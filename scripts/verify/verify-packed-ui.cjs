'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require('./_harness.js');

const NAME = 'verify-packed-ui';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const profile = H.initProfile(NAME);
H.stubIpc(suite.calls);
/* 本套件会 destroy 首个窗口再开第二个做「重载后数据仍在」验证；
   没有这条守卫时 Electron 默认在 window-all-closed 直接 quit，
   第二次 loadFile 会被中止 → ERR_FAILED(-2)。 */
app.on('window-all-closed', () => {});

const archive = process.argv[2] ? path.resolve(process.argv[2]) : '';
const rootRel = archive ? path.relative(H.ROOT, archive) : '';
if (!archive || rootRel.startsWith('..' + path.sep) || path.isAbsolute(rootRel) || !fs.existsSync(archive)) {
  throw new Error('请提供项目目录内存在的 app.asar 路径');
}

async function openPackedPage(suite, archive) {
  const win = H.makeWin(suite, {
    show: false,
    width: 1200,
    height: 860,
    webPreferences: { preload: path.join(archive, 'preload.js') }
  });
  await H.withTimeout(win.loadFile(path.join(archive, 'habit.html'), {
    query: { shell: '1', build: H.BUILD }
  }), 20000, 'load packed habit.html');
  await H.bootWait(win);
  return win;
}

app.whenReady().then(async function () {
  let win = null;
  try {
    win = await openPackedPage(suite, archive);
    let state = await H.evalJson(win,
      'var links=[].slice.call(document.querySelectorAll("link[rel=stylesheet]"));return {build:APP_BUILD,hasUi:!!window.HabitUI,filters:typeof window.HabitUI.filterHabits==="function",styles:links.map(function(n){return {href:n.getAttribute("href"),loaded:!!n.sheet}}),width:innerWidth}');
    const required = ['styles/tokens.css', 'styles/components.css', 'styles/layout.css'];
    const stylesOk = required.every(function (rel) {
      return state.styles.some(function (item) { return item.href === rel && item.loaded; });
    });
    suite.metric('assets', state.styles);
    suite.ok(state.build === H.BUILD && state.hasUi && state.filters && stylesOk,
      'asar 页面加载匹配构建号、ui.js API 与三个外部样式（' + JSON.stringify(state) + ')');

    state = await H.evalJson(win,
      'go("stat");var grid=document.querySelector("#page-stat .stat-grid"),nav=document.querySelector("#app > .tabbar");return {active:document.getElementById("page-stat").classList.contains("active"),columns:grid?getComputedStyle(grid).gridTemplateColumns.split(" ").length:0,nav:nav?getComputedStyle(nav).position:"missing",navWidth:nav?Math.round(nav.getBoundingClientRect().width):0}');
    suite.ok(state.active && state.columns === 5 && state.nav === 'absolute' && state.navWidth >= 160,
      'asar 宽屏统计五列与侧边导航样式生效（' + JSON.stringify(state) + ')');

    const noteId = 'packed_smoke_' + Date.now();
    await H.evalJson(win,
      'data.memoNotes=[{id:' + JSON.stringify(noteId) + ',ts:Date.now(),ord:0,title:"打包验证便签",text:"外部资源可以保存数据。",html:"<p>外部资源可以保存数据。</p>",pin:false}];data.memo={html:"",text:""};saveMemoFields();return true');
    await H.sleep(350);
    try { win.destroy(); } catch (_) {}
    win = await openPackedPage(suite, archive);
    state = await H.evalJson(win,
      'go("memo");renderMemoList();var note=(data.memoNotes||[]).find(function(n){return n.id===' + JSON.stringify(noteId) + '});return {found:!!note,title:note&&note.title,text:note&&note.text,list:document.getElementById("memoList").innerText.slice(0,120)}');
    suite.ok(state.found && state.title === '打包验证便签' && state.text.indexOf('外部资源') >= 0,
      'asar 页面写入的便签在隔离 profile 重载后保留（' + JSON.stringify(state) + ')');

    suite.metric('archive', path.relative(H.ROOT, archive));
    suite.metric('profile', path.relative(H.ROOT, profile));
    await H.drainPageErrs(win, suite);
  } catch (error) {
    suite.errs.push('打包页面回归异常: ' + String((error && error.stack) || error).slice(0, 1200));
  } finally {
    try { if (win) win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
