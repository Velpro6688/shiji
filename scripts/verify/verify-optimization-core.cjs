'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require('./_harness.js');

const NAME = 'verify-optimization-core';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const profile = H.initProfile(NAME);
H.stubIpc(suite.calls);

function readDoc() {
  try { return JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8')); }
  catch (_) { return null; }
}

app.whenReady().then(async function () {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win);
    await H.bootWait(win);

    const seededNotes = [
      { id: 'opt-note-water', ts: Date.now() - 2000, title: '喝水记录', text: '每天补水两升', html: '', ord: 0 },
      { id: 'opt-note-walk', ts: Date.now() - 1000, title: 'Walk log', text: 'evening walk 30 minutes', html: '', ord: 1 },
      { id: 'opt-note-image', ts: Date.now(), title: '带图片的便签', text: '清空记录不得移除这张图片', html: '', ord: 2 }
    ];
    await H.evalJson(win, 'data.memoNotes=' + JSON.stringify(seededNotes) + ';data.memo={html:"",text:""};saveMemoFields();return true');
    await H.sleep(700);

    await H.evalJson(win, 'go("memo");renderMemoList();return true');
    await H.evalJson(win, 'var s=document.getElementById("memoSearch");s.value="喝水";s.dispatchEvent(new Event("input",{bubbles:true}));return true');
    await H.sleep(260);
    let r = await H.evalJson(win, 'return {query:memoSearchQuery,ids:[].slice.call(document.querySelectorAll("#memoList .memo-note")).map(function(n){return n.getAttribute("data-nid")})}');
    suite.ok(r.ids.length === 1 && r.ids[0] === 'opt-note-water', '便签搜索按真实中文输入过滤（query=' + JSON.stringify(r.query) + ', ids=' + JSON.stringify(r.ids) + ')');
    await H.evalJson(win, 'var s=document.getElementById("memoSearch");s.value="no matching note";s.dispatchEvent(new Event("input",{bubbles:true}));return true');
    await H.sleep(260);
    r = await H.evalJson(win, 'return {count:document.querySelectorAll("#memoList .memo-note").length,empty:!!document.querySelector("#memoList .memo-list-empty"),text:(document.getElementById("memoList").textContent||"")}');
    suite.ok(r.count === 0 && r.empty && /清除搜索/.test(r.text), '无匹配搜索显示可清除的空态（' + JSON.stringify(r) + ')');
    await H.evalJson(win, 'document.getElementById("memoSearch").value="";document.getElementById("memoSearch").dispatchEvent(new Event("input",{bubbles:true}));return true');
    await H.sleep(260);

    await H.evalJson(win, 'go("today");openHabitManager();return true');
    await H.evalJson(win, 'document.querySelector("#habitManager .add-habit-btn").click();return true');
    await H.evalJson(win, 'var n=document.getElementById("edName");n.value="半小时阅读";n.dispatchEvent(new Event("input",{bubbles:true}));document.querySelectorAll("#edTypes .type-opt")[2].click();var t=document.getElementById("edTarget");t.value="0.5";t.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#editorSheet .btn-primary").click();return true');
    r = await H.evalJson(win, 'var h=(data.habits||[]).find(function(x){return x.name==="半小时阅读"})||{};return {key:h.key,target:h.target,type:h.type}');
    suite.ok(r.target === 0.5 && r.type === 'hours', '通过编辑表单保存 0.5 小时时长目标（' + JSON.stringify(r) + ')');
    await H.evalJson(win, 'openEdit(' + JSON.stringify(r.key) + ');var t=document.getElementById("edTarget");t.value="1.5";t.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#editorSheet .btn-primary").click();return true');
    r = await H.evalJson(win, 'var h=(data.habits||[]).find(function(x){return x.name==="半小时阅读"})||{};return {target:h.target,type:h.type}');
    suite.ok(r.target === 1.5 && r.type === 'hours', '编辑表单保留 1.5 小时时长目标（' + JSON.stringify(r) + ')');
    r = await H.evalJson(win, 'var d=normalizeImported({days:{},habits:[{key:"hour-half",name:"半小时",type:"hours",target:0.5},{key:"hour-one-half",name:"一个半小时",type:"hours",target:1.5}]});return {targets:d.habits.map(function(h){return h.target})}');
    suite.ok(r.targets[0] === 0.5 && r.targets[1] === 1.5, '导入归一化保留 0.5/1.5 小时（' + JSON.stringify(r.targets) + ')');

    await H.evalJson(win, 'document.querySelector("#habitManager .add-habit-btn").click();var n=document.getElementById("edName");n.value="小数计数错误";n.dispatchEvent(new Event("input",{bubbles:true}));document.querySelectorAll("#edTypes .type-opt")[1].click();var t=document.getElementById("edTarget");t.value="1.5";t.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#editorSheet .btn-primary").click();return true');
    r = await H.evalJson(win, 'return {open:document.getElementById("editorSheet").classList.contains("show"),invalid:document.getElementById("edTarget").getAttribute("aria-invalid"),error:document.getElementById("edTargetError").textContent,created:(data.habits||[]).some(function(h){return h.name==="小数计数错误"})}');
    suite.ok(r.open && r.invalid === 'true' && !r.created && /整数/.test(r.error), '计数小数显示就地错误且不保存（' + JSON.stringify(r) + ')');

    await H.evalJson(win, 'openAdd();var b=[].slice.call(document.querySelectorAll("#edTemplates .tpl-chip")).find(function(x){return x.textContent.indexOf("散步")>=0});if(b)b.click();return true');
    r = await H.evalJson(win, 'var t=document.getElementById("edTarget");var d=normalizeImported({days:{},habits:[{key:"walk-import",name:"散步",type:"count",target:6000}]});return {input:Number(t.value),max:Number(t.max),valid:t.validity.valid,imported:d.habits[0].target}');
    suite.ok(r.input === 6000 && r.max >= 6000 && r.valid, '散步模板 6000 符合目标输入范围（' + JSON.stringify(r) + ')');
    suite.ok(r.imported === 6000, '导入往返保留 6000 步目标（实际 ' + r.imported + ')');
    await H.evalJson(win, 'document.querySelector("#editorSheet .btn-primary").click();return true');
    r = await H.evalJson(win, 'var h=(data.habits||[]).find(function(x){return x.name==="散步"})||{};return {target:h.target,type:h.type}');
    suite.ok(r.target === 6000 && r.type === 'count', '通过编辑表单保存 6000 步目标（' + JSON.stringify(r) + ')');

    const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F1sAAAAASUVORK5CYII=';
    await H.evalJson(win, 'window.__optImage=null;window.hbShell.writeImage(' + JSON.stringify(imageData) + ').then(function(v){window.__optImage=v},function(e){window.__optImage={error:String(e)}});return true');
    let imageResult = null;
    for (let i = 0; i < 30 && imageResult === null; i++) {
      await H.sleep(100);
      const value = await H.evalJson(win, 'return window.__optImage===null?null:window.__optImage');
      if (value !== null) imageResult = value;
    }
    const imageRef = imageResult && (imageResult.ref || imageResult.url || imageResult.path);
    suite.ok(!!imageRef && !imageResult.error, '隔离 profile 中真实写入便签图片（' + JSON.stringify(imageResult) + ')');

    const imageNoteHtml = '<p>图片保留验证</p><img src="' + String(imageRef || '').replace(/"/g, '&quot;') + '">';
    const completeNotes = seededNotes.map(function (n) {
      return n.id === 'opt-note-image' ? Object.assign({}, n, { html: imageNoteHtml }) : n;
    });
    await H.evalJson(win, 'data.memoNotes=' + JSON.stringify(completeNotes) + ';data.memo={html:"",text:""};saveMemoFields();return true');
    await H.sleep(800);
    const beforeClear = readDoc();
    suite.ok(!!beforeClear && beforeClear.memoNotes.length === 3 && beforeClear.memoNotes.some(function (n) { return n.id === 'opt-note-image' && /<img/.test(n.html); }), '清空前磁盘含三条便签与图片引用');

    await H.evalJson(win, 'go("mine");clearSample(false);return true');
    await H.evalJson(win, 'document.getElementById("confirmOk").click();return true');
    await H.sleep(400);
    r = await H.evalJson(win, 'return {memoryCount:getNotes().length,hasArray:Array.isArray(data.memoNotes),noteIds:getNotes().map(function(n){return n.id})}');
    suite.ok(r.memoryCount === 3 && r.noteIds.indexOf('opt-note-image') >= 0, '清空打卡后当前便签内存列表仍完整（' + JSON.stringify(r) + ')');

    await H.evalJson(win, 'go("memo");var b=[].slice.call(document.querySelectorAll("#page-memo button")).find(function(x){return /newNote\(\)/.test(x.getAttribute("onclick")||"")});if(b)b.click();return {clicked:!!b,count:getNotes().length}');
    await H.sleep(900);
    const afterNewNote = readDoc();
    suite.ok(!!afterNewNote && afterNewNote.memoNotes.length === 4 && afterNewNote.memoNotes.some(function (n) { return n.id === 'opt-note-image' && /<img/.test(n.html); }), '清空后新建便签不覆盖旧便签与图片');

    await win.webContents.reload();
    await H.bootWait(win);
    r = await H.evalJson(win, 'var h=(data.habits||[]).find(function(x){return x.name==="半小时阅读"})||{};return {ids:getNotes().map(function(n){return n.id}),count:getNotes().length,hoursTarget:h.target}');
    suite.ok(r.count === 4 && r.ids.indexOf('opt-note-water') >= 0 && r.ids.indexOf('opt-note-image') >= 0, '重载后原便签、新建便签与图片引用均可读（' + JSON.stringify(r) + ')');
    suite.ok(r.hoursTarget === 1.5, '重载后小数时长目标仍为 1.5（' + r.hoursTarget + ')');

    await H.drainPageErrs(win, suite);
    suite.metric('build', H.BUILD);
    suite.metric('profile', path.relative(H.ROOT, profile));
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.stack) || e).slice(0, 1000));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
