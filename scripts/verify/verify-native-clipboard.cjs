'use strict';
const {app,clipboard,ClipboardItem,screen,nativeImage}=require('electron'),H=require('./_harness');
const {spawnSync}=require('child_process');
const suite=H.makeSuite('verify-native-clipboard');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
const run=body=>H.evalJson(win,body);
let win=null;
async function clipSnapshot(){
  const items=await clipboard.read();
  return Promise.all(items.map(async item=>({
    types:item.types,
    values:await Promise.all(item.types.map(async type=>{
      const value=await item.getType(type);
      if(type==='electron application/bookmark')return value;
      return {type,base64:Buffer.from(await value.arrayBuffer()).toString('base64')};
    }))
  })));
}
async function clipRestore(saved){
  try{
    clipboard.clear();
    const rebuilt=saved.map(item=>new ClipboardItem(Object.fromEntries(item.types.map((type,index)=>{
      const value=item.values[index];
      return [type,type==='electron application/bookmark'?value:new Blob([Buffer.from(value.base64,'base64')],{type})];
    }))));
    if(rebuilt.length)await clipboard.write(rebuilt);
  }catch(_){}
}
// Windows may re-encode PNG data and reorder formats on a clipboard round trip.
function comparableClipboard(items){
  return items.map(item=>item.types.map((type,index)=>{
    const value=item.values[index];
    if(type.startsWith('image/')&&value.base64){
      const image=nativeImage.createFromBuffer(Buffer.from(value.base64,'base64'));
      if(!image.isEmpty())return [type,image.getSize(),image.toBitmap().toString('base64')];
    }
    return [type,value];
  }).sort((a,b)=>a[0].localeCompare(b[0]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function pasteAndWait(){win.webContents.paste();return H.sleep(450);}
app.whenReady().then(async()=>{
 const original=await clipSnapshot();
 win=H.makeWin(suite,{offscreen:false,width:520,height:720,frame:false,show:false});
 try{
  await H.loadPage(win,{view:'editor',note:'clipboard-a'});await H.bootWait(win);await H.sleep(1200);
  await run(`var g=document.getElementById('guideSkip');if(g)g.click();hideConfirm();data.settings.sound=false;
    data.memoNotes=[{id:'clipboard-a',title:'系统剪贴板验证',html:'<p>起点</p>',text:'起点'}];curNoteId='clipboard-a';renderNoteToEditor(curNote(),true);return true;`);
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvdQ6QAAAABJRU5ErkJggg==';
  clipboard.clear();
  await clipboard.write([new ClipboardItem({text:new Blob(['前文 中间 后文'],{type:'text/plain'}),'text/html':new Blob(['<article><p>前文<img src="'+image+'">中间<img src="'+image+'">后文</p></article>'],{type:'text/html'})})]);
  await run(`placeCaretAtEnd(document.getElementById('memoInput'));return true`);
  await pasteAndWait();
  let state=await run(`var e=document.getElementById('memoInput'),copy=e.cloneNode(true);copy.querySelectorAll('.memo-image-wrap').forEach(function(n){n.replaceWith('[图]')});return {text:copy.textContent.trim(),images:e.querySelectorAll('img').length};`);
  suite.ok(state.text.includes('前文[图]中间[图]后文')&&state.images===2,'native HTML clipboard preserves two images and their text positions '+JSON.stringify(state));
  await run(`var e=document.getElementById('memoInput');e.innerHTML='<p>图片粘贴</p>';memoResetHistory(e,curNoteId);placeCaretAtEnd(e);return true`);
  await run(`window.__nativePasteProbe=[];document.getElementById('memoInput').addEventListener('paste',function(ev){window.__nativePasteProbe.push({types:Array.from(ev.clipboardData.types||[]),items:Array.from(ev.clipboardData.items||[]).map(function(it){var f=it.getAsFile&&it.getAsFile();return {kind:it.kind,type:it.type,size:f&&f.size};})});},true);return true`);
  clipboard.clear();
  const setImage=spawnSync('powershell.exe',['-Sta','-NoProfile','-Command',"Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;$b=New-Object Drawing.Bitmap 120,48;$g=[Drawing.Graphics]::FromImage($b);$g.Clear([Drawing.Color]::LightBlue);$g.DrawString('Native image paste',(New-Object Drawing.Font 'Segoe UI',11),[Drawing.Brushes]::DarkBlue,8,14);[Windows.Forms.Clipboard]::SetImage($b);$g.Dispose();$b.Dispose()"],{windowsHide:true,encoding:'utf8'});
  suite.ok(setImage.status===0,'Windows native image clipboard was populated '+(setImage.stderr||''));
  await H.sleep(150);
  await pasteAndWait();
  state=await run(`return {text:document.getElementById('memoInput').innerText,images:document.querySelectorAll('#memoInput img').length,probe:window.__nativePasteProbe};`);
  suite.ok(state.images===1&&state.text.includes('图片粘贴'),'native image clipboard inserts an image at the caret '+JSON.stringify(state));
  await run(`var e=document.getElementById('memoInput');e.innerHTML='<p>文本粘贴</p>';memoResetHistory(e,curNoteId);placeCaretAtEnd(e);return true`);
  clipboard.clear();
  await clipboard.writeText('第一行\n第二行');
  await pasteAndWait();
  state=await run(`return document.getElementById('memoInput').innerText;`);
  suite.ok(state.includes('第一行')&&state.includes('第二行'),'native multiline text clipboard preserves both lines '+JSON.stringify(state));
  await run(`var e=document.getElementById('memoInput'),w=createMemoImageWrap('${image}',180);e.appendChild(w);prepareMemoCanvas(e);var img=w.querySelector('img'),r=img.getBoundingClientRect();img.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:73,clientX:r.left+2,clientY:r.top+2}));return true;`);
  await H.sleep(150);win.webContents.copy();await H.sleep(300);
  const copied=await clipboard.read(),copiedText=await clipboard.readText(),copiedHtml=copied.find(item=>item.types.includes('text/html'));
  const copiedHtmlText=copiedHtml?await (await copiedHtml.getType('text/html')).text():'';
  state={text:copiedText,html:copiedHtmlText,types:copied.map(item=>item.types)};
  suite.ok(state.text==='[便签图片]'&&/img/i.test(state.html),'copying a selected note image writes native text and image HTML '+JSON.stringify({text:state.text,html:state.html.slice(0,80),types:state.types}));
  const displays=screen.getAllDisplays().map(d=>({id:String(d.id),bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor,rotation:d.rotation}));
  const primary=String(screen.getPrimaryDisplay().id);
  suite.metric('displays',displays);
  suite.ok(displays.length>=1&&displays.every(d=>d.bounds.width>0&&d.bounds.height>0&&d.workArea.width>0&&d.workArea.height>0&&d.scaleFactor>0),'live display geometry and scale are valid '+JSON.stringify(displays));
  suite.ok(displays.some(d=>d.id===primary),'live primary display is present in the display inventory');
  if(displays.length<2)suite.metric('displayCoverage','single-display host: physical multi-monitor switching not available');
  else{
   for(const d of displays){
    win.setBounds({x:d.workArea.x+20,y:d.workArea.y+20,width:Math.min(520,d.workArea.width-40),height:Math.min(600,d.workArea.height-40)});
    await H.sleep(120);const b=win.getBounds();
    suite.ok(b.x>=d.workArea.x&&b.y>=d.workArea.y&&b.x+b.width<=d.workArea.x+d.workArea.width&&b.y+b.height<=d.workArea.y+d.workArea.height,'window stays inside live display '+d.id+' '+JSON.stringify({b,workArea:d.workArea}));
   }
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{
  await clipRestore(original);
  await H.sleep(100);
  const restored=await clipSnapshot();
  suite.ok(JSON.stringify(comparableClipboard(restored))===JSON.stringify(comparableClipboard(original)),'original clipboard formats, text bytes and image pixels are restored after the test');
  try{win.destroy();}catch(_){}
  H.finish(suite);app.exit(suite.errs.length?1:0);
 }
});
