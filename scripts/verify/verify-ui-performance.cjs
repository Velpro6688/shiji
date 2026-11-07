'use strict';
const { app } = require('electron');
const path = require('path');
const H = require('./_harness.js');

const phase = /^[a-z0-9-]{1,24}$/i.test(process.argv[2] || '') ? process.argv[2] : 'baseline';
const NAME = 'verify-ui-performance-' + phase;
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
const profile = H.initProfile(NAME);
H.stubIpc(suite.calls);

const pad = value => String(value).padStart(2, '0');
const dayKeys = [];
for (let i = 0; i < 500; i++) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - i);
  dayKeys.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
}

async function writeTestImage(win) {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F1sAAAAASUVORK5CYII=';
  await H.evalJson(win, 'window.__perfImage=null;window.hbShell.writeImage(' + JSON.stringify(dataUrl) + ').then(function(v){window.__perfImage=v},function(e){window.__perfImage={error:String(e)}});return true');
  for (let i = 0; i < 30; i++) {
    await H.sleep(100);
    const result = await H.evalJson(win, 'return window.__perfImage');
    if (result) return result.ref || null;
  }
  return null;
}

async function medianFor(win, expression) {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    const elapsed = await H.evalJson(win, 'var t=performance.now();' + expression + ';return performance.now()-t');
    if (i > 0) samples.push(Number(elapsed));
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  return { samples, medianMs: sorted[1] };
}

app.whenReady().then(async function () {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win);
    await H.bootWait(win);
    await H.sleep(2100);
    await H.evalJson(win, 'var gs=document.getElementById("guideSkip");if(gs)gs.click();return true');
    const imageRef = await writeTestImage(win);
    suite.ok(!!imageRef, '固定性能样本的本地图片已写入隔离 profile');

    const setup = [
      'var perfTypes=["bool","count","hours","range"];',
      'data.habits=Array.from({length:20},function(_,i){var type=perfTypes[i%4];return {key:"perf_"+String(i).padStart(2,"0"),name:"习惯"+String(i+1).padStart(2,"0"),icon:type==="count"?"💧":type==="hours"?"📖":type==="range"?"🌙":"✓",color:["#007AFF","#34C759","#FF9500","#AF52DE"][i%4],type:type,target:type==="count"&&i===7?6000:type==="count"?8:type==="range"?8:type==="hours"?1.5:undefined,unit:type==="count"?"次":type==="hours"||type==="range"?"小时":"",size:"wide"};});',
      'var keys=' + JSON.stringify(dayKeys) + ';data.days={};',
      'keys.forEach(function(ds,di){var day={};data.habits.forEach(function(h,hi){if(h.type==="bool")day[h.key]=(di+hi)%2===0;else if(h.type==="count")day[h.key]=(di+hi)%(h.target||8)+1;else if(h.type==="hours")day[h.key]=((di+hi)%5)*0.5;else{day[h.key]=8;day[h.key+"_s"]="23:00";day[h.key+"_e"]="07:00";day[h.key+"_t"]=8;}});if(di%3===0)day.mood="happy";data.days[ds]=day;});',
      'data.memoNotes=Array.from({length:100},function(_,i){var html=i<20?"<p>固定性能样本便签 "+i+"<\/p><img src=\\\""+' + JSON.stringify(imageRef || '') + '+"\\\">":"";return {id:"perf_note_"+i,ts:Date.now()-i*60000,title:"固定性能样本便签 "+String(i+1).padStart(3,"0"),text:"搜索、预览与列表渲染性能样本 "+i,html:html,ord:i};});',
      'data.memo={html:"",text:""};syncHabits();go("today");renderAll();return {habits:data.habits.length,days:Object.keys(data.days).length,notes:data.memoNotes.length,images:data.memoNotes.filter(function(n){return n.html.indexOf("<img")>=0;}).length};'
    ].join('');
    const dataset = await H.evalJson(win, setup);
    suite.metric('dataset', dataset);
    suite.metric('profile', path.relative(H.ROOT, profile));
    suite.ok(dataset.habits === 20 && dataset.days === 500 && dataset.notes === 100 && dataset.images === 20, '固定数据集规模符合计划（' + JSON.stringify(dataset) + ')');

    const checkin = await medianFor(win, 'renderCheckin()');
    const stats = await medianFor(win, 'renderStat()');
    const notes = await medianFor(win, 'memoSearchQuery="";renderMemoList()');
    const filteredNotes = await medianFor(win, 'memoSearchQuery="便签 42";renderMemoList()');
    const pageSwitch = await medianFor(win, 'statDirty=true;go("stat");go("today")');
    suite.metric('renderCheckin', checkin);
    suite.metric('renderStat', stats);
    suite.metric('renderMemoList', notes);
    suite.metric('renderMemoSearchResult', filteredNotes);
    suite.metric('pageSwitch', pageSwitch);
    suite.ok([checkin, stats, notes, filteredNotes, pageSwitch].every(function (x) { return Number.isFinite(x.medianMs) && x.medianMs >= 0; }), '五项渲染性能测量均得到有限数值');
    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('性能基准异常: ' + String((e && e.stack) || e).slice(0, 1000));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
