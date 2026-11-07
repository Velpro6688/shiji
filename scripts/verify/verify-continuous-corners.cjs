'use strict';
const {app,nativeImage}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-continuous-corners');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const w=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false,transparent:true,backgroundColor:'#00000000'}),run=s=>H.evalJson(w,s),out=path.join(H.ROOT,'artifacts/ui-continuous-corners');fs.mkdirSync(out,{recursive:true});
 async function capture(name){await H.sleep(180);const png=await H.capturePng(w);fs.writeFileSync(path.join(out,name+'.png'),png);const img=nativeImage.createFromBuffer(png),b=img.toBitmap(),z=img.getSize();return (x,y)=>b[(y*z.width+x)*4+3];}
 try{
  await H.loadPage(w);await H.bootWait(w);await H.sleep(800);await run(`document.getElementById('guideSkip')?.click();hideConfirm();return true;`);
  suite.ok(await run(`return CSS.supports('corner-shape','squircle');`),'shipped Electron supports native continuous corners');
  for(const width of [320,520,1200]){await H.resizeWindow(w,width,720);for(const theme of ['light','dark']){
   await run(`data.settings.theme=${JSON.stringify(theme)};applyTheme();go('today');return true;`);
   for(const state of ['main','confirm','sheet','habits']){
    await run(`hideConfirm();closeSheet(true);closeHabitManager();return true;`);
    if(state==='confirm')await run(`showConfirm('圆角检查','检查透明边缘',()=>{});return true;`);
    if(state==='sheet')suite.ok(await run(`openEdit(Object.keys(HMAP)[0]);return !!document.querySelector('.sheet.show');`),'habit editor opens');
    if(state==='habits')await run(`openHabitManager();return true;`);
    const alpha=await capture(width+'-'+theme+'-'+state);
    suite.ok([[1,1],[width-2,1],[1,718],[width-2,718]].every(([x,y])=>alpha(x,y)===0),width+'/'+theme+'/'+state+' corners transparent');
    suite.ok(alpha(10,20)>200&&alpha(width-11,20)>200&&alpha(10,699)>200&&alpha(width-11,699)>200,width+'/'+theme+'/'+state+' squircle contour survives overlays');
   }
  }}
  await run(`hideConfirm();closeSheet(true);closeHabitManager();go('today');return true;`);
  suite.ok(await run(`return [...document.querySelectorAll('.card,.ring-card,.hcard,.menu-card,.profile,.memo-note,.td-item')].every(e=>getComputedStyle(e).cornerTopLeftShape==='superellipse(2)');`),'cards use continuous curvature');
  suite.ok(await run(`return ['round','superellipse(1)'].includes(getComputedStyle(document.querySelector('.header-avatar')).cornerTopLeftShape);`),'circular avatar retains its original shape');
  await H.resizeWindow(w,520,720);await capture('preview-today');
  await run(`go('mine');return true;`);await capture('preview-settings');
  await run(`data.memoNotes=[{id:'corner-note',title:'连续曲率便签',html:'<p>左右滑动翻页</p>',text:'左右滑动翻页'}];curNoteId='corner-note';renderNoteToEditor(curNote(),true);return true;`);
  await w.webContents.executeJavaScript('(async()=>{await saveMemoFields();await pinTodayToDesktop();})()');
  const stickyAlpha=await capture('preview-sticky');suite.ok(stickyAlpha(1,1)===0&&stickyAlpha(10,20)>200,'desktop sticker uses the same continuous window contour');
  await H.drainPageErrs(w,suite);
 }catch(e){suite.errs.push(e.stack);}finally{w.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
