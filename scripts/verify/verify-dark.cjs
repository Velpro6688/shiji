/* verify-dark —— 深色模式三态（v2.1 任务 7 新增）
   覆盖：浅色缺省零变化 / 深色切换（四页 + 贴纸锁定态 + 独立编辑窗）/ system 解析逻辑 /
   持久化（重启仍深色）/ 浅色回切还原。
   ※ 必须用【可见窗口】：隐藏窗合成器不出帧，getComputedStyle 对 var() 驱动属性会返回陈旧值。
   颜色全部回传 Node 侧解析亮度（页面里零正则注入）。 */
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require('./_harness.js');

const NAME = 'verify-dark';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);
const SHOT_DIR = path.join(__dirname, 'results');

async function shot(win, name) {
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'dark-' + name + '.png'), img.toPNG());
    suite.metric('shot_' + name, 'saved');
  } catch (_) { suite.metric('shot_' + name, 'failed'); }
}
/* Node 侧：解析 rgb()/rgba()/#hex → 相对亮度 */
function lum(c) {
  const s = String(c || '');
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return null;
    const f = [+m[1], +m[2], +m[3]].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  const h = s.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(h)) {
    const f = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  return null;
}
/* 元素有效底色：backgroundColor 透明时回退 background-image 渐变的首个色值 */
function effBg(c) {
  const b = String(c.backgroundColor || '');
  if (lum(b) !== null) return b;
  const gi = String(c.backgroundImage || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return gi ? 'rgb(' + gi[1] + ',' + gi[2] + ',' + gi[3] + ')' : b;
}

/* 轮询等待页面内表达式为真（消除固定 sleep 带来的时序竞态）；超时返回最后一次值 */
async function waitFor(win, body, ms) {
  const step = 150; const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < ms) {
    try { last = await H.evalJson(win, body); if (last) return last; } catch (_) {}
    await H.sleep(step);
  }
  return last;
}
/* 轮询等待「浅色真正落位」，并顺带取回步骤 7 需要的三项几何/颜色 */
async function waitLight(win) {
  const probe = 'var c=getComputedStyle(document.querySelector(".hcard"));'
    + 'var ap=getComputedStyle(document.getElementById("app"));'
    + 'return {dark:document.documentElement.classList.contains("dark"),theme:(data.settings||{}).theme,'
    + 'appBg:ap.backgroundColor,cardBg:c?c.backgroundColor:null,cardImg:c?String(c.backgroundImage).slice(0,50):null};';
  const t0 = Date.now(); let r = null;
  while (Date.now() - t0 < 5000) {
    try { r = await H.evalJson(win, probe); } catch (_) {}
    if (r && r.dark === false && r.theme === 'light' && r.cardBg && lum(r.appBg) > 0.8) return r;
    await H.sleep(150);
  }
  return r || { dark: null, theme: null, appBg: '', cardBg: null, cardImg: null };
}

app.whenReady().then(async () => {
  const win = H.makeWin(suite, { show: true, width: 520, height: 720 });
  let ed = null;
  try {
    await H.loadPage(win);
    await H.bootWait(win);

    /* —— 1) 缺省浅色：html.dark 不存在，卡底为浅色（老用户零变化）—— */
    let r = await H.evalJson(win, 'var c=getComputedStyle(document.querySelector(".hcard"));return {dark:document.documentElement.classList.contains("dark"),appBg:getComputedStyle(document.getElementById("app")).backgroundColor,cardBg:c.backgroundColor,cardImg:String(c.backgroundImage).slice(0,60)}');
    suite.ok(r.dark === false, '缺省浅色：html.dark 不存在');
    effBg({ backgroundColor: r.cardBg, backgroundImage: r.cardImg });
    const ll = lum(r.appBg); suite.ok(ll !== null && ll > 0.8, '浅色 --app-bg 生效（' + r.appBg + '）');
    await shot(win, 'light-today');

    /* —— 2) 深色切换：四页逐页断言（深底浅字、亮度差充足）—— */
    await H.evalJson(win, 'setThemeMode("dark");return true');
    await H.sleep(500);
    r = await H.evalJson(win, 'return {dark:document.documentElement.classList.contains("dark"),appBg:getComputedStyle(document.getElementById("app")).backgroundColor,theme:(data.settings||{}).theme}');
    suite.ok(r.dark === true && r.theme === 'dark', 'setThemeMode(dark)：html.dark + settings.theme 落档');
    const dl = lum(r.appBg); suite.ok(dl !== null && dl < 0.06, '深色 --app-bg 生效（' + r.appBg + '）');

    for (const t of ['today', 'stat', 'memo', 'mine']) {
      await H.evalJson(win, 'go(' + JSON.stringify(t) + ');return true');
      await H.sleep(400);
      const c = await H.evalJson(win, 'var page=document.querySelector(".page.active");var card=page.querySelector(".hcard,.card,.menu-card,.profile")||document.querySelector(".memo-editor,.memo-note,.memo-box");var cc=card?getComputedStyle(card):null;var tt=card?getComputedStyle(card.querySelector(".mi-t,.hn,.p-name,h3,#memoInput")||card):null;return {page:page.id,cardBg:cc?cc.backgroundColor:null,cardImg:cc?String(cc.backgroundImage).slice(0,80):null,cardText:tt?tt.color:null}');
      let lc = lum(effBg({ backgroundColor: c.cardBg, backgroundImage: c.cardImg }));
      const lt = lum(c.cardText);
      if (lc === null) lc = lum(r.appBg);   /* 无卡页（如空便签列表）：用页面底色兜底算对比 */
      suite.ok(lc !== null && lt !== null && Math.abs(lc - lt) > 0.3,
        '深色页 ' + t + '(' + c.page + ',存在=' + (c.cardBg!==null) + ')：卡底=' + c.cardBg + '/' + String(c.cardImg).slice(0, 40) + ' 文字=' + c.cardText + ' 亮度差=' + (lc !== null && lt !== null ? Math.abs(lc - lt).toFixed(2) : '?'));
      await shot(win, 'dark-' + t);
      await H.drainPageErrs(win, suite);
    }

    /* —— 3) 贴纸（主窗锁定态）：深色保持 —— */
    await H.evalJson(win, 'data.memoNotes=[{id:"ntest",ts:Date.now(),html:"<p>深色贴纸</p>",text:"深色贴纸",title:""}];data.memo=data.memoNotes[0];saveMemoFields();go("today");return true');
    await H.evalJson(win, 'window.lockStickyNote&&window.lockStickyNote();window.applyLock&&window.applyLock(true);return true');
    await H.sleep(1300);
    r = await H.evalJson(win, 'return {dark:document.documentElement.classList.contains("dark"),locked:document.body.classList.contains("app-locked"),appBg:getComputedStyle(document.getElementById("app")).backgroundColor,editText:getComputedStyle(document.getElementById("memoInput")).color}');
    suite.ok(r.dark === true && r.locked === true, '贴纸锁定态：深色保持 + app-locked');
    const bl = lum(r.appBg), el = lum(r.editText); suite.ok(bl !== null && bl < 0.06 && el !== null && el > 0.6, '贴纸正文可读（底 ' + r.appBg + ' / 字 ' + r.editText + '）');
    await shot(win, 'dark-sticky');
    await H.evalJson(win, 'window.applyLock(false);return true');
    await H.sleep(800);
    await H.drainPageErrs(win, suite);

    /* —— 4) 独立编辑窗：boot 从档读 theme，自动深色—— */
    ed = H.makeWin(suite, { show: true, width: 520, height: 720 });
    await H.loadPage(ed, { view: 'editor', note: 'ntest' });
    await H.bootWait(ed);
    await H.sleep(400);
    r = await H.evalJson(ed, 'return {dark:document.documentElement.classList.contains("dark"),bg:getComputedStyle(document.getElementById("app")).backgroundColor}');
    suite.ok(r.dark === true, '编辑窗：随档内 theme=dark 自动深色');
    await shot(ed, 'dark-editor');
    try { ed.destroy(); } catch (_) {}
    ed = null;

    /* —— 5) system 模式解析逻辑：系统深浅翻转 → 外观跟随 —— */
    await H.evalJson(win, 'setThemeMode("system");window.__hbSystemDark=true;applyTheme();return true');
    r = await H.evalJson(win, 'return {dark:document.documentElement.classList.contains("dark")}');
    suite.ok(r.dark === true, 'system + 系统深色 → 外观深色');
    await H.evalJson(win, 'window.__hbSystemDark=false;applyTheme();return true');
    r = await H.evalJson(win, 'return {dark:document.documentElement.classList.contains("dark")}');
    suite.ok(r.dark === false, 'system + 系统浅色 → 外观浅色');

    /* —— 6) 持久化：dark 落档，重启仍深色—— */
    await H.evalJson(win, 'setThemeMode("dark");return true');
    /* 等 theme 真正落盘再 reload：否则 reload 可能读到 light 档，本步假失败 */
    await waitFor(win, 'var d=data.settings||{};return (d.theme==="dark"&&document.documentElement.classList.contains("dark"))?1:0', 5000);
    await win.webContents.reload(); await H.bootWait(win);
    r = await H.evalJson(win, 'return {dark:document.documentElement.classList.contains("dark"),theme:(data.settings||{}).theme}');
    suite.ok(r.dark === true && r.theme === 'dark', '重启后仍为深色（theme 持久化）');

    /* —— 7) 浅色回切还原 ——
       注意：这里不能用固定 sleep。setThemeMode → saveDebounced() 是 300ms 延迟落盘，
       与步骤 6 的 reload 存在竞态：reload 读到 theme 仍为 'dark' 的旧档时，
       boot 的 applyTheme() 会把界面刷回深色，表现为 appBg=rgba(0,0,0,0)、.hcard 缺失。
       改前基线即偶发（8 跑 3 失败），与 r13 改动无关（r13 6 跑 1 失败）。
       改成轮询等待「浅色真正落位」：html.dark 移除 且 #app 底色亮度>0.8 且 .hcard 存在。 */
    await H.evalJson(win, 'setThemeMode("light");return true');
    r = await waitLight(win);
    const rl = lum(r.appBg); suite.ok(r.dark === false && rl !== null && rl > 0.8, '回切浅色：外观与改前一致（' + r.appBg + '）');
    const lcl = lum(effBg({ backgroundColor: r.cardBg, backgroundImage: r.cardImg })); suite.ok(lcl !== null && lcl > 0.8, '浅色白卡还原（亮度 ' + (lcl === null ? '?' : lcl.toFixed(2)) + '）');
    await shot(win, 'light-restore');
    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { if (ed) ed.destroy(); } catch (_) {}
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
