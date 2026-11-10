const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(fetch, hasKey = true, search) {
  const source = fs.readFileSync(path.join(__dirname, '../deepseek.cjs'), 'utf8');
  const module = { exports: {} };
  const context = { module, process: { env: {} }, Buffer, AbortController, TextDecoder, setTimeout, clearTimeout,
    require: name => name === 'electron' ? {
      safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'sk-offline-test-placeholder' }, net: { fetch },
    } : name === 'node:fs' ? { readFileSync: () => JSON.stringify({ model: 'deepseek-flash', ...(hasKey ? { key: 'b2ZmbGluZQ==' } : {}) }) }
      : name === './web-search.cjs' ? { createWebSearch: () => ({ search: async () => ({ ok: false, code: 'empty' }) }) } : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name) };
  vm.runInNewContext(source, context);
  const personasDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bigfish-persona-stream-'));
  const api = module.exports.createDeepSeek({ userData: 'offline-memory-only', personasDirectory, bundledPersonasDirectory: path.join(personasDirectory, 'no-bundled-personas'), ...(search ? { search } : {}) });
  const dispose = api.dispose; api.dispose = () => { dispose(); fs.rmSync(personasDirectory, { recursive: true, force: true }); };
  return api;
}
const data = value => `data: ${JSON.stringify(value)}\n\n`;
async function run(text) {
  const api = fixture(async () => new Response(text));
  const events = [];
  await api.streamChat({ id: 'test', messages: [{ role: 'user', content: 'offline' }], onEvent: e => events.push(e) });
  api.dispose(); return events;
}
test('normal stream finishes and includes token usage', async () => {
  const events = await run(data({ choices: [{ delta: { content: '你好' }, finish_reason: 'stop' }] })
    + data({ usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }) + 'data: [DONE]\n\n');
  assert.equal(events.find(e => e.type === 'delta').text, '你好');
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).finishReason, 'stop');
  assert.equal(events.at(-1).usage.totalTokens, 7);
});
test('premature EOF preserves partial text and reports incomplete response', async () => {
  const events = await run(data({ choices: [{ delta: { content: '半段回答' } }] }));
  assert.equal(events[0].type, 'delta');
  assert.equal(events.at(-1).code, 'incomplete');
  assert.ok(!events.some(e => e.type === 'done'));
});
test('length limit is reported as truncation', async () => {
  const events = await run(data({ choices: [{ delta: { content: '已到上限' }, finish_reason: 'length' }] }) + 'data: [DONE]\n\n');
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).finishReason, 'length');
});
test('empty and blocked responses never masquerade as success', async () => {
  assert.equal((await run('data: [DONE]\n\n')).at(-1).type, 'error');
  assert.equal((await run(data({ choices: [{ delta: { content: '部分' }, finish_reason: 'content_filter' }] }) + 'data: [DONE]\n\n')).at(-1).type, 'error');
});
test('split UTF-8 bytes and CRLF boundaries are reassembled', async () => {
  const encoded = new TextEncoder().encode(data({ choices: [{ delta: { content: '鲸鱼🐋' }, finish_reason: 'stop' }] }).replaceAll('\n', '\r\n') + 'data: [DONE]\r\n\r\n');
  const api = fixture(async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } })));
  const events = [];
  await api.streamChat({ id: 'split', messages: [{ role: 'user', content: 'offline' }], onEvent: e => events.push(e) });
  assert.equal(events.find(e => e.type === 'delta').text, '鲸鱼🐋');
  assert.equal(events.at(-1).type, 'done'); api.dispose();
});
test('stopping a request produces aborted instead of an error', async () => {
  const api = fixture((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { name: 'AbortError' })))));
  const events = [];
  const pending = api.streamChat({ id: 'stop', messages: [{ role: 'user', content: 'offline' }], onEvent: e => events.push(e) });
  api.stop('stop'); await pending;
  assert.equal(events.at(-1).type, 'aborted'); api.dispose();
});
test('missing key does not contact the API', async () => {
  const api = fixture(() => { throw new Error('must not fetch'); }, false);
  const events = [];
  await api.streamChat({ id: 'none', messages: [{ role: 'user', content: 'offline' }], onEvent: e => events.push(e) });
  assert.equal(events.at(-1).code, 'no-key'); api.dispose();
});

test('reused request id cancels the previous stream without losing the replacement', async () => {
  const api = fixture((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { name: 'AbortError' })))));
  const first = [], second = [];
  const input = { id: 'same', messages: [{ role: 'user', content: 'offline' }] };
  const p1 = api.streamChat({ ...input, onEvent: e => first.push(e) });
  const p2 = api.streamChat({ ...input, onEvent: e => second.push(e) });
  await p1;
  assert.equal(first.at(-1).type, 'aborted');
  api.stop('same'); await p2;
  assert.equal(second.at(-1).type, 'aborted'); api.dispose();
});

test('blank chat sends no persona system message; search adds only retrieved context', async () => {
  const persona = '你是一个通用 AI 助手，请根据用户的问题清晰、准确地回答。';
  for (const search of [false, true]) {
    let request;
    const api = fixture(async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(data({ choices: [{ delta: { content: '你好' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n');
    }, true, { search: async () => ({ ok: true, results: [{ title: 'Example', url: 'https://example.org', host: 'example.org', snippet: 'Offline fixture' }] }) });
    try {
      await api.streamChat({ id: `persona-${search}`, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }, { role: 'user', content: 'again' }], search, onEvent: () => {} });
      if (!search) assert.ok(!request.messages.some(m => m.role === 'system'));
      else assert.equal(request.messages[0].role, 'system');
      assert.equal(request.messages.at(-1).content, 'again');
      if (search) assert.match(request.messages[0].content, /联网搜索资料开始/);
    } finally { api.dispose(); }
  }
});
