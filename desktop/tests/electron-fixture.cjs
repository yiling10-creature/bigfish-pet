// Offline Electron UI harness. No real credentials or network requests.
const { ipcMain, BrowserWindow, app } = require('electron');
const path = require('node:path');
const { PROVIDERS } = require('../../shell/providers.cjs');
require('../../shell/main.cjs');
const providers = Object.fromEntries(Object.values(PROVIDERS).map(p => [p.id, { ...p, provider: p.id, hasKey: true, encryptionAvailable: true, contextRounds: 30, thinking: false, pricing: { input: 0, output: 0, currency: '¥' } }]));
let selected = 'deepseek'; const histories = Object.fromEntries(Object.keys(providers).map(id => [id, []])); const pending = new Map();
const broadcast = command => BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send('desktop-pet:command', command); });
const catalog = () => ({ selectedProvider: selected, providers: Object.values(providers), memoryDirectory: path.join(app.getPath('userData'), 'memory') });
const memoryStatus = id => ({ directory: catalog().memoryDirectory, file: path.join(catalog().memoryDirectory, id + '.md'), archived: 0, recent: histories[id].length, hasSummary: false, summarizing: false });
function stop(id) { const p = pending.get(id); if (p) { clearTimeout(p.timer); p.send({ type: 'aborted' }); pending.delete(id); } }
const handlers = {
  status: (_event, id = selected) => ({ ok: true, ...providers[id] }),
  save: (_event, config) => { const p = providers[config.provider]; Object.assign(p, { model: config.model, baseUrl: config.baseUrl, contextRounds: config.contextRounds, thinking: config.thinking, pricing: config.pricing }); if (config.key) p.hasKey = true; broadcast({ type: 'ai-config-changed' }); return { ok: true, ...p }; },
  clear: (_event, id = selected) => { providers[id].hasKey = false; return { ok: true, ...providers[id] }; },
  test: () => ({ ok: true, message: '离线测试连接成功' }),
  catalog,
  select: (_event, id) => { if (id !== selected) for (const key of pending.keys()) stop(key); selected = id; broadcast({ type: 'ai-config-changed' }); return catalog(); },
  history: (_event, id) => histories[id],
  'memory-status': (_event, id) => memoryStatus(id),
  'compact-memory': (_event, id) => memoryStatus(id),
  'open-memory': (_event, id) => memoryStatus(id),
  'clear-memory': (_event, id) => { for (const [key, p] of pending) if (p.provider === id) stop(key); histories[id] = []; broadcast({ type: 'ai-memory-cleared', provider: id }); return memoryStatus(id); },
};
for (const [name, handler] of Object.entries(handlers)) { ipcMain.removeHandler('deepseek:' + name); ipcMain.handle('deepseek:' + name, handler); }
ipcMain.removeAllListeners('deepseek:chat'); ipcMain.removeAllListeners('deepseek:stop');
ipcMain.on('deepseek:chat', (event, payload) => {
  const question = payload.messages.at(-1).content, provider = payload.provider || selected;
  const send = value => { if (!event.sender.isDestroyed()) event.sender.send('deepseek:event', { id: payload.id, provider, ...value }); };
  if (payload.search) { send({ type: 'searching' }); send({ type: 'sources', sources: [{ title: '离线示例来源', url: 'https://example.org/', host: 'example.org' }] }); }
  const timer = setTimeout(() => {
    const text = question.includes('截断') ? '这是一段达到长度上限的回答。' : question.includes('中断') ? '连接中断前的内容。' : '你好呀，我会认真听你说，也会在你忙的时候安静陪着你。';
    send({ type: 'delta', text }); if (question.includes('一直')) return;
    histories[provider].push({ id: payload.id, user: question, assistant: text, status: question.includes('中断') ? 'failed' : 'done' });
    if (question.includes('中断')) send({ type: 'error', code: 'incomplete', message: '连接提前结束，回答可能不完整。可以重试这一轮。' });
    else send({ type: 'done', finishReason: question.includes('截断') ? 'length' : 'stop' });
    pending.delete(payload.id);
  }, question.includes('第二') ? 1800 : 180);
  pending.set(payload.id, { timer, send, provider });
});
ipcMain.on('deepseek:stop', (_event, id) => stop(id));
