'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-window-stability');H.globalKillSwitch(suite.name,suite);
const profile=H.initProfile(suite.name);process.env.HB_USERDATA=profile;
fs.writeFileSync(path.join(profile,'data.json'),JSON.stringify({meta:{version:2,guideDone:true},habits:[],days:{},memoNotes:[],memo:{},settings:{sound:false,theme:'light'},profile:{name:'Window Test'}}));
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
require('../../main.js');
app.whenReady().then(async()=>{
 let win;
 try{
  for(let i=0;i<80;i++){win=BrowserWindow.getAllWindows()[0];if(win){try{if(await win.webContents.executeJavaScript('typeof data!=="undefined"'))break;}catch(_){}}await H.sleep(100);}
  if(!win)throw Error('Main window did not boot');await H.sleep(2200);
  await win.webContents.executeJavaScript('var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();');
  let events=0;win.on('resize',()=>events++);
  for(const [width,height] of [[360,520],[520,600],[640,560],[360,520]]){
   win.setBounds({x:100,y:40,width,height});await H.sleep(350);
   const settled=win.getBounds(),count=events;await H.sleep(1600);
   suite.ok(JSON.stringify(win.getBounds())===JSON.stringify(settled)&&events===count,width+'x'+height+' real main window settles without follow-up geometry changes');
  }
  /* Start above the app minimum: the transparent Windows shell adds an 8px native
     frame floor, so testing inward shrinks from 360x520 reaches the OS floor before
     the requested delta and would test Chromium's frame, not opposite-edge logic. */
  win.setBounds({x:100,y:40,width:640,height:720});await H.sleep(250);
  /* The main page exposes left/right/bottom edge handles. Top and corner
     directions belong to locked-sticker / editor windows and are covered by
     verify-window-boundaries against the current IPC implementation. */
  for(const dir of ['w','e','s']){
   const before=win.getBounds(),dx=dir.includes('e')||dir.includes('w')?8:0,dy=dir.includes('s')||dir.includes('n')?8:0;
   await win.webContents.executeJavaScript('hbShell.beginWindowResize('+JSON.stringify(dir)+');');await H.sleep(30);
   await win.webContents.executeJavaScript('hbShell.moveWindowResize('+JSON.stringify(dir)+','+dx+','+dy+');');await H.sleep(30);
   await win.webContents.executeJavaScript('hbShell.endWindowResize();');await H.sleep(200);
   const b=win.getBounds(),expected={x:before.x+(dir.includes('w')?dx:0),y:before.y+(dir.includes('n')?dy:0),width:before.width+(dir.includes('w')?-dx:dx),height:before.height+(dir.includes('n')?-dy:dy)};
   suite.ok(JSON.stringify(b)===JSON.stringify(expected),'real '+dir+' resize preserves the opposite edge and requested dimensions actual='+JSON.stringify({before,b,expected}));
  }
  const after=win.getBounds();
  await H.sleep(2000);suite.ok(JSON.stringify(win.getBounds())===JSON.stringify(after),'manual resize stays stable after automatic-fit and nudge timers');
  for(const dir of ['w','n','nw']){
   win.setBounds({x:300,y:150,width:320,height:480});await H.sleep(150);
   const before=win.getBounds();
   await win.webContents.executeJavaScript(`hbShell.beginWindowResize('${dir}');`);await H.sleep(30);
   await win.webContents.executeJavaScript(`hbShell.moveWindowResize('${dir}',${dir.includes('w')?80:0},${dir.includes('n')?80:0});`);await H.sleep(30);
   await win.webContents.executeJavaScript(`hbShell.endWindowResize();`);
   await H.sleep(250);
   suite.ok(JSON.stringify(win.getBounds())===JSON.stringify(before),'real '+dir+' resize at minimum keeps position and opposite edge');
  }
  win.setBounds({x:100,y:40,width:520,height:600});await H.sleep(150);
  await win.webContents.executeJavaScript(`hbShell.beginWindowDrag();hbShell.endWindowDrag();hbShell.beginWindowResize('se');`);await H.sleep(30);
  await win.webContents.executeJavaScript(`hbShell.moveWindowResize('se',80,50);`);await H.sleep(30);
  await win.webContents.executeJavaScript(`hbShell.endWindowResize();`);
  await H.sleep(1300);
  const resized=win.getBounds();
  suite.ok(resized.width===600&&resized.height===650,'real drag followed immediately by resize survives old drag timers');
  suite.metric('bounds',after);
 }catch(e){suite.errs.push(e.stack);}finally{H.finish(suite);app.exit(suite.errs.length?1:0);}
});
