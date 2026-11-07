'use strict';
const {app}=require('electron'),H=require('./_harness');
const suite=H.makeSuite('verify-interaction-edges');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{width:520,height:720,frame:false});
 try{
  await H.loadPage(win);await H.bootWait(win);win.showInactive();await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;data.memoNotes=["a","b","c","d","e"].map((id,ord)=>({id,ord,title:id,text:id,html:"<p>"+id+"</p>"}));go("memo");document.getElementById("page-memo").classList.remove("memo-list-view");renderMemoList();return true');
  await H.sleep(350);
  await H.evalJson(win,'var c=document.querySelector("[data-nid=a]"),dt=new DataTransfer();c.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));c.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:dt}));return true');await H.sleep(100);
  suite.ok(await H.evalJson(win,'return !currentNoteDragId&&!document.querySelector(".memo-note.dragging")'),'immediately cancelled drag leaves no faded source card');
  suite.ok(await H.evalJson(win,'currentNoteDragId="a";var box=document.getElementById("memoList"),c=box.querySelector("[data-nid=e]"),r=c.getBoundingClientRect(),hit=memoDropTarget(box,{target:box,clientX:r.left+10,clientY:r.bottom+4});currentNoteDragId=null;return hit.card===c&&hit.after;'),'drop below the final grid row inserts after its last card');
  suite.ok(await H.evalJson(win,'currentNoteDragId="e";var box=document.getElementById("memoList"),c=box.querySelector("[data-nid=a]"),r=c.getBoundingClientRect(),hit=memoDropTarget(box,{target:box,clientX:r.right-10,clientY:r.top-4});currentNoteDragId=null;return hit.card===c&&!hit.after;'),'drop above the first grid row inserts before its first card');
  await H.evalJson(win,'var edge=document.querySelector(".resize-edge.edge-r");edge.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:77,clientX:518,clientY:200}));edge.dispatchEvent(new PointerEvent("lostpointercapture",{bubbles:true,pointerId:77}));return true');await H.sleep(50);
  suite.ok(await H.evalJson(win,'return !window.__hbResizeActive&&!window.__hbGestureActive'),'lost resize pointer capture ends the gesture');
  const before=suite.calls.filter(c=>c[0]==='hb-window-resize-move').length;
  await H.evalJson(win,'window.dispatchEvent(new PointerEvent("pointermove",{pointerId:77,clientX:548,clientY:200,movementX:30}));return true');await H.sleep(50);
  suite.ok(suite.calls.filter(c=>c[0]==='hb-window-resize-move').length===before,'movement after capture loss cannot keep resizing');
  await H.evalJson(win,'window.dispatchEvent(new PointerEvent("pointerup",{pointerId:77}));return true');
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
