'use strict';
const { app } = require('electron');
const path = require('path');
const H = require('./_harness.js');

const NAME = 'verify-ui-workflows';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const profile = H.initProfile(NAME);
H.stubIpc(suite.calls);

async function activate(win, selector) {
  await H.evalJson(win, 'var node=document.querySelector(' + JSON.stringify(selector) + ');if(!node)throw new Error("missing "+' + JSON.stringify(selector) + ');node.click();return true');
  await H.sleep(100);
}

app.whenReady().then(async function () {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win);
    await H.bootWait(win);
    await H.sleep(2300);
    await H.evalJson(win, 'var gs=document.getElementById("guideSkip");if(gs)gs.click();var cm=document.getElementById("confirmMask");if(cm&&cm.classList.contains("show")){var cc=document.getElementById("confirmCancel");if(cc)cc.click();}return true');
    await H.sleep(80);

    let state = await H.evalJson(win,
      'go("today");var tabs=[].slice.call(document.querySelectorAll(".tab[role=tab]"));var start=tabs[0];start.focus();start.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));return {tabs:tabs.length,selected:tabs.filter(function(t){return t.getAttribute("aria-selected")==="true"}).map(function(t){return t.dataset.tab}),focused:document.activeElement.dataset.tab,associated:tabs.every(function(t){var p=document.getElementById(t.getAttribute("aria-controls"));return p&&p.getAttribute("aria-labelledby")===t.id})}');
    suite.ok(state.tabs === 5 && state.selected[0] === 'stat' && state.focused === 'stat' && state.associated, '导航方向键、选中状态与 tabpanel 关联一致（' + JSON.stringify(state) + ')');

    await H.evalJson(win, 'go("today");return true');
    await H.sleep(80);
    let todayScroll = await H.evalJson(win, 'var s=document.getElementById("scroll");s.scrollTop=Math.min(180,s.scrollHeight-s.clientHeight);return s.scrollTop');
    let statScroll = await H.evalJson(win, 'var s=document.getElementById("scroll");go("stat");return Math.min(220,s.scrollHeight-s.clientHeight)');
    await H.evalJson(win, 'document.getElementById("scroll").scrollTop=' + Number(statScroll) + ';return true');
    await H.sleep(80);
    await H.evalJson(win, 'go("memo");return true');
    await H.sleep(80);
    await H.evalJson(win, 'go("stat");return true');
    await H.sleep(80);
    let backStat = await H.evalJson(win, 'return document.getElementById("scroll").scrollTop');
    await H.evalJson(win, 'go("today");return true');
    await H.sleep(80);
    let backToday = await H.evalJson(win, 'return document.getElementById("scroll").scrollTop');
    state = { today: Number(todayScroll), stat: Number(statScroll), backStat: Number(backStat), backToday: Number(backToday) };
    suite.ok(state.stat > 0 && state.backStat === state.stat && state.backToday === state.today, '页面切换恢复各自滚动位置（' + JSON.stringify(state) + ')');

    state = await H.evalJson(win,
      'go("today");var d=ensureDay(todayStr());data.habits.forEach(function(h){d[h.key]=h.type==="bool"?false:0;if(h.type==="range"){d[h.key+"_s"]="23:00";d[h.key+"_e"]="07:00";}});renderAll();var all=habitsVisibleOn(viewDate);var bool=all.find(function(h){return h.type==="bool"});document.querySelector(".habit-filter [data-filter=pending]").click();var pending=Number(document.getElementById("habitFilterCountPending").textContent);var card=document.querySelector(".hcard[data-habit-key="+JSON.stringify(bool.key)+"] .big-btn");card.click();return {total:all.length,key:bool.key,pending:pending,clicked:true}');
    suite.ok(state.total > 0 && state.pending === state.total && state.clicked, '待完成筛选显示当前日期未完成习惯并接受真实打卡点击（' + JSON.stringify(state) + ')');
    await H.sleep(140);
    state = await H.evalJson(win,
      'return {pending:Number(document.getElementById("habitFilterCountPending").textContent),done:Number(document.getElementById("habitFilterCountDone").textContent),selected:document.querySelector(".habit-filter [data-filter=pending]").getAttribute("aria-pressed"),focusInList:!!document.activeElement.closest("#checkinList .hcard"),focusKey:document.activeElement.closest(".hcard")&&document.activeElement.closest(".hcard").dataset.habitKey}');
    suite.ok(state.pending > 0 && state.done === 1 && state.selected === 'true' && state.focusInList, '筛选后打卡计数更新，移出卡片后焦点落到剩余项目（' + JSON.stringify(state) + ')');

    state = await H.evalJson(win,
      'var d=ensureDay(todayStr());data.habits.forEach(function(h){if(h.type==="bool")d[h.key]=true;else if(h.type==="count"||h.type==="hours"||h.type==="range")d[h.key]=h.target||8;if(h.type==="range"){d[h.key+"_s"]="23:00";d[h.key+"_e"]="07:00";}});renderAll();document.querySelector(".habit-filter [data-filter=pending]").click();var empty=!!document.querySelector("#checkinList .filter-empty");document.querySelector("#checkinList [data-filter-reset]").click();return {empty:empty,reset:document.querySelector(".habit-filter [data-filter=all]").getAttribute("aria-pressed"),shown:document.querySelectorAll("#checkinList .hcard").length}');
    suite.ok(state.empty && state.reset === 'true' && state.shown > 0, '已全部完成时提供空态出口并可恢复全部列表（' + JSON.stringify(state) + ')');

    state = await H.evalJson(win,
      'go("today");var h=data.habits.find(function(x){return x.type==="range"});var d=ensureDay(todayStr());d[h.key]=7;delete d[h.key+"_s"];delete d[h.key+"_e"];renderAll();var card=document.querySelector(".hcard[data-habit-key="+JSON.stringify(h.key)+"]");var inputs=card.querySelectorAll("input[type=time]");var legacy={start:inputs[0].value,end:inputs[1].value,hint:card.querySelector(".range-unrecorded")&&card.querySelector(".range-unrecorded").textContent};delete d[h.key];renderAll();card=document.querySelector(".hcard[data-habit-key="+JSON.stringify(h.key)+"]");inputs=card.querySelectorAll("input[type=time]");return {legacy:legacy,fresh:{start:inputs[0].value,end:inputs[1].value,habitStart:h.start,habitEnd:h.end}}');
    suite.ok(state.legacy.start === '' && state.legacy.end === '' && state.legacy.hint && state.fresh.start === state.fresh.habitStart && state.fresh.end === state.fresh.habitEnd, '历史 range 记录不伪造起止时间，新记录仍使用习惯默认值（' + JSON.stringify(state) + ')');

    await activate(win, '#page-today .sec-act-primary');
    state = await H.evalJson(win, 'return {open:document.getElementById("editorSheet").classList.contains("show"),focus:document.activeElement.id,label:document.querySelector("label[for=edName]")&&document.querySelector("label[for=edName]").textContent,modal:document.getElementById("editorSheet").getAttribute("aria-modal")}');
    suite.ok(state.open && state.focus === 'edName' && !!state.label && state.modal === 'true', '今日页直接新建打开可访问的编辑对话框并聚焦名称（' + JSON.stringify(state) + ')');

    state = await H.evalJson(win, 'document.querySelector("#editorSheet .btn-primary").click();return {open:document.getElementById("editorSheet").classList.contains("show"),invalid:document.getElementById("edName").getAttribute("aria-invalid"),visible:!document.getElementById("edNameError").hidden,focus:document.activeElement.id}');
    suite.ok(state.open && state.invalid === 'true' && state.visible && state.focus === 'edName', '空名称错误贴近字段显示并阻止保存（' + JSON.stringify(state) + ')');

    state = await H.evalJson(win,
      'var input=document.getElementById("edName");input.value="丢弃测试";input.dispatchEvent(new Event("input",{bubbles:true}));input.focus();document.querySelector("#editorSheet .sheet-back").click();return {sheet:document.getElementById("editorSheet").classList.contains("show"),confirm:document.getElementById("confirmMask").classList.contains("show"),focus:document.activeElement.id}');
    await H.sleep(80);
    state = await H.evalJson(win, 'return {sheet:document.getElementById("editorSheet").classList.contains("show"),confirm:document.getElementById("confirmMask").classList.contains("show"),focus:document.activeElement.id}');
    suite.ok(state.sheet && state.confirm && state.focus === 'confirmCancel', '关闭有更改的编辑器先确认，并将危险默认焦点放在取消（' + JSON.stringify(state) + ')');
    await H.evalJson(win, 'document.getElementById("confirmCancel").click();return true');
    state = await H.evalJson(win, 'return {sheet:document.getElementById("editorSheet").classList.contains("show"),confirm:document.getElementById("confirmMask").classList.contains("show"),name:document.getElementById("edName").value,focus:document.activeElement.id}');
    suite.ok(state.sheet && !state.confirm && state.name === '丢弃测试' && state.focus === 'edName', '取消放弃确认后保留输入并恢复编辑焦点（' + JSON.stringify(state) + ')');
    await H.evalJson(win, 'document.querySelector("#editorSheet .sheet-back").click();document.getElementById("confirmOk").click();return true');
    state = await H.evalJson(win, 'return {sheet:document.getElementById("editorSheet").classList.contains("show"),confirm:document.getElementById("confirmMask").classList.contains("show"),exists:(data.habits||[]).some(function(h){return h.name==="丢弃测试"})}');
    suite.ok(!state.sheet && !state.confirm && !state.exists, '确认放弃后关闭编辑器且未写入草稿（' + JSON.stringify(state) + ')');

    await activate(win, '#page-today .sec-act-primary');
    await H.evalJson(win, 'var input=document.getElementById("edName");input.value="界面验证习惯";input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#editorSheet .btn-primary").click();return true');
    await H.sleep(250);
    state = await H.evalJson(win, 'var h=(data.habits||[]).find(function(x){return x.name==="界面验证习惯"});return {saved:!!h,closed:!document.getElementById("editorSheet").classList.contains("show"),active:document.activeElement.className}');
    suite.ok(state.saved && state.closed, '编辑器有效数据保存并关闭（' + JSON.stringify(state) + ')');

    await activate(win, '.tab[data-tab=mine]');
    state = await H.evalJson(win, 'var s=document.getElementById("themeSelect");if(!s)throw new Error("theme selector missing");var options=[].slice.call(s.options).map(function(o){return o.value});s.value="dark";s.dispatchEvent(new Event("change",{bubbles:true}));var dark=document.documentElement.classList.contains("dark");window.__hbSystemDark=true;s.value="system";s.dispatchEvent(new Event("change",{bubbles:true}));var systemDark=document.documentElement.classList.contains("dark");window.__hbSystemDark=false;applyTheme();var systemLight=!document.documentElement.classList.contains("dark");s.value="light";s.dispatchEvent(new Event("change",{bubbles:true}));return {options:options,mode:themeMode(),selected:s.value,dark:dark,systemDark:systemDark,systemLight:systemLight}');
    suite.ok(state.options.join(',') === 'light,dark,system' && state.mode === 'light' && state.selected === 'light' && state.dark && state.systemDark && state.systemLight, '主题可直接选择浅色、深色与跟随系统，并同步系统外观（' + JSON.stringify(state) + ')');
    await activate(win, '#pAva');
    state = await H.evalJson(win, 'return {open:document.getElementById("profileSheet").classList.contains("show"),focus:document.activeElement.id}');
    suite.ok(state.open && state.focus === 'pfName', '个人资料编辑器打开后焦点落在昵称字段（' + JSON.stringify(state) + ')');
    await H.evalJson(win, 'var input=document.getElementById("pfName");input.value="未保存昵称";input.dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("mask").click();return true');
    state = await H.evalJson(win, 'return {confirm:document.getElementById("confirmMask").classList.contains("show"),focus:document.activeElement.id}');
    await H.sleep(80);
    state = await H.evalJson(win, 'return {confirm:document.getElementById("confirmMask").classList.contains("show"),focus:document.activeElement.id}');
    suite.ok(state.confirm && state.focus === 'confirmCancel', '昵称编辑未保存时离开会请求确认（' + JSON.stringify(state) + ')');
    await H.evalJson(win, 'document.getElementById("confirmOk").click();return true');
    state = await H.evalJson(win, 'return {closed:!document.getElementById("profileSheet").classList.contains("show"),name:data.profile.name}');
    suite.ok(state.closed && state.name !== '未保存昵称', '确认放弃昵称编辑不会改写个人资料（' + JSON.stringify(state) + ')');

    await activate(win, '.tab[data-tab=today]');
    await activate(win, '#page-today > .sec-title .sec-act-txt');
    state = await H.evalJson(win, 'return {open:habitManagerOpen(),dialog:document.getElementById("habitManager").getAttribute("role"),focus:document.activeElement.className}');
    suite.ok(state.open && state.dialog === 'dialog' && state.focus === 'hm-close', '习惯管理以对话框语义打开并接收焦点（' + JSON.stringify(state) + ')');
    await activate(win, '#habitManager .add-habit-btn');
    state = await H.evalJson(win, 'return {manager:habitManagerOpen(),editor:document.getElementById("editorSheet").classList.contains("show")}');
    suite.ok(state.manager && state.editor, '管理面板中可以打开嵌套编辑器');
    await H.evalJson(win, 'document.querySelector("#editorSheet .sheet-back").click();return true');
    await H.sleep(80);
    state = await H.evalJson(win, 'return {manager:habitManagerOpen(),editor:document.getElementById("editorSheet").classList.contains("show"),focus:document.activeElement.className}');
    suite.ok(state.manager && !state.editor && state.focus === 'add-habit-btn', '关闭嵌套编辑器后回到管理面板原入口（' + JSON.stringify(state) + ')');
    await H.evalJson(win, 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return true');
    await H.sleep(80);
    state = await H.evalJson(win, 'return {manager:habitManagerOpen(),focus:document.activeElement.className}');
    suite.ok(!state.manager && state.focus.indexOf('sec-act-txt') >= 0, 'Escape 关闭当前管理层并恢复触发控件焦点（' + JSON.stringify(state) + ')');

    await H.evalJson(win, 'go("today");var icon=document.querySelector("#checkinList .hi[data-dbedit]");icon.focus();icon.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return true');
    await H.sleep(80);
    state = await H.evalJson(win, 'return {open:document.getElementById("editorSheet").classList.contains("show"),focus:document.activeElement.id,valid:document.getElementById("editorSheet").getAttribute("aria-modal")}');
    suite.ok(state.open && state.focus === 'edName' && state.valid === 'true', '习惯图标支持键盘进入编辑并建立模态焦点（' + JSON.stringify(state) + ')');
    await H.evalJson(win, 'document.querySelector("#editorSheet .sheet-back").click();return true');
    await H.sleep(80);
    state = await H.evalJson(win, 'return {closed:!document.getElementById("editorSheet").classList.contains("show"),focus:document.activeElement.className}');
    suite.ok(state.closed && state.focus === 'hi', '关闭快捷编辑器后焦点返回习惯图标（' + JSON.stringify(state) + ')');

    suite.metric('build', H.BUILD);
    suite.metric('profile', path.relative(H.ROOT, profile));
    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('UI 工作流套件异常: ' + String((e && e.stack) || e).slice(0, 1200));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
