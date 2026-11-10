import React, { useEffect, useRef, useState } from 'react';
import { providerLabels, type DeepSeekEvent, type ProviderId, type SearchSource, type TokenUsage, type DeepSeekPricing } from './deepseek.js';
import { readChatHistory, historyKey, boundHistory, messagesFromMemory, type ChatMessage } from './chat-history.js';

const MAX_INPUT = 4000;
const HIDDEN_KEY = 'bigfish.chat.hidden.v2';
const SEARCH_KEY = 'bigfish.chat.search.v1';

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readSearchPreference() {
  try { return localStorage.getItem(SEARCH_KEY) === '1'; } catch { return false; }
}

function formatTokens(value: number) {
  return value.toLocaleString('zh-CN');
}

function estimateCost(usage: TokenUsage | undefined, pricing: DeepSeekPricing | undefined) {
  if (!usage || !pricing) return null;
  if (pricing.input <= 0 && pricing.output <= 0) return null;
  return (usage.promptTokens / 1_000_000) * pricing.input
    + (usage.completionTokens / 1_000_000) * pricing.output;
}

function formatCost(cost: number) {
  if (cost === 0) return '0';
  if (cost < 0.000001) return '<0.000001';
  if (cost < 0.01) return cost.toFixed(6);
  if (cost < 1) return cost.toFixed(4);
  return cost.toFixed(2);
}

function AnswerBody({ text, sources, busy, onOpen }: {
  text: string;
  sources: SearchSource[];
  busy: boolean;
  onOpen: (source: SearchSource) => void;
}) {
  const parts = text.split(/(\[\d{1,2}\])/g);
  return (
    <div className="bf-chat-answer">
      {parts.map((part, index) => {
        const match = /^\[(\d{1,2})\]$/.exec(part);
        const source = match ? sources[Number(match[1]) - 1] : undefined;
        if (!source || !match) return <React.Fragment key={index}>{part}</React.Fragment>;
        return (
          <button
            key={index}
            type="button"
            className="bf-chat-cite"
            title={`来源 ${match[1]}：${source.title}`}
            aria-label={`打开来源 ${match[1]}：${source.title}`}
            onClick={() => onOpen(source)}
          >
            {part}
          </button>
        );
      })}
      {busy && <span className="bf-chat-caret" aria-hidden="true" />}
    </div>
  );
}

function SourceList({ sources, onOpen }: {
  sources: SearchSource[];
  onOpen: (source: SearchSource) => void;
}) {
  return (
    <div className="bf-chat-sources" aria-label="搜索来源">
      <span className="bf-chat-sources-label">参考网页</span>
      {sources.map((source, index) => (
        <button
          key={`${source.url}-${index}`}
          type="button"
          className="bf-chat-source"
          title={`打开：${source.url}`}
          onClick={() => onOpen(source)}
        >
          <span className="bf-chat-source-index">{index + 1}</span>
          <span className="bf-chat-source-title">{source.title}</span>
          <span className="bf-chat-source-host">{source.host}</span>
        </button>
      ))}
    </div>
  );
}

function UsageLine({ message }: { message: ChatMessage }) {
  const usage = message.usage;
  if (!usage) return null;
  const cost = estimateCost(usage, message.pricing);
  const details = [
    usage.cacheHitTokens ? `缓存命中 ${formatTokens(usage.cacheHitTokens)} tokens` : '',
    usage.cacheMissTokens ? `缓存未命中 ${formatTokens(usage.cacheMissTokens)} tokens` : '',
    usage.reasoningTokens ? `推理 ${formatTokens(usage.reasoningTokens)} tokens` : '',
  ].filter(Boolean).join(' · ');
  return (
    <p className="bf-chat-usage" title={details || undefined}>
      <span>输入 {formatTokens(usage.promptTokens)} · 输出 {formatTokens(usage.completionTokens)} · 共 {formatTokens(usage.totalTokens)} tokens</span>
      {cost !== null && (
        <span title="按设置中的单价估算，实际扣费以服务商账单为准">
          {' '}· 约 {message.pricing?.currency}{formatCost(cost)}
        </span>
      )}
    </p>
  );
}

const SELECTED_KEY = 'bigfish.chat.provider.v1';
const SCOPE_KEY = 'bigfish.chat.scope.v1';
function initialScope() { return 'default'; }
let storage: Storage | null = null;
try { storage = localStorage; } catch { /* Session-only fallback. */ }
function initialProvider(): ProviderId {
  try { const value = storage?.getItem(SELECTED_KEY); return value && Object.hasOwn(providerLabels, value) ? value as ProviderId : 'deepseek'; } catch { return 'deepseek'; }
}

export function DeepSeekChat({ onStart, onEvent }: {
  onStart?: (id: string, search: boolean) => void;
  onEvent?: (event: DeepSeekEvent) => void;
} = {}) {
  const [input, setInput] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [session, setSession] = useState(() => { const provider = initialProvider(), scope = initialScope(); return { provider, scope, messages: readChatHistory(storage, provider, scope), ready: false }; });
  const { provider, scope, messages } = session;
  const sessionRef = useRef(session); sessionRef.current = session;
  const setMessages = (update: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => setSession(current => ({ ...current, messages: typeof update === 'function' ? update(current.messages) : update }));
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('思考中');
  const [searchEnabled, setSearchEnabled] = useState(readSearchPreference);
  const [error, setError] = useState('');
  const [settingsHint, setSettingsHint] = useState(false);
  const [copied, setCopied] = useState('');
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDDEN_KEY) !== '0'; } catch { return true; }
  });
  const activeId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRequest = useRef(0);
  const messagesRef = useRef(messages);
  const callbacks = useRef({ onStart, onEvent });
  callbacks.current = { onStart, onEvent };
  messagesRef.current = messages;
  const bridge = window.desktopPet?.deepseek;
  useEffect(() => () => { composerRequest.current++; window.desktopPet?.chatInput.cancel(); }, []);
  const toggleKeyboard = () => {
    if (composerOpen) { window.desktopPet?.chatInput.cancel(); return; }
    const bounds = textareaRef.current?.closest('form')?.getBoundingClientRect();
    const inputBridge = window.desktopPet?.chatInput;
    if (!bounds || !inputBridge) { setError('输入窗口暂时不可用，请重新打开程序。'); return; }
    const token = ++composerRequest.current;
    const origin = sessionRef.current;
    setComposerOpen(true);
    void inputBridge.open({ value: input, rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }).then(result => {
      if (token !== composerRequest.current || sessionRef.current.provider !== origin.provider || sessionRef.current.scope !== origin.scope) return;
      if (result.error) setError(result.error);
      setInput(result.value);
      if (result.submit) send(result.value);
    }).catch(reason => { if (token === composerRequest.current) setError(reason instanceof Error ? reason.message : '输入窗口打开失败。'); })
      .finally(() => { if (token === composerRequest.current) setComposerOpen(false); });
  };

  useEffect(() => {
    if (!bridge) return;
    const off = bridge.onEvent((event: DeepSeekEvent) => {
      if (event.provider && event.provider !== sessionRef.current.provider) return;
      if (event.scope && event.scope !== sessionRef.current.scope) return;
      if (event.type === 'memory-status') { setError(event.message || '记忆文件未能保存。'); return; }
      if (event.id !== activeId.current) return;
      callbacks.current.onEvent?.(event);
      const patch = (values: Partial<ChatMessage>) => setMessages(current => current.map(m => m.id === event.id ? { ...m, ...values } : m));
      if (event.type === 'searching') setPhase('联网搜索中');
      else if (event.type === 'reasoning') { setPhase('认真思考中'); if (event.text) setMessages(current => current.map(m => m.id === event.id ? { ...m, reasoningContent: (m.reasoningContent || '') + event.text } : m)); }
      else if (event.type === 'sources') { setPhase('正在组织回答'); patch({ sources: event.sources ?? [], searchNote: '' }); }
      else if (event.type === 'search-status') { setPhase('正在组织回答'); patch({ searchNote: event.message ?? '搜索暂不可用，已直接回答。' }); }
      else if (event.type === 'usage') patch({ ...(event.usage ? { usage: event.usage } : {}), ...(event.pricing ? { pricing: event.pricing } : {}) });
      else if (event.type === 'delta') {
        setPhase('正在回答');
        setMessages(current => current.map(m => m.id === event.id ? { ...m, content: m.content + (event.text ?? '') } : m));
      } else if (event.type === 'done') {
        setBusy(false); activeId.current = null;
        patch({ truncated: event.finishReason === 'length', ...(event.usage ? { usage: event.usage } : {}), ...(event.pricing ? { pricing: event.pricing } : {}) });
      } else if (event.type === 'aborted') {
        setBusy(false); activeId.current = null; patch({ stopped: true });
      } else if (event.type === 'error') {
        setBusy(false); activeId.current = null; patch({ failed: true });
        setError(event.message ?? '请求失败，请稍后再试。');
        setSettingsHint(event.code === 'no-key' || event.code === 'auth');
      }
    });
    return () => { off?.(); if (activeId.current) bridge.stop(activeId.current); };
  }, [bridge]);

  useEffect(() => { try { localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0'); } catch { /* Optional. */ } }, [hidden]);
  useEffect(() => { try { localStorage.setItem(SEARCH_KEY, searchEnabled ? '1' : '0'); } catch { /* Optional. */ } }, [searchEnabled]);
  useEffect(() => {
    if (!busy && session.ready) try { storage?.setItem(historyKey(provider, scope), JSON.stringify(boundHistory(messages))); }
    catch { setError('聊天列表未能保存，请检查可用磁盘空间；当前页面内容仍保留。'); }
  }, [messages, busy, provider, scope, session.ready]);
  const switchSession = (id: ProviderId, nextScope = sessionRef.current.scope) => {
    if (id === sessionRef.current.provider && nextScope === sessionRef.current.scope) return;
    composerRequest.current++; window.desktopPet?.chatInput.cancel(); setComposerOpen(false);
    if (activeId.current) {
      bridge?.stop(activeId.current);
      callbacks.current.onEvent?.({ type: 'aborted', id: activeId.current });
      const old = { ...sessionRef.current, messages: sessionRef.current.messages.map(m => m.id === activeId.current ? { ...m, stopped: true } : m) };
      try { storage?.setItem(historyKey(old.provider, old.scope), JSON.stringify(boundHistory(old.messages))); } catch { /* Preserve current page. */ }
    }
    activeId.current = null; setBusy(false); setError(''); setInput(''); setSettingsHint(false); setCopied('');
    const next = { provider: id, scope: nextScope, messages: readChatHistory(storage, id, nextScope), ready: false };
    sessionRef.current = next; messagesRef.current = next.messages; setSession(next);
    try { storage?.setItem(SELECTED_KEY, id); storage?.setItem(SCOPE_KEY, nextScope); } catch { /* Optional. */ }
  };
  const switchRef = useRef(switchSession); switchRef.current = switchSession;
  useEffect(() => {
    let alive = true;
    const reload = () => { void bridge?.catalog().then(value => { if (alive) { switchRef.current(value.selectedProvider, 'default'); } }).catch(() => setError('模型接口配置暂时无法读取。')); };
    reload(); addEventListener('bigfish:ai-config', reload);
    return () => { alive = false; removeEventListener('bigfish:ai-config', reload); };
  }, [bridge]);
  useEffect(() => {
    let alive = true;
    // Recover the UI from the source-folder archive only when there is no saved list.
    let saved = false; try { saved = storage?.getItem(historyKey(provider, scope)) != null; } catch { /* Recover from the archive when storage is unavailable. */ }
    if (!saved && !readChatHistory(storage, provider, scope).length) {
      void bridge?.history(provider, scope).then(turns => { if (alive && !activeId.current) setSession(current => current.provider === provider && current.scope === scope && !current.ready ? { ...current, ready: true, messages: current.messages.length ? current.messages : messagesFromMemory(turns) } : current); }).catch(() => { if (alive) setSession(current => current.provider === provider && current.scope === scope ? { ...current, ready: true } : current); });
    } else setSession(current => current.provider === provider && current.scope === scope ? { ...current, ready: true } : current);
    return () => { alive = false; };
  }, [bridge, provider, scope]);
  useEffect(() => {
    const cleared = (event: Event) => {
      const detail = (event as CustomEvent<{ provider: ProviderId; scope?: string }>).detail;
      const id = detail?.provider, clearedScope = detail?.scope || 'default';
      if (!id || !Object.hasOwn(providerLabels, id)) return;
      try { storage?.setItem(historyKey(id, clearedScope), '[]'); if (clearedScope === 'default' && id === 'deepseek') storage?.removeItem('bigfish.chat.history.v1'); } catch { /* Current session is still cleared below. */ }
      if (sessionRef.current.provider !== id || sessionRef.current.scope !== clearedScope) return;
      composerRequest.current++; window.desktopPet?.chatInput.cancel(); setComposerOpen(false);
      if (activeId.current) callbacks.current.onEvent?.({ type: 'aborted', id: activeId.current });
      activeId.current = null; setBusy(false); setError(''); setSettingsHint(false); setCopied('');
      const next = { provider: id, scope: clearedScope, messages: [] as ChatMessage[], ready: true };
      sessionRef.current = next; messagesRef.current = []; setSession(next);
    };
    addEventListener('bigfish:memory-cleared', cleared);
    return () => removeEventListener('bigfish:memory-cleared', cleared);
  }, []);
  useEffect(() => {
    const target = scrollRef.current;
    if (target && stickToBottom.current) target.scrollTop = target.scrollHeight;
  }, [messages, busy, error, phase, hidden]);
  useEffect(() => {
    const target = textareaRef.current;
    if (!target) return;
    target.style.height = 'auto'; target.style.height = `${Math.min(target.scrollHeight, 96)}px`;
  }, [input, hidden]);

  const send = (text: string, previous = messagesRef.current, retryOf?: string) => {
    if (!bridge || activeId.current || !sessionRef.current.ready || !text.trim()) return;
    const question = text.trim().slice(0, MAX_INPUT), id = createId();
    const base = boundHistory(previous);
    const context = [...base.filter(m => m.content && !m.failed).map(m => ({ role: m.role, content: m.content, ...(m.reasoningContent ? { reasoning_content: m.reasoningContent } : {}) })), { role: 'user' as const, content: question }];
    setMessages([...base, { id: createId(), role: 'user', content: question }, { id, role: 'assistant', content: '' }]);
    setInput(''); setError(''); setSettingsHint(false); setCopied(''); setBusy(true);
    setComposerOpen(false); textareaRef.current?.blur(); window.desktopPet?.chatInput.cancel();
    setPhase(searchEnabled ? '联网搜索中' : '思考中'); stickToBottom.current = true; activeId.current = id;
    callbacks.current.onStart?.(id, searchEnabled);
    bridge.chat({ id, provider: sessionRef.current.provider, scope: sessionRef.current.scope, messages: context, ...(retryOf ? { retryOf } : {}), search: searchEnabled });
  };
  const retry = () => {
    let at = messagesRef.current.length - 1;
    while (at >= 0 && messagesRef.current[at]?.role !== 'user') at--;
    const question = messagesRef.current[at];
    if (question) send(question.content, messagesRef.current.slice(0, at), messagesRef.current.slice(at + 1).find(m => m.role === 'assistant')?.id);
  };
  const clear = () => {
    if (messages.length && !confirm('清空聊天列表？长期记忆和完整对话归档会保留。')) return;
    if (activeId.current) { bridge?.stop(activeId.current); callbacks.current.onEvent?.({ type: 'aborted', id: activeId.current }); }
    activeId.current = null; setMessages([]); setError(''); setSettingsHint(false); setBusy(false);
    try { storage?.setItem(historyKey(provider, scope), '[]'); } catch { /* Optional. */ }
  };
  const copy = async (message: ChatMessage) => {
    try { await navigator.clipboard.writeText(message.content); setCopied(message.id); }
    catch { setError('复制失败，可以选中文字后按 Ctrl+C。'); }
  };
  const openSource = (source: SearchSource) => {
    void window.desktopPet?.openExternal(source.url).then(result => { if (!result.ok) setError(result.message ?? '无法打开来源链接。'); }).catch(() => setError('无法打开来源链接。'));
  };
  const last = messages.at(-1);
  if (hidden) return <button type="button" className="bf-chat-toggle" data-busy={busy} aria-label="打开问答" title="打开聊天" onClick={() => setHidden(false)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 2v-6a8.5 8.5 0 1 1 18-4.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01" strokeLinecap="round" strokeWidth="3"/></svg>
  </button>;
  return (
    <section className="bf-chat" aria-label="聊天" data-busy={busy}>
      <header className="bf-chat-toolbar"><div><i data-busy={busy} /><strong>聊天</strong><span>{busy ? phase : '随时聊聊'}</span></div>
        <button type="button" aria-label="打开设置" title="打开设置" onClick={() => window.desktopPet?.openSettings()}>设置</button>
        <button type="button" aria-label="隐藏问答框" title="收起聊天" onClick={() => { setHidden(true); window.desktopPet?.chatInput.cancel(); }}>收起</button></header>
      {(messages.length > 0 || error) && <div className="bf-chat-bubble" ref={scrollRef} role="log" aria-label="聊天记录" aria-live="polite"
        onScroll={e => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {messages.map(message => message.role === 'user' ? <p key={message.id} className="bf-chat-question">{message.content}</p> : (
          <article key={message.id} className="bf-chat-reply" data-message-id={message.id}>
            {message.content && <AnswerBody text={message.content} sources={message.sources ?? []} busy={busy && message.id === activeId.current} onOpen={openSource} />}
            {busy && message.id === activeId.current && !message.content && <p className="bf-chat-thinking"><span className="bf-thinking-dots" aria-hidden="true">•••</span>{phase}…</p>}
            {message.searchNote && <p className="bf-chat-search-note">{message.searchNote}</p>}
            {Boolean(message.sources?.length) && <SourceList sources={message.sources!} onOpen={openSource} />}
            <UsageLine message={message} />
            {message.stopped && <p className="bf-chat-note">已停止生成，已有内容已保留。</p>}
            {message.truncated && <p className="bf-chat-note">达到单次回答长度上限，可以继续回答。</p>}
            {message.content && message.id !== activeId.current && <button type="button" className="bf-chat-copy" onClick={() => void copy(message)}>{copied === message.id ? '已复制' : '复制回答'}</button>}
          </article>))}
        {error && <div className="bf-chat-error" role="status"><span>{error}</span>{settingsHint && <button type="button" onClick={() => window.desktopPet?.openSettings()}>打开设置</button>}</div>}
        {!busy && messages.length > 0 && <div className="bf-chat-bottom-actions">
          {(last?.failed || last?.stopped || last?.truncated) && <button type="button" onClick={retry}>重试这一轮</button>}
          {(last?.truncated || (last?.stopped && last.content)) && <button type="button" onClick={() => send('请从刚才中断的地方继续回答，避免重复已有内容。')}>继续回答</button>}
          <button type="button" className="bf-chat-clear" onClick={clear}>清空显示</button></div>}
      </div>}
      {!messages.length && !error && <p className="bf-chat-welcome">今天有什么想和我分享的？</p>}
      <form className="bf-chat-form" onSubmit={e => { e.preventDefault(); send(input); }}>
        <textarea ref={textareaRef} rows={1} value={input} maxLength={MAX_INPUT} placeholder={composerOpen ? '正在输入…' : '点“输入文字”后开始聊天'} aria-label="输入消息" readOnly spellCheck={false}
          onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(input); } }} />
        <div className="bf-chat-compose-actions"><button type="button" className="bf-chat-search-toggle" aria-pressed={searchEnabled} aria-label={searchEnabled ? '联网搜索已开启，问题会发送给 Bing' : '联网搜索已关闭'} title={searchEnabled ? '联网搜索已开启，问题会发送给 Bing' : '开启联网搜索'} disabled={busy} onClick={() => setSearchEnabled(v => !v)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"/></svg><span>联网</span></button>
          <button type="button" className="bf-chat-input-toggle" aria-pressed={composerOpen} title="输入文字会临时获取键盘焦点，发送后释放" onClick={toggleKeyboard}>{composerOpen ? '取消输入' : '输入文字'}</button>
          {busy ? <button type="button" className="bf-chat-send bf-chat-stop" onClick={() => { if (activeId.current) bridge?.stop(activeId.current); }}>停止</button> : <button type="submit" className="bf-chat-send" disabled={!input.trim() || !session.ready}>发送 <span aria-hidden="true">↗</span></button>}
        </div>
      </form>
    </section>
  );
}
