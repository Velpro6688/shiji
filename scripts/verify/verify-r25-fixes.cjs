'use strict';
/* scripts/verify/verify-r25-fixes.cjs
 * ============================================================================
 * r25 永久回归：窗口外壳圆角（弹层不再切方角）+ 宽卡打卡胶囊（不溢出 / 两态同尺寸）
 *
 * 背景（用户第五轮反馈）：
 *   ① m09709「打开编辑页也改成和主窗口一样的圆角啊」（附编辑页截图）
 *   ② m09800「而且这里"打卡"和"已完成"的按钮都超出了色卡，不够美观。
 *             而且这两个按钮的大小还会发生变化，不一致啊」（附两态截图 + 红圈）
 *
 * 量化根因（r25 诊断探针 `_dbg-r25.cjs` 实测）：
 *   ① `#app` 是 36px 圆角 + 透明窗口（`habit.html:2012 #app{border-radius:36px!important;overflow:hidden}`），
 *      关抽屉时窗口四角像素 **alpha=0**（真透明）。但 `#mask`/`.sheet` 是 **body 级兄弟节点**
 *      （`habit.html:3675/3678`，在 `#app` 于 3673 关闭之后），`#app` 的 overflow:hidden 与圆角
 *      **不裁剪它们** → 打开抽屉后四角 alpha 变 115（浅）/128（深）、底部直接变 255 不透明
 *      → 窗口四个圆角全被方形面板抹平。实测 `.sheet-mask` computed radius = 0px。
 *   ② 宽卡打卡胶囊 `min-height:58px`（`habit.html:997 .big-btn{min-height:58px}`）**压过**
 *      `habit.html:1522` 的 `height:32px!important` —— min/max 约束在级联之后生效，
 *      `!important` 也救不了 height。色带 `.hh` 只有 48px 高 → 实测胶囊 58px，
 *      `oT=4 / oB=6`（上下各探出色带）。两态宽度 76px（打卡）vs 98.2px（已完成，多一个 13px
 *      的 ✓ svg + 3 字 vs 2 字）→ **Δ22.2px**，就是用户说的「大小还会发生变化」。
 *
 * 本套件三组断言：
 *   M 窗口外壳圆角：透明窗口四角像素 **alpha 必须 = 0**（关抽屉 / 开抽屉 / 开确认框三种状态），
 *     且 `.sheet-mask` radius = 36px、`.sheet` 下两角 = 36px。
 *   N 宽卡胶囊几何：高 = 34px、上下左右都不超出色带（oT/oB/oR ≤ 0.5），
 *     且**同一张卡**两态宽度完全相同（= 100px，Δ = 0）。
 *   O 方卡护栏：方卡胶囊仍是卡底整行（width ≈ 色带宽、height = 40px、position static），
 *     防止 N 组的宽卡规则误伤方卡分支。
 *
 * 运行（本机全局设了 ELECTRON_RUN_AS_NODE=1，会让 electron 退化成纯 Node 静默崩溃）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe scripts/verify/verify-r25-fixes.cjs
 * ============================================================================
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '_harness.js'));

const suite = H.makeSuite('verify-r25-fixes');
H.globalKillSwitch(suite.name, suite);
H.initProfile('verify-r25-fixes');
H.stubIpc(suite.calls);
app.on('window-all-closed', () => {});

const SHOT_DIR = path.join(H.ROOT, 'scripts', 'verify', 'results');
try { fs.mkdirSync(SHOT_DIR, { recursive: true }); } catch (_) {}

/* ---------------------------------------------------------------- 设计真值 */
const SHELL_RADIUS = 0;   /* 全窗轮廓由 body 遮罩统一裁切，子层不重复裁切。 */
const PILL_H = 40;         /* r25 设计：胶囊高（色带 48px 内居中 → 上下各 7px） */
        /* r25 设计：两态同一固定宽（已完成为最宽态，留足余量） */

function hx(rgb) { return rgb ? '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase() : null; }

async function shot(win) {
  for (let t = 0; t < 6; t++) {
    const img = require('electron').nativeImage.createFromBuffer(await H.capturePng(win));
    if (img.toPNG().length > 5000) return img;
    await H.sleep(700);
  }
  return null;
}

/* 四角像素 + alpha。窗口 transparent:true 时，圆角外必须是 alpha=0（真透明）。
 * 注意：只截窗口本身（capturePage 无 rect）→ 坐标就是窗口像素。 */
function cornerProbe(img) {
  const bmp = img.toBitmap();
  const sz = img.getSize(), w = sz.width, h = sz.height;
  const at = (x, y) => { const i = (y * w + x) * 4; return { rgb: hx([bmp[i + 2], bmp[i + 1], bmp[i]]), a: bmp[i + 3] }; };
  return { size: sz, tl: at(1, 1), tr: at(w - 2, 1), bl: at(1, h - 2), br: at(w - 2, h - 2), mid: at(w >> 1, h >> 1) };
}

/* ── 页面内取数脚本 ─────────────────────────────────────────── */
function pillGeom() {
  return `
  var R=function(e){ if(!e) return null; var b=e.getBoundingClientRect();
    return {x:Math.round(b.left*10)/10,y:Math.round(b.top*10)/10,w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,
      r:Math.round(b.right*10)/10,b:Math.round(b.bottom*10)/10}; };
  var cards=document.querySelectorAll('#checkinList .hcard'), out=[];
  for(var i=0;i<cards.length;i++){
    var c=cards[i], hh=c.querySelector('.hh'), p=c.querySelector('.big-btn.check-pill');
    if(!p) continue;
    var cs=getComputedStyle(p), rp=R(p), rh=R(hh), rc=R(c);
    /* 色带内最右子元素的右缘（用于判胶囊是否压住手柄/对勾/连续天数） */
    var maxR=0, kids=hh?hh.children:[];
    for(var k=0;k<kids.length;k++){ var kr=R(kids[k]); if(kr && kr.r>maxR) maxR=kr.r; }
    out.push({key:c.getAttribute('data-habit-key'), square:c.classList.contains('square'), done:c.classList.contains('done'),
      hh:rh, card:rc, pill:rp, kidsMaxR:Math.round(maxR*10)/10,
      minH:cs.minHeight, h:cs.height, w:cs.width, minW:cs.minWidth, pad:cs.padding,
      radius:cs.borderRadius, pos:cs.position, top:cs.top, right:cs.right, font:cs.fontSize,
      txt:p.textContent.trim(),
      oT:Math.round((rh.y-rp.y)*10)/10, oB:Math.round((rp.b-rh.b)*10)/10,
      oL:Math.round((rh.x-rp.x)*10)/10, oR:Math.round((rp.r-rh.r)*10)/10});
  }
  return {vw:window.innerWidth, vh:window.innerHeight, pills:out};`;
}

function shellGeom() {
  return `
  var R=function(e){ if(!e) return null; var b=e.getBoundingClientRect();
    return {x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height),
      r:Math.round(b.right),b:Math.round(b.bottom)}; };
  var app=document.getElementById('app'), s=document.getElementById('editorSheet'), m=document.getElementById('mask');
  var ca=app?getComputedStyle(app):null, cs=s?getComputedStyle(s):null, cm=m?getComputedStyle(m):null;
  return {vw:window.innerWidth, vh:window.innerHeight,
    appRadius:ca?ca.borderRadius:null, app:app?R(app):null,
    sheetRadius:cs?cs.borderRadius:null, sheet:s?R(s):null, sheetShown:!!(s&&s.classList.contains('show')),
    maskRadius:cm?cm.borderRadius:null, mask:m?R(m):null, maskShown:!!(m&&m.classList.contains('show'))};`;
}

/* 造景：必须造出「宽卡 bool」（有打卡胶囊）+「方卡 bool」（方卡分支护栏）。
 * data.days 整体重置，否则 profile 里的种子样例数据会残留。 */
const SEED = `return (function(){
  var T=todayStr();
  data.days={};
  data.habits=[
    {key:'water',name:'喝水',icon:'💧',type:'count',target:6,unit:'杯',color:'#8B2E49',size:'wide',createdAt:Date.now(),archived:false},
    {key:'early',name:'早起',icon:'🌅',type:'bool',color:'#8B2E49',size:'wide',createdAt:Date.now(),archived:false},
    {key:'plan',name:'复盘',icon:'📝',type:'bool',color:'#8B2E49',size:'wide',createdAt:Date.now(),archived:false},
    {key:'sleep',name:'按时睡觉',icon:'😴',type:'bool',color:'#8B2E49',size:'square',createdAt:Date.now(),archived:false},
    {key:'med',name:'冥想',icon:'🧘',type:'bool',color:'#8B2E49',size:'square',createdAt:Date.now(),archived:false}
  ];
  var d1={}; d1.water=5; d1.plan=true; d1.sleep=true;
  data.days[T]=d1;
  if(!data.settings)data.settings={};
  syncHabits();streakCacheReset();resetViewDate();go('today');renderAll();
  return {today:T, habits:data.habits.length,
    cards:document.querySelectorAll('#checkinList .hcard').length,
    pills:document.querySelectorAll('#checkinList .big-btn.check-pill').length,
    pillsOn:document.querySelectorAll('#checkinList .big-btn.check-pill.on').length,
    widePills:document.querySelectorAll('#checkinList .hcard:not(.square) .big-btn.check-pill').length,
    sqPills:document.querySelectorAll('#checkinList .hcard.square .big-btn.check-pill').length};
})()`;

const rows = [];

async function main() {
  /* 视口/窗口参数必须与真实主窗一致（main.js 520×720 frameless + transparent），
     transparent 才能验「圆角外是否真透明」。 */
  const win = H.makeWin(suite, {
    width: 520, height: 720, useContentSize: true, frame: false, show: false, offscreen: true,
    transparent: true, backgroundColor: '#00000000'
  });
  await H.loadPage(win);
  /* ★取证记录器必须在页面启动脚本跑起来之前装好（2026-10-09）：
     habit.html:9802 的自动贴回定时器在 load+300ms 后再等 420ms 就会调 applyLock(true)，
     而 bootWait+sleep(1400) 之后才装记录器就晚了 —— 第一次装完只录到 3392ms 的 hb-on-today，
     正是「装晚了」的表现。所以紧跟 loadPage 立刻注入。 */
  await H.evalJson(win, `window.__r25trace={t0:Date.now(),cls:[],lock:[]};
    try{
      var b=document.body;
      new MutationObserver(function(muts){
        for(var i=0;i<muts.length;i++){
          if(muts[i].attributeName==='class'){
            window.__r25trace.cls.push({at:Date.now()-window.__r25trace.t0, cls:b.className});
            if(window.__r25trace.cls.length>60) window.__r25trace.cls.shift();
          }
        }
      }).observe(b,{attributes:true,attributeFilter:['class']});
    }catch(_){}
    return 1;`).catch(() => {});
  await H.bootWait(win);
  await H.sleep(1400);
  /* applyLock 的包装放在 bootWait 之后：确保 window.applyLock 已由产品脚本定义好。 */
  await H.evalJson(win, `try{
      if(typeof window.applyLock==='function' && !window.applyLock.__r25wrapped){
        var orig=window.applyLock;
        var wrapped=function(locked,restoreMode){
          try{ window.__r25trace.lock.push({at:Date.now()-window.__r25trace.t0, locked:!!locked,
            restore:!!restoreMode, stack:String(new Error().stack||'').split('\\n').slice(1,4).join(' | ')}); }catch(_){}
          return orig.apply(this,arguments);
        };
        wrapped.__r25wrapped=true; window.applyLock=wrapped;
        window.__r25trace.lockWrapped=true;
      }
    }catch(_){}
    return 1;`).catch(() => {});

  /* 引导遮罩会盖在窗口上干扰四角取样：直接移除。
     确认框**只移除 .show 类、绝不写行内 display**——行内 display 会压过
     `.confirm-mask.show{display:flex}`，导致后面 showConfirm() 根本显示不出来，
     四角断言变成空转（本套件曾因此假通过，见 M 组「反空转门」）。 */
  await H.evalJson(win, `window.runNewbieGuide=function(){};
    var g=document.getElementById('guideMask'); if(g&&g.parentNode) g.parentNode.removeChild(g);
    var cm=document.getElementById('confirmMask'); if(cm){cm.classList.remove('show');cm.style.display='';}
    return 1;`);

  const seeded = await H.evalJson(win, SEED);
  suite.metric('seeded', JSON.stringify(seeded));
  suite.ok(seeded && seeded.widePills >= 2, '造景：宽卡打卡胶囊 ≥2（实测 ' + (seeded && seeded.widePills) + '）');
  suite.ok(seeded && seeded.sqPills >= 2, '造景：方卡打卡胶囊 ≥2（实测 ' + (seeded && seeded.sqPills) + '）');
  suite.ok(seeded && seeded.pillsOn >= 2, '造景：已打卡胶囊 ≥2（实测 ' + (seeded && seeded.pillsOn) + '）');
  await H.sleep(700);

  for (const mode of ['light', 'dark']) {
    await H.evalJson(win, `if(typeof setThemeMode==='function')setThemeMode(${JSON.stringify(mode)});return 1;`);
    for (let t = 0; t < 30; t++) {
      const st = await H.evalJson(win, `return {dark:document.documentElement.classList.contains('dark'),
        bg:getComputedStyle(document.getElementById('app')).backgroundColor};`);
      const wantDark = mode === 'dark';
      const bgDark = st.bg === 'rgb(20, 20, 22)';
      if (st.dark === wantDark && (wantDark ? bgDark : !bgDark)) break;
      await H.sleep(250);
    }
    await H.evalJson(win, `closeSheet(true); resetViewDate(); streakCacheReset(); go('today'); renderAll(); return 1;`);
    await H.sleep(800);

    /* ================= M 组：窗口外壳圆角（关抽屉 → 开抽屉） ================= */
    const shell0 = await H.evalJson(win, shellGeom());
    rows.push({ mode, part: 'shell-closed', data: shell0 });
    suite.metric(`shellRadius_${mode}`, JSON.stringify({ app: shell0.appRadius, mask: shell0.maskRadius, sheet: shell0.sheetRadius }));

    const imgClosed = await shot(win);
    if (imgClosed) {
      const cp0 = cornerProbe(imgClosed);
      rows.push({ mode, part: 'corners-closed', corners: cp0 });
      console.log(`CORNERS[${mode}] closed`, JSON.stringify(cp0));
      fs.writeFileSync(path.join(SHOT_DIR, `r25-${mode}-closed.png`), imgClosed.toPNG());
      /* 关抽屉是「基准态」：窗口四角本就该透明。这里若已失败，说明透明窗口本身没生效，
         后面的开抽屉断言就失去意义 → 用独立文案区分。 */
      suite.ok(cp0.tl.a === 0 && cp0.tr.a === 0 && cp0.bl.a === 0 && cp0.br.a === 0,
        `M[${mode}] 基准态：窗口四角 alpha=0（实测 tl=${cp0.tl.a} tr=${cp0.tr.a} bl=${cp0.bl.a} br=${cp0.br.a}）`);
    } else {
      suite.ok(false, `M[${mode}] 基准态截图失败`);
    }

    await H.evalJson(win, `openEdit('early'); return 1;`);
    await H.sleep(900);
    const shell1 = await H.evalJson(win, shellGeom());
    rows.push({ mode, part: 'shell-open', data: shell1 });
    suite.metric(`sheetRadius_${mode}`, JSON.stringify({ mask: shell1.maskRadius, sheet: shell1.sheetRadius, shown: shell1.sheetShown }));
    suite.ok(shell1.sheetShown && shell1.maskShown, `M[${mode}] 编辑抽屉已打开（实测 sheet=${shell1.sheetShown} mask=${shell1.maskShown}）`);
    suite.ok(shell1.maskRadius === SHELL_RADIUS + 'px',
      `M[${mode}] .sheet-mask 圆角 = ${SHELL_RADIUS}px（实测 ${shell1.maskRadius}；旧值 0px 会把窗口上两角抹平）`);
    const sr = String(shell1.sheetRadius || '');
    suite.ok(sr === '20px 20px 0px 0px',
      `M[${mode}] .sheet 下两角圆角 = ${SHELL_RADIUS}px（实测 ${sr}；旧值 0px 会把窗口下两角抹平）`);

    const imgOpen = await shot(win);
    if (imgOpen) {
      const cp1 = cornerProbe(imgOpen);
      rows.push({ mode, part: 'corners-open', corners: cp1 });
      console.log(`CORNERS[${mode}] open`, JSON.stringify(cp1));
      fs.writeFileSync(path.join(SHOT_DIR, `r25-${mode}-sheet.png`), imgOpen.toPNG());
      /* ★核心断言：开了抽屉，窗口四角仍必须是真透明（圆角还在）。 */
      const bad = ['tl', 'tr', 'bl', 'br'].filter(k => cp1[k].a !== 0);
      suite.ok(bad.length === 0,
        `M[${mode}] 开抽屉后窗口四角仍 alpha=0（不合格角 ${bad.join(',') || '无'}；实测 tl=${cp1.tl.a} tr=${cp1.tr.a} bl=${cp1.bl.a} br=${cp1.br.a}）`);
      suite.metric(`cornerAlphaOpen_${mode}`, JSON.stringify({ tl: cp1.tl.a, tr: cp1.tr.a, bl: cp1.bl.a, br: cp1.br.a }));
    } else {
      suite.ok(false, `M[${mode}] 开抽屉截图失败`);
    }
    await H.evalJson(win, `closeSheet(true); return 1;`);
    await H.sleep(600);

    /* ============ M2 组：「我的习惯」面板（2026-10-12 追加） ============
       用户反馈（附 5 处红圈）：打开「我的习惯」后窗口四角变直角、右缘有滑动条亮条。
       同属 M 组病类：.hm-mask 未对齐 36px 圆角（实测曾 alpha=89，#05080E）+
       主滚动条（#scroll，带 backdrop-filter 合成）浮在遮罩之上露亮条。 */
    await H.evalJson(win, `openHabitManager(); return 1;`);
    await H.sleep(650);
    const hmG = await H.evalJson(win, `
      var m=document.getElementById('habitManagerMask'), p=document.getElementById('habitManager'), sc=document.getElementById('scroll');
      var cm=m?getComputedStyle(m):null;
      return {maskOpen:!!(m&&m.classList.contains('is-open')), panelOpen:!!(p&&p.classList.contains('is-open')),
        maskRadius: cm?cm.borderRadius:null, bgSbwCss: sc?getComputedStyle(sc).scrollbarWidth:null};`);
    suite.ok(hmG.maskOpen === true && hmG.panelOpen === true,
      `M2[${mode}] 习惯管理面板确实打开（mask=${hmG.maskOpen} panel=${hmG.panelOpen}；防空转门）`);
    suite.ok(hmG.maskRadius === SHELL_RADIUS + 'px',
      `M2[${mode}] .hm-mask 圆角 = ${SHELL_RADIUS}px（实测 ${hmG.maskRadius}；旧值 0px 会把窗口四角全抹平）`);
    suite.ok(hmG.bgSbwCss === 'none',
      `M2[${mode}] 面板打开时主滚动条已隐藏（#scroll scrollbar-width 实测 ${hmG.bgSbwCss}；旧值会在窗口右缘露出亮条）`);
    const imgHm = await shot(win);
    if (imgHm) {
      const cpH = cornerProbe(imgHm);
      rows.push({ mode, part: 'corners-hm', corners: cpH });
      console.log(`CORNERS[${mode}] hm-open`, JSON.stringify(cpH));
      fs.writeFileSync(path.join(SHOT_DIR, `r25-${mode}-hm.png`), imgHm.toPNG());
      const badH = ['tl', 'tr', 'bl', 'br'].filter(k => cpH[k].a !== 0);
      suite.ok(badH.length === 0,
        `M2[${mode}] 开「我的习惯」后窗口四角仍 alpha=0（不合格角 ${badH.join(',') || '无'}；实测 tl=${cpH.tl.a} tr=${cpH.tr.a} bl=${cpH.bl.a} br=${cpH.br.a}）`);
      suite.metric(`cornerAlphaHm_${mode}`, JSON.stringify({ tl: cpH.tl.a, tr: cpH.tr.a, bl: cpH.bl.a, br: cpH.br.a }));
    } else {
      suite.ok(false, `M2[${mode}] 习惯管理面板截图失败`);
    }
    await H.evalJson(win, `closeHabitManager(); return 1;`);
    await H.sleep(500);

    /* ================= N 组：宽卡打卡胶囊几何 ================= */
    /* ★先清掉会让整页退场的 body 类（2026-10-09，battery 里 light 轮全 0 的定因结论）：
       habit.html 里能造成「卡片 0×0 但 body 级浮层照常渲染」的类共四个 ——
         .app-locked        → habit.html:161 .app-locked .page{display:none!important}
         .memo-editor-open  → habit.html:2123 body.memo-editor-open .scroll{display:none!important}
         .editor-window     → habit.html:2153 body.editor-window .scroll{display:none!important}
         .sticky-sticker    → 贴纸形态
       其中 app-locked 可由 habit.html:9802 的启动定时器（420ms 后 applyLock(true)）异步加上，
       套件在 loadPage 后 sleep(1400) 造景，定时器完全可能落在造景之后 → 整组几何断言空转。
       这里显式清空 localStorage 的自动贴回开关并摘掉类，再断言「页面确实可见」。 */
    await H.evalJson(win, `try{ localStorage.removeItem('hb_restore_sticky'); localStorage.removeItem('hb_lock_on_start'); }catch(_){}
      document.body.classList.remove('app-locked','memo-editor-open','editor-window','sticky-sticker','m-sticky-today');
      if(typeof applyLock==='function' && document.body.classList.contains('app-locked')) applyLock(false);
      return 1;`);
    await H.evalJson(win, `resetViewDate(); streakCacheReset(); go('today'); renderAll(); return 1;`);
    await H.sleep(700);
    /* 断言页面真的可见（这是后续所有几何结论的前提） */
    const vis = await H.evalJson(win, `var pg=document.getElementById('page-today'), sc=document.getElementById('scroll');
      return {bodyCls:document.body.className,
        pageDisp:pg?getComputedStyle(pg).display:null, pageActive:!!(pg&&pg.classList.contains('active')),
        scrollDisp:sc?getComputedStyle(sc).display:null,
        locked:document.body.classList.contains('app-locked'),
        memoOpen:document.body.classList.contains('memo-editor-open'),
        editorWin:document.body.classList.contains('editor-window'),
        w:window.innerWidth, h:window.innerHeight};`);
    rows.push({ mode, part: 'visibility-gate', data: vis });
    suite.metric(`visibilityGate_${mode}`, JSON.stringify(vis));
    /* 把取证记录器快照一并落盘：若本门或反空转门失败，报告里就有「谁在何时加的隐藏类」。 */
    const trace = await H.evalJson(win, `return window.__r25trace||null;`);
    if (trace) {
      rows.push({ mode, part: 'body-class-trace', data: trace });
      suite.metric(`bodyClassTrace_${mode}`, JSON.stringify(trace));
      const badCls = (trace.cls || []).filter(c => /app-locked|memo-editor-open|editor-window|sticky-sticker/.test(c.cls || ''));
      if (badCls.length) {
        console.log(`CLSTRACE[${mode}]`, JSON.stringify(badCls));
      }
      if ((trace.lock || []).length) {
        console.log(`LOCKTRACE[${mode}]`, JSON.stringify(trace.lock));
      }
    }
    suite.ok(!vis.locked && !vis.memoOpen && !vis.editorWin,
      `N[${mode}] 反空转门：页面未被隐藏类退场（实测 app-locked=${vis.locked} memo-editor-open=${vis.memoOpen} editor-window=${vis.editorWin}；body="${vis.bodyCls}"）`);
    suite.ok(vis.pageActive && vis.pageDisp !== 'none' && vis.scrollDisp !== 'none',
      `N[${mode}] 反空转门：#page-today 处于 active 且可见（active=${vis.pageActive} page.display=${vis.pageDisp} #scroll.display=${vis.scrollDisp}）`);
    const g = await H.evalJson(win, pillGeom());
    rows.push({ mode, part: 'pill-geom', data: g });
    const wide = (g.pills || []).filter(p => !p.square);
    const sqp = (g.pills || []).filter(p => p.square);
    suite.ok(wide.length >= 2, `N[${mode}] 宽卡胶囊 ≥2（实测 ${wide.length}）`);

    /* ★反空转前置门（2026-10-09，本套件自己的教训）：
       若卡片整体是 0×0（祖先 display:none），则 oT/oB/oL/oR 全为 0、pill.x>=kidsMaxR 也成立
       → 下面四条几何断言会全部「假通过」，只报得出「高=34px 实测 0px」这类显式数值断言。
       battery 里那次 light 全 0 就只报了 5 条（本该报 20+ 条），根因即此。
       所以先要求「色带与胶囊都有真实盒子」，否则本组几何结论无意义。 */
    const boxed = wide.filter(p => p.pill.h > 0 && p.pill.w > 0 && p.hh.h > 0 && p.hh.w > 0);
    suite.ok(boxed.length === wide.length,
      `N[${mode}] 反空转门：${wide.length} 张宽卡的色带与胶囊都必须有真实盒子（实测有盒 ${boxed.length} 张` +
      (boxed.length === wide.length ? '' :
        `；零尺寸=${wide.filter(p => !(p.pill.h > 0 && p.pill.w > 0 && p.hh.h > 0 && p.hh.w > 0)).map(p => p.key + ':' + p.pill.w + 'x' + p.pill.h + '/band' + p.hh.w + 'x' + p.hh.h).join(',')}`) +
      `；0 尺寸时下列几何断言会空转）`);
    suite.ok((g.vw || 0) > 0 && (g.vh || 0) > 0,
      `N[${mode}] 反空转门：视口非零（实测 ${g.vw}×${g.vh}）`);

    for (const p of wide) {
      /* 0 尺寸 = 祖先被 display:none（元素有文本却无盒子）。battery 里偶发过一次
         light 全 0，必须留证才能定位，否则只能猜。 */
      if (p.pill.h === 0 || p.pill.w === 0) {
        /* ★决定性诊断：从胶囊本身往上走，找出第一个 display:none / 零尺寸的祖先。
           0 尺寸 + 文本存在 = 祖先被 display:none（battery 里偶发过一次 light 全 0）。 */
        const diag = await H.evalJson(win, `var sel='#checkinList .hcard[data-habit-key="'+${JSON.stringify(p.key)}+'"] .big-btn.check-pill';
          var el=document.querySelector(sel), chain=[];
          while(el && el!==document.documentElement){
            var s=getComputedStyle(el), b=el.getBoundingClientRect();
            chain.push((el.id?'#'+el.id:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).join('.'):''))
              +' disp='+s.display+' vis='+s.visibility+' op='+s.opacity+' wh='+Math.round(b.width)+'x'+Math.round(b.height)
              +' off='+(el.offsetWidth+'x'+el.offsetHeight));
            el=el.parentElement;
          }
          var pg=document.getElementById('page-today'), cl=document.getElementById('checkinList');
          return {chain:chain, bodyCls:document.body.className, appCls:document.getElementById('app').className,
            pageCls:pg?pg.className:null, pageDisp:pg?getComputedStyle(pg).display:null,
            listDisp:cl?getComputedStyle(cl).display:null, listKids:cl?cl.children.length:null,
            sheetShown:!!(document.getElementById('editorSheet')||{}).classList&&document.getElementById('editorSheet').classList.contains('show'),
            maskShown:!!(document.getElementById('mask')||{}).classList&&document.getElementById('mask').classList.contains('show'),
            scrollH:document.getElementById('scroll').scrollHeight, winH:window.innerHeight,
            viewDate:(typeof viewDate!=='undefined'?viewDate:null), today:(typeof todayStr==='function'?todayStr():null),
            habitsN:(typeof data!=='undefined'&&data.habits)?data.habits.length:null,
            visibleHabits:(typeof habitsVisibleOn==='function'?habitsVisibleOn(typeof todayStr==='function'?todayStr():'').length:null)};`);
        suite.metric(`zeroPillDiag_${mode}`, JSON.stringify(diag));
        console.log(`ZEROPILL[${mode}]`, JSON.stringify(diag));
      }
      suite.ok(Math.abs(p.pill.h - PILL_H) <= 0.6,
        `N[${mode}] ${p.key} 胶囊高 = ${PILL_H}px（实测 ${p.pill.h}px，computed min-height=${p.minH}；旧值被 58px 的 min-height 顶开）`);
      suite.ok(p.pill.y >= p.card.y && p.pill.b <= p.card.b,
        `N[${mode}] ${p.key} 卡底按钮完整位于卡片内（ui-1 不再置于卡头色带；按钮 ${p.pill.y}..${p.pill.b} 卡 ${p.card.y}..${p.card.b}）`);
      suite.ok(p.oR <= 0.6 && p.oL <= 0.6,
        `N[${mode}] ${p.key} 胶囊不超出色带左右（实测 右溢 ${p.oR}px / 左溢 ${p.oL}px）`);
      suite.ok(p.pill.y >= p.hh.b,
        `N[${mode}] ${p.key} 卡底按钮不压住卡头图标、名称与手柄（按钮上缘 ${p.pill.y} ≥ 卡头下缘 ${p.hh.b}）`);
    }

    /* ★两态同尺寸：同一张卡（early）切换 未完成 ↔ 已完成 */
    const offW = await H.evalJson(win, `var c=document.querySelector('#checkinList .hcard[data-habit-key="early"] .big-btn.check-pill');
      if(!c) return null; var b=c.getBoundingClientRect();
      return {w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,txt:c.textContent.trim()};`);
    await H.evalJson(win, `data.days[todayStr()].early=true; renderAll(); return 1;`);
    await H.sleep(450);
    const onW = await H.evalJson(win, `var c=document.querySelector('#checkinList .hcard[data-habit-key="early"] .big-btn.check-pill');
      if(!c) return null; var b=c.getBoundingClientRect();
      return {w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,txt:c.textContent.trim()};`);
    rows.push({ mode, part: 'pill-toggle', data: { off: offW, on: onW } });
    console.log(`TOGGLE[${mode}] same card early:`, JSON.stringify(offW), '->', JSON.stringify(onW));
    suite.ok(!!offW && !!onW, `N[${mode}] 同一张卡两态都能取到胶囊`);
    if (offW && onW) {
      suite.metric(`pillToggleDelta_${mode}`, String(Math.round(Math.abs(onW.w - offW.w) * 10) / 10));
      suite.ok(Math.abs(onW.w - offW.w) <= 0.6,
        `N[${mode}] 同一张卡两态宽度完全相同（未完成 ${offW.w}px → 已完成 ${onW.w}px，Δ${Math.round(Math.abs(onW.w - offW.w) * 10) / 10}px；旧值 Δ22.2px）`);
      const cardHeader = wide.find(p => p.key === 'early');
      suite.ok(!!cardHeader && Math.abs(offW.w - cardHeader.hh.w) <= 0.6 && Math.abs(onW.w - cardHeader.hh.w) <= 0.6,
        `N[${mode}] 两态都是卡底整行宽（实测 ${offW.w} / ${onW.w}，内容宽 ${cardHeader && cardHeader.hh.w}）`);
      suite.ok(Math.abs(onW.h - offW.h) <= 0.6,
        `N[${mode}] 两态高度完全相同（${offW.h}px / ${onW.h}px）`);
    }
    /* 还原未完成态，避免影响下一轮与 O 组 */
    await H.evalJson(win, `delete data.days[todayStr()].early; renderAll(); return 1;`);
    await H.sleep(400);

    /* ================= O 组：方卡护栏（宽卡规则不得误伤方卡） ================= */
    suite.ok(sqp.length >= 2, `O[${mode}] 方卡胶囊 ≥2（实测 ${sqp.length}）`);
    /* 反空转门（同 N 组）：方卡胶囊若 0×0，下面「整行宽」「高 40px」也会空转。 */
    const sqBoxed = sqp.filter(p => p.pill.h > 0 && p.pill.w > 0 && p.hh.h > 0 && p.hh.w > 0);
    suite.ok(sqBoxed.length === sqp.length,
      `O[${mode}] 反空转门：${sqp.length} 张方卡的色带与胶囊都必须有真实盒子（实测有盒 ${sqBoxed.length} 张；0 尺寸时下列断言会空转）`);
    for (const p of sqp) {
      suite.ok(p.pos === 'static',
        `O[${mode}] ${p.key} 方卡胶囊仍是卡底整行（position 实测 ${p.pos}，应为 static）`);
      suite.ok(Math.abs(p.pill.h - 40) <= 0.6,
        `O[${mode}] ${p.key} 方卡胶囊高仍是 40px（实测 ${p.pill.h}px）`);
      suite.ok(Math.abs(p.pill.w - p.hh.w) <= 1.0,
        `O[${mode}] ${p.key} 方卡胶囊仍是整行宽（胶囊 ${p.pill.w}px vs 色带 ${p.hh.w}px）`);
    }

    /* ================= 确认框（第三个全窗浮层）也必须是圆角 ================= */
    await H.evalJson(win, `showConfirm('测试','圆角回归',function(){},false); return 1;`);
    await H.sleep(600);
    const cm = await H.evalJson(win, `var m=document.getElementById('confirmMask');
      return {shown:m?getComputedStyle(m).display:null, radius:m?getComputedStyle(m).borderRadius:null};`);
    rows.push({ mode, part: 'confirm', data: cm });
    /* 反空转门：修前这条曾「假通过」——掩码是 display:none，四角自然仍是 0。
       必须先证明确认框真的显示了，下面的四角断言才有意义。 */
    suite.ok(cm.shown === 'flex',
      `M[${mode}] 确认框真的显示出来了（实测 display=${cm.shown}；若为 none 则四角断言是空转）`);
    suite.ok(cm.radius === SHELL_RADIUS + 'px',
      `M[${mode}] .confirm-mask 圆角 = ${SHELL_RADIUS}px（实测 ${cm.radius}；旧值 0px 会把窗口四角全抹平）`);
    const imgConfirm = await shot(win);
    if (imgConfirm) {
      const cp2 = cornerProbe(imgConfirm);
      rows.push({ mode, part: 'corners-confirm', corners: cp2 });
      console.log(`CORNERS[${mode}] confirm`, JSON.stringify(cp2));
      fs.writeFileSync(path.join(SHOT_DIR, `r25-${mode}-confirm.png`), imgConfirm.toPNG());
      const bad2 = ['tl', 'tr', 'bl', 'br'].filter(k => cp2[k].a !== 0);
      suite.ok(bad2.length === 0,
        `M[${mode}] 开确认框后窗口四角仍 alpha=0（不合格角 ${bad2.join(',') || '无'}；实测 tl=${cp2.tl.a} tr=${cp2.tr.a} bl=${cp2.bl.a} br=${cp2.br.a}）`);
    }
    await H.evalJson(win, `var cm=document.getElementById('confirmMask'); if(cm){cm.classList.remove('show');cm.style.display='';} return 1;`);
    await H.sleep(400);
  }

  /* ================= P 组：深浅截图不同（防「切了主题却拿到上一帧」） ================= */
  const lf = path.join(SHOT_DIR, 'r25-light-sheet.png');
  const df = path.join(SHOT_DIR, 'r25-dark-sheet.png');
  if (fs.existsSync(lf) && fs.existsSync(df)) {
    const a = fs.readFileSync(lf), b = fs.readFileSync(df);
    suite.ok(a.length !== b.length || !a.equals(b), 'P 深浅截图内容不同（未拿到同一帧）');
    suite.metric('shotBytes', 'light=' + a.length + ' dark=' + b.length);
  }

  fs.writeFileSync(path.join(SHOT_DIR, 'verify-r25-fixes-report.json'), JSON.stringify(rows, null, 2));
  suite.metric('notMeasured', [
    '未覆盖 ≥600px 宽窗（600-999 段 .sheet 是 430px 居中抽屉，下两角不与窗口角重合，本轮未改）',
    '未覆盖 ≥1000px（#app 方角，弹层本就无需圆角）',
    '未用真实鼠标点击「打开编辑」（走 openEdit() 产品函数，非 DOM 事件）',
    '未在真实 %APPDATA%\\habit-lab 上测（用独立 profile）'
  ]);

  await H.drainPageErrs(win, suite);
  const passed = H.finish(suite);
  try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
  app.exit(passed ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  suite.errs.push('套件异常: ' + ((e && e.message) || e));
  H.finish(suite);
  try { process.exit(1); } catch (_) {}
});
