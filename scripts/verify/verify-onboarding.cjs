'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const s=H.makeSuite('verify-onboarding');H.globalKillSwitch(s.name,s);H.initProfile(s.name);H.stubIpc(s.calls);
app.whenReady().then(async()=>{const w=H.makeWin(s,{offscreen:true,width:320,height:720}),run=q=>H.evalJson(w,q);try{
 await H.loadPage(w);await H.bootWait(w);await H.sleep(900);await run(`document.getElementById('guideSkip')?.click();hideConfirm();return true;`);
 for(const width of [320,520])for(const theme of ['light','dark']){
  await H.resizeWindow(w,width,720);await run(`data.settings.theme='${theme}';applyTheme();go('mine');document.getElementById('guideReplay').click();return true;`);
  for(const page of ['today','todo','memo','stat','mine']){
   s.ok(await run(`var r=document.querySelector('.guide-card').getBoundingClientRect();return document.querySelector('.page.active').id==='page-${page}'&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;`),width+'/'+theme+'/'+page+' tour follows actual page inside window');
   if(page!=='mine')await run(`document.getElementById('guideNext').click();return true;`);
  }
  await H.sleep(180);const out=path.join(H.ROOT,'artifacts/onboarding');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,width+'-'+theme+'.png'),await H.capturePng(w));
  await run(`document.getElementById('guidePrev').click();return true;`);s.ok(await run(`return document.querySelector('.page.active').id==='page-stat';`),'back returns to previous real page');
  await run(`document.getElementById('guideNext').click();document.getElementById('guideNext').click();return true;`);
  s.ok(await run(`return !document.getElementById('guideMask')&&!!document.querySelector('#editorSheet.show')&&data.meta.guideDone;`),'completion opens actual habit creation form');await run(`closeSheet(true);return true;`);
 }
 await run(`go('mine');document.getElementById('guideReplay').click();return true;`);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await H.sleep(80);
 s.ok(await run(`return !document.getElementById('guideMask')&&document.activeElement.id==='guideReplay';`),'Escape skips and restores replay focus');
 await H.drainPageErrs(w,s);
}catch(e){s.errs.push(e.stack);}finally{w.destroy();H.finish(s);app.exit(s.errs.length?1:0);}});
