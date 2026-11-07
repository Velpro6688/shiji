'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('fs');
const path=require('path');
const root=path.resolve(process.argv[2]);
const allowed=path.resolve(__dirname,'profiles')+path.sep;
if(!root.startsWith(allowed))throw new Error('Quit test must use an isolated verification profile');
const delay=Number(process.argv[3])||0;
process.env.HB_USERDATA=root;
BrowserWindow.prototype.show=function(){};
BrowserWindow.prototype.showInactive=function(){};
require('../../main.js');
const timeout=setTimeout(()=>app.exit(2),25000);
app.whenReady().then(async()=>{
  let win;
  for(let i=0;i<100;i++){
    win=BrowserWindow.getAllWindows()[0];
    if(win){try{if(await win.webContents.executeJavaScript('typeof data!=="undefined"&&!!data.meta'))break;}catch(_){} }
    await new Promise(r=>setTimeout(r,100));
  }
  if(!win)throw new Error('Main window did not boot');
  await new Promise(r=>setTimeout(r,300));
  const today=await win.webContents.executeJavaScript('toggleBool("quit-test",null);todayStr()');
  fs.writeFileSync(path.join(root,'test-day.txt'),today);
  if(process.argv[4]==='editor'){
    await win.webContents.executeJavaScript('hbShell.editorOpen("quit-note")');
    let editor;
    for(let i=0;i<100;i++){
      editor=BrowserWindow.getAllWindows().find(w=>w!==win);
      if(editor){try{if(await editor.webContents.executeJavaScript('typeof IS_EDITOR_WIN!=="undefined"&&IS_EDITOR_WIN&&document.body.classList.contains("editor-window")'))break;}catch(_){} }
      await new Promise(r=>setTimeout(r,100));
    }
    if(!editor)throw new Error('Editor did not open');
    await editor.webContents.executeJavaScript('document.getElementById("memoInput").innerHTML="<p>退出前最后一笔便签</p>";saveMemoHtml(true)');
  }
  await new Promise(r=>setTimeout(r,delay));
  clearTimeout(timeout);app.quit();
});
