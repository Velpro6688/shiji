'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),espree=require('espree');
const source=fs.readFileSync(path.join(__dirname,'../../main.js'),'utf8');
const ast=espree.parse(source,{ecmaVersion:2022,range:true}),functions={},handlers={};
function walk(node){
 if(!node||typeof node!=='object')return;
 if(node.type==='FunctionDeclaration'&&['clampResizeRect','clampXYIntoScreen'].includes(node.id.name))functions[node.id.name]=source.slice(...node.range);
 if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='ipcMain'&&node.callee.property.name==='on'){
  const [name,fn]=node.arguments;if(name&&typeof name.value==='string'&&name.value.startsWith('hb-window-'))handlers[name.value]=source.slice(...fn.range);
 }
 for(const [key,value] of Object.entries(node))if(key!=='range')Array.isArray(value)?value.forEach(walk):walk(value);
}
walk(ast);
const displays=[{bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040}},{bounds:{x:1920,y:0,width:1920,height:1080},workArea:{x:1920,y:0,width:1920,height:1040}}];
let bounds={x:100,y:40,width:520,height:600},minimum=[320,480],cursor={x:100,y:40};
const timers=[],win={webContents:{id:1},isDestroyed:()=>false,getBounds:()=>({...bounds}),getPosition:()=>[bounds.x,bounds.y],getMinimumSize:()=>minimum,setBounds:b=>{bounds={...b};}};
const context=vm.createContext({
 win,winLocked:false,manualWindowDrag:null,manualWindowResize:null,windowGestureRevision:0,stickyFitSuppressed:false,stickyPosPinned:false,
 screen:{getDisplayMatching:r=>displays[r.x+r.width/2>=1920?1:0],getCursorScreenPoint:()=>cursor},
 BrowserWindow:{fromWebContents:()=>win,getAllWindows:()=>[win]},
 trustedSizeByWC:new Map(),trustedW:()=>bounds.width,trustedH:()=>bounds.height,
 setInterval:fn=>{timers.push(fn);return fn;},clearInterval:()=>{}
});
for(const code of Object.values(functions))vm.runInContext(code,context);
const calls=Object.fromEntries(Object.entries(handlers).map(([name,code])=>[name,vm.runInContext('('+code+')',context)])),event={sender:win.webContents};
let count=0;
function ok(value,message){assert.ok(value,message);count++;}
for(const dir of ['w','n','nw','ne','sw','e','s','se']){
 bounds={x:400,y:250,width:320,height:480};const before={...bounds};
 calls['hb-window-resize-start'](event);
 calls['hb-window-resize-move'](event,{dir,dx:dir.includes('w')?100:dir.includes('e')?-100:0,dy:dir.includes('n')?100:dir.includes('s')?-100:0});
 calls['hb-window-resize-end'](event);
 ok(JSON.stringify(bounds)===JSON.stringify(before),dir+' respects minimum dimensions without moving the fixed edge');
}
for(const dir of ['w','n','nw','ne','sw','e','s','se']){
 bounds={x:8,y:8,width:1904,height:1024};const before={...bounds};
 calls['hb-window-resize-start'](event);
 calls['hb-window-resize-move'](event,{dir,dx:dir.includes('w')?-100:dir.includes('e')?100:0,dy:dir.includes('n')?-100:dir.includes('s')?100:0});
 calls['hb-window-resize-end'](event);
 ok(JSON.stringify(bounds)===JSON.stringify(before),dir+' respects maximum dimensions without moving the fixed edge');
}
bounds={x:2100,y:100,width:520,height:600};
calls['hb-window-resize-start'](event);calls['hb-window-resize-move'](event,{dir:'se',dx:20,dy:20});calls['hb-window-resize-end'](event);
ok(bounds.x===2100&&bounds.width===540,'resizing on secondary screen preserves its position');
const safe=vm.runInContext('clampXYIntoScreen(2200,100,520,600)',context);
ok(safe.x===2200,'dragging onto secondary screen stays there');
for(const finishResize of [false,true]){
 bounds={x:100,y:40,width:520,height:600};
 calls['hb-window-drag-start'](event);calls['hb-window-drag-end'](event);
 calls['hb-window-resize-start'](event);calls['hb-window-resize-move'](event,{dir:'se',dx:80,dy:50});
 if(finishResize)calls['hb-window-resize-end'](event);
 timers.forEach(fn=>fn());
 ok(bounds.width===600&&bounds.height===650,'old drag timer cannot override '+(finishResize?'completed':'active')+' resize');
}
context.winLocked=true;minimum=[200,160];bounds={x:400,y:250,width:200,height:160};
calls['hb-window-resize-start'](event);calls['hb-window-resize-move'](event,{dir:'nw',dx:100,dy:100});calls['hb-window-resize-end'](event);
ok(bounds.x===400&&bounds.y===250&&bounds.width===200&&bounds.height===160,'sticker uses its own native minimum');
fs.mkdirSync(path.join(__dirname,'results'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'results/verify-window-boundaries-result.json'),JSON.stringify({ok:true,steps:count,method:'Current source IPC handlers executed with simulated windows and displays',ts:new Date().toISOString()},null,2));
console.log('PASS window boundaries '+count+' checks');
