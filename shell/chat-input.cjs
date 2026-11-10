function positionComposer(owner, rect, area, zoom = 1) {
  if (!rect || !['x','y','width','height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) throw new Error('无法确定聊天输入框的位置，请重新打开聊天框。');
  const width = Math.min(area.width, Math.max(280, Math.min(460, Math.round(rect.width * zoom))));
  const height = Math.min(area.height, Math.max(116, Math.min(160, Math.round(rect.height * zoom))));
  return { x: Math.round(Math.max(area.x, Math.min(owner.x + rect.x * zoom, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(owner.y + rect.y * zoom, area.y + area.height - height))), width, height };
}
function createChatInput({ BrowserWindow, screen, getOwner, preload, html, guardNavigation = () => {} }) {
  let current = null;
  function settle(entry, submit = false, error) {
    if (!entry || entry.finished) return;
    entry.finished = true; clearTimeout(entry.timer);
    if (current === entry) current = null;
    entry.resolve({ value: entry.value, submit: Boolean(submit), ...(error ? { error } : {}) });
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
  function entryFor(sender) { return current && !current.finished && current.window.webContents === sender ? current : null; }
  function show(entry) {
    if (entry.finished || !entry.nativeReady || !entry.rendererReady || entry.shown) return;
    entry.shown = true; clearTimeout(entry.timer);
    entry.window.show(); entry.window.setSkipTaskbar(true); entry.window.focus(); entry.window.webContents.focus();
  }
  function open(payload) {
    if (current) return current.promise;
    const owner = getOwner();
    if (!owner || owner.isDestroyed()) throw new Error('聊天窗口暂时不可用。');
    const value = typeof payload?.value === 'string' ? payload.value.slice(0, 4000) : '';
    const ownerBounds = owner.getContentBounds();
    const zoom = owner.webContents.getZoomFactor();
    const rect = payload?.rect;
    if (!rect || !['x','y','width','height'].every(key => Number.isFinite(rect[key]))) throw new Error('输入框位置无效。');
    const area = screen.getDisplayNearestPoint({ x: Math.round(ownerBounds.x + rect.x * zoom), y: Math.round(ownerBounds.y + rect.y * zoom) }).workArea;
    const bounds = positionComposer(ownerBounds, rect, area, zoom);
    const window = new BrowserWindow({ ...bounds, title: '聊天输入', parent: owner, frame: false, transparent: false, backgroundColor: '#ffffff', show: false, focusable: true, skipTaskbar: true, alwaysOnTop: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false, additionalArguments: ['--bigfish-chat-input'] } });
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const entry = { window, value, resolve, promise, nativeReady: false, rendererReady: false, shown: false, finished: false };
    current = entry;
    entry.timer = setTimeout(() => settle(entry, false, '输入窗口没有准备好，请再试一次。'), 15000);
    window.setMenuBarVisibility(false); guardNavigation(window);
    window.once('ready-to-show', () => { entry.nativeReady = true; show(entry); });
    window.on('blur', () => { if (entry.shown) settle(entry); });
    window.once('closed', () => settle(entry));
    window.webContents.once('did-fail-load', () => settle(entry, false, '输入窗口加载失败，请重试。'));
    window.loadFile(html, { hash: 'chat-input' }).catch(() => settle(entry, false, '输入窗口加载失败，请重试。'));
    return promise;
  }
  return {
    open,
    read(sender) { const entry = entryFor(sender); if (!entry) throw new Error('输入窗口不可用。'); return { value: entry.value }; },
    update(sender, value) { const entry = entryFor(sender); if (entry && typeof value === 'string') entry.value = value.slice(0, 4000); },
    ready(sender) { const entry = entryFor(sender); if (entry) { entry.rendererReady = true; show(entry); } },
    finish(sender, result) { const entry = entryFor(sender); if (!entry) return; if (typeof result?.value === 'string') entry.value = result.value.slice(0, 4000); settle(entry, result?.submit === true); },
    cancel() { settle(current); },
    dispose() { settle(current); },
  };
}
module.exports = { createChatInput, positionComposer };
