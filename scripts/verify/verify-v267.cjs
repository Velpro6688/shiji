'use strict';
const {app,ipcMain}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v267');H.globalKillSwitch(suite.name,suite);const profile=H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;return true');
  suite.ok(await H.evalJson(win,'var n=document.getElementById("edName");n.focus();return document.activeElement!==n'),'closed editor cannot receive focus');
  await H.evalJson(win,'openAdd();return true');await H.sleep(150);
  suite.ok(await H.evalJson(win,'return document.activeElement.id==="edName"'),'opening editor enables normal input focus');
  await H.evalJson(win,'closeSheet(true);return true');await H.sleep(100);
  suite.ok(await H.evalJson(win,'var n=document.getElementById("edName");n.focus();return document.activeElement!==n'),'closing editor removes its controls from keyboard navigation');
  await H.evalJson(win,'document.getElementById("rewardMask").hidden=false;showConfirm("确认操作","测试叠加确认",null);return true');await H.sleep(150);
  suite.ok(await H.evalJson(win,'var b=document.getElementById("confirmOk");b.focus();b.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));return document.activeElement.id==="confirmCancel"'),'Tab stays in confirmation above reward');
  suite.ok(await H.evalJson(win,'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));return !document.getElementById("confirmMask").classList.contains("show")&&!document.getElementById("rewardMask").hidden'),'Escape dismisses one layer and preserves reward underneath');
  await H.evalJson(win,'document.getElementById("rewardMask").hidden=true;openHabitManager();setDayNote();return true');await H.sleep(200);
  suite.ok(await H.evalJson(win,'document.getElementById("dayNoteInput").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));return !document.getElementById("dayNoteMask").classList.contains("show")&&habitManagerOpen()'),'Escape in date note does not also close underlying manager');
  await H.evalJson(win,'document.getElementById("focusOverlay").classList.add("show");return true');
  suite.ok(await H.evalJson(win,'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));return !document.getElementById("focusOverlay").classList.contains("show")&&habitManagerOpen()'),'Escape follows visible focus overlay above habit manager');
  await H.evalJson(win,'closeHabitManager();go("memo");return true');
  for(const size of [[320,480],[520,720]]){
   win.setSize(...size);await H.sleep(200);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();showConfirm("需要确认的操作","较长的操作说明与恢复提示。".repeat(70),null,true);return true');await H.sleep(250);
    suite.ok(await H.evalJson(win,'var p=document.querySelector("#confirmMask .confirm-box"),r=p.getBoundingClientRect(),b=document.getElementById("confirmCancel").getBoundingClientRect(),m=document.getElementById("confirmMsg");m.scrollTop=m.scrollHeight;return r.top>=12&&r.bottom<=innerHeight-12&&b.bottom<=r.bottom&&m.scrollTop>0'),size[0]+'/'+theme+' long confirmation scrolls while actions stay inside window');
    suite.ok(await H.evalJson(win,'return getComputedStyle(document.getElementById("page-memo")).scrollbarWidth==="none"'),size[0]+'/'+theme+' confirmation hides background scrollbar');
    suite.ok(await H.evalJson(win,'var c=getComputedStyle(document.getElementById("confirmOk"));function lum(s){return s.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}var a=lum(c.color),b=lum(c.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5;'),size[0]+'/'+theme+' danger action has readable foreground contrast');
    if(size[0]===320){await H.evalJson(win,'document.getElementById("confirmMsg").scrollTop=0;return true');await H.sleep(100);fs.writeFileSync(path.join(out,'confirm-'+theme+'.png'),await H.capturePng(win));}
    await H.evalJson(win,'hideConfirm();return true');
   }
  }
  suite.ok(await H.evalJson(win,'return getComputedStyle(document.getElementById("page-memo")).scrollbarWidth!=="none"'),'background scrollbar returns after modal closes');
  for(const theme of ['light','dark']){
   await win.webContents.executeJavaScript('(async()=>{data.settings.theme='+JSON.stringify(theme)+';await save();})()');
   await H.loadPage(win);await H.bootWait(win);await H.sleep(500);
   await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();go("stat");return true');await H.sleep(250);
   const ratio=await H.evalJson(win,'var n=document.querySelector(".insight-habit-rate"),p=n.closest(".insight-card");function lum(s){var a=s.match(/[\\d.]+/g).slice(0,3).map(v=>{v=Number(v)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722;}var a=lum(getComputedStyle(n).color),b=lum(getComputedStyle(p).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);');
   suite.metric(theme+' text',await H.evalJson(win,'return [".insight-habit-heading strong",".insight-list-heading strong",".header-streak"].map(sel=>{var n=document.querySelector(sel),c=getComputedStyle(n);return {sel,color:c.color,text:c.getPropertyValue("--ui-text"),brand:c.getPropertyValue("--text-brand")};})'));
   suite.ok(ratio>=4.5,theme+' progress text contrast reaches 4.5:1 ('+ratio.toFixed(2)+')');
   suite.ok(await H.evalJson(win,'return parseFloat(getComputedStyle(document.querySelector(".insight-period time")).fontSize)>=12'),theme+' report period remains readable at 12px');
   fs.writeFileSync(path.join(out,'report-'+theme+'.png'),await H.capturePng(win));
  }
  await win.webContents.executeJavaScript('(async()=>{data.memoNotes=["a","b","c"].map((id,i)=>({id,title:id,text:"正文 "+id,html:"<p>正文 "+id+"</p>",ord:i}));await saveMemoFields();go("memo");renderMemoList();window.orderToasts=[];window.originalToast=toast;toast=function(text,type){orderToasts.push(text);originalToast(text,type);};})()');
  let release,mode='hold';
  ipcMain.removeHandler('hb-data:note-order-commit');
  ipcMain.handle('hb-data:note-order-commit',async(e,token,list)=>{
   if(mode==='hold')await new Promise(resolve=>{release=resolve;});
   if(mode==='fail')return {ok:false,message:'模拟磁盘写入失败'};
   H.storeInternal().applyNoteOrder(token,list);return H.storeInternal().drainWrites();
  });
  await H.evalJson(win,'reorderNotes("a","b",true);return true');await H.sleep(100);
  suite.ok(await H.evalJson(win,'return document.getElementById("appSaveStatus").dataset.state==="saving"&&!orderToasts.some(t=>t.includes("顺序已保存"))'),'reorder waits for disk acknowledgement before success feedback');
  mode='ok';release();await H.sleep(200);
  suite.ok(await H.evalJson(win,'return !memoOrderNeedsSave&&orderToasts.some(t=>t.includes("顺序已保存"))'),'successful acknowledgement clears pending order and reports success');
  mode='fail';await H.evalJson(win,'orderToasts=[];reorderNotes("a","b",false);return true');await H.sleep(150);
  win.webContents.send('hb-data-save-state',{state:'saved'});await H.sleep(100);
  suite.ok(await H.evalJson(win,'return memoOrderNeedsSave&&document.getElementById("appSaveStatus").dataset.state==="error"&&!orderToasts.some(t=>t.includes("顺序已保存"))'),'failed reorder remains retryable and unrelated saved broadcast cannot mask failure');
  mode='ok';await win.webContents.executeJavaScript('flushRendererChanges()');
  const disk=JSON.parse(fs.readFileSync(path.join(profile,'data.json'),'utf8'));
  suite.ok(disk.memoNotes.slice().sort((a,b)=>a.ord-b.ord).map(n=>n.id).join(',')==='a,b,c'&&disk.memoNotes.every(n=>n.text==='正文 '+n.id),'retry persists ordering without changing note content');
  await H.evalJson(win,'var el=document.getElementById("memoInput");el.innerHTML="<p>after</p>";memoHistory=["<p>before</p>","<p>after</p>"];memoHistoryPos=1;openAdd();return true');await H.sleep(150);
  suite.ok(await H.evalJson(win,'var e=new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true,cancelable:true});document.getElementById("edName").dispatchEvent(e);return memoHistoryPos===1&&!e.defaultPrevented'),'Ctrl+Z in habit input does not undo memo content');
  await H.evalJson(win,'closeSheet(true);return true');
  suite.ok(await H.evalJson(win,'document.getElementById("memoInput").dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true,cancelable:true}));return memoHistoryPos===0'),'Ctrl+Z inside note body still restores note history');
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
