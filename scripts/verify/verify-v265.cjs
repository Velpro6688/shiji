'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v265');H.globalKillSwitch(suite.name,suite);const profile=H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;return true');
  const before=suite.calls.filter(c=>c[0]==='hb-nudge').length;
  for(const width of [320,520,780,1200,520]){
   win.setSize(width,720);await H.sleep(250);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();go("today");document.getElementById("scroll").scrollTop=0;hbLayoutSync();return true');await H.sleep(350);
    const gap=await H.evalJson(win,'return document.querySelector("#page-today .ring-card").getBoundingClientRect().top-document.querySelector(".date-nav").getBoundingClientRect().bottom');
    suite.ok(gap>=10&&gap<=20,width+'/'+theme+' date navigation and progress card have separate edges');
   }
  }
  await H.sleep(1400);suite.ok(suite.calls.filter(c=>c[0]==='hb-nudge').length===before,'programmatic resize does not request geometry nudges');
  fs.writeFileSync(path.join(out,'today-spacing.png'),await H.capturePng(win));
  await win.webContents.executeJavaScript('(async()=>{data.memoNotes=["a","b","c"].map((id,i)=>({id,title:"便签 "+id,html:"<p>正文 "+id+"</p>",text:"正文 "+id,ord:i}));await saveMemoFields();go("memo");renderMemoList();window.testDrag=(source,target,after,gap)=>{var box=document.getElementById("memoList"),s=box.querySelector("[data-nid="+source+"]"),t=box.querySelector("[data-nid="+target+"]"),r=t.getBoundingClientRect(),x=r.left+r.width*(after?.8:.2),y=r.top+r.height*(after?.8:.2),dt=new DataTransfer();s.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));var node=gap?box:t.querySelector(".mn-title");node.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));node.dispatchEvent(new DragEvent("dragleave",{bubbles:true,relatedTarget:t}));node.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));return notesSorted().map(n=>n.id).join(",");};})()');await H.sleep(350);
  let v=await H.evalJson(win,'return testDrag("a","b",true,false)');suite.ok(v==='b,a,c','grid dragging uses horizontal insertion and survives child dragleave');
  await H.sleep(200);await H.storeInternal().drainWrites();suite.ok(JSON.parse(fs.readFileSync(path.join(profile,'data.json'),'utf8')).memoNotes.slice().sort((a,b)=>a.ord-b.ord).map(n=>n.id).join(',')==='b,a,c','dragged order is persisted to disk');
  v=await H.evalJson(win,'return testDrag("c","b",false,true)');suite.ok(v==='c,b,a','drop on list whitespace resolves a nearby insertion target');
  v=await H.evalJson(win,'var box=document.getElementById("memoList"),original=box.querySelector("[data-nid=a]"),dt=new DataTransfer();original.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));renderMemoList();var retained=original===box.querySelector("[data-nid=a]");original.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:dt}));return retained&&!memoListRefreshPending&&currentNoteDragId===null');suite.ok(v,'synchronization redraw waits until a drag ends without replacing its source node');
  v=await H.evalJson(win,'noteById("c").pin=true;persistNoteOrder();renderMemoList();return testDrag("a","c",false,false)');suite.ok(v==='c,b,a','cross-group drop preserves pinned priority');
  const dragBefore=suite.calls.filter(c=>c[0]==='hb-window-drag-start').length;
  v=await H.evalJson(win,'var card=document.querySelector(".memo-note"),e=new PointerEvent("pointerdown",{bubbles:true,cancelable:true,button:0,pointerId:81});card.dispatchEvent(e);return !e.defaultPrevented');
  suite.ok(v&&suite.calls.filter(c=>c[0]==='hb-window-drag-start').length===dragBefore,'pressing a note does not start dragging the application window');
  win.setSize(320,720);await H.sleep(300);
  v=await H.evalJson(win,'document.getElementById("page-memo").classList.add("memo-list-view");renderMemoList();return testDrag("b","a",true,false)');suite.ok(v==='c,a,b','single-column list insertion follows vertical position after resizing');
  fs.writeFileSync(path.join(out,'note-reorder.png'),await H.capturePng(win));
  win.setSize(520,720);await H.sleep(200);
  await H.evalJson(win,'document.getElementById("page-memo").classList.remove("memo-list-view");getNotes().forEach(n=>{delete n.pin;n.ord=["a","b","c"].indexOf(n.id);});renderMemoList();window.resizeDrag=new DataTransfer();document.querySelector("[data-nid=a]").dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:resizeDrag}));return true');
  win.setSize(320,720);await H.sleep(300);
  v=await H.evalJson(win,'var card=document.querySelector("[data-nid=b]"),r=card.getBoundingClientRect();card.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:resizeDrag,clientX:r.left+10,clientY:r.bottom-10}));return notesSorted().map(n=>n.id).join(",")');suite.ok(v==='b,a,c','resizing from grid to list during a drag recalculates the drop axis');
  const moves=suite.calls.filter(c=>c[0]==='hb-window-resize-move').length;
  await H.evalJson(win,'go("today");document.body.classList.add("app-locked");window._lockFitManual=false;var corner=document.querySelector(".lock-corner"),r=corner.getBoundingClientRect();corner.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,button:0,pointerId:90,clientX:r.x,clientY:r.y}));window.dispatchEvent(new PointerEvent("pointermove",{pointerId:90,clientX:r.x+2,clientY:r.y+2,movementX:2,movementY:2}));window.dispatchEvent(new PointerEvent("pointerup",{pointerId:90}));return true');await H.sleep(100);
  suite.ok(suite.calls.filter(c=>c[0]==='hb-window-resize-move').length===moves,'tiny movement below the resize threshold does not move the window');
  await H.evalJson(win,'var corner=document.querySelector(".lock-corner"),r=corner.getBoundingClientRect();corner.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,button:0,pointerId:91,clientX:r.x,clientY:r.y}));window.dispatchEvent(new PointerEvent("pointermove",{pointerId:91,clientX:r.x+20,clientY:r.y+20,movementX:20,movementY:20}));window.dispatchEvent(new PointerEvent("pointerup",{pointerId:91}));return true');
  v=await H.evalJson(win,'return window._lockFitManual&&!window.__hbResizeActive');suite.ok(v,'manual sticky resize disables automatic fitting and ends the gesture cleanly');
  suite.ok(suite.calls.some(c=>c[0]==='hb-window-resize-move'),'pointer release flushes the final resize delta');
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
