import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopCompanion } from '../src/desktop/controller.js';

test('desktop follows search, reasoning, output and completion, ignoring stale events', () => {
  const c = new DesktopCompanion(null);
  try {
    assert.equal(c.getSnapshot().snapshot.state, 'idle');
    assert.equal(c.getSnapshot().demo, false);
    c.begin('one', true);
    assert.equal(c.getSnapshot().snapshot.state, 'tool-running');
    assert.equal(c.getSnapshot().activity?.semantic, 'search');
    c.receive({ type: 'sources', id: 'one', sources: [] });
    assert.equal(c.getSnapshot().snapshot.state, 'reasoning');
    c.receive({ type: 'delta', id: 'old', text: 'stale' });
    assert.equal(c.getSnapshot().snapshot.state, 'reasoning');
    c.receive({ type: 'delta', id: 'one', text: '你好' });
    assert.equal(c.getSnapshot().snapshot.state, 'generating');
    assert.equal(c.getSnapshot().snapshot.rate, null);
    c.receive({ type: 'done', id: 'one', finishReason: 'stop' });
    assert.equal(c.getSnapshot().snapshot.state, 'completed');
    assert.equal(c.getSnapshot().snapshot.completionSerial, 1);
  } finally { c.dispose(); }
});

test('truncation, stop and network errors have distinct animation outcomes', () => {
  const c = new DesktopCompanion(null);
  try {
    c.begin('a', false); c.receive({ type: 'done', id: 'a', finishReason: 'length' });
    assert.equal(c.getSnapshot().snapshot.state, 'limited');
    c.begin('b', false); c.receive({ type: 'aborted', id: 'b' });
    assert.equal(c.getSnapshot().snapshot.state, 'cancelled');
    c.begin('c', false); c.receive({ type: 'error', id: 'c', code: 'network' });
    assert.equal(c.getSnapshot().snapshot.state, 'failed');
  } finally { c.dispose(); }
});
