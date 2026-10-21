const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createDeepSeek } = require('./deepseek.cjs');

const os = require('node:os');
function chooseUserData() {
  const candidates = [];
  if (process.env.BIGFISH_USER_DATA) candidates.push(process.env.BIGFISH_USER_DATA);
  try { candidates.push(path.join(app.getPath('appData'), 'BigFishPet')); } catch { /* optional */ }
  candidates.push(path.join(os.homedir(), '.bigfish-pet'));
  try { candidates.push(path.join(app.getPath('temp'), 'BigFishPet')); } catch { /* optional */ }
  try { candidates.push(path.join(path.dirname(app.getPath('exe')), 'bigfish-profile')); } catch { /* optional */ }

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      console.log('user data directory:', dir);
      return dir;
    } catch (error) {
      console.error('cannot use user data directory:', dir, error.message);
    }
  }
  return null;
}

const userData = chooseUserData();
if (userData) app.setPath('userData', userData);

const DEMO_STATES = [
  ['idle', '待机'],
  ['reasoning', '思考'],
  ['generating', '输出'],
  ['tool-running', '工具执行'],
  ['awaiting-output', '准备开工'],
  ['waiting-user', '等待确认'],
  ['completed', '完成'],
  ['failed', '出错'],
  ['disconnected', '断开'],
];

let win = null;
let settingsWin = null;
let tray = null;
let visible = true;
let alwaysOnTop = true;
let autoDemo = true;
let manualState = 'idle';
let quitting = false;
let ignoreMouse = true;
let hotspots = [];
let hoverLock = false;
let hoverLockOutsideAt = 0;

const debugLogPath = process.env.BIGFISH_DEBUG_LOG;
function logLine(...args) {
  const text = args.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
  console.log(text);
  if (debugLogPath) {
    try {
      fs.appendFileSync(debugLogPath, `${new Date().toISOString()} ${text}\n`);
    } catch {
      /* Debug log is best effort. */
    }
  }
}

const deepseek = userData ? createDeepSeek({ userData, log: logLine }) : null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('studio.bigfish.desktop-pet');

  const workArea = () => {
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
    return { x, y, width, height };
  };

  function sendCommand(command) {
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      win.webContents.send('desktop-pet:command', command);
    }
  }

  function openSettings() {
    if (settingsWin && !settingsWin.isDestroyed()) {
      if (settingsWin.isMinimized()) settingsWin.restore();
      settingsWin.show();
      settingsWin.focus();
      logLine('SETTINGS_FOCUS');
      return;
    }

    const area = workArea();
    const width = Math.min(640, Math.max(420, area.width - 80));
    const height = Math.min(820, Math.max(560, area.height - 80));
    settingsWin = new BrowserWindow({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
      minWidth: 420,
      minHeight: 560,
      title: '大肥鱼桌宠 · 设置',
      backgroundColor: '#fafcff',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });

    settingsWin.setMenuBarVisibility(false);
    settingsWin.loadFile(path.join(__dirname, 'resources', 'pet.html'), { hash: 'settings' });
    logLine('SETTINGS_LOAD');
    settingsWin.webContents.on('did-finish-load', () => logLine('SETTINGS_DID_FINISH_LOAD'));
    settingsWin.webContents.on('did-fail-load', (_event, code, description) => {
      logLine('SETTINGS_LOAD_FAILED', code, description);
    });
    settingsWin.once('ready-to-show', () => {
      if (!settingsWin || settingsWin.isDestroyed()) return;
      settingsWin.show();
      settingsWin.focus();
      logLine('SETTINGS_SHOWN', settingsWin.getBounds());
    });
    settingsWin.on('closed', () => {
      settingsWin = null;
      logLine('SETTINGS_CLOSED');
      if (!quitting) sendCommand({ type: 'refresh' });
    });
  }

  function setVisible(next) {
    visible = next;
    if (!win || win.isDestroyed()) return;
    if (visible) {
      win.setBounds(workArea());
      setIgnore(true);
      win.showInactive();
      updateHover();
    } else {
      win.hide();
    }
    refreshTray();
  }

  function setIgnore(next) {
    if (ignoreMouse === next) return;
    ignoreMouse = next;
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignoreMouse);
    logLine('IGNORE_MOUSE', ignoreMouse);
  }

  function cursorInsideHotspots() {
    if (!win || win.isDestroyed() || !hotspots.length) return false;
    const bounds = win.getContentBounds();
    const cursor = screen.getCursorScreenPoint();
    return hotspots.some(spot =>
      cursor.x >= bounds.x + spot.x &&
      cursor.x <= bounds.x + spot.x + spot.w &&
      cursor.y >= bounds.y + spot.y &&
      cursor.y <= bounds.y + spot.y + spot.h,
    );
  }

  function updateHover() {
    if (!win || win.isDestroyed() || !visible || !win.isVisible()) return;
    const inside = cursorInsideHotspots();
    if (!inside && hoverLock) {
      const now = Date.now();
      if (!hoverLockOutsideAt) hoverLockOutsideAt = now;
      else if (now - hoverLockOutsideAt > 1500) {
        // A lost pointerup must not leave the whole overlay swallowing clicks.
        hoverLock = false;
        hoverLockOutsideAt = 0;
      }
    } else if (inside) {
      hoverLockOutsideAt = 0;
    }
    setIgnore(!(hoverLock || inside));
  }

  function refreshTray() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: '显示大肥鱼',
        type: 'checkbox',
        checked: visible,
        click: item => setVisible(item.checked),
      },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: alwaysOnTop,
        click: item => {
          alwaysOnTop = item.checked;
          if (win && !win.isDestroyed()) win.setAlwaysOnTop(alwaysOnTop, 'floating');
          refreshTray();
        },
      },
      { type: 'separator' },
      {
        label: '自动演示',
        type: 'checkbox',
        checked: autoDemo,
        click: item => {
          autoDemo = item.checked;
          sendCommand({ type: 'auto', enabled: autoDemo });
          refreshTray();
        },
      },
      {
        label: '演示状态',
        enabled: !autoDemo,
        submenu: DEMO_STATES.map(([state, label]) => ({
          label,
          type: 'radio',
          checked: !autoDemo && manualState === state,
          click: () => {
            autoDemo = false;
            manualState = state;
            sendCommand({ type: 'state', state });
            refreshTray();
          },
        })),
      },
      { type: 'separator' },
      { label: '打开设置', click: () => openSettings() },
      { label: '重置位置', click: () => { setVisible(true); sendCommand({ type: 'reset-position' }); } },
      { type: 'separator' },
      { label: '退出大肥鱼', click: () => { quitting = true; app.quit(); } },
    ]));
  }

  function createWindow() {
    win = new BrowserWindow({
      ...workArea(),
      title: '大肥鱼桌宠',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    win.setMenuBarVisibility(false);
    win.setAlwaysOnTop(true, 'floating');
    win.setIgnoreMouseEvents(true);
    ignoreMouse = true;
    win.loadFile(path.join(__dirname, 'resources', 'pet.html'));
    logLine('LOAD_FILE');

    win.webContents.on('did-finish-load', () => logLine('DID_FINISH_LOAD'));
    win.webContents.on('did-fail-load', (_event, code, description) => {
      logLine('LOAD_FAILED', code, description);
    });
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      logLine('PRELOAD_ERROR', preloadPath, error.message);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      logLine('RENDER_GONE', details);
    });
    win.webContents.on('unresponsive', () => logLine('UNRESPONSIVE'));

    win.once('ready-to-show', () => {
      win.showInactive();
      logLine('SHOWN', { visible: win.isVisible(), bounds: win.getBounds(), top: win.isAlwaysOnTop() });
      updateHover();
    });
    win.on('closed', () => { win = null; logLine('CLOSED'); });
    win.on('show', () => { visible = true; refreshTray(); logLine('SHOW_EVENT'); });
    win.on('hide', () => { visible = false; refreshTray(); logLine('HIDE_EVENT'); });
  }

  ipcMain.on('desktop-pet:hotspots', (event, list) => {
    if (!win || event.sender !== win.webContents || !Array.isArray(list)) return;
    hotspots = list.slice(0, 240)
      .map(spot => ({
        x: Number(spot?.x),
        y: Number(spot?.y),
        w: Number(spot?.w),
        h: Number(spot?.h),
      }))
      .filter(spot => [spot.x, spot.y, spot.w, spot.h].every(Number.isFinite) && spot.w > 0 && spot.h > 0);
    updateHover();
  });

  ipcMain.on('desktop-pet:interactive-lock', (event, locked) => {
    if (!win || event.sender !== win.webContents) return;
    hoverLock = Boolean(locked);
    hoverLockOutsideAt = 0;
    updateHover();
  });

  ipcMain.on('desktop-pet:open-settings', event => {
    if (!win || event.sender !== win.webContents) return;
    openSettings();
  });

  ipcMain.on('desktop-pet:settings-changed', event => {
    if (!settingsWin || event.sender !== settingsWin.webContents) return;
    sendCommand({ type: 'refresh' });
  });

  function trustedConfigSender(event) {
    return Boolean(
      (win && !win.isDestroyed() && event.sender === win.webContents) ||
      (settingsWin && !settingsWin.isDestroyed() && event.sender === settingsWin.webContents),
    );
  }

  ipcMain.handle('deepseek:status', event => {
    if (!trustedConfigSender(event)) return { ok: false, message: 'unauthorized' };
    if (!deepseek) return { ok: false, message: 'DeepSeek 配置不可用。' };
    return { ok: true, ...deepseek.status() };
  });

  ipcMain.handle('deepseek:save', (event, config) => {
    if (!trustedConfigSender(event)) return { ok: false, message: 'unauthorized' };
    if (!deepseek) return { ok: false, message: 'DeepSeek 配置不可用。' };
    try {
      return {
        ok: true,
        ...deepseek.save({
          key: typeof config?.key === 'string' ? config.key : '',
          model: typeof config?.model === 'string' ? config.model : '',
          pricing: config?.pricing,
        }),
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle('deepseek:clear', event => {
    if (!trustedConfigSender(event)) return { ok: false, message: 'unauthorized' };
    if (!deepseek) return { ok: false, message: 'DeepSeek 配置不可用。' };
    return { ok: true, ...deepseek.clear() };
  });

  ipcMain.handle('deepseek:test', async event => {
    if (!trustedConfigSender(event)) return { ok: false, message: 'unauthorized' };
    if (!deepseek) return { ok: false, message: 'DeepSeek 配置不可用。' };
    return deepseek.test();
  });

  ipcMain.on('deepseek:chat', (event, payload) => {
    if (!win || event.sender !== win.webContents || !deepseek) return;
    const id = typeof payload?.id === 'string' ? payload.id.slice(0, 80) : '';
    if (!id) return;
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    deepseek.streamChat({
      id,
      messages,
      search: Boolean(payload?.search),
      onEvent: message => {
        if (!event.sender.isDestroyed()) event.sender.send('deepseek:event', message);
      },
    }).catch(error => logLine('DEEPSEEK_STREAM_ERROR', error.message));
  });

  ipcMain.on('deepseek:stop', (event, id) => {
    if (!win || event.sender !== win.webContents || !deepseek) return;
    if (typeof id === 'string') deepseek.stop(id);
  });

  ipcMain.handle('desktop-pet:open-external', async (event, rawUrl) => {
    if (!trustedConfigSender(event)) return { ok: false, message: 'unauthorized' };
    const text = typeof rawUrl === 'string' ? rawUrl.trim().slice(0, 2048) : '';
    let url;
    try {
      url = new URL(text);
    } catch {
      return { ok: false, message: '链接格式不正确。' };
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return { ok: false, message: '只能打开网页链接。' };
    }
    try {
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch (error) {
      logLine('OPEN_EXTERNAL_FAILED', error.message);
      return { ok: false, message: '无法打开链接。' };
    }
  });

  ipcMain.on('desktop-pet:context-menu', event => {
    if (!win || event.sender !== win.webContents) return;
    Menu.buildFromTemplate([
      {
        label: '打开设置',
        click: () => openSettings(),
      },
      {
        label: '自动演示',
        type: 'checkbox',
        checked: autoDemo,
        click: item => {
          autoDemo = item.checked;
          sendCommand({ type: 'auto', enabled: autoDemo });
          refreshTray();
        },
      },
      { type: 'separator' },
      { label: '隐藏大肥鱼', click: () => setVisible(false) },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]).popup({ window: win });
  });

  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      setVisible(true);
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    const icon = nativeImage.createFromPath(path.join(__dirname, 'resources', 'tray.png'));
    tray = new Tray(icon);
    tray.setToolTip('大肥鱼桌宠');
    tray.on('click', () => setVisible(!visible));
    refreshTray();
    setInterval(updateHover, 80);

    screen.on('display-metrics-changed', () => {
      if (win && !win.isDestroyed() && visible) win.setBounds(workArea());
    });
    screen.on('display-added', () => {
      if (win && !win.isDestroyed() && visible) win.setBounds(workArea());
    });
    screen.on('display-removed', () => {
      if (win && !win.isDestroyed() && visible) win.setBounds(workArea());
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    deepseek?.dispose();
  });
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
  app.on('activate', () => {
    if (!win) createWindow();
    else setVisible(true);
  });
}
