// DOM элементы
let currentSection = 'devices';
let pinnedDevices = [];
let devicesCache = [];
let refreshInterval = null;
let deviceStatusTimers = new Map();
// Время последнего "онлайн" по MAC (для задержки офлайн)
let lastOnlineTimeByMac = new Map();

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
  if (!window.electronAPI) {
    showError('API недоступен');
    return;
  }
  
  // Загружаем закрепленные устройства
  await loadPinnedDevices();
  
  // Загружаем данные
  await loadAllData();
  
  // Настраиваем обработчики
  setupEventListeners();
  
  // Настраиваем автообновление
  setupAutoRefresh();
});

// Загрузка закрепленных устройств
async function loadPinnedDevices() {
  try {
    pinnedDevices = await window.electronAPI.getPinnedDevices() || [];
  } catch (error) {
    pinnedDevices = [];
  }
}

// Сохранение закрепленных устройств
async function savePinnedDevices() {
  try {
    await window.electronAPI.savePinnedDevices(pinnedDevices);
  } catch (error) {
    console.error('Ошибка сохранения закрепленных устройств:', error);
  }
}

// Загрузка всех данных
async function loadAllData() {
  try {
    await loadSettings();
    await loadDevices();
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
    showError('Ошибка загрузки: ' + error.message);
  }
}

// Загрузка настроек
async function loadSettings() {
  try {
    const settings = await window.electronAPI.getSettings();
    
    // Заполняем форму
    document.getElementById('routerIp').value = settings.routerIp || '192.168.1.1';
    document.getElementById('routerPort').value = settings.routerPort || '81';
    document.getElementById('routerUsername').value = settings.routerUsername || 'admin';
    document.getElementById('routerPassword').value = settings.routerPassword || '';
    document.getElementById('vpnPolicy').value = settings.vpnPolicy || 'Policy0';
    document.getElementById('noVpnPolicy').value = settings.noVpnPolicy || 'Policy1';
    
    // Настройки отображения
    document.getElementById('showMac').checked = settings.showMac !== false;
    document.getElementById('showIp').checked = settings.showIp !== false;
    document.getElementById('showStats').checked = settings.showStats !== false;
    
    // Настройки автообновления
    document.getElementById('autoRefresh').checked = settings.autoRefresh !== false;
    document.getElementById('refreshInterval').value = settings.refreshInterval || 10;
    document.getElementById('offlineDelay').value = settings.offlineDelay || 5;
    
  } catch (error) {
    console.error('Ошибка загрузки настроек:', error);
  }
}

// Сохранение настроек
async function saveSettings() {
  showLoading();
  
  try {
    const settings = {
      routerIp: document.getElementById('routerIp').value,
      routerPort: document.getElementById('routerPort').value,
      routerUsername: document.getElementById('routerUsername').value,
      routerPassword: document.getElementById('routerPassword').value,
      vpnPolicy: document.getElementById('vpnPolicy').value,
      noVpnPolicy: document.getElementById('noVpnPolicy').value,
      showMac: document.getElementById('showMac').checked,
      showIp: document.getElementById('showIp').checked,
      showStats: document.getElementById('showStats').checked,
      autoRefresh: document.getElementById('autoRefresh').checked,
      refreshInterval: parseInt(document.getElementById('refreshInterval').value) || 10,
      offlineDelay: parseInt(document.getElementById('offlineDelay').value) || 5
    };
    
    const result = await window.electronAPI.saveSettings(settings);
    
    if (result.success) {
      showNotification('Настройки сохранены', 'success');
      await loadDevices();
      setupAutoRefresh(); // Перезапускаем автообновление
    } else {
      showNotification('Ошибка сохранения', 'error');
    }
  } catch (error) {
    showNotification('Ошибка: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

// Настройка автообновления
function setupAutoRefresh() {
  // Останавливаем предыдущий интервал
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  
  // Загружаем настройки для проверки автообновления
  window.electronAPI.getSettings().then(settings => {
    if (settings.autoRefresh) {
      const interval = (settings.refreshInterval || 10) * 1000; // в секундах
      refreshInterval = setInterval(() => {
        loadDevices();
      }, interval);
      
    }
  });
}

// Загрузка устройств
async function loadDevices() {
  try {
    const devices = await window.electronAPI.getDevices();
    devicesCache = devices;
    
    // Применяем задержку для офлайн статуса
    const settings = await window.electronAPI.getSettings();
    const offlineDelay = (settings.offlineDelay || 5) * 1000;
    const now = Date.now();
    
    devices.forEach(device => {
      const deviceKey = device.mac;
      
      if (device.online) {
        lastOnlineTimeByMac.set(deviceKey, now);
        if (deviceStatusTimers.has(deviceKey)) {
          clearTimeout(deviceStatusTimers.get(deviceKey));
          deviceStatusTimers.delete(deviceKey);
        }
        device.displayOnline = true;
      } else {
        const lastOnline = lastOnlineTimeByMac.get(deviceKey);
        if (lastOnline === undefined) {
          device.displayOnline = false;
        } else {
          const timeSinceLastSeen = now - lastOnline;
          if (timeSinceLastSeen > offlineDelay) {
            device.displayOnline = false;
            if (deviceStatusTimers.has(deviceKey)) {
              clearTimeout(deviceStatusTimers.get(deviceKey));
              deviceStatusTimers.delete(deviceKey);
            }
          } else {
            device.displayOnline = true;
            if (!deviceStatusTimers.has(deviceKey)) {
              const remainingTime = offlineDelay - timeSinceLastSeen;
              const timer = setTimeout(() => {
                lastOnlineTimeByMac.delete(deviceKey);
                deviceStatusTimers.delete(deviceKey);
                updateDeviceDisplay(deviceKey, false);
              }, remainingTime);
              deviceStatusTimers.set(deviceKey, timer);
            }
          }
        }
      }
    });
    
    await displayDevices(devices);
    await updateStats(devices);
    
  } catch (error) {
    console.error('Ошибка загрузки устройств:', error);
  }
}

// Обновление отображения конкретного устройства
function updateDeviceDisplay(mac, online) {
  const row = document.querySelector(`tr[data-mac="${mac}"]`);
  if (row) {
    const statusCell = row.querySelector('.device-status');
    if (statusCell) {
      const indicator = statusCell.querySelector('.status-indicator');
      const text = statusCell.querySelector('span:last-child');
      
      if (indicator) {
        indicator.className = `status-indicator ${online ? 'online' : 'offline'}`;
        indicator.title = online ? 'Устройство в сети' : 'Устройство не в сети';
        if (online) {
          indicator.style.animation = 'pulse 2s infinite';
        } else {
          indicator.style.animation = 'none';
        }
      }
      
      if (text) {
        text.textContent = online ? 'Онлайн' : 'Оффлайн';
        text.style.color = online ? 'var(--success-color)' : 'var(--error-color)';
      }
    }
  }
}

// Обновление заголовков таблицы
function updateTableHeaders(showIp, showMac) {
  const table = document.querySelector('.devices-table');
  if (!table) return;
  
  const thead = table.querySelector('thead');
  if (!thead) return;
  
  const headerRow = thead.querySelector('tr');
  if (!headerRow) return;

  // Построим заголовки в правильном порядке, без колонки действий
  const headers = [];
  headers.push({ text: 'Устройство', cls: 'col-name' });
  if (showIp) headers.push({ text: 'IP адрес', cls: 'col-ip ip-header' });
  if (showMac) headers.push({ text: 'MAC адрес', cls: 'col-mac mac-header' });
  headers.push({ text: 'Статус', cls: 'col-status' });
  headers.push({ text: 'VPN', cls: 'col-policy' });
  headers.push({ text: '', cls: 'col-pin' });

  headerRow.innerHTML = '';
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h.text;
    th.className = h.cls;
    headerRow.appendChild(th);
  });
}

// Отображение устройств
async function displayDevices(devices) {
  const tbody = document.getElementById('devicesTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (!devices || devices.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 9;
    cell.textContent = 'Нет устройств для отображения';
    cell.className = 'no-devices';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  
  // Загружаем настройки
  const settings = await window.electronAPI.getSettings();
  const showIp = settings.showIp !== false;
  const showMac = settings.showMac !== false;
  
  // Обновляем заголовки таблицы
  updateTableHeaders(showIp, showMac);
  
  // Разделяем на закрепленные и обычные
  const pinned = [];
  const unpinned = [];
  
  devices.forEach(device => {
    if (pinnedDevices.includes(device.mac)) {
      pinned.push(device);
    } else {
      unpinned.push(device);
    }
  });
  
  // Сортируем закрепленные: сначала онлайн, потом офлайн, затем по порядку в pinnedDevices
  const sortedPinned = pinned.sort((a, b) => {
    const onlineA = a.displayOnline !== false ? 1 : 0;
    const onlineB = b.displayOnline !== false ? 1 : 0;
    if (onlineB !== onlineA) return onlineB - onlineA;
    return pinnedDevices.indexOf(a.mac) - pinnedDevices.indexOf(b.mac);
  });
  
  // Сортируем незакрепленные: сначала онлайн, потом офлайн, потом по имени
  const sortedUnpinned = unpinned.sort((a, b) => {
    const onlineA = a.displayOnline !== false ? 1 : 0;
    const onlineB = b.displayOnline !== false ? 1 : 0;
    if (onlineB !== onlineA) return onlineB - onlineA;
    return (a.name || '').localeCompare(b.name || '');
  });
  
  // Объединяем
  const sortedDevices = [...sortedPinned, ...sortedUnpinned];
  
  // Обновляем заголовок (счётчик "онлайн" только если включена статистика)
  const header = document.querySelector('.devices-header h2');
  if (header) {
    if (settings.showStats) {
      const onlineCount = devices.filter(d => d.displayOnline !== false).length;
      header.textContent = `Устройства сети (${devices.length}, онлайн: ${onlineCount})`;
    } else {
      header.textContent = `Устройства сети (${devices.length})`;
    }
  }
  
  // Отображаем устройства
  sortedDevices.forEach((device, index) => {
    const row = document.createElement('tr');
    row.dataset.mac = device.mac;
    if (pinnedDevices.includes(device.mac)) {
      row.classList.add('pinned');
      row.draggable = true;
      
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', device.mac);
      });
      
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drag-over');
      });
      
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });
      
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const draggedMac = e.dataTransfer.getData('text/plain');
        movePinnedDevice(draggedMac, device.mac);
      });
    }
    
    // Кнопка закрепления (звёздочка)
    const pinCell = document.createElement('td');
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    // modern star SVG (filled when pinned)
    if (pinnedDevices.includes(device.mac)) {
      pinBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 17.3l6.18 3.73-1.64-7.03L21.5 9.5l-7.19-.62L12 2 9.69 8.88 2.5 9.5l5.96 4.5L6.82 21z"/></svg>`;
      pinBtn.title = 'Открепить';
    } else {
      pinBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l2.31 6.88L21.5 9.5l-5 3.86L17.18 21 12 17.3 6.82 21l1.68-7.64-5-3.86 7.19-0.62L12 2z"/></svg>`;
      pinBtn.title = 'Закрепить';
    }
    pinBtn.onclick = (e) => {
      e.stopPropagation();
      togglePinDevice(device.mac);
    };
    pinCell.appendChild(pinBtn);
    pinCell.className = 'pin-cell';
    
    // Имя
    const nameCell = document.createElement('td');
    const nameValue = document.createElement('div');
    nameValue.className = 'device-name';
    nameValue.textContent = device.name || 'Неизвестное устройство';
    nameValue.title = `MAC: ${device.mac}`;
    nameCell.appendChild(nameValue);
    
    // IP (если включено в настройках)
    const ipCell = document.createElement('td');
    ipCell.className = 'ip-cell';
    const ipLabel = document.createElement('div'); ipLabel.className = 'cell-label'; ipLabel.textContent = 'IP';
    const ipValue = document.createElement('div'); ipValue.className = 'cell-value';
    if (showIp) {
      ipValue.textContent = device.ip || 'Не в сети';
      if (!device.ip || device.ip === 'Не в сети') ipValue.classList.add('no-ip');
      ipCell.appendChild(ipLabel);
      ipCell.appendChild(ipValue);
    } else {
      ipCell.classList.add('hidden');
    }
    
    // MAC (если включено в настройках)
    const macCell = document.createElement('td');
    macCell.className = 'mac-cell';
    const macLabel = document.createElement('div'); macLabel.className = 'cell-label'; macLabel.textContent = 'MAC';
    const macValue = document.createElement('div'); macValue.className = 'cell-value';
    if (showMac) {
      macValue.textContent = device.mac || '';
      macCell.appendChild(macLabel);
      macCell.appendChild(macValue);
    } else {
      macCell.classList.add('hidden');
    }
    
    // Статус
    const statusCell = document.createElement('td');
    const statusDiv = document.createElement('div'); statusDiv.className = 'device-status';
    const indicator = document.createElement('span');
    indicator.className = `status-indicator ${device.displayOnline !== false ? 'online' : 'offline'}`;
    indicator.title = device.displayOnline !== false ? 'Устройство в сети' : 'Устройство не в сети';
    const text = document.createElement('span'); text.textContent = device.displayOnline !== false ? 'Онлайн' : 'Оффлайн';
    statusDiv.appendChild(indicator);
    statusDiv.appendChild(text);
    statusCell.appendChild(statusDiv);
    
    // Политика с кнопкой переключения
    const policyCell = document.createElement('td');
    const policyContainer = document.createElement('div');
    policyContainer.className = 'policy-container';
    
    const toggleBtn = document.createElement('button');
    toggleBtn.className = `policy-toggle ${device.policy === 'Policy0' ? 'vpn-on' : 'vpn-off'}`;
    toggleBtn.dataset.mac = device.mac || '';
    toggleBtn.dataset.currentPolicy = device.policy || 'Policy1';
    
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'toggle-icon';
    toggleIcon.textContent = device.policy === 'Policy0' ? '🔒' : '🌐';
    
    const toggleText = document.createElement('span');
    toggleText.className = 'toggle-text';
    toggleText.textContent = device.policy === 'Policy0' ? ' VPN' : ' Нет';
    
    toggleBtn.appendChild(toggleIcon);
    toggleBtn.appendChild(toggleText);
    
    toggleBtn.onclick = function(e) {
      e.stopPropagation();
      const currentPolicy = this.dataset.currentPolicy;
      const newPolicy = currentPolicy === 'Policy0' ? 'Policy1' : 'Policy0';
      updateDevicePolicy(this.dataset.mac, newPolicy);
    };
    
    policyContainer.appendChild(toggleBtn);
    policyCell.appendChild(policyContainer);
    
    // On small screens open modal with details when row clicked (but not when clicking buttons)
    row.addEventListener('click', (e) => {
      const isButton = e.target.closest('button');
      if (isButton) return;
      if (window.innerWidth <= 480) {
        showDeviceModal(device);
      }
    });
    
    // Собираем строку (номер убран). Пин перемещён вправо перед действиями
    row.appendChild(nameCell);
    
    // Добавляем ячейки только если они включены в настройках
    if (showIp) {
      row.appendChild(ipCell);
    }
    if (showMac) {
      row.appendChild(macCell);
    }

    row.appendChild(statusCell);
    row.appendChild(policyCell);
    row.appendChild(pinCell);
    
    tbody.appendChild(row);
  });
}

// Показать детальную информацию об устройстве в модальном окне (мобильные)
function showDeviceModal(device) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <span class="close-modal">&times;</span>
    <h3>${device.name || 'Устройство'}</h3>
    <p><strong>IP:</strong> ${device.ip || 'Не в сети'}</p>
    <p><strong>MAC:</strong> ${device.mac || ''}</p>
    <p><strong>Статус:</strong> ${device.displayOnline !== false ? 'Онлайн' : 'Оффлайн'}</p>
    <div style="margin-top:16px; display:flex; gap:8px;">
      <button class="btn btn-secondary" id="modalRefresh">Обновить</button>
      <button class="btn btn-primary" id="modalTogglePolicy">Переключить VPN</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  content.querySelector('.close-modal').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  content.querySelector('#modalRefresh').onclick = async (e) => {
    e.stopPropagation();
    await loadDevices();
    modal.remove();
  };

  content.querySelector('#modalTogglePolicy').onclick = async (e) => {
    e.stopPropagation();
    const newPolicy = device.policy === 'Policy0' ? 'Policy1' : 'Policy0';
    await updateDevicePolicy(device.mac, newPolicy);
    modal.remove();
  };
}

// Перемещение закрепленного устройства
function movePinnedDevice(draggedMac, targetMac) {
  const draggedIndex = pinnedDevices.indexOf(draggedMac);
  const targetIndex = pinnedDevices.indexOf(targetMac);
  
  if (draggedIndex > -1 && targetIndex > -1) {
    // Удаляем из текущей позиции
    pinnedDevices.splice(draggedIndex, 1);
    // Вставляем перед целевым элементом
    pinnedDevices.splice(targetIndex, 0, draggedMac);
    
    savePinnedDevices();
    loadDevices();
  }
}

// Закрепить/открепить устройство
async function togglePinDevice(mac) {
  try {
    if (pinnedDevices.includes(mac)) {
      // Открепляем
      pinnedDevices = pinnedDevices.filter(m => m !== mac);
      showNotification('Устройство откреплено', 'success');
    } else {
      // Закрепляем
      pinnedDevices.push(mac);
      showNotification('Устройство закреплено', 'success');
    }
    
    await savePinnedDevices();
    await loadDevices();
    
  } catch (error) {
    showNotification('Ошибка: ' + error.message, 'error');
  }
}

// Обновление политики
async function updateDevicePolicy(mac, policy) {
  if (!mac) return;
  
  showLoading();
  
  try {
    const result = await window.electronAPI.updateDevicePolicy(mac, policy);
    
    if (result.success) {
      showNotification('Политика обновлена', 'success');
      await loadDevices();
    } else {
      showNotification('Ошибка обновления', 'error');
    }
  } catch (error) {
    showNotification('Ошибка: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

// Обновление статистики
async function updateStats(devices) {
  if (!devices) return;
  
  const settings = await window.electronAPI.getSettings();
  
  // Скрываем раздел статистики если опция выключена
  const statsSection = document.getElementById('statsSection');
  if (statsSection) {
    if (!settings.showStats) {
      statsSection.classList.add('hidden');
      statsSection.classList.remove('active');
      if (currentSection === 'stats') {
        showSection('devices');
      }
    } else {
      statsSection.classList.remove('hidden');
    }
  }
  
  // Показываем/скрываем кнопку статистики в сайдбаре
  const statsNavBtn = document.querySelector('[data-section="stats"]');
  if (statsNavBtn) {
    if (settings.showStats) {
      statsNavBtn.classList.remove('hidden');
    } else {
      statsNavBtn.classList.add('hidden');
    }
  }
  
  // Если статистика отключена, выходим
  if (!settings.showStats) return;
  
  const total = devices.length;
  const online = devices.filter(d => d.displayOnline !== false).length;
  const vpn = devices.filter(d => d.policy === 'Policy0').length;
  
  const totalEl = document.getElementById('totalDevices');
  const onlineEl = document.getElementById('onlineDevices');
  const vpnEl = document.getElementById('vpnDevices');
  
  if (totalEl) totalEl.textContent = total;
  if (onlineEl) onlineEl.textContent = online;
  if (vpnEl) vpnEl.textContent = vpn;
}

// Тестирование API
async function testApiEndpoints() {
  showLoading();
  
  try {
    const results = await window.electronAPI.testApiEndpoints();
    showApiResults(results);
  } catch (error) {
    showNotification('Ошибка тестирования: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

// Показать результаты тестирования
function showApiResults(results) {
  let html = '<div class="api-test-results"><h3>Результаты тестирования API</h3>';
  
  results.forEach(result => {
    html += `
      <div class="api-endpoint">
        <div class="api-endpoint-header">
          <strong>${result.endpoint}:</strong>
          <span class="api-path">${result.path || ''}</span>
          <span class="api-status ${result.status.includes('✅') ? 'api-success' : 'api-error'}">
            ${result.status}
          </span>
        </div>
        ${result.url ? `<div><small>URL: ${result.url}</small></div>` : ''}
      </div>
    `;
  });
  
  html += `
    <div class="api-tips">
      <h4>Проверьте:</h4>
      <ul>
        <li>Правильность IP и порта в настройках</li>
        <li>Пароль администратора роутера</li>
        <li>Доступность роутера в сети</li>
      </ul>
    </div>
  `;
  
  html += '</div>';
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close-modal">&times;</span>
      ${html}
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.close-modal').onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
}

// Переключение разделов
function showSection(sectionId) {
  // Проверка статистики
  if (sectionId === 'stats') {
    window.electronAPI.getSettings().then(settings => {
      if (!settings.showStats) {
        showSection('devices');
        return;
      }
      activateSection(sectionId);
    });
    return;
  }
  
  activateSection(sectionId);
}

function activateSection(sectionId) {
  // Скрываем все разделы
  document.querySelectorAll('.content-section').forEach(s => {
    s.classList.remove('active');
  });
  
  // Убираем активный класс у всех кнопок
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
  });
  
  // Активируем нужный раздел
  const section = document.getElementById(sectionId + 'Section');
  if (section) {
    section.classList.add('active');
  }
  
  // Активируем нужную кнопку
  const btn = document.querySelector(`[data-section="${sectionId}"]`);
  if (btn) btn.classList.add('active');
  
  currentSection = sectionId;
  
  if (sectionId === 'devices') {
    loadDevices();
  }
}

// Настройка обработчиков
function setupEventListeners() {
  // Навигация между разделами
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-section]');
    if (navBtn) {
      showSection(navBtn.dataset.section);
    }
  });
  
  document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);
  document.getElementById('refreshDevicesBtn')?.addEventListener('click', loadDevices);
  document.getElementById('testApiBtn')?.addEventListener('click', testApiEndpoints);
  
  // Переключение отображения MAC/IP
  document.getElementById('showMac')?.addEventListener('change', loadDevices);
  document.getElementById('showIp')?.addEventListener('change', loadDevices);
  document.getElementById('showStats')?.addEventListener('change', async () => {
    await updateStats(devicesCache);
  });
  
  // Настройки автообновления
  document.getElementById('autoRefresh')?.addEventListener('change', setupAutoRefresh);
  document.getElementById('refreshInterval')?.addEventListener('change', setupAutoRefresh);
  document.getElementById('offlineDelay')?.addEventListener('change', () => {
    // Сбрасываем все таймеры при изменении задержки
    deviceStatusTimers.forEach(timer => clearTimeout(timer));
    deviceStatusTimers.clear();
    loadDevices();
  });
}

// Вспомогательные функции
function showLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) notification.remove();
  }, 3000);
}

function showError(message) {
  showNotification(message, 'error');
}