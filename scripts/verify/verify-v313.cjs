'use strict';
const {app,ipcMain,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v313');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const w=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false,transparent:true,backgroundColor:'#00000000'});let sticker=null;const run=s=>H.evalJson(w,s),out=path.join(H.ROOT,'artifacts/ui-3.1.3');fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(w);await H.bootWait(w);await H.sleep(800);await run(`var g=document.getElementById('guideSkip');if(g)g.click();hideConfirm();go('mine');return true;`);
  suite.ok(await run(`return document.querySelectorAll('#page-mine .menu-item').length===19;`),'all existing actions survive consolidation');
  suite.ok(await run(`return document.querySelectorAll('#page-mine .settings-group').length===5&&!document.querySelector('#page-mine .settings-group[open]')&&document.querySelectorAll('#page-mine .settings-action-line').length===2;`),'settings present five purpose groups and two paired backup actions');
  suite.ok(await run(`return [...document.querySelectorAll('#page-mine .settings-inline-actions .mi-ico')].every(e=>getComputedStyle(e).display==='none');`),'paired backup controls omit repeated decorative icons');
  suite.ok(await run(`return document.getElementById('copyDiagnostics').closest('[data-settings-group="settings_operations"]')&&document.getElementById('openDataDirectory').closest('[data-settings-group="settings_storage"]');`),'diagnostics and storage actions live with their related controls');
  await run(`document.querySelector('[data-settings-group="settings_notifications"]>summary').click();var before=data.settings.remindTodo;document.getElementById('tgRemindTodo').click();window._reminderTestBefore=before;return true;`);
  suite.ok(await run(`return data.settings.remindTodo!==window._reminderTestBefore&&document.getElementById('tgRemindTodo').checkVisibility();`),'expanded reminder control is visible and still changes the setting');
  await run(`document.getElementById('tgRemindTodo').click();document.querySelector('[data-settings-group="settings_notifications"]').open=false;return true;`);
  await run(`var group=document.querySelector('[data-settings-group="settings_startup"]');group.open=true;group.querySelector('summary').focus();return true;`);
  w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await H.sleep(80);
  suite.ok(await run(`var group=document.querySelector('[data-settings-group="settings_startup"]');return !group.open&&document.activeElement===group.querySelector('summary');`),'Escape collapses settings and returns focus to its summary');
  for(const width of [320,520,1200]){
   await H.resizeWindow(w,width,720);
   for(const theme of ['light','dark'])for(const page of ['today','mine']){
    await run(`data.settings.theme=${JSON.stringify(theme)};applyTheme();go(${JSON.stringify(page)});return true;`);await H.sleep(160);
    suite.ok(await run(`var p=document.querySelector('.page.active');return p.scrollWidth<=p.clientWidth+1;`),width+'/'+theme+'/'+page+' no horizontal overflow');
    if(page==='today')suite.ok(await run(`var h=document.querySelector('.topbar').getBoundingClientRect(),n=document.querySelector('.date-nav').getBoundingClientRect();return h.height===56&&Math.abs(h.bottom-n.top)<=1;`),width+'/'+theme+' compact header joins fixed date bar');
    const png=await H.capturePng(w),img=require('electron').nativeImage.createFromBuffer(png),b=img.toBitmap(),z=img.getSize();const at=(x,y)=>b[(y*z.width+x)*4+3];suite.ok([at(1,1),at(z.width-2,1),at(1,z.height-2),at(z.width-2,z.height-2)].every(a=>a===0),width+'/'+theme+'/'+page+' four corners remain transparent');
    fs.writeFileSync(path.join(out,page+'-'+width+'-'+theme+'.png'),png);
   }
  }
  await H.resizeWindow(w,520,720);await run(`go('mine');document.querySelector('[data-settings-group="settings_notifications"]').open=true;document.querySelector('[data-settings-group="settings_storage"]').open=true;return true;`);fs.writeFileSync(path.join(out,'settings-expanded-dark.png'),await H.capturePng(w));
  await w.webContents.executeJavaScript("(async()=>{data.memoNotes=[{id:'v313-note',ts:Date.now(),title:'回到待办',html:'<p>回到待办</p>',text:'回到待办'}];await saveMemoFields();})()");
  // Exercise the shipped main-process callback through real renderer IPC in isolated windows.
  const source=fs.readFileSync(path.join(H.ROOT,'main.js'),'utf8'),ast=require('espree').parse(source,{ecmaVersion:'latest',range:true});let callback;
  function findBack(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee?.object?.name==='ipcMain'&&node.callee?.property?.name==='handle'&&node.arguments[0]?.value==='hb-editor-back')callback=node.arguments[1];Object.values(node).forEach(v=>{if(Array.isArray(v))v.forEach(findBack);else if(v&&typeof v==='object')findBack(v);});}findBack(ast);
  if(!callback)throw Error('main editor-back callback missing');
  const context={win:w,winLocked:true,editorWin:null,BrowserWindow,log:()=>{},killEditorWindow:()=>{}};
  const onBack=require('vm').runInNewContext('('+source.slice(callback.range[0],callback.range[1])+')',context);
  ipcMain.removeHandler('hb-editor-back');ipcMain.handle('hb-editor-back',(event,target)=>{suite.calls.push(['hb-editor-back',target]);return onBack(event,target);});
  await w.webContents.executeJavaScript('pinTodayToDesktop()');await run(`setStickyMode('todo');return true;`);
  sticker=H.makeWin(suite,{offscreen:true,width:360,height:480,frame:false,transparent:true,backgroundColor:'#00000000'});await H.loadPage(sticker,{view:'editor',sticky:'1',note:'v313-note'});await H.bootWait(sticker);sticker._isSticky=true;context.editorWin=sticker;await H.evalJson(sticker,`hideConfirm();setStickyMode('todo');document.querySelector('.st-td-open').click();return true;`);await H.sleep(150);
  suite.ok(suite.calls.some(c=>c[0]==='hb-editor-back'&&c[1]==='todo'),'standalone sticker sends the todo destination through preload IPC');
  suite.ok(await run(`return document.querySelector('.page.active').id==='page-todo'&&!document.body.classList.contains('memo-editor-open')&&document.getElementById('todoInput').checkVisibility();`),'real main IPC callback unlocks to a visible todo page');
  context.winLocked=false;await run(`go('memo');document.body.classList.add('memo-editor-open');return true;`);
  await H.evalJson(sticker,`document.querySelector('.st-td-open').click();return true;`);await H.sleep(150);
  suite.ok(await run(`return document.querySelector('.page.active').id==='page-todo'&&!document.body.classList.contains('memo-editor-open')&&document.getElementById('todoInput').checkVisibility();`),'real main IPC callback clears an editor overlay when already unlocked');
  await H.drainPageErrs(sticker,suite);await H.drainPageErrs(w,suite);
 }catch(e){suite.errs.push(e.stack);}finally{if(sticker&&!sticker.isDestroyed())sticker.destroy();w.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
