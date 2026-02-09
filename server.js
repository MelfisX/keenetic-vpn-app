/**
 * Веб-сервер для Keenetic VPN Manager.
 * Раздаёт приложение и проксирует запросы к роутеру (для работы в браузере на любом устройстве).
 * Запуск: npm run web
 * Откройте http://localhost:3000 (или http://IP_ВАШЕГО_ПК:3000 с телефона в той же Wi‑Fi сети).
 */

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// CORS для запросов с других устройств в локальной сети
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ——— Логика API роутера (как в main.js) ———
function getTestDevices() {
  return [
    { mac: '66:B7:08:8A:CC:6C', name: 'warmCont1', ip: '192.168.1.54', policy: 'Policy0', online: true, lastSeen: Date.now(), interface: 'Bridge0' },
    { mac: '66:B7:08:8A:D1:24', name: 'warmCont2', ip: '192.168.1.141', policy: 'Policy1', online: true, lastSeen: Date.now(), interface: 'Bridge0' },
    { mac: 'C8:2E:18:C0:8C:BC', name: 'Шлюз zigbee', ip: '192.168.1.53', policy: 'Policy1', online: false, lastSeen: Date.now() - 60000, interface: 'Bridge0' }
  ];
}

async function fetchKnownHosts(baseUrl, auth) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${baseUrl}/rci/known/host`, { headers: { 'Authorization': auth }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return {};
    const data = await response.json();
    return data.known?.host || data || {};
  } catch (e) {
    return {};
  }
}

async function fetchArpTable(baseUrl, auth) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${baseUrl}/rci/show/ip/arp`, { headers: { 'Authorization': auth }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function fetchHotspotHosts(baseUrl, auth) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${baseUrl}/rci/ip/hotspot/host`, { headers: { 'Authorization': auth }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') return Object.values(data);
    return [];
  } catch (e) {
    return [];
  }
}

function filterLocalDevices(devices, routerIp) {
  const routerSubnet = routerIp.substring(0, routerIp.lastIndexOf('.'));
  return devices.filter(device => {
    if (!device.ip || device.ip === 'Не в сети') return true;
    const ip = device.ip;
    if (ip.startsWith('10.')) return ip.startsWith(routerSubnet);
    if (ip.startsWith('172.')) {
      const secondOctet = parseInt(ip.split('.')[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return ip.startsWith(routerSubnet);
    }
    if (ip.startsWith('192.168.')) return ip.startsWith(routerSubnet);
    if (ip.startsWith('169.254.')) return false;
    if (ip.startsWith('100.')) {
      const secondOctet = parseInt(ip.split('.')[1]);
      if (secondOctet >= 64 && secondOctet <= 127) return false;
    }
    if (device.interface && (device.interface.includes('GigabitEthernet') || device.interface.includes('PPPoE') || device.interface.includes('ISP') || device.interface.includes('WAN'))) return false;
    return true;
  });
}

function mergeDeviceData(knownHosts, arpEntries, hotspotEntries, credentials) {
  const devicesMap = new Map();
  const { noVpnPolicy } = credentials;
  const arpMap = new Map();
  arpEntries.forEach(entry => {
    if (entry.mac) {
      const mac = entry.mac.toLowerCase();
      arpMap.set(mac, { ip: entry.ip || entry.address || '', online: entry.state === 'REACHABLE', lastSeen: Date.now(), interface: entry.interface || '' });
    }
  });
  const hotspotMap = new Map();
  hotspotEntries.forEach(entry => {
    if (entry.mac) {
      const mac = entry.mac.toLowerCase();
      hotspotMap.set(mac, { policy: entry.policy || noVpnPolicy, lastSeen: Date.now() });
    }
  });
  Object.entries(knownHosts).forEach(([name, info]) => {
    if (info && info.mac) {
      const mac = info.mac.toLowerCase();
      const arpInfo = arpMap.get(mac);
      const hotspotInfo = hotspotMap.get(mac);
      const policy = (hotspotInfo && hotspotInfo.policy) || noVpnPolicy;
      const online = !!(arpInfo && arpInfo.online);
      devicesMap.set(mac, { mac: info.mac, name: name, ip: arpInfo ? arpInfo.ip : '', policy, online, lastSeen: arpInfo ? arpInfo.lastSeen : Date.now(), interface: arpInfo ? arpInfo.interface : '' });
    }
  });
  arpEntries.forEach(entry => {
    if (entry.mac && !devicesMap.has(entry.mac.toLowerCase())) {
      const mac = entry.mac.toLowerCase();
      const hotspotInfo = hotspotMap.get(mac);
      devicesMap.set(mac, { mac: entry.mac, name: entry.name || `Устройство ${entry.mac.replace(/:/g, '').substring(0, 8)}`, ip: entry.ip || entry.address || '', policy: hotspotInfo ? hotspotInfo.policy : noVpnPolicy, online: entry.state === 'REACHABLE', lastSeen: Date.now(), interface: entry.interface || '' });
    }
  });
  hotspotEntries.forEach(entry => {
    if (entry.mac && !devicesMap.has(entry.mac.toLowerCase())) {
      const mac = entry.mac.toLowerCase();
      devicesMap.set(mac, { mac: entry.mac, name: entry.hostname || entry.name || `Устройство ${entry.mac.replace(/:/g, '').substring(0, 8)}`, ip: '', policy: entry.policy || noVpnPolicy, online: false, lastSeen: Date.now(), interface: '' });
    }
  });
  const devices = Array.from(devicesMap.values());
  devices.sort((a, b) => (a.online !== b.online ? (b.online ? 1 : -1) : a.name.localeCompare(b.name)));
  return devices;
}

async function getDevicesFromRouter(credentials) {
  try {
    const { routerIp, routerPort, routerUsername, routerPassword, vpnPolicy, noVpnPolicy } = credentials;
    if (!routerIp || !routerPort) return getTestDevices();
    const baseUrl = `http://${routerIp}:${routerPort}`;
    const auth = 'Basic ' + Buffer.from(`${routerUsername || ''}:${routerPassword || ''}`).toString('base64');
    const creds = { ...credentials, vpnPolicy: vpnPolicy || 'Policy0', noVpnPolicy: noVpnPolicy || 'Policy1' };
    const [knownHostsData, arpData, hotspotData] = await Promise.allSettled([
      fetchKnownHosts(baseUrl, auth),
      fetchArpTable(baseUrl, auth),
      fetchHotspotHosts(baseUrl, auth)
    ]);
    const knownHosts = knownHostsData.status === 'fulfilled' ? knownHostsData.value : {};
    const arpEntries = arpData.status === 'fulfilled' ? arpData.value : [];
    const hotspotEntries = hotspotData.status === 'fulfilled' ? hotspotData.value : [];
    const devices = mergeDeviceData(knownHosts, arpEntries, hotspotEntries, creds);
    return filterLocalDevices(devices, routerIp);
  } catch (err) {
    console.error(err);
    return getTestDevices();
  }
}

async function updateDevicePolicyOnRouter(credentials, mac, policy) {
  try {
    const { routerIp, routerPort, routerUsername, routerPassword } = credentials;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`http://${routerIp}:${routerPort}/rci/ip/hotspot/host`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${routerUsername || ''}:${routerPassword || ''}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mac, policy }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    return { success: response.ok };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function testApiEndpoints(credentials) {
  try {
    const { routerIp, routerPort, routerUsername, routerPassword } = credentials;
    if (!routerIp || !routerPort) return [{ endpoint: 'Ошибка', status: '❌ Настройки не загружены' }];
    const baseUrl = `http://${routerIp}:${routerPort}`;
    const auth = 'Basic ' + Buffer.from(`${routerUsername || ''}:${routerPassword || ''}`).toString('base64');
    const endpoints = [
      { name: 'Known Hosts', path: '/rci/known/host' },
      { name: 'ARP Table', path: '/rci/show/ip/arp' },
      { name: 'Hotspot Hosts', path: '/rci/ip/hotspot/host' }
    ];
    const results = [];
    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${baseUrl}${ep.path}`, { headers: { 'Authorization': auth }, signal: controller.signal });
        clearTimeout(timeout);
        let deviceCount = 0;
        if (response.ok) {
          const data = await response.json();
          if (ep.path === '/rci/known/host') deviceCount = Object.keys(data.known?.host || data || {}).length;
          else if (ep.path === '/rci/show/ip/arp') deviceCount = Array.isArray(data) ? data.length : 0;
          else if (ep.path === '/rci/ip/hotspot/host') deviceCount = Array.isArray(data) ? data.length : (typeof data === 'object' ? Object.values(data).length : 0);
        }
        results.push({ endpoint: ep.name, path: ep.path, status: response.ok ? `✅ Работает (${deviceCount} устройств)` : `❌ Ошибка ${response.status}`, url: `${baseUrl}${ep.path}` });
      } catch (err) {
        results.push({ endpoint: ep.name, path: ep.path, status: '❌ Ошибка: ' + err.message, url: `${baseUrl}${ep.path}` });
      }
    }
    return results;
  } catch (err) {
    return [{ endpoint: 'Ошибка', status: '❌ ' + err.message }];
  }
}

// ——— API для веб-клиента ———
app.post('/api/devices', async (req, res) => {
  try {
    const devices = await getDevicesFromRouter(req.body);
    res.json(devices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/update-policy', async (req, res) => {
  try {
    const { routerIp, routerPort, routerUsername, routerPassword, mac, policy } = req.body;
    const result = await updateDevicePolicyOnRouter({ routerIp, routerPort, routerUsername, routerPassword }, mac, policy);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/test-endpoints', async (req, res) => {
  try {
    const results = await testApiEndpoints(req.body);
    res.json(results);
  } catch (e) {
    res.status(500).json([{ endpoint: 'Ошибка', status: '❌ ' + e.message }]);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Keenetic VPN Manager (веб) доступен по адресу http://localhost:${PORT}`);
  console.log(`С других устройств в той же Wi‑Fi сети: http://<IP этого ПК>:${PORT}`);
});
