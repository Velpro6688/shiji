'use strict';
/* verify-v231-css —— v2.3.1 波次 4（CSS 安全清理）断言
   判据全部走 DOM/CSSOM 实测，不看源码文本（源码里留有说明性注释会误报）：
   ① 死类在样式表中已无规则、页面 DOM 也从未使用
   ② 打卡列表布局单一来源（网格列/间距/跨列/min-width）
   ③ 晚间提醒芯片仍存在，遵循当前静态提示设计，不播放循环动画
   ④ 座右铭配色随主题切换，不再是硬编码浅蓝孤岛
   ⑤ 窄窗单列回退
   ⑥ 构建残留属性在 DOM 里清零
   ⑦ .hcard .hh 的 border-bottom-color 删除无视觉影响（border-bottom-width=0） */
const { app } = require('electron');
const H = require('./_harness.js');
const suite = H.makeSuite('verify-v231-css');
H.globalKillSwitch('verify-v231-css', suite);
H.initProfile('verify-v231-css');
H.stubIpc(suite.calls);

app.whenReady().then(async () => {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win); await H.bootWait(win);
    await H.sleep(1800);
    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');
    await H.sleep(300);
    let r = await H.evalJson(win, `
      data.habits=[
        {key:'w1',name:'宽卡',icon:'W',color:'#3B82F6',type:'bool',size:'wide',createdAt:'2026-09-01'},
        {key:'s1',name:'方卡甲',icon:'A',color:'#3B82F6',type:'bool',size:'square',createdAt:'2026-09-01'},
        {key:'s2',name:'方卡乙',icon:'B',color:'#3B82F6',type:'bool',size:'square',createdAt:'2026-09-01'}];
      data.days={};syncHabits();go('today');renderAll();
      /* —— ① 样式表里是否还留着死类规则（展开 @media/@supports 递归） —— */
      var dead=['todo-strip','todo-chips','todo-alldone','mgr-item','mgr-i','mgr-n','mgr-t','mgr-del','mgr-edit'];
      var ruleHits={};dead.forEach(function(c){ruleHits[c]=0;});
      var softblink=0, keyframes=0;
      function scan(rules){[].forEach.call(rules,function(rr){
        if(rr.type===CSSRule.KEYFRAMES_RULE){keyframes++;if(/softblink/.test(rr.name))softblink++;return;}
        if(rr.cssRules&&rr.type!==CSSRule.KEYFRAMES_RULE){scan(rr.cssRules);return;}
        if(!rr.selectorText)return;
        dead.forEach(function(c){ if(new RegExp('\\\\.'+c+'(?![\\\\w-])').test(rr.selectorText)) ruleHits[c]++; });
      });}
      [].forEach.call(document.styleSheets,function(sh){try{scan(sh.cssRules);}catch(_){}});
      var domDead=document.querySelectorAll(dead.map(function(c){return '.'+c}).join(',')).length;
      var resid=document.querySelectorAll('[data-page-node-id],[data-sp-bindable],[data-sp-database-id]').length;
      var pnidAttrs=document.querySelectorAll('*[data-pnid-children]').length;
      /* —— ②⑦ 布局单一来源 —— */
      var list=document.getElementById('checkinList'),cs=getComputedStyle(list);
      var wide=getComputedStyle(document.querySelector('#checkinList .hcard.wide'));
      var sq=getComputedStyle(document.querySelector('#checkinList .hcard.square'));
      var hh=getComputedStyle(document.querySelector('.hcard .hh'));
      return {ruleHits:ruleHits,domDead:domDead,softblink:softblink,keyframes:keyframes,resid:resid,pnidAttrs:pnidAttrs,
        display:cs.display,cols:cs.gridTemplateColumns,gap:cs.gap,
        wideCol:wide.gridColumnStart+'/'+wide.gridColumnEnd,sqMinW:sq.minWidth,
        hhBdw:hh.borderBottomWidth,hhBdc:hh.borderBottomColor};`);
    const defined = Object.keys(r.ruleHits).filter(c => r.ruleHits[c] > 0);
    suite.ok(defined.length === 0, '① 样式表已无死类规则（仍命中：' + JSON.stringify(defined) + '）');
    suite.ok(r.domDead === 0, '① 页面 DOM 从未使用这些类（命中 ' + r.domDead + '）');
    suite.ok(r.softblink === 1, '① @keyframes softblink 全表只定义一次（实得 ' + r.softblink + '，全部 keyframes ' + r.keyframes + '）');
    suite.ok(r.resid === 0, '⑥ 构建残留属性在 DOM 里清零（data-page-node-id / data-sp-* 命中 ' + r.resid + '）');
    suite.ok(r.display === 'grid' && /px/.test(r.cols), '② 布局由网格单一来源给出（display=' + r.display + ' cols=' + r.cols + '）');
    suite.ok(parseFloat(r.gap) >= 8 && parseFloat(r.gap) <= 16, '② 卡片保留紧凑且可区分的列间距（实得 ' + r.gap + '）');
    suite.ok(r.wideCol === '1/-1' || r.wideCol === '1/3', '⑤ 宽卡跨满整行（' + r.wideCol + '）');
    suite.ok(r.sqMinW === '0px', '② 方卡 min-width=0，flex 时代的 calc(50%-6px)/100%!important 不再顶爆轨道（' + r.sqMinW + '）');
    suite.ok(parseFloat(r.hhBdw) === 0, '① 删除 .hcard .hh{border-bottom-color} 无视觉影响：border-bottom-width=' + r.hhBdw + '（该元素本就没有下边框，颜色值不落地）');

    /* —— ③ 闪烁：动画名必须真的挂在芯片上 —— */
    r = await H.evalJson(win, `
      var real=Date.prototype.getHours;Date.prototype.getHours=function(){return 21;};
      renderTodo();Date.prototype.getHours=real;
      var chip=document.querySelector('.ring-todo-chip.blink'),cs=chip?getComputedStyle(chip):null;
      return {has:!!chip,name:cs?cs.animationName:'',iter:cs?cs.animationIterationCount:'',
        rm:matchMedia('(prefers-reduced-motion: reduce)').matches,dur:cs?cs.animationDuration:''};`);
    suite.ok(r.has && r.name === 'none', '③ 晚间提醒芯片保留，使用当前静态提示（anim=' + (r.name || '无') + '）');
    suite.ok(r.rm ? parseFloat(r.dur) <= 0.00001 : r.dur === '0s', '③ 静态提醒不播放循环动画（duration=' + r.dur + '）');

    /* —— ④ 座右铭随主题切换 —— */
    const light = await H.evalJson(win, `var m=document.querySelector('#page-today .ring-motto');var cs=getComputedStyle(m);return {bg:cs.backgroundColor,color:cs.color,ph:cs.color};`);
    await H.evalJson(win, `var s=document.getElementById('themeSelect');s.value='dark';s.dispatchEvent(new Event('change',{bubbles:true}));return 1`);
    await H.sleep(700);
    const dark = await H.evalJson(win, `var m=document.querySelector('#page-today .ring-motto');var cs=getComputedStyle(m);return {bg:cs.backgroundColor,color:cs.color,cls:document.documentElement.className};`);
    suite.ok(light.bg !== 'rgb(238, 246, 255)', '④ 浅色底色不再是旧的硬编码 #EEF6FF（实得 ' + light.bg + '）');
    suite.ok(dark.cls === 'dark' && dark.bg !== light.bg && dark.color !== light.color,
      '④ 深色模式底色/文字随主题翻转（' + light.bg + '→' + dark.bg + '，文字 ' + light.color + '→' + dark.color + '）');
    await H.evalJson(win, `var s=document.getElementById('themeSelect');s.value='light';s.dispatchEvent(new Event('change',{bubbles:true}));return 1`);
    await H.sleep(500);

    /* —— ⑤ 窄窗单列 —— */
    win.setContentSize(340, 760);
    await H.sleep(600);
    r = await H.evalJson(win, `
      var cs=getComputedStyle(document.getElementById('checkinList'));
      var sq=getComputedStyle(document.querySelector('#checkinList .hcard.square'));
      return {n:cs.gridTemplateColumns.split(' ').filter(Boolean).length,cols:cs.gridTemplateColumns,minW:sq.minWidth};`);
    suite.ok(r.n === 1, '⑤ 340px 窄窗回退单列（' + r.cols + '）');
    suite.ok(r.minW === '0px', '⑤ 窄窗方卡 min-width=0（' + r.minW + '）');
    win.setContentSize(780, 900);
    await H.sleep(300);

    await H.drainPageErrs(win, suite);
    win.destroy();
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
    try { win.destroy(); } catch (_) { }
  }
  H.finish(suite);
  app.exit(suite.errs.length ? 1 : 0);
});
