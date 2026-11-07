'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-memo-editor');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false,transparent:true,backgroundColor:'#00000000'});
 const out=path.join(H.ROOT,'artifacts','ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win,{view:'editor',note:'editor-a'});await H.bootWait(win);await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;data.memoNotes=[{id:"editor-a",title:"图文编辑测试",html:"<p>第一段文字</p><p>第二段文字</p>",text:"第一段文字\\n第二段文字",ord:0},{id:"editor-b",title:"另一条便签",html:"<p>另一条内容</p>",text:"另一条内容",ord:1}];curNoteId="editor-a";renderNoteToEditor(curNote(),true);return true');
  for(const width of [320,520,900]){
   await H.resizeWindow(win,width,640);await H.sleep(120);
   const v=await H.evalJson(win,'var top=document.querySelector(".me-top").getBoundingClientRect(),tools=document.getElementById("memoTools"),tr=tools.getBoundingClientRect(),edit=document.getElementById("memoInput").getBoundingClientRect(),first=document.querySelector("#memoInput p").getBoundingClientRect();return {top:top.toJSON(),tools:tr.toJSON(),edit:edit.toJSON(),first:first.toJSON(),topVisible:getComputedStyle(document.querySelector(".me-top")).opacity==="1",toolsVisible:getComputedStyle(tools).opacity==="1",horizontal:tools.scrollWidth<=tools.clientWidth+1,buttons:[...tools.children].filter(n=>getComputedStyle(n).display!=="none").every(n=>{var r=n.getBoundingClientRect();return r.left>=tr.left-1&&r.right<=tr.right+1})}');
   suite.ok(v.topVisible&&v.toolsVisible&&v.horizontal&&v.buttons&&v.first.top>=v.top.bottom&&v.first.top-v.top.bottom<=18&&v.tools.top>=v.edit.top,width+'px editor chrome stays visible without overlap or horizontal overflow '+JSON.stringify(v));
  }
  let v=await H.evalJson(win,'var e=document.getElementById("memoInput"),t=e.firstElementChild.firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,2);var s=getSelection();s.removeAllRanges();s.addRange(r);var before=s.toString(),summary=document.querySelector(".memo-more>summary");summary.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));summary.click();return {before:before,after:getSelection().toString(),open:summary.parentElement.open}');
  suite.ok(v.before==='第一'&&v.after==='第一'&&v.open,'opening More preserves the selected text');
  await H.evalJson(win,'document.querySelector(".memo-more").open=false;getSelection().removeAllRanges();var e=document.getElementById("memoInput"),cv=document.createElement("canvas");cv.width=400;cv.height=220;var cx=cv.getContext("2d");cx.fillStyle="#EAF4FF";cx.fillRect(0,0,400,220);cx.fillStyle="#0A84FF";cx.font="bold 28px sans-serif";cx.fillText("图片交互预览",86,120);var w=createMemoImageWrap(cv.toDataURL("image/png"),320);e.insertBefore(w,e.children[1]);prepareMemoCanvas(e);var img=w.querySelector("img"),r=img.getBoundingClientRect();img.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:41,clientX:r.left+20,clientY:r.top+20}));return true');
  await H.sleep(220);
  v=await H.evalJson(win,'var w=document.querySelector(".memo-image-wrap.is-selected");return {selected:!!w,controls:w?[...w.querySelectorAll(".memo-image-grip,.memo-image-crop,.memo-image-remove")].map(n=>({visibility:getComputedStyle(n).visibility,display:getComputedStyle(n).display,opacity:getComputedStyle(n).opacity,rect:n.getBoundingClientRect().toJSON()})):[]}');
  suite.ok(v.selected&&v.controls.every(n=>n.visibility==='visible'&&n.display!=='none'&&Number(n.opacity)>.9&&n.rect.width>=22),'clicking an image exposes its contextual controls '+JSON.stringify(v));
  fs.writeFileSync(path.join(out,'memo-editor-image-selected.png'),await H.capturePng(win));
  v=await H.evalJson(win,'var e=document.getElementById("memoInput");e.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,cancelable:true,key:"Delete"}));return {selected:!!document.querySelector(".memo-image-wrap.is-selected"),confirm:document.getElementById("confirmMask").classList.contains("show")}');
  suite.ok(v.selected&&v.confirm,'selected image can be deleted with the keyboard even when the caret is outside the image');
  await H.evalJson(win,'document.getElementById("confirmOk").click();return true');await H.sleep(80);
  suite.ok(await H.evalJson(win,'return !document.querySelector("#memoInput .memo-image-wrap")'),'keyboard image deletion removes the image after confirmation');
  v=await H.evalJson(win,'var e=document.getElementById("memoInput"),url=document.createElement("canvas").toDataURL("image/png"),w=createMemoImageWrap(url,180);e.insertBefore(w,e.children[1]);prepareMemoCanvas(e);var before=[...e.children].indexOf(w),img=w.querySelector("img"),r=img.getBoundingClientRect();img.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:42,clientX:r.left+4,clientY:r.top+4}));w.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:42,clientX:r.left+4,clientY:e.getBoundingClientRect().bottom-20}));w.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:42,clientX:r.left+4,clientY:e.getBoundingClientRect().bottom-20}));return {before:before,after:[...e.children].indexOf(w),positioning:w.classList.contains("is-positioning")}');
  suite.ok(v.before===v.after&&!v.positioning,'cancelled image drag keeps its original position and clears drag state');
  v=await H.evalJson(win,'var e=document.getElementById("memoInput");curNoteId="editor-a";renderNoteToEditor(curNote(),true);e.innerHTML="<p>A 已修改</p>";memoRecordHistory(e);curNoteId="editor-b";renderNoteToEditor(curNote(),true);return {undo:memoUndo(),text:e.innerText,pos:memoHistoryPos,size:memoHistory.length}');
  suite.ok(!v.undo&&v.text.includes('另一条内容')&&v.pos===0&&v.size===1,'undo history resets when switching notes');
  await H.resizeWindow(win,360,480);await H.evalJson(win,'document.body.classList.add("sticky-sticker");curNoteId="editor-a";renderNoteToEditor(curNote(),true);return true');await H.sleep(120);
  v=await H.evalJson(win,'var e=document.getElementById("memoInput"),first=e.firstElementChild,es=getComputedStyle(e),gap=first.getBoundingClientRect().top-e.getBoundingClientRect().top;return {paddingTop:parseFloat(es.paddingTop),gap:gap,topHidden:getComputedStyle(document.querySelector(".me-top")).display==="none",toolsHidden:getComputedStyle(document.getElementById("memoTools")).display==="none"}');
  suite.ok(v.paddingTop<=8&&v.gap<=9&&v.topHidden&&v.toolsHidden,'desktop sticker starts content near the top without editor chrome whitespace '+JSON.stringify(v));
  fs.writeFileSync(path.join(out,'memo-editor-adaptive.png'),await H.capturePng(win));
  for(const width of [280,375,520]){
   await H.resizeWindow(win,width,500);
   await H.evalJson(win,'setStickyMode("note");renderStickyNavigation();return true');
   v=await H.evalJson(win,'var mode=document.getElementById("wfMode").getBoundingClientRect(),lock=document.querySelector(".win-fab[data-act=lock]").getBoundingClientRect(),edit=document.getElementById("memoInput").getBoundingClientRect();return {pager:!!document.querySelector("#stickyPrev,#stickyNext,#stickyNotePosition,#stickyNoteNavigation"),edit:edit.toJSON(),mode:mode.toJSON(),lock:lock.toJSON()}');
   suite.ok(!v.pager&&v.mode.right<=v.lock.left&&v.lock.bottom<=v.edit.top,width+'px swipe-only sticker keeps window actions clear of content '+JSON.stringify(v));
   if(width===375)fs.writeFileSync(path.join(out,'memo-sticker-toolbar.png'),await H.capturePng(win));
  }
  const swipe=async(dx,dy)=>{
   const point=await H.evalJson(win,'var r=document.getElementById("memoInput").getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+50),id:curNoteId}');
   win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
   win.webContents.sendInputEvent({type:'mouseMove',x:point.x+dx,y:point.y+dy,button:'left'});
   win.webContents.sendInputEvent({type:'mouseUp',x:point.x+dx,y:point.y+dy,button:'left',clickCount:1});
   await H.sleep(400);
   return {before:point.id,after:await H.evalJson(win,'return curNoteId')};
  };
  v=await swipe(-100,2);suite.ok(v.before!==v.after,'native left swipe turns to the next desktop note');
  v=await swipe(100,2);suite.ok(v.before!==v.after,'native right swipe turns to the previous desktop note');
  v=await swipe(3,70);suite.ok(v.before===v.after,'vertical reading gesture never changes notes');
  suite.ok(await H.evalJson(win,'return !document.getElementById("stickyNotePosition")'),'desktop note page counter is removed');
  await H.loadPage(win);await H.bootWait(win);await H.sleep(500);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();go("today");return true');
  for(const width of [375,520,1100]){
   await H.resizeWindow(win,width,500);
   const before=await H.evalJson(win,'return document.querySelector(".date-nav").getBoundingClientRect().top');
   await H.evalJson(win,'document.getElementById("scroll").scrollTop=300;return true');await H.sleep(80);
   v=await H.evalJson(win,'var n=document.querySelector(".date-nav").getBoundingClientRect(),h=document.querySelector(".topbar").getBoundingClientRect();return {top:n.top,headerBottom:h.bottom,scroll:document.getElementById("scroll").scrollTop}');
   suite.ok(Math.abs(v.top-before)<1&&Math.abs(v.top-v.headerBottom)<2,width+'px date controls stay attached to header while content scrolls '+JSON.stringify(v));
   if(width===520)fs.writeFileSync(path.join(out,'today-fixed-date.png'),await H.capturePng(win));
  }
  await H.resizeWindow(win,520,500);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.memoNotes=[{id:"drop-a",title:"便签一",html:"<p>拖动排序</p>",ord:0},{id:"drop-b",title:"便签二",html:"<p>目标位置</p>",ord:1}];go("memo");renderMemoList();return true');
  for(const theme of ['light','dark']){
   await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();return true');
   await H.sleep(300);
   for(const direction of ['drop-before','drop-after','drop-horizontal drop-before','drop-horizontal drop-after']){
    v=await H.evalJson(win,'var card=document.querySelector(".memo-note");card.classList.remove("drop-before","drop-after","drop-horizontal");card.classList.add(...'+JSON.stringify(direction.split(' '))+');var c=getComputedStyle(card,"::before");return {content:c.content,color:c.backgroundColor,width:parseFloat(c.width),height:parseFloat(c.height),right:c.right,bottom:c.bottom}');
    suite.ok(v.content==='""'&&v.color!=='rgba(0, 0, 0, 0)'&&(direction.includes('horizontal')?v.width===3&&v.height>20:v.height===3&&v.width>20),theme+' '+direction+' has a visible independent insertion marker '+JSON.stringify(v));
   }
   fs.writeFileSync(path.join(out,'memo-drop-'+theme+'.png'),await H.capturePng(win));
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
