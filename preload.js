const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Получение устройств
  getDevices: () => ipcRenderer.invoke('get-devices'),
  
  // Обновление политики
  updateDevicePolicy: (mac, policy) => ipcRenderer.invoke('update-device-policy', { mac, policy }),
  
  // Настройки
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // Тестирование API
  testApiEndpoints: () => ipcRenderer.invoke('test-api-endpoints'),
  
  // Закрепленные устройства
  getPinnedDevices: () => ipcRenderer.invoke('get-pinned-devices'),
  savePinnedDevices: (pinnedDevices) => ipcRenderer.invoke('save-pinned-devices', pinnedDevices),
  
  // События
  onRefreshDevices: (callback) => {
    ipcRenderer.on('refresh-devices', callback);
    return () => ipcRenderer.removeListener('refresh-devices', callback);
  }
});