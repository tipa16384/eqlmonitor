'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqlMonitor', {
  chooseProfile: () => ipcRenderer.invoke('monitor:chooseProfile'),
  chooseLog: () => ipcRenderer.invoke('monitor:chooseLog'),
  setSettings: (settings) => ipcRenderer.invoke('monitor:setSettings', settings),
  getSnapshot: () => ipcRenderer.invoke('monitor:getSnapshot'),
  onSnapshot: (callback) => {
    const handler = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('monitor:snapshot', handler);
    return () => ipcRenderer.removeListener('monitor:snapshot', handler);
  }
});
