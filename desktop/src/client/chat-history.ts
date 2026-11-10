import type { DeepSeekPricing, ProviderId, SearchSource, TokenUsage, MemoryTurn } from './deepseek.js';
export interface ChatMessage {
  id: string; role: 'user' | 'assistant'; content: string; reasoningContent?: string;
  stopped?: boolean; truncated?: boolean; failed?: boolean; sources?: SearchSource[];
  searchNote?: string; usage?: TokenUsage; pricing?: DeepSeekPricing;
}
export const historyKey = (provider: ProviderId, scope = 'default') => scope === 'default' ? `bigfish.chat.history.v2:${provider}` : `bigfish.chat.history.v3:${scope}:${provider}`;
const MAX_MESSAGES = 100, MAX_CHARS = 180000;
export function boundHistory(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []; let size = 0;
  for (const item of messages.slice(-MAX_MESSAGES).reverse()) {
    const cost = item.content.length + (item.reasoningContent?.length || 0);
    if (size + cost > MAX_CHARS && result.length > 1) break;
    result.push(item); size += cost;
  }
  result.reverse(); if (result[0]?.role === 'assistant') result.shift(); return result;
}
export function readChatHistory(storage: Storage | null, provider: ProviderId, scope = 'default'): ChatMessage[] {
  try {
    const raw = storage?.getItem(historyKey(provider, scope)) ?? (scope === 'default' && provider === 'deepseek' ? storage?.getItem('bigfish.chat.history.v1') : null);
    const value: unknown = JSON.parse(raw || '[]'); if (!Array.isArray(value)) return [];
    return boundHistory(value.filter((m): m is ChatMessage => Boolean(m) && typeof m.id === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map(m => ({ id: m.id.slice(0, 80), role: m.role, content: m.content.slice(0, 30000),
        ...(typeof m.reasoningContent === 'string' ? { reasoningContent: m.reasoningContent.slice(0, 80000) } : {}),
        stopped: Boolean(m.stopped), truncated: Boolean(m.truncated), failed: Boolean(m.failed),
        sources: Array.isArray(m.sources) ? m.sources.filter(s => s && typeof s.title === 'string' && typeof s.url === 'string' && /^https?:\/\//.test(s.url) && typeof s.host === 'string').slice(0, 5) : [],
        ...(m.usage ? { usage: m.usage } : {}), ...(m.pricing ? { pricing: m.pricing } : {}) })));
  } catch { return []; }
}
export function messagesFromMemory(turns: MemoryTurn[]): ChatMessage[] {
  return boundHistory(turns.flatMap(t => [
    { id: `u-${t.id}`, role: 'user' as const, content: t.user },
    { id: t.id, role: 'assistant' as const, content: t.assistant, ...(t.reasoning ? { reasoningContent: t.reasoning } : {}),
      failed: t.status === 'failed', stopped: ['stopped', 'pending'].includes(t.status), truncated: t.status === 'truncated' },
  ]));
}
