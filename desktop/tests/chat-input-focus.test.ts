import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusChatInput } from '../src/client/chat-input-focus.js';
function fixture() {
 const frames: Array<FrameRequestCallback> = [], events: string[] = [];
 const document = { activeElement: null as unknown, defaultView: { requestAnimationFrame(callback: FrameRequestCallback) { frames.push(callback); return frames.length; } } };
 const field = { ownerDocument: document, value: '你好', readOnly: false, isConnected: true,
   getBoundingClientRect() { events.push('layout'); return { x: 480, y: 520 }; },
   focus(options: FocusOptions) { assert.equal(options.preventScroll, true); events.push('caret-focus'); document.activeElement = field; },
   setSelectionRange(start: number, end: number) { assert.equal(start, 2); assert.equal(end, 2); events.push('caret-position'); } };
 const frame = async () => { const callback = frames.shift(); assert.ok(callback); callback(0); await Promise.resolve(); await Promise.resolve(); };
 return { field, input: field as unknown as HTMLTextAreaElement, frames, events, frame };
}
test('input acquires focus only after layout, native activation and another paint', async () => {
 const f = fixture(); let live = true;
 const result = focusChatInput(f.input, async () => { f.events.push('native-focus'); return true; }, () => live);
 assert.deepEqual(f.events, []); await f.frame(); assert.deepEqual(f.events, ['layout', 'native-focus']);
 await f.frame(); assert.equal(await result, true); assert.deepEqual(f.events, ['layout', 'native-focus', 'caret-focus', 'caret-position']);
});
test('cancelled input requests do not pull the caret into a hidden or different conversation', async () => {
 const f = fixture(); let live = true;
 const result = focusChatInput(f.input, async () => true, () => live); await f.frame(); live = false; await f.frame();
 assert.equal(await result, false); assert.ok(!f.events.includes('caret-focus'));
});
test('readonly and detached fields cannot activate the native input context', async () => {
 for (const state of ['readonly', 'detached']) {
  const f=fixture(); if(state === 'readonly') f.field.readOnly=true; else f.field.isConnected=false;
  let activated=false; const result=focusChatInput(f.input,async()=>{activated=true;return true;},()=>true);await f.frame();
  assert.equal(await result,false);assert.equal(activated,false);
 }
});
test('failed native activation does not focus the page or place a caret', async () => {
 const f=fixture(); const result=focusChatInput(f.input,async()=>false,()=>true); const rejected=assert.rejects(result,/键盘输入/);await f.frame();await rejected;assert.ok(!f.events.includes('caret-focus'));
});
