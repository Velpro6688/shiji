'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v306');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:480,frame:false});
 const run=s=>H.evalJson(win,s);
 const out=path.join(H.ROOT,'artifacts','ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(700);
  await run(`var g=document.getElementById('guideSkip');if(g)g.click();hideConfirm();data.settings.sound=false;
   data.memoNotes=['a','b'].map((id,i)=>({id:'read-'+id,html:'<p>阅读 '+id+'</p>'+'<p>长便签正文，用于检查阅读位置。</p>'.repeat(80),ord:i}));
   curNoteId='read-a';renderNoteToEditor(curNote(),true);document.body.classList.add('app-locked');setStickyMode('note');window._lockFitManual=true;return true;`);
  await run(`document.getElementById('memoInput').scrollTop=450;return true;`);
  await win.webContents.executeJavaScript('switchStickyNote(1)');
  suite.ok(await run(`return curNoteId==='read-b'&&document.getElementById('memoInput').scrollTop===0;`),'first visit starts at the top of the new note');
  await run(`document.getElementById('memoInput').scrollTop=220;return true;`);
  await win.webContents.executeJavaScript('switchStickyNote(-1)');await H.sleep(100);
  suite.ok(await run(`return curNoteId==='read-a'&&Math.abs(document.getElementById('memoInput').scrollTop-450)<2;`),'returning to note A restores its own reading position');
  await win.webContents.executeJavaScript('switchStickyNote(1)');await H.sleep(100);
  suite.ok(await run(`return curNoteId==='read-b'&&Math.abs(document.getElementById('memoInput').scrollTop-220)<2;`),'note B keeps an independent reading position');
  await run(`data.memoNotes.find(n=>n.id==='read-a').html='<p>内容已缩短</p>';return true;`);
  await win.webContents.executeJavaScript('switchStickyNote(-1)');await H.sleep(100);
  suite.ok(await run(`return document.getElementById('memoInput').scrollTop===0;`),'shortened content clamps a previously deep reading position safely');
  for(const userScrolled of [false,true]){
   const top=await run(`var page=document.getElementById('memoInput');page.innerHTML='<p>等待图片</p>';var img=document.createElement('img');Object.defineProperty(img,'complete',{get:()=>false});page.appendChild(img);
    stickyReadingPositions.set(String(curNoteId),450);restoreStickyReadingPosition(page,String(curNoteId));page.insertAdjacentHTML('beforeend','<div style="height:1800px">图片占位内容</div>');
    ${userScrolled?'page.scrollTop=27;':''}img.dispatchEvent(new Event('load'));return page.scrollTop;`);
   suite.ok(Math.abs(top-(userScrolled?27:450))<2,userScrolled?'late image never overrides a new user scroll':'late image restores the saved depth after content expands');
  }
  // 激活已编写的 coarse-pointer CSS 进行几何和命中检查，不依赖测试主机是否带触摸屏。
  await run(`window.coarseRules=[];for(const sheet of document.styleSheets)for(const rule of sheet.cssRules){if(rule.media&&rule.conditionText.split(' ').join('')==='(any-pointer:coarse)'){coarseRules.push([rule,rule.media.mediaText]);rule.media.mediaText='all';}}return true;`);
  let v=await run(`var buttons=[document.getElementById('wfMode'),document.querySelector('.win-fab[data-act=lock]')];return buttons.map(b=>{var r=b.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,hit:document.elementFromPoint(r.left+2,r.top+r.height/2).closest('button')===b};});`);
  suite.ok(v.every(b=>b.width>=44&&b.height>=44&&b.hit)&&v[0].right<=v[1].left,'touch sticker controls are 44px, distinct, and clickable at their edges');
  suite.ok(await run(`return !document.querySelector('#stickyPrev,#stickyNext,#stickyNotePosition');`),'reading and touch changes never reintroduce pager buttons or counters');
  fs.writeFileSync(path.join(out,'touch-sticker.png'),await H.capturePng(win));
  await H.loadPage(win,{view:'editor',note:'read-a'});await H.bootWait(win);await H.sleep(400);
  await run(`var g=document.getElementById('guideSkip');if(g)g.click();hideConfirm();data.memoNotes=[{id:'read-a',html:'<p>触摸编辑布局</p>',ord:0}];curNoteId='read-a';renderNoteToEditor(curNote(),true);
   for(const sheet of document.styleSheets)for(const rule of sheet.cssRules)if(rule.media&&rule.conditionText.split(' ').join('')==='(any-pointer:coarse)')rule.media.mediaText='all';return true;`);
  for(const width of [320,520]){
   await H.resizeWindow(win,width,640);
   await run(`document.querySelector('.memo-more').open=true;syncMemoChromeHeights();return true;`);await H.sleep(180);
   v=await run(`var t=document.getElementById('memoTools'),p=document.querySelector('.memo-more-tools'),r=p.getBoundingClientRect();return {overflow:t.scrollWidth>t.clientWidth+1||p.scrollWidth>p.clientWidth+1,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=t.getBoundingClientRect().top,buttons:[...t.querySelectorAll('.mt-btn')].filter(b=>b.getBoundingClientRect().width>0).every(b=>{var r=b.getBoundingClientRect();return r.width>=44&&r.height>=44}),contentBottom:document.getElementById('memoInput').getBoundingClientRect().bottom,toolsTop:t.getBoundingClientRect().top};`);
   suite.ok(!v.overflow&&v.inside&&v.buttons,width+'px touch toolbar and format panel use 44px controls without overflow '+JSON.stringify(v));
   fs.writeFileSync(path.join(out,'touch-editor-'+width+'.png'),await H.capturePng(win));
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
