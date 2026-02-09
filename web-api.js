/** Web API fallback when not in Electron. Uses localStorage; requests go via npm run web server. */
(function () {
  if (typeof window !== 'undefined' && window.electronAPI) return;

  const STORAGE_SETTINGS = 'keenetic-vpn-settings';
  const STORAGE_PINNED = 'keenetic-vpn-pinned';
  const defaultSettings = {
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

  function getBaseUrl() {
    return window.location.origin;
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_SETTINGS);
      if (!raw) return Promise.resolve({ ...defaultSettings });
      return Promise.resolve({ ...defaultSettings, ...JSON.parse(raw) });
    } catch (e) {
      return Promise.resolve({ ...defaultSettings });
    }
  }

  function saveSettings(settings) {
    try {
      const full = { ...defaultSettings, ...settings };
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(full));
      return Promise.resolve({ success: true, settings: full });
    } catch (e) {
      return Promise.resolve({ success: false, error: e.message });
    }
  }

  function getPinnedDevices() {
    try {
      const raw = localStorage.getItem(STORAGE_PINNED);
      if (!raw) return Promise.resolve([]);
      return Promise.resolve(JSON.parse(raw));
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  function savePinnedDevices(pinnedDevices) {
    try {
      localStorage.setItem(STORAGE_PINNED, JSON.stringify(pinnedDevices));
      return Promise.resolve({ success: true });
    } catch (e) {
      return Promise.resolve({ success: false, error: e.message });
    }
  }

  async function getDevices() {
    const settings = await getSettings();
    const body = {
      routerIp: settings.routerIp,
      routerPort: settings.routerPort,
      routerUsername: settings.routerUsername,
      routerPassword: settings.routerPassword,
      vpnPolicy: settings.vpnPolicy,
      noVpnPolicy: settings.noVpnPolicy
    };
    const res = await fetch(getBaseUrl() + '/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(res.statusText || 'Ошибка загрузки устройств');
    return res.json();
  }

  async function updateDevicePolicy(mac, policy) {
    const settings = await getSettings();
    const res = await fetch(getBaseUrl() + '/api/update-policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routerIp: settings.routerIp,
        routerPort: settings.routerPort,
        routerUsername: settings.routerUsername,
        routerPassword: settings.routerPassword,
        mac: mac,
        policy: policy
      })
    });
    const data = await res.json().catch(() => ({}));
    return data;
  }

  async function testApiEndpoints() {
    const settings = await getSettings();
    const res = await fetch(getBaseUrl() + '/api/test-endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routerIp: settings.routerIp,
        routerPort: settings.routerPort,
        routerUsername: settings.routerUsername,
        routerPassword: settings.routerPassword
      })
    });
    if (!res.ok) return [{ endpoint: 'Ошибка', status: '❌ ' + res.statusText }];
    return res.json();
  }

  function onRefreshDevices(callback) {
    if (typeof callback === 'function') {
      window.addEventListener('refresh-devices', callback);
      return function () {
        window.removeEventListener('refresh-devices', callback);
      };
    }
  }

  window.electronAPI = {
    getDevices: getDevices,
    updateDevicePolicy: updateDevicePolicy,
    getSettings: getSettings,
    saveSettings: saveSettings,
    testApiEndpoints: testApiEndpoints,
    getPinnedDevices: getPinnedDevices,
    savePinnedDevices: savePinnedDevices,
    onRefreshDevices: onRefreshDevices
  };
})();
