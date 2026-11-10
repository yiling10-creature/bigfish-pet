const { contextBridge, ipcRenderer } = require('electron');

// 宠物素材由主进程解析（插件 / 指定目录 / 上游源码），在这里同步注入页面。
// 页面里的 sprite-assets 会优先读 window.__BIGFISH_ASSETS__，缺失时给出明确提示。
try {
  const assets = process.argv.includes('--bigfish-chat-input') ? null : ipcRenderer.sendSync('bigfish:assets');
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
  setKeyboardFocus: enabled => ipcRenderer.invoke('desktop-pet:keyboard-focus', Boolean(enabled)),
  chatInput: {
    open: payload => ipcRenderer.invoke('desktop-pet:chat-input-open', payload),
    read: () => ipcRenderer.invoke('desktop-pet:chat-input-read'),
    update: value => ipcRenderer.send('desktop-pet:chat-input-update', value),
    ready: () => ipcRenderer.send('desktop-pet:chat-input-ready'),
    finish: result => ipcRenderer.send('desktop-pet:chat-input-finish', result),
    cancel: () => ipcRenderer.send('desktop-pet:chat-input-cancel'),
  },
  resetPosition: () => ipcRenderer.send('desktop-pet:reset-position'),
  chatStarted: () => ipcRenderer.send('desktop-pet:chat-started'),
  saveFile: (filename, bytes) => ipcRenderer.invoke('desktop-pet:save-file', filename, bytes),
  desktop: {
    status: () => ipcRenderer.invoke('desktop-pet:desktop-status'),
    update: patch => ipcRenderer.invoke('desktop-pet:desktop-update', patch),
  },
  openExternal: url => ipcRenderer.invoke('desktop-pet:open-external', url),
  settingsChanged: () => ipcRenderer.send('desktop-pet:settings-changed'),
  contextMenu: () => ipcRenderer.send('desktop-pet:context-menu'),
  deepseek: {
    status: provider => ipcRenderer.invoke('deepseek:status', provider),
    save: config => ipcRenderer.invoke('deepseek:save', config),
    clear: provider => ipcRenderer.invoke('deepseek:clear', provider),
    test: provider => ipcRenderer.invoke('deepseek:test', provider),
    catalog: () => ipcRenderer.invoke('deepseek:catalog'),
    select: provider => ipcRenderer.invoke('deepseek:select', provider),
    history: (provider, scope) => ipcRenderer.invoke('deepseek:history', provider, scope),
    memoryStatus: (provider, scope) => ipcRenderer.invoke('deepseek:memory-status', provider, scope),
    compactMemory: (provider, scope) => ipcRenderer.invoke('deepseek:compact-memory', provider, scope),
    clearMemory: (provider, scope) => ipcRenderer.invoke('deepseek:clear-memory', provider, scope),
    openMemory: (provider, scope) => ipcRenderer.invoke('deepseek:open-memory', provider, scope),
    chat: payload => ipcRenderer.send('deepseek:chat', payload),
    stop: id => ipcRenderer.send('deepseek:stop', id),
    onEvent: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('deepseek:event', listener);
      return () => ipcRenderer.removeListener('deepseek:event', listener);
    },
  },
});
