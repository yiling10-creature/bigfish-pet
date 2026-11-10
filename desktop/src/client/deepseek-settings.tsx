import React, { useEffect, useState } from 'react';
import { providerLabels, type DeepSeekPricing, type ProviderId, type ProviderConfig, type ProviderCatalog, type MemoryStatus } from './deepseek.js';

function ProviderForm({ value, active, scope, assistantName, onRefresh }: { value: ProviderConfig; active: boolean; scope: string; assistantName: string; onRefresh: () => Promise<void> }) {
  const bridge = window.desktopPet?.deepseek;
  const [key, setKey] = useState(''), [model, setModel] = useState(value.model), [baseUrl, setBaseUrl] = useState(value.baseUrl);
  const [contextRounds, setContextRounds] = useState(value.contextRounds), [thinking, setThinking] = useState(value.thinking);
  const [pricing, setPricing] = useState<DeepSeekPricing>(value.pricing);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const [memory, setMemory] = useState<MemoryStatus | null>(null);
  const refreshMemory = () => bridge?.memoryStatus(value.id, scope).then(setMemory).catch(() => {});
  useEffect(() => { void refreshMemory(); }, [value.id, scope]);
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setMessage(''); setFailed(false);
    try { await action(); } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : '操作失败，请重试。'); }
    finally { setBusy(''); }
  };
  const save = () => run('save', async () => {
    if (!bridge) return;
    const result = await bridge.save({ provider: value.id, key, model, baseUrl, contextRounds, thinking, pricing });
    if (!result.ok) throw new Error(result.message || '保存失败。');
    setKey(''); setMessage(`${value.label}配置已保存。`); await onRefresh();
  });
  const test = () => run('test', async () => {
    if (!bridge) return;
    const result = await bridge.test(value.id); if (!result.ok) throw new Error(result.message || '连接失败。');
    setMessage(result.message || '连接成功。');
  });
  return <div className="bf-provider-form">
    <div className="bf-provider-heading"><div><strong>{value.label}</strong><span>{value.hasKey ? '已保存 Key' : '待配置 Key'}</span></div>
      <button type="button" disabled={Boolean(busy) || active} onClick={() => void run('select', async () => { await bridge?.select(value.id); await onRefresh(); setMessage(`当前聊天接口已切换到${value.label}。`); })}>{active ? '当前聊天接口' : '用于聊天'}</button></div>
    <p className="bf-help">Key 和模型按接口保存；聊天记录与长期记忆按接口分别保存。</p>
    <label className="bf-field bf-deepseek-key"><span>{value.label} API Key</span><input type="password" autoComplete="off" spellCheck={false} aria-label={`${value.label} API Key`} placeholder={value.hasKey ? '已保存，留空保留；输入可替换' : '粘贴本接口的 API Key'} value={key} onChange={e => setKey(e.target.value)} /></label>
    <label className="bf-field"><span>模型名称</span><input type="text" aria-label="模型名称" list={`models-${value.id}`} value={model} onChange={e => setModel(e.target.value)} spellCheck={false} /></label>
    <datalist id={`models-${value.id}`}>{value.models.map(m => <option key={m} value={m} />)}</datalist>
    <label className="bf-field bf-api-url"><span>接口地址 · Base URL</span><input type="url" aria-label="接口地址" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} spellCheck={false} /></label>
    {value.id === 'qwen' && <p className="bf-help">默认使用中国内地地址。其他地域或业务空间可填写百炼控制台提供的 Base URL。</p>}
    <label className="bf-field"><span>近期上下文</span><select aria-label="近期上下文" value={contextRounds} onChange={e => setContextRounds(+e.target.value)}>{[10, 20, 30, 50].map(n => <option key={n} value={n}>最近 {n} 轮 + 长期记忆</option>)}</select></label>
    <label className="bf-field"><span>深度思考</span><input type="checkbox" aria-label="深度思考" checked={thinking || (value.id === 'kimi' && /^kimi-k3/.test(model))} disabled={value.id === 'kimi' && /^kimi-k3/.test(model)} onChange={e => setThinking(e.target.checked)} /></label>
    <p className="bf-help">较早的对话会自动整理成长期记忆摘要，完整文字保留在源文件夹的 Markdown 归档中。</p>
    <details><summary>费用显示（可选）</summary><p className="bf-help">填写每百万 tokens 单价，0 表示不显示估算费用。</p>
      {(['input', 'output'] as const).map(field => <label className="bf-field" key={field}><span>{field === 'input' ? '输入单价' : '输出单价'}</span><input type="number" min="0" max="100000" step="0.01" aria-label={`${field === 'input' ? '输入' : '输出'}单价`} value={pricing[field]} onChange={e => setPricing(v => ({ ...v, [field]: +e.target.value }))} /></label>)}
      <label className="bf-field"><span>费用单位</span><select aria-label="费用单位" value={pricing.currency} onChange={e => setPricing(v => ({ ...v, currency: e.target.value === '$' ? '$' : '¥' }))}><option value="¥">人民币</option><option value="$">美元</option></select></label>
    </details>
    <div className="bf-button-row"><button disabled={Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存配置'}</button><button disabled={Boolean(busy) || !value.hasKey} onClick={() => void test()}>{busy === 'test' ? '测试中…' : '测试连接'}</button>
      <button disabled={Boolean(busy) || !value.hasKey} onClick={() => { if (confirm(`清除${value.label}已保存的 API Key？其他接口不受影响。`)) void run('clear', async () => { const result = await bridge?.clear(value.id); if (!result?.ok) throw new Error(result?.message || '清除失败。'); setMessage('已清除本接口 Key。'); await onRefresh(); }); }}>清除本接口 Key</button></div>
    <p className="bf-help">修改后先保存，再测试连接。Key 由系统加密，只在对应接口发起请求时使用。</p>
    <div className="bf-memory-panel"><strong>{assistantName} · {value.label} 的长期记忆</strong><p className="bf-help">{memory ? `近期 ${memory.recent} 轮，已整理 ${memory.archived} 轮${memory.hasSummary ? ' · 已有记忆摘要' : ' · 记忆逐步积累中'}` : '尚未读取记忆状态'}</p>
      {memory && <p className="bf-memory-path" title={memory.file}>{memory.file}</p>}
      <div className="bf-button-row"><button disabled={Boolean(busy)} onClick={() => void run('open-memory', async () => { const info = await bridge?.openMemory(value.id, scope); if (info) setMemory(info); })}>打开记忆文件夹</button><button disabled={Boolean(busy) || !value.hasKey} onClick={() => void run('compact', async () => { const result = await bridge?.compactMemory(value.id, scope); if (result) setMemory(result); setMessage('记忆已整理；最近的对话继续保留原文。'); })}>{busy === 'compact' ? '整理中…' : '整理长期记忆'}</button></div>
      <div className="bf-button-row"><button type="button" disabled={Boolean(busy)} onClick={() => { if (confirm(`清除「${assistantName}」在${value.label}下的全部记忆？\n\n将清空本接口下的聊天记录、手动记忆、长期摘要和完整归档。此操作无法撤销。其他接口及 API 配置会保留。`)) void run('clear-memory', async () => { const result = await bridge?.clearMemory(value.id, scope); if (result) setMemory(result); setMessage(`${assistantName}在${value.label}下的记忆和聊天记录已清除，API 配置已保留。`); }); }}>{busy === 'clear-memory' ? '清除中…' : '清除本接口的记忆'}</button></div>
      <p className="bf-help">可编辑记忆 Markdown 中的“手动记忆”区域，下一次提问就会读取。自动摘要只使用本接口的模型。</p>
    </div>
    {message && <p className={failed ? 'bf-error' : 'bf-help'} role="status">{message}</p>}
  </div>;
}
export function DeepSeekSettings() {
  const bridge = window.desktopPet?.deepseek;
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null), [editing, setEditing] = useState<ProviderId>('deepseek'), [error, setError] = useState('');
  const refresh = async () => { if (bridge) setCatalog(await bridge.catalog()); };
  useEffect(() => {
    let alive = true, initialized = false;
    const reload = () => { void bridge?.catalog().then(value => {
      if (!alive) return;
      setCatalog(value); setError('');
      if (!initialized) { setEditing(value.selectedProvider); initialized = true; }
    }).catch(() => { if (alive) setError('接口配置无法读取，请重试。'); }); };
    const visible = () => { if (!document.hidden) reload(); };
    reload(); addEventListener('focus', reload); document.addEventListener('visibilitychange', visible);
    return () => { alive = false; removeEventListener('focus', reload); document.removeEventListener('visibilitychange', visible); };
  }, [bridge]);
  if (!bridge) return null;
  const config = catalog?.providers.find(p => p.id === editing);
  return <div>
    <nav className="bf-provider-tabs" aria-label="接口配置">{Object.entries(providerLabels).map(([id, label]) => <button key={id} type="button" aria-pressed={editing === id} onClick={() => setEditing(id as ProviderId)}><span>{label}</span><i data-configured={Boolean(catalog?.providers.find(p => p.id === id)?.hasKey)} /></button>)}</nav>
    {config && <ProviderForm key={editing} scope="default" assistantName="AI 助手" value={config} active={catalog?.selectedProvider === editing} onRefresh={refresh} />}
    {!config && !error && <p className="bf-help">正在读取接口配置…</p>}{error && <p className="bf-error" role="alert">{error}</p>}
    <p className="bf-help">在本页配置接口，点击“用于聊天”后生效。开启联网时，问题会发送给 Bing。</p>
  </div>;
}
