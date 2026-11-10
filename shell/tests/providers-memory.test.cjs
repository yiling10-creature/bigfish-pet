const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { PROVIDERS, baseUrlFor, requestParameters } = require('../providers.cjs');
const { createMemory } = require('../memory.cjs');
const PERSONA = '你是一个通用 AI 助手，请根据用户的问题清晰、准确地回答。';
const pricing = { input: 2, output: 3, currency: '¥' };
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigfish-provider-test-'));
  t.after(() => { const absolute = path.resolve(dir); assert.equal(path.dirname(absolute), path.resolve(os.tmpdir())); assert.match(path.basename(absolute), /^bigfish-provider-test-/); fs.rmSync(absolute, { recursive: true, force: true }); });
  return dir;
}
function fixture(t, fetch = async () => response()) {
  const dir = temp(t), config = path.join(dir, 'config'), memory = path.join(dir, 'memory');
  const instances = [];
  function open() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../deepseek.cjs'), 'utf8'), {
      module, process: { env: {} }, Buffer, AbortController, TextDecoder, setTimeout, clearTimeout,
      require: name => name === 'electron' ? {
        net: { fetch }, safeStorage: { isEncryptionAvailable: () => true,
          encryptString: value => Buffer.from('sealed:' + value), decryptString: value => value.toString().replace(/^sealed:/, '') },
      } : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name),
    });
    const api = module.exports.createDeepSeek({ userData: config, memoryDirectory: memory, bundledPersonasDirectory: path.join(dir, 'no-bundled-personas') }); instances.push(api); return api;
  }
  t.after(() => instances.forEach(api => api.dispose()));
  return { dir, config, memory, open, api: open() };
}
function response(text = '我是肥肥鱼') {
  return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
}
function configure(api, provider) { return api.save({ provider, key: 'offline-key-' + provider, model: PROVIDERS[provider].model, pricing, contextRounds: 30, thinking: false }); }
async function chat(api, provider, id, question, extra = {}) {
  const events = [];
  await api.streamChat({ provider, id, messages: [{ role: 'user', content: question }], onEvent: e => events.push(e), ...extra });
  assert.equal(events.at(-1).type, 'done', events.at(-1).message); return events;
}
test('four providers save encrypted credentials independently and survive restart', t => {
  const f = fixture(t);
  for (const id of Object.keys(PROVIDERS)) {
    configure(f.api, id);
    const raw = fs.readFileSync(path.join(f.config, id + '.json'), 'utf8');
    assert.ok(!raw.includes('offline-key-')); assert.equal(f.api.status(id).hasKey, true);
  }
  f.api.select('kimi'); f.api.dispose(); const restored = f.open();
  assert.equal(restored.catalog().selectedProvider, 'kimi');
  assert.equal(restored.catalog().providers.length, 4);
  assert.ok(!JSON.stringify(restored.catalog()).includes('offline-key-'));
  assert.ok(restored.catalog().providers.every(p => p.hasKey && p.contextRounds === 30));
  restored.save({ provider: 'qwen', key: '', model: 'qwen-flash' });
  assert.equal(restored.status('qwen').hasKey, true); assert.equal(restored.status('deepseek').model, 'deepseek-flash');
  restored.clear('zhipu'); assert.equal(restored.status('zhipu').hasKey, false); assert.equal(restored.status('kimi').hasKey, true);
});
test('legacy DeepSeek credentials and model migrate without resetting other settings', t => {
  const f = fixture(t); fs.mkdirSync(f.config, { recursive: true });
  fs.writeFileSync(path.join(f.config, 'deepseek.json'), JSON.stringify({ version: 1, model: 'deepseek-chat', key: Buffer.from('sealed:offline-legacy-key').toString('base64'), pricing }));
  assert.equal(f.api.status('deepseek').model, 'deepseek-flash'); assert.equal(f.api.status('deepseek').hasKey, true); assert.equal(f.api.status('deepseek').contextRounds, 30);
  f.api.save({ provider: 'deepseek', key: '', contextRounds: 50 }); assert.equal(f.api.status('deepseek').hasKey, true);
});
test('requests use official endpoints without persona instructions', async t => {
  const requests = [];
  const f = fixture(t, async (url, options) => { requests.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization }); return response(); });
  for (const id of Object.keys(PROVIDERS)) { configure(f.api, id); const events = await chat(f.api, id, id + '-turn', '本轮' + id); assert.ok(events.every(e => e.provider === id)); }
  for (let i = 0; i < requests.length; i++) {
    const id = Object.keys(PROVIDERS)[i], r = requests[i];
    assert.equal(r.url, PROVIDERS[id].baseUrl + '/chat/completions'); assert.equal(r.auth, 'Bearer offline-key-' + id);
    assert.equal(r.body.messages[0].role, 'user'); assert.equal(r.body.messages.length, 1); assert.ok(!r.body.messages.some(m => m.role === 'system'));
    assert.equal(r.body.model, PROVIDERS[id].model);
    if (id === 'qwen') { assert.equal(r.body.enable_thinking, false); assert.equal(r.body.thinking, undefined); }
    else assert.equal(r.body.thinking.type, 'disabled');
  }
});
test('provider history and memory remain separate across application restarts', async t => {
  const requests = [], f = fixture(t, async (_url, options) => { requests.push(JSON.parse(options.body)); return response(); });
  configure(f.api, 'deepseek'); configure(f.api, 'qwen');
  await chat(f.api, 'deepseek', 'd1', '只告诉DeepSeek的事情'); await chat(f.api, 'qwen', 'q1', '只告诉千问的事情');
  f.api.dispose(); const api = f.open(); await chat(api, 'deepseek', 'd2', '还记得吗');
  const request = JSON.stringify(requests.at(-1)); assert.ok(request.includes('只告诉DeepSeek')); assert.ok(!request.includes('只告诉千问'));
  assert.equal(api.history('deepseek').length, 2); assert.equal(api.history('qwen').length, 1);
  assert.ok(fs.readFileSync(path.join(f.memory, 'deepseek-对话归档.md'), 'utf8').includes('只告诉DeepSeek'));
  api.clear('deepseek'); assert.equal(api.history('deepseek').length, 2);
});
test('switching providers cancels the previous stream without mixing the next session', async t => {
  const f = fixture(t, (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { name: 'AbortError' })))));
  configure(f.api, 'deepseek'); configure(f.api, 'qwen'); const events = [];
  const pending = f.api.streamChat({ provider: 'deepseek', id: 'pending', messages: [{ role: 'user', content: '等待' }], onEvent: e => events.push(e) });
  f.api.select('qwen'); await pending;
  assert.equal(events.at(-1).type, 'aborted'); assert.equal(events.at(-1).provider, 'deepseek'); assert.equal(f.api.history('qwen').length, 0);
});
test('retry omits the stopped answer while retaining earlier successful context', async t => {
  let request;
  const f = fixture(t, async (_url, options) => { request = JSON.parse(options.body); return response('重新回答'); }); configure(f.api, 'kimi');
  const memory = createMemory({ directory: f.memory }); memory.start('kimi', 'first', '前一个问题'); memory.finish('kimi', 'first', '前一轮回答', '', 'done');
  memory.start('kimi', 'stopped', '要重试的问题'); memory.finish('kimi', 'stopped', '不应带入的半截答案', '', 'stopped');
  await chat(f.api, 'kimi', 'retry', '要重试的问题', { retryOf: 'stopped' });
  const contents = request.messages.map(m => m.content);
  assert.ok(contents.includes('前一轮回答')); assert.ok(!contents.includes('不应带入的半截答案')); assert.equal(contents.filter(s => s === '要重试的问题').length, 1);
});
test('connection test rejects an empty success response instead of claiming connection works', async t => {
  const f = fixture(t, async () => new Response(JSON.stringify({ choices: [] }))); configure(f.api, 'zhipu');
  assert.equal((await f.api.test('zhipu')).ok, false);
});
test('official endpoint validation and thinking flags match provider protocols', () => {
  assert.equal(baseUrlFor('qwen', 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'), 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
  assert.equal(baseUrlFor('kimi', 'https://api.moonshot.ai/v1/'), 'https://api.moonshot.ai/v1');
  for (const value of ['http://api.moonshot.cn/v1', 'https://api.moonshot.cn.evil.test/v1', 'https://key@api.moonshot.cn/v1']) assert.throws(() => baseUrlFor('kimi', value));
  const k3 = requestParameters('kimi', { model: 'kimi-k3.1-pro', thinking: false }); assert.equal(k3.reasoning_effort, 'low'); assert.equal(k3.thinking, undefined);
  assert.throws(() => baseUrlFor('../deepseek', 'https://api.deepseek.com'));
});
test('manual Markdown notes are read immediately and do not cross providers', t => {
  const directory = temp(t), memory = createMemory({ directory });
  const file = memory.status('deepseek').file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<!-- manual:start -->', '<!-- manual:start -->\n喜欢海边和蓝色'));
  assert.ok(memory.prompt('deepseek').includes('喜欢海边和蓝色')); assert.equal(memory.prompt('qwen'), '');
  memory.start('deepseek', 'next', '你好'); memory.finish('deepseek', 'next', '你好呀', '', 'done');
  assert.ok(fs.readFileSync(file, 'utf8').includes('喜欢海边和蓝色'));
});
test('automatic compaction keeps recent turns, archives every message and coalesces concurrent jobs', async t => {
  const directory = temp(t), memory = createMemory({ directory });
  for (let i = 0; i < 18; i++) { memory.start('qwen', 't' + i, '问题' + i); memory.finish('qwen', 't' + i, '回答' + i, '', 'done'); }
  let calls = 0, release; const wait = new Promise(resolve => { release = resolve; });
  const summarize = async (_prior, turns) => { calls++; assert.equal(turns.length, 8); await wait; return '- 重要偏好已保留'; };
  const first = memory.compact('qwen', 10, summarize), second = memory.compact('qwen', 10, summarize);
  assert.equal(memory.status('qwen').summarizing, true); release(); const result = await first; await second;
  assert.equal(calls, 1); assert.equal(result.summarizing, false); assert.equal(result.archived, 8); assert.equal(memory.history('qwen').length, 10);
  assert.ok(memory.prompt('qwen').includes('重要偏好')); assert.ok(fs.readFileSync(path.join(directory, 'qwen-对话归档.md'), 'utf8').includes('问题0'));
  assert.equal(createMemory({ directory }).history('qwen').length, 10); assert.equal(memory.history('kimi').length, 0);
});
test('failed summary preserves all original memory and the archive', async t => {
  const memory = createMemory({ directory: temp(t) });
  for (let i = 0; i < 12; i++) { memory.start('zhipu', 't' + i, '问题'); memory.finish('zhipu', 't' + i, '回答', '', 'done'); }
  await assert.rejects(memory.compact('zhipu', 10, async () => { throw new Error('离线'); }, true), /离线/);
  assert.equal(memory.history('zhipu').length, 12); assert.equal(memory.status('zhipu').archived, 0); assert.equal(memory.status('zhipu').summarizing, false);
});
test('damaged memory is preserved and reported rather than silently replaced', t => {
  const directory = temp(t), file = path.join(directory, 'kimi.json'); fs.writeFileSync(file, 'damaged original');
  const memory = createMemory({ directory }); assert.throws(() => memory.history('kimi'), /保留原文件/); assert.equal(fs.readFileSync(file, 'utf8'), 'damaged original');
});

test('clearing memory removes recent turns, manual notes and full archive for only one provider', async t => {
  const f = fixture(t); configure(f.api, 'deepseek'); configure(f.api, 'qwen');
  await chat(f.api, 'deepseek', 'clear-me', '要清除的私人消息'); await chat(f.api, 'qwen', 'keep-me', '千问保留的消息');
  const file = f.api.memoryStatus('deepseek').file; fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<!-- manual:start -->', '<!-- manual:start -->\n要清除的手动记忆'));
  const result = f.api.clearMemory('deepseek');
  assert.equal(result.recent, 0); assert.equal(result.hasSummary, false); assert.equal(f.api.status('deepseek').hasKey, true);
  for (const suffix of ['.json', '.md', '-对话归档.md']) { const text = fs.readFileSync(path.join(f.memory, 'deepseek' + suffix), 'utf8'); assert.ok(!text.includes('要清除')); }
  assert.equal(f.api.history('qwen').length, 1); assert.equal(f.api.status('qwen').hasKey, true);
  assert.equal(f.open().history('deepseek').length, 0);
});
test('clearing while summarizing prevents a late result from restoring deleted memories', async t => {
  const directory = temp(t), memory = createMemory({ directory });
  for (let i = 0; i < 12; i++) { memory.start('kimi', 't' + i, '旧消息'); memory.finish('kimi', 't' + i, '旧回答', '', 'done'); }
  let release; const wait = new Promise(resolve => { release = resolve; });
  const pending = memory.compact('kimi', 10, async () => { await wait; return '不该复活的旧记忆'; }, true);
  memory.clear('kimi'); release(); await pending;
  assert.equal(memory.history('kimi').length, 0); assert.equal(memory.prompt('kimi'), ''); assert.equal(memory.status('kimi').archived, 0);
  assert.equal(createMemory({ directory }).prompt('kimi'), '');
});
test('clearing during generation cancels the request and late completion cannot restore the turn', async t => {
  const f = fixture(t, (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { name: 'AbortError' })))));
  configure(f.api, 'zhipu'); const events = [];
  const pending = f.api.streamChat({ provider: 'zhipu', id: 'active', messages: [{ role: 'user', content: '清除中的消息' }], onEvent: e => events.push(e) });
  f.api.clearMemory('zhipu'); await pending;
  assert.equal(events.at(-1).type, 'aborted'); assert.equal(f.api.history('zhipu').length, 0); assert.equal(f.api.status('zhipu').hasKey, true);
});
