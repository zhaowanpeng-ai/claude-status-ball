'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ballAPI', {
  onState: (callback) => ipcRenderer.on('ball-state', (_event, snapshot) => callback(snapshot)),
  click: () => ipcRenderer.send('ball-click'),
  context: () => ipcRenderer.send('ball-context'),
  moveBy: (dx, dy) => ipcRenderer.send('ball-move-by', { dx, dy }),
});

contextBridge.exposeInMainWorld('bubbleAPI', {
  onData: (callback) => ipcRenderer.on('bubble-data', (_event, data) => callback(data)),
  setHeight: (height) => ipcRenderer.send('bubble-height', height),
  dismiss: () => ipcRenderer.send('bubble-dismiss'),
});
