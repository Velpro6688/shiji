'use strict';
/* verify-v231-layout —— 用户实拍反馈的两处排版问题的几何断言（2026-10-11）
   ① 今日卡「还差 N 项」芯片：原先是单行 + 隐藏横向滚动，第 5 个起被裁成半截
      → 断言没有任何芯片超出容器右缘、且容器不需要横向滚动
   ② 方卡「连续天数」徽章与拖拽手柄贴在一起（手柄占右侧 38px，卡头只预留 36px）
      → 断言两者之间有 ≥6px 可见间隙
   顺带出图到 results/ 供肉眼复核。 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require('./_harness.js');
const suite = H.makeSuite('verify-v231-layout');
H.globalKillSwitch('verify-v231-layout', suite);
H.initProfile('verify-v231-layout');
H.stubIpc(suite.calls);

const SEED = `
  var names=['学习','喝水','按时睡觉','冥想','早起运动','阅读三十分钟'];
  data.habits=names.map(function(n,i){return {key:'L'+i,name:n,icon:'📘',color:'#3B82F6',type:'bool',size:i%2?'square':'wide',createdAt:'2026-09-01'};});
  /* 造连续天数：昨天与前天各打满 6 项，让 .hstreak 以非 zero 态真实出现（徽章贴着手柄才是实拍里的问题） */
  function ago(n){var d=new Date();d.setDate(d.getDate()-n);return fmt(d);}
  data.days={};data.days[ago(1)]={};data.days[ago(2)]={};
  names.forEach(function(n,i){data.days[ago(1)]['L'+i]=true;data.days[ago(2)]['L'+i]=true;});
  syncHabits();go('today');renderAll();`;

const MEASURE = `
  var out={};
  var box=document.getElementById('ringTodo'),br=box.getBoundingClientRect();
  var chips=[].slice.call(box.querySelectorAll('.ring-todo-chip'));
  out.chipCount=chips.length;
  out.overflow=box.scrollWidth-box.clientWidth;
  out.maxRightOver=Math.max.apply(null,chips.map(function(c){return c.getBoundingClientRect().right-br.right;}));
  out.rows=(function(){var ys={};chips.forEach(function(c){ys[Math.round(c.getBoundingClientRect().top)]++;});return Object.keys(ys).length;})();
  var card=document.querySelector('.hcard.square');
  var streak=card&&card.querySelector('.hstreak'), handle=card&&card.querySelector('.habit-sort');
  out.squares=document.querySelectorAll('.hcard.square').length;
  out.gaps=[].slice.call(document.querySelectorAll('.hcard.square')).map(function(c){
    var s=c.querySelector('.hstreak'),h=c.querySelector('.habit-sort');
    if(!s||!h)return null;
    var sr=s.getBoundingClientRect(),hr=h.getBoundingClientRect();
    return Math.round((hr.left-sr.right)*10)/10;
  }).filter(function(v){return v!==null;});
  return out;`;

async function shot(win, name) {
  const png = await H.capturePng(win, 15000);
  fs.writeFileSync(path.join(__dirname, 'results', 'layout-' + name + '.png'), png);
}

app.whenReady().then(async () => {
  const win = H.makeWin(suite, { show: true, width: 520, height: 760 });
  try {
    await H.loadPage(win); await H.bootWait(win);
    await H.sleep(1800);
    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');
    await H.sleep(300);
    await H.evalJson(win, SEED + 'return 1');
    await H.sleep(700);

    let r = await H.evalJson(win, MEASURE);
    suite.ok(r.chipCount >= 5, '① 造出多芯片场景（' + r.chipCount + ' 个，' + r.rows + ' 行）');
    suite.ok(r.overflow <= 1, '① 芯片条不再需要横向滚动（scrollWidth-clientWidth=' + r.overflow + '）');
    suite.ok(r.maxRightOver <= 1, '① 没有任何芯片超出容器右缘（最大超出 ' + Math.round(r.maxRightOver * 10) / 10 + 'px）');
    suite.ok(r.squares > 0 && Math.min.apply(null, r.gaps) >= 6,
      '② 方卡连续徽章与拖拽手柄间隙 ≥6px（实测 ' + JSON.stringify(r.gaps) + '）');
    await shot(win, '520-today');

    /* 窄窗：芯片更多行也不能溢出 */
    win.setContentSize(340, 720);
    await H.sleep(600);
    r = await H.evalJson(win, MEASURE);
    suite.ok(r.overflow <= 1 && r.maxRightOver <= 1, '① 340px 窄窗同样不溢出（overflow=' + r.overflow + ' over=' + Math.round(r.maxRightOver * 10) / 10 + '，' + r.rows + ' 行）');
    suite.ok(Math.min.apply(null, r.gaps) >= 6, '② 340px 窄窗间隙仍 ≥6px（' + JSON.stringify(r.gaps) + '）');
    await shot(win, '340-today');

    win.setContentSize(520, 760);
    await H.sleep(500);
    await H.evalJson(win, 'data.settings.theme="dark";applyTheme();renderAll();return 1');
    await H.sleep(700);
    r = await H.evalJson(win, MEASURE);
    suite.ok(r.overflow <= 1 && Math.min.apply(null, r.gaps) >= 6, '①② 深色模式下排版一致（overflow=' + r.overflow + ' gaps=' + JSON.stringify(r.gaps) + '）');
    await shot(win, '520-dark');

    await H.drainPageErrs(win, suite);
    win.destroy();
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
    try { win.destroy(); } catch (_) { }
  }
  H.finish(suite);
  app.exit(suite.errs.length ? 1 : 0);
});
