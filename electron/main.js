'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Notification } = require('electron');
const { parseLine } = require('../src/core/parser');
const { MonitorEngine } = require('../src/core/engine');
const { loadProfile } = require('../src/core/profile');
const { LogTailer } = require('../src/core/tailer');

let mainWindow = null;
let engine = new MonitorEngine();
let tailer = null;
let currentLogPath = null;
let currentProfilePath = null;
let lastStatusCode = null;
let lastProcAlertMessages = new Set();
let pushTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));
}

function sendSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const snapshot = engine.snapshot();
  snapshot.paths = { log: currentLogPath, profile: currentProfilePath };
  mainWindow.webContents.send('monitor:snapshot', snapshot);
  maybeNotify(snapshot);
}

function maybeNotify(snapshot) {
  if (!Notification.isSupported()) return;
  const status = snapshot.status;
  if (status && status.code !== lastStatusCode && ['MOVE_DEEPER', 'TOO_HARD', 'SOFTENING'].includes(status.code)) {
    new Notification({ title: `EQL Monitor: ${status.code.replaceAll('_', ' ')}`, body: status.message }).show();
  }
  lastStatusCode = status?.code || null;
  const currentMessages = new Set(snapshot.procAlerts.map((a) => a.message));
  for (const alert of snapshot.procAlerts) {
    if (!lastProcAlertMessages.has(alert.message)) new Notification({ title: 'EQL Monitor: Combat anomaly', body: alert.message }).show();
  }
  lastProcAlertMessages = currentMessages;
}

async function startLog(filePath) {
  if (tailer) tailer.stop();
  currentLogPath = filePath;
  engine.resetRuntime();
  tailer = new LogTailer(filePath, (line) => engine.ingest(parseLine(line)));
  await tailer.start({ fromBeginning: true });
  sendSnapshot();
}

app.whenReady().then(() => {
  createWindow();
  pushTimer = setInterval(sendSnapshot, 1000);

  ipcMain.handle('monitor:chooseProfile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose EQ Legends character profile', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    currentProfilePath = result.filePaths[0];
    engine.setProfile(loadProfile(currentProfilePath));
    sendSnapshot();
    return engine.snapshot().character;
  });

  ipcMain.handle('monitor:chooseLog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose EQ combat log', properties: ['openFile'], filters: [{ name: 'EQ log', extensions: ['txt', 'log'] }, { name: 'All files', extensions: ['*'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    await startLog(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('monitor:setSettings', (_event, settings) => { engine.setSettings(settings || {}); sendSnapshot(); return true; });
  ipcMain.handle('monitor:getSnapshot', () => {
    const snapshot = engine.snapshot();
    snapshot.paths = { log: currentLogPath, profile: currentProfilePath };
    return snapshot;
  });
});

app.on('window-all-closed', () => {
  if (tailer) tailer.stop();
  if (pushTimer) clearInterval(pushTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
