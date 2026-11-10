export interface DeepSeekPricing {
  input: number;
  output: number;
  currency: '¥' | '$';
}

export type ProviderId = 'deepseek' | 'zhipu' | 'qwen' | 'kimi';
export const providerLabels: Record<ProviderId, string> = { deepseek: 'DeepSeek', zhipu: '智谱', qwen: '千问', kimi: 'Kimi' };
export interface DeepSeekStatus {
  provider: ProviderId;
  label: string;
  baseUrl: string;
  contextRounds: number;
  thinking: boolean;
  hasKey: boolean;
  model: string;
  encryptionAvailable: boolean;
  pricing: DeepSeekPricing;
}
export interface ProviderConfig extends DeepSeekStatus { id: ProviderId; models: string[] }
export interface ProviderCatalog { selectedProvider: ProviderId; providers: ProviderConfig[]; memoryDirectory: string | null }
export interface MemoryStatus { directory: string; file: string; archived: number; recent: number; hasSummary: boolean; summarizing: boolean }
export interface MemoryTurn { id: string; user: string; assistant: string; reasoning?: string; status: string }

export interface SearchSource {
  title: string;
  url: string;
  host: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  reasoningTokens: number;
}

export interface DeepSeekEvent {
  type: 'delta' | 'reasoning' | 'done' | 'error' | 'aborted' | 'searching' | 'sources' | 'search-status' | 'usage' | 'memory-status';
  provider?: ProviderId;
  scope?: string;
  id: string;
  text?: string;
  code?: string;
  message?: string;
  chars?: number;
  sources?: SearchSource[];
  status?: 'failed' | 'empty';
  usage?: TokenUsage | null;
  pricing?: DeepSeekPricing;
  finishReason?: 'stop' | 'length';
}

export interface DeepSeekResult extends Partial<DeepSeekStatus> {
  ok: boolean;
  message?: string;
}

export interface DeepSeekBridge {
  status(provider?: ProviderId): Promise<DeepSeekResult>;
  save(config: { provider?: ProviderId; key: string; model: string; pricing: DeepSeekPricing; baseUrl?: string; contextRounds?: number; thinking?: boolean }): Promise<DeepSeekResult>;
  clear(provider?: ProviderId): Promise<DeepSeekResult>;
  test(provider?: ProviderId): Promise<DeepSeekResult>;
  catalog(): Promise<ProviderCatalog>;
  select(provider: ProviderId): Promise<ProviderCatalog>;
  history(provider: ProviderId, scope?: string): Promise<MemoryTurn[]>;
  memoryStatus(provider: ProviderId, scope?: string): Promise<MemoryStatus | null>;
  compactMemory(provider: ProviderId, scope?: string): Promise<MemoryStatus>;
  clearMemory(provider: ProviderId, scope?: string): Promise<MemoryStatus>;
  openMemory(provider: ProviderId, scope?: string): Promise<MemoryStatus | null>;
  chat(payload: { id: string; provider?: ProviderId; scope?: string; retryOf?: string; messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning_content?: string }>; search?: boolean }): void;
  stop(id: string): void;
  onEvent(callback: (event: DeepSeekEvent) => void): () => void;
}
