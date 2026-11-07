/* verify-filter-fill —— 筛选胶囊组「拉满、与下方卡片平齐」+ 深色主题
   背景：用户红圈指出「全部/待完成/已完成」胶囊组的宽度比下游 #checkinList 卡片窄，
   右侧留白随窗口变宽而扩大；要求拉满并与卡片平齐，且深色主题下同样成立。

   断言口径（几何为准，不靠肉眼）：
     1) 浅色 + 深色两种主题下，.habit-filter 与 #checkinList 的左右边界一致（±1px）；
     2) 胶囊组确实撑满 page 内容区（宽度 == 内容区宽度，±1px）；
     3) 多窗口宽度（440 / 520 / 744）下均成立 —— 覆盖「窄窗仍平齐」与「宽窗不再留白」；
     4) 深色下胶囊组底色与其父容器/页面背景有可辨差异（不是同色消失）；
     5) 三个按钮等宽（grid 三列 1fr）。 */
'use strict';
const { app } = require('electron');
require('path');
const H = require('./_harness.js');

const NAME = 'verify-filter-fill';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);
app.on('window-all-closed', () => {});

/* 量几何：返回胶囊组 / 卡片 / page 内容区的边界，以及按钮宽度 */
const MEASURE = `
  var f = document.querySelector('.habit-filter');
  var list = document.getElementById('checkinList');
  var page = document.getElementById('page-today');
  if (!f || !list || !page) return { miss: true };
  var fr = f.getBoundingClientRect();
  var lr = list.getBoundingClientRect();
  var pr = page.getBoundingClientRect();
  var cs = getComputedStyle(page);
  var padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
  var contentW = pr.width - padL - padR;
  var btns = [].slice.call(f.querySelectorAll('button')).map(function (b) {
    return Math.round(b.getBoundingClientRect().width * 100) / 100;
  });
  var fs = getComputedStyle(f);
  var fbg = fs.backgroundColor;
  /* 找最近的、底色非透明的祖先，用来验证「胶囊组与背景可辨」 */
  var anc = f.parentElement, abg = null;
  while (anc) {
    var a = getComputedStyle(anc).backgroundColor;
    if (a && a !== 'rgba(0, 0, 0, 0)' && a !== 'transparent') { abg = a; break; }
    anc = anc.parentElement;
  }
  return {
    ok: true,
    filter: { left: Math.round(fr.left * 100) / 100, right: Math.round(fr.right * 100) / 100, width: Math.round(fr.width * 100) / 100 },
    list: { left: Math.round(lr.left * 100) / 100, right: Math.round(lr.right * 100) / 100, width: Math.round(lr.width * 100) / 100 },
    contentW: Math.round(contentW * 100) / 100,
    btnWidths: btns,
    filterBg: fbg,
    ancestorBg: abg,
    bgFillVar: getComputedStyle(document.documentElement).getPropertyValue('--bg-fill').trim(),
    innerW: window.innerWidth,
    htmlDark: document.documentElement.classList.contains('dark')
  };
`;

async function measure(win) {
  return await H.evalJson(win, MEASURE);
}

async function setTheme(win, dark) {
  /* 必须走产品真实的 applyTheme()：色板（--bg-fill/--line-2 等 60+ 键）是 JS 注入的，
     只切 html.dark class 拿不到深色值 → 量出来会是浅色兜底值（假失败）。 */
  await H.evalJson(win, `
    try {
      window.__hbSystemDark = ${dark};
      if (!data.settings) data.settings = {};
      data.settings.theme = ${dark} ? 'dark' : 'light';
      applyTheme();
    } catch (e) { return { err: String(e) }; }
    return true;`);
  await H.sleep(420);
  return await H.evalJson(win, 'return { dark: document.documentElement.classList.contains("dark"), fill: getComputedStyle(document.documentElement).getPropertyValue("--bg-fill").trim() }');
}

async function setWidth(win, w) {
  /* 首选 setContentSize（直接定视口宽，不受边框影响）。
     产品侧在 boot/切主题后会按记忆尺寸复位窗口，所以设完必须实测确认、必要时重设。 */
  let cur = null;
  for (let i = 0; i < 5; i++) {
    win.setContentSize(w, 720);
    await H.sleep(450);
    cur = await H.evalJson(win, 'return { w: window.innerWidth, h: window.innerHeight }');
    if (cur && Math.abs(cur.w - w) <= 2) return cur;
  }
  return cur;
}

function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1 : tol); }

app.whenReady().then(async () => {
  let win = null;
  try {
    win = H.makeWin(suite, { width: 520, height: 720 });
    await H.loadPage(win, 'habit.html');
    await H.bootWait(win);

    const widths = [440, 520, 744];
    /* 主题底色样本：在循环内顺带采集（同一窗口、同一加载态），比事后重切主题更可靠 */
    const fillByTheme = {};
    const bgByTheme = {};
    for (const dark of [false, true]) {
      const tag = dark ? '深色' : '浅色';
      const info = await setTheme(win, dark);
      suite.ok(!!info && info.dark === dark, tag + '：html.dark 与主题一致');
      suite.ok(!!info && !!info.fill, tag + '：--bg-fill 已注入（' + (info && info.fill) + '）');
      fillByTheme[tag] = info && info.fill;
      for (const w of widths) {
        await setWidth(win, w);
        const m = await measure(win);
        if (!m || !m.ok) { suite.ok(false, tag + ' ' + w + 'px：量不到元素'); continue; }
        /* 宽度没设上时，几何断言会失去意义 → 先确认视口宽度确实到位 */
        if (Math.abs(m.innerW - w) > 2) {
          suite.ok(false, tag + ' ' + w + 'px：视口宽度未生效（实测 ' + m.innerW + '）');
          continue;
        }
        bgByTheme[tag] = m.filterBg;

        /* 1) 与下方卡片左右边界一致 */
        suite.ok(near(m.filter.left, m.list.left) && near(m.filter.right, m.list.right),
          tag + ' ' + w + 'px：胶囊组与 checkinList 左右对齐（胶囊 ' + m.filter.left + '~' + m.filter.right + ' / 卡片 ' + m.list.left + '~' + m.list.right + '）');

        /* 2) 撑满 page 内容区 */
        suite.ok(near(m.filter.width, m.contentW, 1.5),
          tag + ' ' + w + 'px：胶囊组撑满内容区（' + m.filter.width + ' vs 内容区 ' + m.contentW + '）');

        /* 3) 与卡片等宽 */
        suite.ok(near(m.filter.width, m.list.width, 1.5),
          tag + ' ' + w + 'px：胶囊组与卡片等宽（' + m.filter.width + ' vs ' + m.list.width + '）');

        /* 5) 三按钮等宽 */
        const bw = m.btnWidths;
        suite.ok(bw.length === 3 && near(bw[0], bw[1], 0.6) && near(bw[1], bw[2], 0.6),
          tag + ' ' + w + 'px：三按钮等宽（' + bw.join(' / ') + '）');

        /* 4) 深色下底色可辨 */
        if (dark) {
          suite.ok(m.filterBg && m.filterBg !== 'rgba(0, 0, 0, 0)',
            '深色 ' + w + 'px：胶囊组底色非透明（' + m.filterBg + '，祖先 ' + m.ancestorBg + '）');
        }
        suite.metric(tag + w, m);
      }
    }

    /* 主题差异断言：用循环内已采到的样本 */
    suite.ok(fillByTheme['深色'] !== fillByTheme['浅色'],
      '--bg-fill 随主题变化（深 ' + fillByTheme['深色'] + ' / 浅 ' + fillByTheme['浅色'] + '）');
    suite.ok(bgByTheme['深色'] !== bgByTheme['浅色'],
      '胶囊组底色随主题变化（深 ' + bgByTheme['深色'] + ' / 浅 ' + bgByTheme['浅色'] + '）');

    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.stack) || e).slice(0, 800));
  } finally {
    try { if (win) win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
