'use strict';
const {app,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),vm=require('vm'),espree=require('espree'),H=require('./_harness');
const suite=H.makeSuite('verify-v304');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false});
 const run=s=>H.evalJson(win,s);
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(600);
  await run(`var g=document.getElementById('guideSkip');if(g)g.click();hideConfirm();data.settings.sound=false;
   data.memoNotes=[{id:'v304-a',html:'<p>正文 A</p>',ord:0},{id:'v304-b',html:'<p>正文 B</p>',ord:1}];
   curNoteId='v304-a';renderNoteToEditor(curNote(),true);document.body.classList.add('app-locked');setStickyMode('note');
   window.testMotionQuery=matchMedia.bind(window);window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:false}:testMotionQuery(q);return true;`);
  const point=await run(`var r=document.getElementById('memoInput').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+60)};`);
  const send=(type,dx,dy)=>win.webContents.sendInputEvent({type,x:point.x+dx,y:point.y+dy,button:'left',...(type==='mouseMove'?{}:{clickCount:1})});
  const reset=()=>run(`curNoteId='v304-a';renderNoteToEditor(curNote(),true);return true;`);
  send('mouseDown',0,0);send('mouseMove',20,0);await H.sleep(40);
  const preview=await run(`return {transform:document.getElementById('memoInput').style.transform,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};`);
  console.log('preview '+JSON.stringify(preview));
  suite.ok(preview.reduced?preview.transform==='':preview.transform!=='','horizontal drag follows the motion preference '+JSON.stringify(preview));
  const out=path.join(H.ROOT,'artifacts','ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'sticky-swipe-preview.png'),await H.capturePng(win));
  send('mouseMove',55,220);send('mouseUp',55,220);await H.sleep(300);
  suite.ok(await run(`return curNoteId==='v304-a'&&document.getElementById('memoInput').style.transform==='';`),'mostly vertical final direction rebounds without turning');
  send('mouseDown',0,0);send('mouseMove',30,0);send('mouseUp',30,0);await H.sleep(300);
  suite.ok(await run(`return curNoteId==='v304-a'&&document.getElementById('memoInput').getAnimations().every(a=>a.playState!=='running');`),'short swipe rebounds and finishes animation');
  send('mouseDown',0,0);send('mouseMove',-100,0);send('mouseUp',-100,0);await H.sleep(300);
  suite.ok(await run(`return curNoteId==='v304-b';`),'complete left swipe turns page');
  await reset();send('mouseDown',0,0);send('mouseMove',-100,0);
  await run(`window.dispatchEvent(new Event('blur'));return true;`);send('mouseUp',-100,0);await H.sleep(300);
  suite.ok(await run(`return curNoteId==='v304-a'&&document.getElementById('memoInput').style.transform==='';`),'blur cancels a captured swipe without leaving an offset');
  await reset();send('mouseDown',0,0);send('mouseMove',-100,0);
  await run(`document.getElementById('memoInput').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}));return true;`);send('mouseUp',-100,0);await H.sleep(300);
  suite.ok(await run(`return curNoteId==='v304-a'&&document.getElementById('memoInput').style.transform==='';`),'pointer cancellation never turns the page');
  await run(`window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true}:testMotionQuery(q);return true;`);
  send('mouseDown',0,0);send('mouseMove',-100,0);await H.sleep(40);
  suite.ok(await run(`return document.getElementById('memoInput').style.transform==='';`),'reduced motion disables drag preview');
  send('mouseUp',-100,0);await H.sleep(300);
  suite.ok(await run(`return curNoteId==='v304-b'&&document.getElementById('memoInput').getAnimations().every(a=>a.playState!=='running');`),'reduced motion still turns pages without animation');
  await H.loadPage(win,{view:'editor',note:'v304-a'});await H.bootWait(win);await H.sleep(400);
  await run(`data.memoNotes=[{id:'v304-a',html:'<p>旧正文</p>',ord:0}];curNoteId='v304-a';renderNoteToEditor(curNote(),true);return true;`);
  ipcMain.removeHandler('hb-data:commit');ipcMain.handle('hb-data:commit',()=>({ok:false,message:'injected save failure'}));
  let pins=0;ipcMain.removeHandler('hb-pin-note');ipcMain.handle('hb-pin-note',()=>{pins++;return {ok:true};});
  await win.webContents.executeJavaScript(`(async()=>{document.getElementById('memoInput').innerHTML='<p>尚未保存正文</p>';saveMemoHtml();await lockStickyNote();})()`);
  suite.ok(pins===0&&await run(`return lastCommitFailed&&document.getElementById('memoInput').innerText.includes('尚未保存正文')&&!document.body.classList.contains('sticky-sticker');`),'save failure blocks pin IPC and preserves the editable draft');
  ipcMain.removeHandler('hb-data:commit');ipcMain.handle('hb-data:commit',()=>({ok:true}));
  await win.webContents.executeJavaScript('lockStickyNote()');
  suite.ok(pins===1&&await run('return !lastCommitFailed&&!lockStickyNote.busy;'),'retry after recovery pins successfully and releases busy state');
  const source=fs.readFileSync(path.join(H.ROOT,'main.js'),'utf8'),ast=espree.parse(source,{ecmaVersion:2022,range:true});let handler;
  function walk(n){if(!n||typeof n!=='object')return;if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.name==='ipcMain'&&n.callee.property.name==='handle'&&n.arguments[0].value==='hb-pin-note')handler=source.slice(...n.arguments[1].range);for(const [k,v]of Object.entries(n))if(k!=='range')Array.isArray(v)?v.forEach(walk):walk(v);}
  walk(ast);
  for(const failure of [true,false]){
   let retired=false;const editor={isDestroyed:()=>false,webContents:{executeJavaScript:()=>failure?Promise.reject(new Error('disk unavailable')):Promise.resolve(true)}};
   const context={BrowserWindow:{fromWebContents:()=>editor},editorWin:editor,retireEditorWindow:()=>{retired=true;},pinFlowActive:false,winLocked:false,win:null,log:()=>{},setTimeout,clearTimeout};
   const fn=vm.runInNewContext('('+handler+')',context);const result=await fn({sender:{}},'v304-a');
   suite.ok(failure?!retired&&result.ok===false:retired,'actual main-process pin handler '+(failure?'keeps the editor when saving fails':'retires only after save confirmation'));
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
