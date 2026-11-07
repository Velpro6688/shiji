'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v301');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts','ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 const run=body=>H.evalJson(win,body);
 const reset=html=>run(`var e=document.getElementById('memoInput');e.innerHTML=${JSON.stringify(html)};memoResetHistory(e,curNoteId);e.focus();placeCaretAtEnd(e);return true;`);
 try{
  await H.loadPage(win,{view:'editor',note:'v301-a'});await H.bootWait(win);await H.sleep(1200);
  await run(`var g=document.getElementById('guideSkip');if(g)g.click();hideConfirm();data.settings.sound=false;
    data.memoNotes=[{id:'v301-a',title:'图文便签',html:'<p>开始</p>'},{id:'v301-b',title:'另一张',html:'<p>另一张正文</p>'}];
    curNoteId='v301-a';renderNoteToEditor(curNote(),true);return true;`);
  await reset('<p>起点</p>');
  await win.webContents.insertText('A');await win.webContents.insertText('B');
  let v=await run(`var e=document.getElementById('memoInput'),before=e.innerText;memoUndo();var undo=e.innerText;memoRedo();return {before,undo,redo:e.innerText};`);
  suite.ok(v.before==='起点AB'&&v.undo==='起点'&&v.redo==='起点AB','native rapid typing survives immediate undo/redo '+JSON.stringify(v));
  await run(`memoUndo();return true;`);await win.webContents.insertText('新');
  await H.sleep(260);
  suite.ok(await run(`return !memoRedo()&&document.getElementById('memoInput').innerText==='起点新';`),'typing after undo discards obsolete redo branch');
  await reset('<p>起点</p>');
  v=await run(`var e=document.getElementById('memoInput');e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    e.innerHTML='<p>起点中</p>';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
    var undoDuring=memoUndo();e.innerHTML='<p>起点中文</p>';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}));
    memoUndo();var undo=e.innerText;memoRedo();return {undoDuring,undo,redo:e.innerText};`);
  suite.ok(!v.undoDuring&&v.undo==='起点'&&v.redo==='起点中文','composition is preserved as one complete edit '+JSON.stringify(v));
  for(const [cmd,value] of [['bold',''],['italic',''],['underline',''],['strikeThrough',''],['size','4'],['size','2'],['color','#E5484D'],['hilite','#FFF59D'],['align','center'],['ul',''],['ol','']]){
   await reset('<p>格式测试</p>');
   v=await run(`var e=document.getElementById('memoInput'),r=document.createRange();r.selectNodeContents(e.firstElementChild);getSelection().removeAllRanges();getSelection().addRange(r);
     var selector='[data-cmd="${cmd}"]${value?'[data-v="'+value+'"]':''}';document.querySelector(selector).click();
     function state(){var node=e.querySelector('li')||e.firstElementChild;while(node&&node.firstElementChild&&!node.firstElementChild.classList.contains('memo-image-wrap'))node=node.firstElementChild;
       var c=getComputedStyle(node);return {text:e.innerText.trim(),weight:c.fontWeight,style:c.fontStyle,size:c.fontSize,color:c.color,background:c.backgroundColor,decoration:c.textDecorationLine,align:c.textAlign,ul:!!e.querySelector('ul'),ol:!!e.querySelector('ol')};}
     var before=state();commitMemoHtml();renderNoteToEditor(curNote(),true);return {before,after:state(),html:curNote().html};`);
   suite.ok(JSON.stringify(v.before)===JSON.stringify(v.after),cmd+' '+value+' survives save/reopen '+JSON.stringify(v));
  }
  await reset('裸文本');
  suite.ok(await run(`prepareMemoCanvas(document.getElementById('memoInput'));return document.getElementById('memoInput').innerText==='裸文本';`),'normalization never removes unwrapped plain text');
  await run(`var canvas=document.createElement('canvas');canvas.width=360;canvas.height=120;var ctx=canvas.getContext('2d');ctx.fillStyle='#EAF4FF';ctx.fillRect(0,0,360,120);ctx.fillStyle='#0057B8';ctx.font='24px sans-serif';ctx.fillText('图文顺序与保存测试',50,68);window.testImage=canvas.toDataURL();return true;`);
  for(const kind of ['embedded','external']){
   await reset('<p>替换这里</p>');
   v=await run(`var e=document.getElementById('memoInput'),r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);
     var dt=new DataTransfer(),src=${kind==='embedded'?'testImage':"'https://example.invalid/image.png'"};
     dt.setData('text/html','<article><p>前文<img src="'+src+'">中间<img src="'+src+'">后文</p></article>');
     e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));
     function order(){var copy=e.cloneNode(true);copy.querySelectorAll('.memo-image-wrap').forEach(n=>n.replaceWith('[图]'));return copy.textContent.trim();}
     var before=order();commitMemoHtml();renderNoteToEditor(curNote(),true);return {before,after:order(),images:e.querySelectorAll('img').length};`);
   suite.ok(v.before==='前文[图]中间[图]后文'&&v.after===v.before&&v.images===2,kind+' paste retains all text and images in place '+JSON.stringify(v));
  }
  await reset('<p>原文</p>');
  await run(`var e=document.getElementById('memoInput'),dt=new DataTransfer();dt.setData('text/html','<p>粘贴<img src="'+testImage+'">末尾</p>');e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));memoUndo();return true;`);
  suite.ok(await run(`return document.getElementById('memoInput').innerText==='原文';`),'paste can be undone as one operation');
  suite.ok(await run(`memoRedo();var e=document.getElementById('memoInput');return e.querySelectorAll('img').length===1&&e.textContent.includes('粘贴')&&e.textContent.includes('末尾');`),'paste redo restores text and image');
  for(const eventName of ['pointercancel','lostpointercapture','blur','pointerup']){
   await reset('<p>图片缩放</p>');
   v=await run(`var e=document.getElementById('memoInput'),w=createMemoImageWrap(testImage,180);e.appendChild(w);prepareMemoCanvas(e);memoRecordHistory(e);
     var grip=w.querySelector('.memo-image-grip'),r=grip.getBoundingClientRect();
     grip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:81,clientX:r.x,clientY:r.y}));
     grip.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:81,clientX:r.x+60,clientY:r.y}));
     ${eventName==='blur'?"window.dispatchEvent(new Event('blur'));":`grip.dispatchEvent(new PointerEvent('${eventName}',{bubbles:true,pointerId:81}));`}
     var width=w.style.width;grip.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:81,clientX:r.x+100,clientY:r.y}));
     return {width,after:w.style.width,stored:curNote().html};`);
   const expected=eventName==='pointerup'?'240px':'180px';
   suite.ok(v.width===expected&&v.after===expected&&v.stored.includes(expected),eventName+' finishes image resizing predictably '+JSON.stringify(v));
  }
  await run(`curNoteId='v301-b';renderNoteToEditor(curNote(),true);return true;`);await H.sleep(260);
  suite.ok(await run(`return !memoUndo()&&document.getElementById('memoInput').innerText==='另一张正文';`),'pending history cannot cross note boundaries');
  await run(`curNoteId='v301-a';renderNoteToEditor(curNote(),true);return true;`);
  await reset('<p>今日记录</p><p>把想法写下来，图片和文字按顺序排列。</p>');
  await run(`var e=document.getElementById('memoInput');e.appendChild(createMemoImageWrap(testImage,320));e.insertAdjacentHTML('beforeend','<p>下一步：完成今天的小目标。</p>');prepareMemoCanvas(e);saveMemoHtml();return true;`);
  for(const width of [320,520,900]){
   await H.resizeWindow(win,width,width===320?480:720);
   for(const theme of ['light','dark']){
    await run(`data.settings.theme='${theme}';applyTheme();document.querySelector('.memo-more').open=true;return true;`);await H.sleep(230);
    v=await run(`var p=document.querySelector('.memo-more-tools'),r=p.getBoundingClientRect(),tools=document.getElementById('memoTools');
      return {inside:r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,overflow:p.scrollWidth<=p.clientWidth+1,
        groups:p.querySelectorAll('[role=group]').length,colors:[...p.querySelectorAll('[data-cmd=color]')].map(b=>getComputedStyle(b,'::after').backgroundColor),
        highlighters:[...p.querySelectorAll('[data-cmd=hilite]')].map(b=>getComputedStyle(b,'::after').backgroundColor),
        visible:[...p.querySelectorAll('button')].every(b=>b.getBoundingClientRect().width>=24&&getComputedStyle(b).visibility==='visible'),
        toolbar:tools.scrollWidth<=tools.clientWidth+1};`);
    suite.ok(v.inside&&v.overflow&&v.toolbar&&v.visible&&v.groups===4&&new Set(v.colors).size===4&&new Set(v.highlighters).size===3,width+'/'+theme+' grouped toolbar has visible distinct swatches without clipping '+JSON.stringify(v));
    if(width!==900)fs.writeFileSync(path.join(out,'editor-tools-'+width+'-'+theme+'.png'),await H.capturePng(win));
   }
  }
  await run(`document.querySelector('.memo-more').open=false;data.settings.theme='light';applyTheme();return true;`);
  await win.webContents.executeJavaScript('flushRendererChanges()');
  const expected=await run(`return {text:curNote().text,count:document.querySelectorAll('#memoInput img').length};`);
  await H.loadPage(win,{view:'editor',note:'v301-a'});await H.bootWait(win);await H.sleep(600);
  v=await run(`return {text:curNote().text,count:document.querySelectorAll('#memoInput img').length};`);
  suite.ok(v.text===expected.text&&v.count===expected.count,'persisted rich note survives a full page reload '+JSON.stringify(v));
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
