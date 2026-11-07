'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v266');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;return true');
  for(const width of [320,520,1200]){
   win.setSize(width,720);await H.sleep(250);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();go("memo");openHabitManager();return true');await H.sleep(400);
    const v=await H.evalJson(win,'var p=document.getElementById("habitManager"),b=p.querySelector(".hm-body"),r=p.getBoundingClientRect(),q=b.getBoundingClientRect(),h=p.querySelector(".sec-title"),top=h.getBoundingClientRect().top;b.scrollTop=b.scrollHeight;return {clipped:getComputedStyle(p).overflowY==="hidden"&&r.top>=0&&r.bottom<=innerHeight+1,inset:q.left>r.left&&q.right<r.right&&q.bottom<r.bottom&&q.top>r.top+20,scroll:b.scrollTop>0,fixed:Math.abs(h.getBoundingClientRect().top-top)<1,background:getComputedStyle(document.getElementById("page-memo")).scrollbarWidth==="none",horizontal:b.scrollWidth<=b.clientWidth+1,close:p.querySelector(".hm-close").getBoundingClientRect().right<r.right}');
    suite.ok(v.clipped&&v.inset,width+'/'+theme+' habit scrollbar is inset within clipped rounded shell');
    suite.ok(v.scroll&&v.fixed&&v.close,width+'/'+theme+' list scrolls while title and close remain available');
    suite.ok(v.background&&v.horizontal,width+'/'+theme+' no background scrollbar or horizontal overflow');
    if(width===520)await H.sleep(150);
    if(width===520)fs.writeFileSync(path.join(out,'habit-scroll-'+theme+'.png'),await H.capturePng(win));
    await H.evalJson(win,'closeHabitManager();return true');
   }
  }
  win.setSize(320,480);await H.sleep(200);
  for(const id of ['editorSheet','profileSheet','timerSheet','timeOffSheet','backupHistorySheet','timerRecoverySheet']){
   await H.evalJson(win,'document.getElementById('+JSON.stringify(id)+').classList.add("show");HabitUI.sheetOpened('+JSON.stringify(id)+');return true');await H.sleep(450);
   const v=await H.evalJson(win,'var p=document.querySelector(".sheet.show"),b=p.querySelector(".sheet-body"),r=p.getBoundingClientRect(),q=b.getBoundingClientRect();return getComputedStyle(p).overflowY==="hidden"&&q.top>r.top&&q.bottom<r.bottom&&q.right<=r.right&&p.scrollWidth<=p.clientWidth+1&&getComputedStyle(document.getElementById("page-memo")).scrollbarWidth==="none"');
   suite.ok(v,id+' keeps scroll region inside header/footer and hides background scrollbar in small window');
   await H.evalJson(win,'closeSheet(true);return true');await H.sleep(400);
  }
  win.setSize(520,720);await H.sleep(200);
  await H.evalJson(win,'data.memoNotes=["a","b","c"].map((id,i)=>({id,title:"便签 "+id,text:"按住卡片拖动排序",html:"<p>按住卡片拖动排序</p>",ord:i}));go("memo");renderMemoList();return true');
  suite.ok(await H.evalJson(win,'return !document.querySelector(".mn-sort")&&Array.from(document.querySelectorAll(".memo-note")).every(n=>n.draggable)'),'drag buttons are removed and every note remains draggable');
  await H.evalJson(win,'var c=document.querySelector("[data-nid=a]");c.focus();c.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,cancelable:true,ctrlKey:true,key:"ArrowDown"}));return true');await H.sleep(180);
  suite.ok(await H.evalJson(win,'return notesSorted().map(n=>n.id).join(",")==="b,a,c"&&document.activeElement.dataset.nid==="a"'),'Ctrl+Down reorders focused card and keeps focus on the moved note');
  fs.writeFileSync(path.join(out,'memo-no-handle.png'),await H.capturePng(win));
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
