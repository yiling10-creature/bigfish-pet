const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createChatInput, positionComposer } = require('../chat-input.cjs');
function fixture() {
 const windows = [];
 class Window extends EventEmitter {
  constructor(options) { super(); this.options=options; this.destroyed=false; this.actions=[];this.webContents=Object.assign(new EventEmitter(),{focus:()=>this.actions.push('view-focus')});windows.push(this); }
  isDestroyed(){return this.destroyed;} setMenuBarVisibility(){} setSkipTaskbar(value){this.actions.push(['taskbar',value]);}
  show(){this.actions.push('show');}focus(){this.actions.push('focus');}
  destroy(){this.destroyed=true;this.emit('closed');}
  loadFile(file,options){this.file=file;this.loadOptions=options;return Promise.resolve();}
 }
 const owner={isDestroyed:()=>false,getContentBounds:()=>({x:0,y:0,width:1920,height:1040}),webContents:{getZoomFactor:()=>1}};
 const api=createChatInput({BrowserWindow:Window,screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},getOwner:()=>owner,preload:'preload.cjs',html:'chat-input.html'});
 const open=(value='草稿')=>api.open({value,rect:{x:1400,y:680,width:360,height:100}});
 return {api,windows,owner,open};
}
test('input owns a small native window beside the chat instead of the fullscreen pet',async()=>{
 const f=fixture();const result=f.open();const w=f.windows[0];
 assert.equal(w.options.x,1400);assert.equal(w.options.y,680);assert.equal(w.options.width,360);assert.equal(w.options.height,116);
 assert.equal(w.options.focusable,true);assert.equal(w.options.skipTaskbar,true);assert.equal(w.file,'chat-input.html');
 w.emit('ready-to-show');assert.ok(!w.actions.includes('show'));f.api.ready(w.webContents);assert.ok(w.actions.includes('show'));
 f.api.finish(w.webContents,{value:'中文消息',submit:true});assert.deepEqual(await result,{value:'中文消息',submit:true});assert.ok(w.destroyed);
});
test('draft is preserved when clicking back to a video without sending',async()=>{
 const f=fixture();const result=f.open();const w=f.windows[0];f.api.ready(w.webContents);w.emit('ready-to-show');
 f.api.update(w.webContents,'还没发送的中文');w.emit('blur');assert.deepEqual(await result,{value:'还没发送的中文',submit:false});
});
test('only the dedicated input renderer can read, change or send its draft',async()=>{
 const f=fixture();const result=f.open();const w=f.windows[0],other={};assert.throws(()=>f.api.read(other));
 f.api.update(other,'invalid');f.api.finish(other,{value:'invalid',submit:true});assert.equal(f.api.read(w.webContents).value,'草稿');
 f.api.cancel();assert.deepEqual(await result,{value:'草稿',submit:false});
});
test('cancel and window destruction settle pending input only once',async()=>{
 const f=fixture();const result=f.open();const w=f.windows[0];f.api.update(w.webContents,'保留');f.api.cancel();f.api.cancel();w.emit('closed');assert.deepEqual(await result,{value:'保留',submit:false});
 const again=f.open('第二次');assert.equal(f.windows.length,2);f.api.dispose();assert.equal((await again).value,'第二次');
});
test('input position respects display origin, zoom and screen edges',()=>{
 const bounds=positionComposer({x:-1920,y:0},{x:1200,y:700,width:360,height:100},{x:-1920,y:0,width:1920,height:1080},1.25);
 assert.equal(bounds.x,-450);assert.equal(bounds.y,875);assert.equal(bounds.width,450);assert.equal(bounds.height,125);
 const edge=positionComposer({x:0,y:0},{x:1910,y:1030,width:360,height:100},{x:0,y:0,width:1920,height:1040});
 assert.equal(edge.x,1560);assert.equal(edge.y,924);assert.throws(()=>positionComposer({x:0,y:0},{x:NaN,y:0,width:360,height:100},{x:0,y:0,width:1920,height:1040}));
});
test('failure to load input closes it and returns the draft without sending',async()=>{
 const f=fixture();const result=f.open('保留失败前草稿');const w=f.windows[0];w.webContents.emit('did-fail-load');const value=await result;assert.equal(value.submit,false);assert.equal(value.value,'保留失败前草稿');assert.ok(value.error);assert.ok(w.destroyed);
});
