const fs = require('node:fs');
const path = require('node:path');
const { net, safeStorage } = require('electron');
const { createWebSearch } = require('./web-search.cjs');
const { PROVIDERS, providerFor, baseUrlFor, requestParameters } = require('./providers.cjs');
const { createMemory } = require('./memory.cjs');
const DEFAULT_SCOPE = 'default';
const STORE_VERSION = 2;
const LEGACY_MODELS = new Map([['deepseek-chat', 'deepseek-flash'], ['deepseek-reasoner', 'deepseek-v4-pro']]);
const SYSTEM_PROMPT = ''; // Blank persona: no identity or style instructions.
function friendlyError(status, detail, label) {
  if (status === 401 || status === 403) return { code: 'auth', message: `${label} API Key 无效或没有访问权限，请检查配置。` };
  if (status === 402) return { code: 'balance', message: `${label}账户余额不足，请先充值。` };
  if (status === 429) return { code: 'rate', message: '请求太频繁，请稍后再试。' };
  if (status === 404) return { code: 'model', message: '当前接口不支持所选模型，请检查模型名称与接口地址。' };
  if (status >= 500) return { code: 'server', message: `${label}服务暂时不可用，请稍后再试。` };
  return { code: 'http', message: detail || `${label}返回了错误（${status}）。` };
}
function sanitizeDetail(detail) {
  const text = String(detail || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 220);
}

function safePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100000
    ? Math.round(number * 10000) / 10000
    : 0;
}

function readPricing(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    input: safePrice(source.input),
    output: safePrice(source.output),
    currency: source.currency === '$' ? '$' : '¥',
  };
}

function validatePricing(raw, fallback) {
  if (raw === undefined) return fallback;
  if (!raw || typeof raw !== 'object') throw new Error('费用单价格式不正确。');
  for (const field of ['input', 'output']) {
    const value = Number(raw[field] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      throw new Error('费用单价需要是 0 到 100000 之间的数字。');
    }
  }
  return {
    input: Math.round(Number(raw.input ?? 0) * 10000) / 10000,
    output: Math.round(Number(raw.output ?? 0) * 10000) / 10000,
    currency: raw.currency === '$' ? '$' : '¥',
  };
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const promptTokens = tokenCount(raw.prompt_tokens);
  const completionTokens = tokenCount(raw.completion_tokens);
  const totalTokens = tokenCount(raw.total_tokens) || promptTokens + completionTokens;
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheHitTokens: tokenCount(raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens),
    cacheMissTokens: tokenCount(raw.prompt_cache_miss_tokens),
    reasoningTokens: tokenCount(raw.completion_tokens_details?.reasoning_tokens),
  };
}

function buildSearchPrompt(results, scopePrompt = SYSTEM_PROMPT) {
  const blocks = results.map((result, index) => [
    `[${index + 1}] ${result.title}`,
    `来源：${result.host}`,
    `摘要：${result.snippet || '（无摘要）'}`,
  ].join('\n'));
  return [
    scopePrompt,
    '【联网搜索资料开始】',
    blocks.join('\n\n'),
    '【联网搜索资料结束】',
  ].join('\n\n');
}

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}


function createDeepSeek({ userData, memoryDirectory, log = () => {}, search: searchProvider = createWebSearch({ log }) }) {
  const active = new Map(), summaryControllers = new Map();
  const memories = new Map();
  const scopeKey = (provider, scope) => scope + ':' + provider;
  function memoryFor(scope) {
    if (!memoryDirectory) return null;
    if (!memories.has(scope)) memories.set(scope, createMemory({ directory: memoryDirectory, characterName: 'AI 助手', log }));
    return memories.get(scope);
  }
  const selectionPath = path.join(userData, 'ai-settings.json');
  const configPath = id => { providerFor(id); return path.join(userData, `${id}.json`); };
  function selected() {
    try { return providerFor(JSON.parse(fs.readFileSync(selectionPath, 'utf8')).selectedProvider).id; }
    catch { return 'deepseek'; }
  }
  function selectedScope() { return DEFAULT_SCOPE; }
  function selectionPatch(patch) {
    let prior = {}; try { prior = JSON.parse(fs.readFileSync(selectionPath, 'utf8')); } catch { /* First launch. */ }
    atomic(selectionPath, { ...prior, version: 2, ...patch });
  }
  function atomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value), 'utf8'); fs.renameSync(`${file}.tmp`, file);
  }
  function readStored(id = selected()) {
    const provider = providerFor(id); let raw = {};
    try { raw = JSON.parse(fs.readFileSync(configPath(id), 'utf8')); } catch { /* First use has no credentials. */ }
    const model = typeof raw.model === 'string' && raw.model.trim() ? (id === 'deepseek' ? LEGACY_MODELS.get(raw.model) ?? raw.model : raw.model) : provider.model;
    let key = null;
    if (typeof raw.key === 'string' && raw.key && safeStorage.isEncryptionAvailable()) {
      try { key = safeStorage.decryptString(Buffer.from(raw.key, 'base64')); }
      catch (error) { log('AI_KEY_DECRYPT_FAILED', id, error.message); }
    }
    const contextRounds = Number.isInteger(raw.contextRounds) && raw.contextRounds >= 6 && raw.contextRounds <= 50 ? raw.contextRounds : 30;
    return { provider: id, model, key, baseUrl: baseUrlFor(id, raw.baseUrl), contextRounds,
      thinking: typeof raw.thinking === 'boolean' ? raw.thinking : id === 'deepseek' && model === 'deepseek-v4-pro', pricing: readPricing(raw.pricing) };
  }
  function status(id = selected()) {
    const value = readStored(id);
    return { provider: id, label: providerFor(id).label, hasKey: Boolean(value.key), model: value.model,
      baseUrl: value.baseUrl, contextRounds: value.contextRounds, thinking: value.thinking,
      encryptionAvailable: safeStorage.isEncryptionAvailable(), pricing: value.pricing };
  }
  function catalog() {
    return { selectedProvider: selected(), providers: Object.values(PROVIDERS).map(p => ({ ...p, ...status(p.id) })), memoryDirectory: memoryDirectory || null };
  }
  function select(id) {
    providerFor(id);
    if (id !== selected()) for (const entry of active.values()) entry.controller.abort();
    selectionPatch({ selectedProvider: id }); return catalog();
  }
  function writeStored(id, config) {
    const { key, ...plain } = config;
    const data = { version: STORE_VERSION, ...plain };
    if (key) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法安全保存 API Key。');
      data.key = safeStorage.encryptString(key).toString('base64');
    }
    atomic(configPath(id), data);
  }
  function save(config = {}) {
    const id = config.provider ?? selected(), p = providerFor(id), current = readStored(id);
    const key = typeof config.key === 'string' && config.key.trim() ? config.key.trim() : current.key;
    if (key && (key.length < 8 || key.length > 512 || /\s|[^\x21-\x7e]/.test(key))) throw new Error('API Key 格式不正确，请完整粘贴且不要包含空格。');
    const model = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : current.model;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(model)) throw new Error('模型名称格式不正确。');
    const contextRounds = config.contextRounds ?? current.contextRounds;
    if (!Number.isInteger(contextRounds) || contextRounds < 6 || contextRounds > 50) throw new Error('上下文轮数需要在 6 到 50 之间。');
    writeStored(id, { provider: id, key, model, baseUrl: baseUrlFor(id, config.baseUrl ?? current.baseUrl), contextRounds,
      thinking: typeof config.thinking === 'boolean' ? config.thinking : current.thinking,
      pricing: validatePricing(config.pricing, current.pricing) });
    log('AI_CONFIG_SAVED', id, model); return status(id);
  }
  function clear(id = selected()) {
    const current = readStored(id); writeStored(id, { ...current, key: null });
    for (const entry of active.values()) if (entry.provider === id) entry.controller.abort();
    for (const [key, controller] of summaryControllers) if (key.endsWith(':' + id)) controller.abort(); return status(id);
  }
  function endpoint(stored) {
    const override = stored.provider === 'deepseek' ? process.env.BIGFISH_DEEPSEEK_BASE : null;
    return `${(override || stored.baseUrl).replace(/\/+$/, '')}/chat/completions`;
  }
  async function readError(response, label) {
    let detail = '';
    try { const text = await response.text(); try { const data = JSON.parse(text); detail = sanitizeDetail(data?.error?.message || data?.message || text); } catch { detail = sanitizeDetail(text); } } catch { /* Keep HTTP classification. */ }
    return friendlyError(response.status, detail, label);
  }
  function fetchChat(stored, payload, signal) {
    return net.fetch(endpoint(stored), { method: 'POST', headers: { Authorization: `Bearer ${stored.key}`, 'Content-Type': 'application/json', Accept: payload.stream ? 'text/event-stream' : 'application/json' }, body: JSON.stringify(payload), signal });
  }
  async function test(id = selected()) {
    const stored = readStored(id), label = providerFor(id).label;
    if (!stored.key) return { ok: false, code: 'no-key', message: `还没有配置${label} API Key。` };
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000), started = Date.now();
    try {
      const response = await fetchChat(stored, { ...requestParameters(id, stored, { stream: false, test: true }), messages: [{ role: 'user', content: '你好，请简短回应。' }] }, controller.signal);
      if (!response.ok) return { ok: false, ...(await readError(response, label)) };
      const data = await response.json();
      if (!data.choices?.some(choice => [choice?.message?.content, choice?.message?.reasoning_content].some(text => typeof text === 'string' && text.trim()))) return { ok: false, code: 'protocol', message: '接口未返回兼容的聊天结果，请检查地址。' };
      return { ok: true, message: `${label}连接成功（${Date.now() - started} ms）` };
    } catch (error) { return { ok: false, code: error.name === 'AbortError' ? 'timeout' : 'network', message: error.name === 'AbortError' ? '连接超时，请检查网络或代理。' : `连接${label}失败，请检查网络或代理。` }; }
    finally { clearTimeout(timeout); }
  }
  async function summarize(id, scope, prior, turns) {
    const stored = readStored(id); if (!stored.key) throw new Error('请先保存本接口的 API Key，再整理长期记忆。');
    const controller = new AbortController(); const summaryKey = scopeKey(id, scope); summaryControllers.set(summaryKey, controller);
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const body = { ...requestParameters(id, { ...stored, thinking: false }, { stream: false }), messages: [
        { role: 'user', content: '请为后续对话整理长期记忆。合并已有记忆和以下历史，保留用户明确表达的身份信息、偏好、重要事实、未完成事项和约定；不要猜测或编造，不要记录 API Key 等密钥。保留细节但去掉重复，只输出 Markdown 条目。\n\n已有记忆：\n' + prior + '\n\n历史对话：\n' + turns.map(t => `用户：${t.user}\n助手：${t.assistant}`).join('\n\n').slice(0, 80000) },
      ] };
      const response = await fetchChat(stored, body, controller.signal);
      if (!response.ok) throw new Error((await readError(response, providerFor(id).label)).message);
      const result = await response.json(); return result?.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timeout); if (summaryControllers.get(summaryKey) === controller) summaryControllers.delete(summaryKey); }
  }
  async function compactMemory(id = selected(), force = true, scope = selectedScope()) {
    const memory = memoryFor(scope);
    if (!memory) throw new Error('长期记忆目录不可用。');
    return memory.compact(id, readStored(id).contextRounds, (prior, turns) => summarize(id, scope, prior, turns), force);
  }
  async function streamChat({ id, provider = selected(), scope = selectedScope(), messages, retryOf, search: useSearch = false, onEvent }) {
    scope = DEFAULT_SCOPE;
    const emitRaw = onEvent;
    const emit = value => emitRaw({ ...value, provider, scope });
    let stored, label, character, memory;
    try { stored = readStored(provider); label = providerFor(provider).label;  memory = memoryFor(scope); }
    catch (error) { emit({ type: 'error', id, code: 'input', message: error.message }); return; }
    if (!stored.key) { emit({ type: 'error', id, code: 'no-key', message: `还没有配置${label} API Key，请先到设置里填写。` }); return; }
    if (!Array.isArray(messages)) { emit({ type: 'error', id, code: 'input', message: '消息格式不正确。' }); return; }
    const clean = messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.trim().slice(0, 30000), ...(m.role === 'assistant' && typeof m.reasoning_content === 'string' ? { reasoning_content: m.reasoning_content.slice(0, 80000) } : {}) })).filter(m => m.content).slice(-101);
    const question = [...clean].reverse().find(m => m.role === 'user')?.content.slice(0, 8000);
    if (!question) { emit({ type: 'error', id, code: 'input', message: '消息为空。' }); return; }
    for (const entry of active.values()) entry.controller.abort();
    const controller = new AbortController(), entry = { controller, timedOut: false, provider, scope };
    active.set(id, entry);
    const timeout = setTimeout(() => { entry.timedOut = true; controller.abort(); }, 180000);
    let answerText = '', reasoningText = '', terminal = 'failed', started = false;
    const send = emit;
    const emitEvent = value => { if (value.type === 'done') terminal = value.finishReason === 'length' ? 'truncated' : 'done'; else if (value.type === 'aborted') terminal = 'stopped'; send(value); };
    // Wrap terminal bookkeeping without persisting or exposing credentials.
    const deliver = emitEvent;
    try {
      let context;
      if (memory) {
        if (scope === DEFAULT_SCOPE) memory.seed(provider, clean.slice(0, -1)); context = memory.context(provider, stored.contextRounds, typeof retryOf === 'string' ? retryOf : undefined);
        memory.start(provider, id, question); started = true;
      } else context = clean.slice(0, -1).slice(-(stored.contextRounds * 2 - 1));
      context = [...context, { role: 'user', content: question }];
      let systemPrompt = SYSTEM_PROMPT;
      if (useSearch) {
        deliver({ type: 'searching', id }); let outcome;
        try { outcome = await searchProvider.search(question, { signal: controller.signal }); }
        catch (error) { log('WEB_SEARCH_UNEXPECTED', error.message); outcome = { ok: false, message: '联网搜索失败，请检查网络。' }; }
        if (controller.signal.aborted || outcome?.code === 'aborted') throw abortError();
        if (outcome?.ok && outcome.results?.length) { systemPrompt = buildSearchPrompt(outcome.results, SYSTEM_PROMPT); deliver({ type: 'sources', id, sources: outcome.results.map(({ title, url, host }) => ({ title, url, host })) }); }
        else deliver({ type: 'search-status', id, status: outcome?.code === 'empty' ? 'empty' : 'failed', message: `${String(outcome?.message || '没有找到相关网页').replace(/。$/, '')}，已直接回答。` });
      }
      const remembered = memory?.prompt(provider);
      const payload = { ...requestParameters(provider, stored), messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...(remembered ? [{ role: 'system', content: '【本接口与用户的长期记忆】\n' + remembered }] : []), ...context] };
      const response = await fetchChat(stored, payload, controller.signal);
      if (!response.ok) { deliver({ type: 'error', id, ...(await readError(response, label)) }); return; }
      if (!response.body) { deliver({ type: 'error', id, code: 'stream', message: `${label}没有返回可读取的回答。` }); return; }
      let usage = null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let contentLength = 0;
      let reasoningSeen = false;
      let finished = false;
      let finishReason = null;

      const handleEvent = eventText => {
        for (const line of eventText.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') {
            if (data === '[DONE]') finished = true;
            continue;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (parsed?.usage) {
            const nextUsage = normalizeUsage(parsed.usage);
            if (nextUsage) {
              usage = nextUsage;
              deliver({ type: 'usage', id, usage, pricing: stored.pricing });
            }
          }
          const delta = parsed?.choices?.[0]?.delta;
          if (parsed?.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
          if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
            reasoningText += delta.reasoning_content; reasoningSeen = true;
            deliver({ type: 'reasoning', id, text: delta.reasoning_content });
          }
          if (typeof delta?.content === 'string' && delta.content) {
            contentLength += delta.content.length; answerText += delta.content;
            deliver({ type: 'delta', id, text: delta.content });
          }
        }
      };

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        let split;
        while (!finished && (split = buffer.indexOf('\n\n')) >= 0) {
          const eventText = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          handleEvent(eventText);
        }
      }
      if (!finished && buffer.trim()) handleEvent(buffer);
      reader.cancel().catch(() => {});
      if ((!finished && !finishReason) || !contentLength) {
        deliver({ type: 'error', id, code: 'incomplete', message: contentLength
          ? '连接提前结束，回答可能不完整。可以重试这一轮。'
          : '这次没有收到回答，可以重试这一轮。' });
      } else if (finishReason && !['stop', 'length'].includes(finishReason)) {
        deliver({ type: 'error', id, code: 'incomplete', message: '回答未正常完成，可以修改问题后重试。' });
      } else {
        deliver({ type: 'done', id, chars: contentLength, usage, pricing: stored.pricing,
          finishReason: finishReason === 'length' ? 'length' : 'stop' });
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        if (entry.timedOut) deliver({ type: 'error', id, code: 'timeout', message: '回答超时，已停止生成。' });
        else deliver({ type: 'aborted', id });
      } else { log('AI_CHAT_FAILED', provider, error.message); deliver({ type: 'error', id, code: 'network', message: error.message?.includes('记忆') ? error.message : `连接${label}失败，请检查网络或代理。` }); }
    } finally {
      clearTimeout(timeout); if (active.get(id) === entry) active.delete(id);
      if (memory && started) {
        try { memory.finish(provider, id, answerText, reasoningText, terminal); }
        catch (error) { log('MEMORY_WRITE_FAILED', provider, error.message); emit({ type: 'memory-status', id, message: '本轮记忆文件未能保存，请检查记忆目录。' }); }
        if (terminal === 'done') void compactMemory(provider, false, scope).catch(error => log('MEMORY_AUTO_SUMMARY_FAILED', provider, error.message));
      }
    }
  }
  function stop(id) { active.get(String(id))?.controller.abort(); }
  function dispose() { for (const entry of active.values()) entry.controller.abort(); for (const c of summaryControllers.values()) c.abort(); active.clear(); }
  function clearMemory(id = selected(), scope = selectedScope()) {
    const memory = memoryFor(scope);
    providerFor(id);
    if (!memory) throw new Error('记忆目录不可用。');
    for (const entry of active.values()) if (entry.provider === id && entry.scope === scope) entry.controller.abort();
    summaryControllers.get(scopeKey(id, scope))?.abort();
    return memory.clear(id);
  }
  return { status, save, clear, test, streamChat, stop, dispose, catalog, select, compactMemory, clearMemory,
    memoryStatus: (id = selected(), scope = selectedScope()) => memoryFor(scope)?.status(id) ?? null,
    history: (id = selected(), scope = selectedScope()) => memoryFor(scope)?.history(id) ?? [] };
}
module.exports = { createDeepSeek };
