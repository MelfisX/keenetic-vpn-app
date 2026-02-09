const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow;

// Пути к данным пользователя (работают на всех ОС: Windows, macOS, Linux)
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function getPinnedPath() {
  return path.join(app.getPath('userData'), 'pinned.json');
}

// Конфигурация по умолчанию
const defaultConfig = {
  routerIp: '192.168.1.1',
  routerPort: '81',
  routerUsername: 'admin',
  routerPassword: '',
  vpnPolicy: 'Policy0',
  noVpnPolicy: 'Policy1',
  showMac: true,
  showIp: true,
  showStats: true,
  autoRefresh: true,
  refreshInterval: 10,
  offlineDelay: 5
};

async function createWindow() {
  const iconPath = path.join(__dirname, 'icons', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  // DevTools только в режиме разработки
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Создание меню приложения
function createMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Обновить устройства',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('refresh-devices');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Выход',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Чтение настроек
async function readSettings() {
  try {
    const data = await fs.readFile(getSettingsPath(), 'utf8');
    const settings = JSON.parse(data);
    return { ...defaultConfig, ...settings };
  } catch (error) {
    await saveSettings(defaultConfig);
    return defaultConfig;
  }
}

// Сохранение настроек
async function saveSettings(settings) {
  try {
    const fullSettings = { ...defaultConfig, ...settings };
    await fs.writeFile(getSettingsPath(), JSON.stringify(fullSettings, null, 2));
    return { success: true, settings: fullSettings };
  } catch (error) {
    console.error('Ошибка сохранения настроек:', error);
    return { success: false, error: error.message };
  }
}

// Чтение закрепленных устройств
async function readPinnedDevices() {
  try {
    const data = await fs.readFile(getPinnedPath(), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Сохранение закрепленных устройств
async function savePinnedDevices(pinnedDevices) {
  try {
    await fs.writeFile(getPinnedPath(), JSON.stringify(pinnedDevices, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Основная функция получения устройств
async function getDevicesFromRouter(credentials) {
  try {
    const { routerIp, routerPort, routerUsername, routerPassword } = credentials;
    
    if (!routerIp || !routerPort) {
      return getTestDevices();
    }
    
    const baseUrl = `http://${routerIp}:${routerPort}`;
    const auth = 'Basic ' + Buffer.from(`${routerUsername}:${routerPassword}`).toString('base64');
    
    // Получаем данные параллельно
    const [knownHostsData, arpData, hotspotData] = await Promise.allSettled([
      fetchKnownHosts(baseUrl, auth),
      fetchArpTable(baseUrl, auth),
      fetchHotspotHosts(baseUrl, auth)
    ]);
    
    const knownHosts = knownHostsData.status === 'fulfilled' ? knownHostsData.value : {};
    const arpEntries = arpData.status === 'fulfilled' ? arpData.value : [];
    const hotspotEntries = hotspotData.status === 'fulfilled' ? hotspotData.value : [];
    
    // Объединяем и фильтруем устройства
    const devices = mergeDeviceData(knownHosts, arpEntries, hotspotEntries, credentials);
    return filterLocalDevices(devices, routerIp);
    
  } catch (error) {
    console.error('Ошибка получения устройств:', error);
    return getTestDevices();
  }
}

// Получение данных с API роутера
async function fetchFromRouter(baseUrl, auth, endpoint) {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: { 'Authorization': auth },
      timeout: 5000
    });
    
    if (!response.ok) return endpoint === '/rci/known/host' ? {} : [];
    return await response.json();
  } catch (error) {
    return endpoint === '/rci/known/host' ? {} : [];
  }
}

// Получение известных хостов
async function fetchKnownHosts(baseUrl, auth) {
  const data = await fetchFromRouter(baseUrl, auth, '/rci/known/host');
  return data.known?.host || data || {};
}

// Получение ARP таблицы
async function fetchArpTable(baseUrl, auth) {
  const data = await fetchFromRouter(baseUrl, auth, '/rci/show/ip/arp');
  return Array.isArray(data) ? data : [];
}

// Получение hotspot хостов
async function fetchHotspotHosts(baseUrl, auth) {
  const data = await fetchFromRouter(baseUrl, auth, '/rci/ip/hotspot/host');
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') return Object.values(data);
  return [];
}

// Фильтрация локальных устройств
function filterLocalDevices(devices, routerIp) {
  const routerSubnet = routerIp.substring(0, routerIp.lastIndexOf('.'));
  
  return devices.filter(device => {
    if (!device.ip || device.ip === 'Не в сети') return true;
    
    const ip = device.ip;
    
    // Фильтруем WAN адреса
    if (ip.startsWith('10.')) {
      return ip.startsWith('10.') && ip.startsWith(routerSubnet);
    }
    
    if (ip.startsWith('172.')) {
      const secondOctet = parseInt(ip.split('.')[1]);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return ip.startsWith(routerSubnet);
      }
    }
    
    if (ip.startsWith('192.168.')) {
      return ip.startsWith(routerSubnet);
    }
    
    if (ip.startsWith('169.254.')) return false;
    if (ip.startsWith('100.')) {
      const secondOctet = parseInt(ip.split('.')[1]);
      if (secondOctet >= 64 && secondOctet <= 127) return false;
    }
    
    // Фильтруем интерфейсы роутера
    if (device.interface && (
      device.interface.includes('GigabitEthernet') ||
      device.interface.includes('PPPoE') ||
      device.interface.includes('ISP') ||
      device.interface.includes('WAN')
    )) return false;
    
    return true;
  });
}

// Объединение данных устройств
function mergeDeviceData(knownHosts, arpEntries, hotspotEntries, credentials) {
  const devicesMap = new Map();
  const { vpnPolicy, noVpnPolicy } = credentials;
  
  // Создаем маппинги
  const arpMap = new Map();
  arpEntries.forEach(entry => {
    if (entry.mac) {
      const mac = entry.mac.toLowerCase();
      arpMap.set(mac, {
        ip: entry.ip || entry.address || '',
        online: entry.state === 'REACHABLE',
        lastSeen: Date.now(),
        interface: entry.interface || ''
      });
    }
  });
  
  const hotspotMap = new Map();
  hotspotEntries.forEach(entry => {
    if (entry.mac) {
      const mac = entry.mac.toLowerCase();
      hotspotMap.set(mac, {
        policy: entry.policy || noVpnPolicy,
        online: entry.online === true, // Только если явно true
        lastSeen: Date.now()
      });
    }
  });
  
  // Добавляем все известные устройства
  Object.entries(knownHosts).forEach(([name, info]) => {
    if (info && info.mac) {
      const mac = info.mac.toLowerCase();
      const arpInfo = arpMap.get(mac);
      const hotspotInfo = hotspotMap.get(mac);
      
      let policy = noVpnPolicy;
      if (hotspotInfo && hotspotInfo.policy) {
        policy = hotspotInfo.policy;
      }
      
      // Определяем статус онлайн: 
      // 1. Если есть в ARP и состояние REACHABLE - онлайн
      // 2. Иначе - офлайн (hotspot online игнорируем, так как он ненадежный)
      let online = false;
      if (arpInfo && arpInfo.online) {
        online = true;
      }
      
      devicesMap.set(mac, {
        mac: info.mac,
        name: name,
        ip: arpInfo ? arpInfo.ip : '',
        policy: policy,
        online: online,
        lastSeen: arpInfo ? arpInfo.lastSeen : Date.now(),
        interface: arpInfo ? arpInfo.interface : ''
      });
    }
  });
  
  // Добавляем устройства из ARP
  arpEntries.forEach(entry => {
    if (entry.mac && !devicesMap.has(entry.mac.toLowerCase())) {
      const mac = entry.mac.toLowerCase();
      const hotspotInfo = hotspotMap.get(mac);
      
      devicesMap.set(mac, {
        mac: entry.mac,
        name: entry.name || `Устройство ${entry.mac.replace(/:/g, '').substring(0, 8)}`,
        ip: entry.ip || entry.address || '',
        policy: hotspotInfo ? hotspotInfo.policy : noVpnPolicy,
        online: entry.state === 'REACHABLE',
        lastSeen: Date.now(),
        interface: entry.interface || ''
      });
    }
  });
  
  // Добавляем устройства из hotspot (только те, которых нет в ARP)
  hotspotEntries.forEach(entry => {
    if (entry.mac && !devicesMap.has(entry.mac.toLowerCase())) {
      const mac = entry.mac.toLowerCase();
      
      devicesMap.set(mac, {
        mac: entry.mac,
        name: entry.hostname || entry.name || `Устройство ${entry.mac.replace(/:/g, '').substring(0, 8)}`,
        ip: '',
        policy: entry.policy || noVpnPolicy,
        online: false, // Все устройства не в ARP - офлайн
        lastSeen: Date.now(),
        interface: ''
      });
    }
  });
  
  // Конвертируем в массив и сортируем: сначала онлайн, потом по имени
  const devices = Array.from(devicesMap.values());
  devices.sort((a, b) => {
    if (a.online !== b.online) {
      return b.online - a.online; // true (1) идет первым, false (0) вторым
    }
    return a.name.localeCompare(b.name);
  });
  
  return devices;
}

// Тестовые устройства
function getTestDevices() {
  return [
    { mac: '66:B7:08:8A:CC:6C', name: 'warmCont1', ip: '192.168.1.54', policy: 'Policy0', online: true, lastSeen: Date.now(), interface: 'Bridge0' },
    { mac: '66:B7:08:8A:D1:24', name: 'warmCont2', ip: '192.168.1.141', policy: 'Policy1', online: true, lastSeen: Date.now(), interface: 'Bridge0' },
    { mac: 'C8:2E:18:C0:8C:BC', name: 'Шлюз zigbee', ip: '192.168.1.53', policy: 'Policy1', online: false, lastSeen: Date.now() - 60000, interface: 'Bridge0' }
  ];
}

// Обновление политики
async function updateDevicePolicyOnRouter(credentials, mac, policy) {
  try {
    const { routerIp, routerPort, routerUsername, routerPassword } = credentials;
    
    const response = await fetch(`http://${routerIp}:${routerPort}/rci/ip/hotspot/host`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${routerUsername}:${routerPassword}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mac, policy })
    });
    
    return { success: response.ok };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Тестирование API
async function testApiEndpoints() {
  const settings = await readSettings();
  const { routerIp, routerPort, routerUsername, routerPassword } = settings;
  
  if (!routerIp || !routerPort) {
    return [{ endpoint: 'Ошибка конфигурации', status: '❌ Настройки не загружены' }];
  }
  
  const baseUrl = `http://${routerIp}:${routerPort}`;
  const auth = 'Basic ' + Buffer.from(`${routerUsername}:${routerPassword}`).toString('base64');
  
  const endpoints = [
    { name: 'Known Hosts', path: '/rci/known/host' },
    { name: 'ARP Table', path: '/rci/show/ip/arp' },
    { name: 'Hotspot Hosts', path: '/rci/ip/hotspot/host' }
  ];
  
  const results = await Promise.all(endpoints.map(async (endpoint) => {
    try {
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        headers: { 'Authorization': auth },
        timeout: 3000
      });
      
      if (!response.ok) {
        return {
          endpoint: endpoint.name,
          path: endpoint.path,
          status: `❌ Ошибка ${response.status}`,
          url: `${baseUrl}${endpoint.path}`
        };
      }
      
      const data = await response.json();
      let deviceCount = 0;
      
      if (endpoint.path === '/rci/known/host') {
        const knownHosts = data.known?.host || data || {};
        deviceCount = Object.keys(knownHosts).length;
      } else {
        deviceCount = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
      }
      
      return {
        endpoint: endpoint.name,
        path: endpoint.path,
        status: `✅ Работает (${deviceCount} устройств)`,
        url: `${baseUrl}${endpoint.path}`
      };
    } catch (error) {
      return {
        endpoint: endpoint.name,
        path: endpoint.path,
        status: `❌ Ошибка: ${error.message}`,
        url: `${baseUrl}${endpoint.path}`
      };
    }
  }));
  
  return results;
}

// IPC обработчики
ipcMain.handle('get-devices', async () => {
  try {
    const settings = await readSettings();
    return await getDevicesFromRouter(settings);
  } catch (error) {
    return getTestDevices();
  }
});

ipcMain.handle('update-device-policy', async (event, { mac, policy }) => {
  try {
    const settings = await readSettings();
    return await updateDevicePolicyOnRouter(settings, mac, policy);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-settings', async () => {
  return await readSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  return await saveSettings(settings);
});

ipcMain.handle('test-api-endpoints', async () => {
  return await testApiEndpoints();
});

ipcMain.handle('get-pinned-devices', async () => {
  return await readPinnedDevices();
});

ipcMain.handle('save-pinned-devices', async (event, pinnedDevices) => {
  return await savePinnedDevices(pinnedDevices);
});

// Запуск приложения
app.whenReady().then(async () => {
  await createWindow();
  createMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});