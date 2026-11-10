import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
export function ChatInputView() {
  const bridge = window.desktopPet?.chatInput;
  const [value, setValue] = useState(''), [ready, setReady] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null), composing = useRef(false);
  useEffect(() => { let alive = true; void bridge?.read().then(data => { if (alive) { setValue(data.value); setReady(true); } }).catch(() => setError('输入窗口加载失败，请关闭后重试。')); return () => { alive = false; }; }, [bridge]);
  useLayoutEffect(() => {
    if (!ready || !input.current) return;
    const focus = () => { input.current?.focus({ preventScroll: true }); };
    focus(); input.current.setSelectionRange(input.current.value.length, input.current.value.length); bridge?.ready();
    addEventListener('focus', focus); return () => removeEventListener('focus', focus);
  }, [bridge, ready]);
  const finish = (submit: boolean) => { if (submit && (!value.trim() || composing.current)) return; bridge?.finish({ value, submit }); };
  return <main className="bf-surface bf-compose-window"><form onSubmit={event => { event.preventDefault(); finish(true); }}>
    <textarea ref={input} aria-label="聊天输入文字" placeholder="说点什么…" value={value} maxLength={4000} readOnly={!ready} spellCheck={false}
      onChange={event => { setValue(event.target.value); bridge?.update(event.target.value); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); finish(false); } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); finish(true); } }} />
    {error && <p role="alert">{error}</p>}
    <footer><span>Enter 发送 · Shift+Enter 换行</span><button type="button" onClick={() => finish(false)}>取消</button><button type="submit" disabled={!ready || !value.trim()}>发送</button></footer>
  </form></main>;
}
