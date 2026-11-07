'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require('./_harness.js');

const NAME = 'capture-ui-states';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const profile = H.initProfile(NAME);
H.stubIpc(suite.calls);

async function clearToasts(win) {
  await H.evalJson(win, 'document.querySelectorAll("#toastWrap .toast").forEach(function(node){node.remove()});return true');
}

async function capture(win, outDir, name, guard) {
  await clearToasts(win);
  await win.webContents.executeJavaScript('new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);})})', true);
  const state = await H.evalJson(win, 'var state=(function(){' + guard + '})();var guide=document.getElementById("guideMask");state.guide=!!guide&&getComputedStyle(guide).display!=="none";state.sheets=[].slice.call(document.querySelectorAll(".sheet")).map(function(node){var r=node.getBoundingClientRect(),s=getComputedStyle(node);return {id:node.id,show:node.classList.contains("show"),display:s.display,top:Math.round(r.top),height:Math.round(r.height),z:s.zIndex,transform:s.transform}});state.ok=!!state.ok&&!state.guide;return state');
  state.captureWindow = { type: win.webContents.getType(), offscreen: win.webContents.isOffscreen() };
  state.focusOverlay = await H.evalJson(win, 'var n=document.getElementById("focusOverlay");return n?{className:n.className,display:getComputedStyle(n).display,visibility:getComputedStyle(n).visibility}:null');
  state.captureCss = await H.evalJson(win, 'var a=document.getElementById("app");return {body:document.body.className,htmlBackground:getComputedStyle(document.documentElement).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,appBackground:a&&getComputedStyle(a).backgroundColor,appRect:a&&a.getBoundingClientRect().toJSON()}');
  state.captureHit = await H.evalJson(win, 'return document.elementsFromPoint(50,500).slice(0,6).map(function(n){return {tag:n.tagName,id:n.id,cls:typeof n.className==="string"?n.className:"",text:(n.innerText||"").slice(0,60),bg:getComputedStyle(n).backgroundColor,opacity:getComputedStyle(n).opacity}})');
  const activeSheets = state.sheets.filter(item => item.show);
  const expectedSheet = name === 'habit-editor' || name === 'unsaved-confirm' ? 'editorSheet' : null;
  const sheetsValid = expectedSheet ? activeSheets.length === 1 && activeSheets[0].id === expectedSheet && activeSheets[0].top >= 0 : activeSheets.length === 0;
  state.ok = !!state.ok && sheetsValid && state.captureWindow.offscreen && (!state.focusOverlay || !/\bshow\b/.test(state.focusOverlay.className));
  suite.metric(name + '-ui', state);
  suite.ok(state && state.ok, name + ' 截图状态有效（' + JSON.stringify(state) + ')');
  if (!state || !state.ok) return;
  await H.sleep(350);
  await win.webContents.executeJavaScript('new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);})})', true);
  const png = await H.capturePng(win);
  if (png.length < 5000) {
    suite.errs.push(name + ' capturePage 未取得有效截图');
    return;
  }
  const target = path.join(outDir, name + '.png');
  fs.writeFileSync(target, png);
  suite.metric(name, { path: path.relative(H.ROOT, target), bytes: png.length, size: { width: win.getContentSize()[0], height: win.getContentSize()[1] }, capture: 'Electron webContents.capturePage (offscreen, stayHidden; fresh paint)' });
}

app.whenReady().then(async function () {
  const outDir = path.join(__dirname, 'results', 'ui-after', 'states');
  fs.mkdirSync(outDir, { recursive: true });
  const main = H.makeWin(suite, { show: false, offscreen: true, frame: false, transparent: true, backgroundColor: '#00000000', width: 520, height: 720 });
  suite.metric('mainCaptureWindow', { type: main.webContents.getType(), offscreen: main.webContents.isOffscreen() });
  let editor = null;
  let sticker = null;
  try {
    await H.loadPage(main);
    await H.bootWait(main);
    await H.sleep(2200);
    await H.evalJson(main, 'var skip=document.getElementById("guideSkip");if(skip)skip.click();return true');
    await H.sleep(100);
    await H.evalJson(main, 'var gs=document.getElementById("guideSkip");if(gs)gs.click();var cm=document.getElementById("confirmMask");if(cm)cm.classList.remove("show");data.settings.theme="light";applyTheme();data.memoNotes=[{id:"capture-note",ts:Date.now(),ord:0,title:"给自己的小记",text:"把重要的事慢慢做好。\\n今天先完成一件小事。",html:"<p>把重要的事慢慢做好。</p><p>今天先完成一件小事。</p>",pin:false}];data.memo={html:data.memoNotes[0].html,text:data.memoNotes[0].text};saveMemoFields();renderMemoList();return true');
    await H.sleep(350);
    await H.evalJson(main, 'data.habits=[{key:"capture-habit",name:"每日阅读",type:"hours",target:0.5,unit:"小时",icon:"📖",color:"#7A9E7E",size:"wide",createdAt:Date.now(),archived:false}];syncHabits();renderAll();return true');
    suite.metric('sheetsBeforeCapture', await H.evalJson(main, 'return [].slice.call(document.querySelectorAll(".sheet.show")).map(function(node){return node.id})'));

    await H.evalJson(main, 'go("today");document.querySelector("#page-today .sec-act-primary").click();return true');
    await H.sleep(100);
    await capture(main, outDir, 'habit-editor', 'var d=document.getElementById("editorSheet"),r=d.getBoundingClientRect();return {ok:d.classList.contains("show")&&r.width>0&&r.height>0&&document.activeElement.id==="edName",active:document.activeElement.id,theme:document.documentElement.className}');

    await H.evalJson(main, 'var name=document.getElementById("edName");name.value="未保存示例";name.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#editorSheet .sheet-back").click();return true');
    await H.sleep(100);
    await capture(main, outDir, 'unsaved-confirm', 'var d=document.getElementById("confirmMask"),cancel=document.getElementById("confirmCancel"),r=d.getBoundingClientRect();return {ok:d.classList.contains("show")&&r.width>0&&document.activeElement===cancel,focus:document.activeElement.id,theme:document.documentElement.className}');
    await H.evalJson(main, 'document.getElementById("confirmOk").click();return true');
    await H.sleep(100);

    await H.evalJson(main, 'document.querySelector("#page-today .sec-act-txt").click();return true');
    await H.sleep(350);
    await capture(main, outDir, 'habit-manager', 'var d=document.getElementById("habitManager"),r=d.getBoundingClientRect();return {ok:d.classList.contains("is-open")&&r.width>0&&r.height>0&&d.getAttribute("role")==="dialog",items:d.querySelectorAll("#habitList .habit-card").length}');
    await H.evalJson(main, 'closeHabitManager();return true');
    await H.sleep(300);

    await H.evalJson(main, 'go("memo");renderMemoList();return true');
    await H.sleep(200);
    await capture(main, outDir, 'memo-list', 'var p=document.getElementById("page-memo"),n=document.querySelector(".memo-note");return {ok:p.classList.contains("active")&&!!n&&n.getBoundingClientRect().width>0,title:n&&n.querySelector(".mn-title").textContent}');

    editor = H.makeWin(suite, { show: false, offscreen: true, frame: false, transparent: true, backgroundColor: '#00000000', width: 520, height: 720 });
    await H.loadPage(editor, { view: 'editor', note: 'capture-note' });
    await H.bootWait(editor);
    await H.evalJson(editor, 'var skip=document.getElementById("guideSkip");if(skip)skip.click();return true');
    await H.sleep(250);
    await capture(editor, outDir, 'memo-editor-window', 'var e=document.getElementById("memoInput"),r=e.getBoundingClientRect();return {ok:document.body.classList.contains("editor-window")&&document.body.classList.contains("memo-editor-open")&&!document.body.classList.contains("sticky-sticker")&&r.width>0&&r.height>0&&e.textContent.indexOf("把重要的事")>=0,title:document.getElementById("memoEdTitle").value}');

    sticker = H.makeWin(suite, { show: false, offscreen: true, frame: false, transparent: true, backgroundColor: '#00000000', width: 360, height: 480 });
    await H.loadPage(sticker, { view: 'editor', sticky: '1', note: 'capture-note' });
    await H.bootWait(sticker);
    await H.evalJson(sticker, 'var skip=document.getElementById("guideSkip");if(skip)skip.click();return true');
    await H.sleep(850);
    await H.evalJson(sticker, 'localStorage.setItem("hb_lock_mode","note");applyStickyMode();return true');
    await H.sleep(150);
    await capture(sticker, outDir, 'memo-sticker-window', 'var e=document.getElementById("memoInput"),top=document.querySelector(".me-top"),fab=document.querySelector(".win-fab"),r=e.getBoundingClientRect();return {ok:document.body.classList.contains("sticky-sticker")&&getComputedStyle(top).display==="none"&&r.width>0&&r.height>0&&e.textContent.indexOf("把重要的事")>=0,fab:getComputedStyle(fab).display}');

    await H.evalJson(main, 'curNoteId="capture-note";window.applyLock(true);return true');
    await H.sleep(850);
    await capture(main, outDir, 'locked-note', 'return {ok:document.body.classList.contains("app-locked")&&document.getElementById("page-memo").classList.contains("active")&&document.getElementById("memoInput").getAttribute("contenteditable")==="false",text:document.getElementById("memoInput").textContent.slice(0,40)}');
    await H.evalJson(main, 'setStickyMode("today");return true');
    await H.sleep(400);
    await capture(main, outDir, 'locked-today', 'var card=document.getElementById("stickyToday"),r=card.getBoundingClientRect();return {ok:document.body.classList.contains("app-locked")&&document.body.classList.contains("m-sticky-today")&&getComputedStyle(card).display!=="none"&&r.width>0&&r.height>0,width:r.width,height:r.height}');

    suite.metric('profile', path.relative(H.ROOT, profile));
    await H.drainPageErrs(main, suite);
    if (editor) await H.drainPageErrs(editor, suite);
    if (sticker) await H.drainPageErrs(sticker, suite);
  } catch (e) {
    suite.errs.push('状态截图套件异常: ' + String((e && e.stack) || e).slice(0, 1200));
  } finally {
    try { if (sticker) sticker.destroy(); } catch (_) {}
    try { if (editor) editor.destroy(); } catch (_) {}
    try { main.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
