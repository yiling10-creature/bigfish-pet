const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, screen, shell } = require('electron');
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
const bootTracePath = path.join(os.tmpdir(), 'bigfish-boot.log');
function writeTrace(...args) {
  const line = `${new Date().toISOString()} ${args.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ')}\n`;
  try {
    fs.appendFileSync(bootTracePath, line);
  } catch {
    /* best effort */
  }
  console.log(line.trim());
}
try {
  fs.writeFileSync(bootTracePath, `--- ${new Date().toISOString()} boot ---\n`);
} catch {
  /* best effort */
}
process.on('uncaughtException', error => {
  writeTrace('UNCAUGHT', error?.stack || String(error));
});
process.on('unhandledRejection', reason => {
  writeTrace('REJECTED', String(reason));
});
function logLine(...args) {
  const text = args.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
  writeTrace('LOG', text);
  if (debugLogPath) {
    try {
      fs.appendFileSync(debugLogPath, `${new Date().toISOString()} ${text}\n`);
    } catch {
      /* Debug log is best effort. */
    }
  }
}

const deepseek = userData ? createDeepSeek({ userData, log: logLine }) : null;

// ---------------------------------------------------------------------------
// 宠物素材：不随安装包分发，运行时从本机已安装的 dsh-bigfish 插件读取。
//   1) BIGFISH_PET_ASSETS 指定的目录（6 张 PNG，可选 playful.dshpet）
//   2) 插件 lib/client.js 里的内联资源（6 个 PNG data URL + 1 个 base64 扩展包）
//   3) 本地上游源码 assets/sprites 与 packs/playful（开发机常见）
// ---------------------------------------------------------------------------
const ASSET_NAMES = [
  'bigfish-atlas.png',
  'bigfish-motions.png',
  'bigfish-signs.png',
  'bigfish-work.png',
  'bigfish-quiet.png',
  'bigfish-daily.png',
];

function assetsFromDirectory(dir) {
  const map = {};
  for (const name of ASSET_NAMES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return null;
    map[name] = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  }
  const playful = path.join(dir, 'playful.dshpet');
  if (fs.existsSync(playful)) {
    map.playful = 'data:application/octet-stream;base64,' + fs.readFileSync(playful).toString('base64');
  }
  return map;
}

// 在 34 MB 的 bundle 上不要用「超长量词」正则：V8 的递归回溯会爆栈
// （实测 "Maximum call stack size exceeded"）。改为逐字符扫描 base64 段。
const PNG_PREFIX = 'data:image/png;base64,';
const ZIP_MAGIC = 'UEsDBB';
const BASE64_CHARS = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
);

function scanBase64End(text, from) {
  let index = from;
  while (index < text.length && BASE64_CHARS.has(text[index])) index++;
  return index;
}

function assetsFromBundle(file) {
  // 以 latin1 读取：base64 全是 ASCII，避免 34 MB 的 UTF-8 解码开销
  const text = fs.readFileSync(file, 'latin1');
  const pngs = [];
  let cursor = text.indexOf(PNG_PREFIX);
  while (cursor >= 0 && pngs.length < ASSET_NAMES.length) {
    const end = scanBase64End(text, cursor + PNG_PREFIX.length);
    if (end > cursor + PNG_PREFIX.length) pngs.push(text.slice(cursor, end));
    cursor = text.indexOf(PNG_PREFIX, end);
  }
  if (pngs.length < ASSET_NAMES.length) return null;
  const map = {};
  ASSET_NAMES.forEach((name, index) => {
    map[name] = pngs[index];
  });
  const zipStart = text.indexOf(ZIP_MAGIC);
  if (zipStart >= 0) {
    const zipEnd = scanBase64End(text, zipStart + ZIP_MAGIC.length);
    if (zipEnd - zipStart > 1000) {
      map.playful = 'data:application/octet-stream;base64,' + text.slice(zipStart, zipEnd);
    }
  }
  return map;
}

function pluginDirectories() {
  const list = [];
  if (process.env.BIGFISH_PLUGIN_DIR) list.push(process.env.BIGFISH_PLUGIN_DIR);
  const profiles = path.join(os.homedir(), '.dsh', 'profiles');
  try {
    const entries = fs.readdirSync(profiles, { withFileTypes: true });
    const preferred = ['desktop', 'web'];
    entries
      .map(entry => entry.name)
      .sort((a, b) => (preferred.indexOf(a) + 1 || 99) - (preferred.indexOf(b) + 1 || 99))
      .forEach(name => list.push(path.join(profiles, name, 'node_modules', 'dsh-bigfish')));
  } catch {
    /* 没有安装 DSH 时静默跳过 */
  }
  return list;
}

function resolvePetAssets() {
  const attempts = [];
  const dir = process.env.BIGFISH_PET_ASSETS;
  if (dir) {
    attempts.push(`目录 ${dir}: ${fs.existsSync(dir) ? '存在' : '不存在'}`);
    if (fs.existsSync(dir)) {
      const map = assetsFromDirectory(dir);
      if (map) {
        logLine('ASSETS_DIRECTORY', dir);
        return map;
      }
      attempts.push('  目录里缺少 6 张 PNG');
    }
  } else {
    attempts.push('环境变量 BIGFISH_PET_ASSETS 未设置');
  }
  for (const plugin of pluginDirectories()) {
    const bundle = path.join(plugin, 'lib', 'client.js');
    attempts.push(`插件 ${plugin}: ${fs.existsSync(bundle) ? '找到 client.js' : '没有 client.js'}`);
    if (!fs.existsSync(bundle)) continue;
    try {
      const map = assetsFromBundle(bundle);
      if (map) {
        logLine('ASSETS_PLUGIN', plugin);
        return map;
      }
      attempts.push('  client.js 里没抽出 6 张图集');
    } catch (error) {
      attempts.push(`  读取失败: ${error.message}`);
      logLine('ASSETS_PLUGIN_FAILED', plugin, error.message);
    }
  }
  const sourceRoots = [
    process.env.BIGFISH_UPSTREAM,
    path.join(path.dirname(process.execPath), 'bigfish-source'),
    path.join(os.homedir(), 'Desktop', 'bigfish-pet', 'source'),
  ].filter(Boolean);
  for (const root of sourceRoots) {
    const sprites = path.join(root, 'assets', 'sprites');
    attempts.push(`源码 ${sprites}: ${fs.existsSync(sprites) ? '存在' : '不存在'}`);
    if (!fs.existsSync(sprites)) continue;
    const map = assetsFromDirectory(sprites);
    if (!map) continue;
    const playful = path.join(root, 'packs', 'playful', 'bundle.dshpet');
    if (fs.existsSync(playful)) {
      map.playful = 'data:application/octet-stream;base64,' + fs.readFileSync(playful).toString('base64');
    }
    logLine('ASSETS_SOURCE', root);
    return map;
  }
  logLine('ASSETS_MISSING');
  globalThis.__ASSET_ATTEMPTS__ = attempts;
  return null;
}

let petAssets = null;


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
    writeTrace('READY');
    try {
      petAssets = resolvePetAssets();
    } catch (error) {
      writeTrace('ASSETS_THROW', error.stack || error.message);
      petAssets = null;
    }
    if (!petAssets) {
      writeTrace('ASSETS_NULL');
      dialog.showMessageBoxSync({
        type: 'error',
        title: '缺少宠物素材',
        message: '没有找到角色素材。',
        detail:
          '这个桌宠不打包角色美术，需要本机已安装 dsh-bigfish 插件。\n\n' +
          '请在命令行执行：\n    dsh plugin --profile web add dsh-bigfish\n\n' +
          '或者用环境变量 BIGFISH_PET_ASSETS 指向包含 6 张 PNG 的目录后重试。\n' +
          '详见 README 第一节与 docs/素材来源与读取.md。\n\n' +
          '排查记录：\n' + (globalThis.__ASSET_ATTEMPTS__ || []).slice(0, 8).join('\n'),
        buttons: ['退出'],
        noLink: true,
      });
      app.quit();
      return;
    }
    ipcMain.on('bigfish:assets', event => {
      event.returnValue = petAssets ?? {};
    });
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
