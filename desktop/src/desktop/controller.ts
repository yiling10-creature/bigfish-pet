import { PreferenceStore } from '../client/preferences-store.js';
import type { Companion, CompanionView } from '../client/controller.js';
import type { Snapshot, WorkState } from '../contract/types.js';
import type { DeepSeekEvent } from '../client/deepseek.js';

/** Desktop animation follows this app's chat, without inventing model telemetry. */
export class DesktopCompanion implements Companion {
  readonly preferences: PreferenceStore;
  private listeners = new Set<() => void>();
  private settle: ReturnType<typeof setTimeout> | undefined;
  private off: () => void;
  private activeId: string | null = null;
  private view: CompanionView;
  constructor(storage: Storage | null) {
    // Keep the original desktop key so existing appearance preferences migrate intact.
    this.preferences = new PreferenceStore(null, storage, 'bigfish.demo.preferences.v1');
    const snapshot: Snapshot = { sessionId: 'desktop', turn: 0, sequence: 0, state: 'idle',
      modelKey: null, rate: null, quality: 'unavailable', baseline: null, relativeRate: null,
      pressure: 0, activity: 0, fatigue: 0, whipHz: 0, wallElapsed: 0, workElapsed: 0,
      generationElapsed: 0, tools: 0, tokens: 0, completionSerial: 0 };
    this.view = { snapshot, model: 'DeepSeek', issue: null,
      compatibility: { kind: 'legacy-list-current', supported: true, capabilities: ['desktop-chat'], missing: [] }, demo: false };
    this.off = this.preferences.subscribe(() => this.publish());
  }
  getSnapshot = () => this.view;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish() { this.view = { ...this.view }; for (const fn of this.listeners) fn(); }
  setState(state: WorkState) {
    clearTimeout(this.settle);
    this.view = { ...this.view, activity: state === 'tool-running'
      ? { category: 'search', semantic: 'search', label: '联网搜索', elapsed: 0, activeCount: 1, completedCount: 0 }
      : null, snapshot: { ...this.view.snapshot, state, sequence: this.view.snapshot.sequence + 1,
        activity: ['generating', 'reasoning', 'tool-running'].includes(state) ? 0.6 : 0,
        completionSerial: this.view.snapshot.completionSerial + (state === 'completed' ? 1 : 0) } };
    this.publish();
    if (['completed', 'cancelled', 'failed', 'limited', 'interrupted'].includes(state)) {
      const p = this.preferences.getSnapshot().value;
      const ms = state === 'completed' ? (p.completionMode === 'quiet' ? 0 : p.completionSeconds * 1000) : 4000;
      this.settle = setTimeout(() => this.setState('idle'), ms);
    }
  }
  begin(id: string, search: boolean) {
    this.activeId = id;
    this.view = { ...this.view, snapshot: { ...this.view.snapshot, turn: this.view.snapshot.turn + 1 } };
    this.setState(search ? 'tool-running' : 'reasoning');
  }
  receive(event: DeepSeekEvent) {
    if (event.id !== this.activeId) return;
    let next: WorkState | undefined;
    if (event.type === 'searching') next = 'tool-running';
    else if (['reasoning', 'sources', 'search-status'].includes(event.type)) next = 'reasoning';
    else if (event.type === 'delta') next = 'generating';
    else if (event.type === 'done') next = event.finishReason === 'length' ? 'limited' : 'completed';
    else if (event.type === 'aborted') next = 'cancelled';
    else if (event.type === 'error') next = 'failed';
    if (next && next !== this.view.snapshot.state) this.setState(next);
    if (['done', 'aborted', 'error'].includes(event.type)) this.activeId = null;
  }
  resetLearning() { /* Desktop has no synthetic speed history. */ }
  dispose() { clearTimeout(this.settle); this.off(); this.preferences.dispose(); this.listeners.clear(); }
}
