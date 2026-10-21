const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPet', {
  setHotspots: list => ipcRenderer.send('desktop-pet:hotspots', list),
  setInteractiveLock: locked => ipcRenderer.send('desktop-pet:interactive-lock', Boolean(locked)),
  onCommand: callback => {
    ipcRenderer.on('desktop-pet:command', (_event, command) => callback(command));
  },
  openSettings: () => ipcRenderer.send('desktop-pet:open-settings'),
  settingsChanged: () => ipcRenderer.send('desktop-pet:settings-changed'),
  contextMenu: () => ipcRenderer.send('desktop-pet:context-menu'),
});
