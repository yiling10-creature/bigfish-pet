const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPetFocus } = require('../window-focus.cjs');
function fixture() {
 const window = new EventEmitter(), calls = []; let destroyed = false;
 Object.assign(window, { isDestroyed: () => destroyed, setFocusable: value => calls.push(['focusable',value]), setSkipTaskbar: value => calls.push(['taskbar',value]), focus: () => calls.push(['focus']), webContents: { focus: () => calls.push(['input']) } });
 const focus = createPetFocus(window, () => calls.push(['released']));
 return { window, calls, focus, destroy: () => { destroyed = true; } };
}
test('passive pet interaction never requests keyboard or window focus', () => {
 const f = fixture(); assert.equal(f.calls.length,0); f.focus.request(false); f.focus.request(false);
 assert.ok(f.calls.every(call => (call[0] === 'focusable' && call[1] === false) || (call[0] === 'taskbar' && call[1] === true)));
});
test('explicit typing gets focus and releasing returns to nonactivating mode', () => {
 const f=fixture(); f.focus.request(true); assert.ok(f.calls.some(c=>c[0]==='focus')); assert.ok(!f.calls.some(c=>c[0]==='input')); f.focus.request(false);
 assert.deepEqual(f.calls.slice(-3),[['focusable',false],['taskbar',true],['released']]);
 const released=f.calls.filter(c=>c[0]==='released').length;f.focus.request(false);assert.equal(f.calls.filter(c=>c[0]==='released').length,released);
});
test('leaving the chat or hiding it ends keyboard capture until explicitly enabled again', () => {
 const f=fixture();f.focus.request(true);f.window.emit('blur');assert.deepEqual(f.calls.slice(-3),[['focusable',false],['taskbar',true],['released']]);
 f.focus.request(true);f.window.emit('hide');assert.deepEqual(f.calls.slice(-3),[['focusable',false],['taskbar',true],['released']]);
});
test('destroyed windows cannot be focused by a late request', () => {
 const f=fixture();f.destroy();assert.equal(f.focus.request(true),false);assert.equal(f.calls.length,0);
});

test('typing reasserts taskbar hiding before taking keyboard focus', () => {
 const f=fixture(); f.focus.request(true);
 assert.deepEqual(f.calls.slice(0,3),[['focusable',true],['taskbar',true],['focus']]);
});
test('showing or refocusing the pet keeps its taskbar entry hidden', () => {
 const f=fixture(); f.window.emit('show'); f.window.emit('focus');
 assert.deepEqual(f.calls,[['taskbar',true],['taskbar',true]]);
});
