const { contextBridge, ipcRenderer } = require('electron');

// 宠物素材由主进程解析（插件 / 指定目录 / 上游源码），在这里同步注入页面。
// 页面里的 sprite-assets 会优先读 window.__BIGFISH_ASSETS__，缺失时给出明确提示。
try {
  const assets = ipcRenderer.sendSync('bigfish:assets');
  if (assets && Object.keys(assets).length) {
    contextBridge.exposeInMainWorld('__BIGFISH_ASSETS__', assets);
  }
} catch (error) {
  console.error('asset bridge failed:', error.message);
}

contextBridge.exposeInMainWorld('desktopPet', {
  setHotspots: list => ipcRenderer.send('desktop-pet:hotspots', list),
  setInteractiveLock: locked => ipcRenderer.send('desktop-pet:interactive-lock', Boolean(locked)),
  onCommand: callback => {
    ipcRenderer.on('desktop-pet:command', (_event, command) => callback(command));
  },
  openSettings: () => ipcRenderer.send('desktop-pet:open-settings'),
  openExternal: url => ipcRenderer.invoke('desktop-pet:open-external', url),
  settingsChanged: () => ipcRenderer.send('desktop-pet:settings-changed'),
  contextMenu: () => ipcRenderer.send('desktop-pet:context-menu'),
  deepseek: {
    status: () => ipcRenderer.invoke('deepseek:status'),
    save: config => ipcRenderer.invoke('deepseek:save', config),
    clear: () => ipcRenderer.invoke('deepseek:clear'),
    test: () => ipcRenderer.invoke('deepseek:test'),
    chat: payload => ipcRenderer.send('deepseek:chat', payload),
    stop: id => ipcRenderer.send('deepseek:stop', id),
    onEvent: callback => {
      ipcRenderer.on('deepseek:event', (_event, payload) => callback(payload));
    },
  },
});
