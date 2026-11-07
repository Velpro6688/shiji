/* Reports use calendar obligations; weekly quotas are never daily penalties. */
var insightMode='week';
function insightRange(mode,previous){
  const R=window.HabitRules,today=todayStr();let from,to;
  if(mode==='month'){
    const month=statSelectedMonth||today.slice(0,7),start=new Date(month+'-01T12:00:00');
    if(previous)start.setMonth(start.getMonth()-1);
    from=fmt(start);const end=new Date(start.getFullYear(),start.getMonth()+1,0,12);
    to=fmt(end);
    // Compare equal elapsed portions when the current period is unfinished.
    if(month===today.slice(0,7))to=fmt(new Date(start.getFullYear(),start.getMonth(),Math.min(new Date().getDate(),end.getDate()),12));
  }else{
    const offset=(new Date().getDay()+6)%7;
    from=R.shift(R.week(today),previous?-7:0);to=R.shift(from,offset);
  }
  return {from,to:to>today?today:to};
}
function insightRows(range){
  return HABITS.map(h=>{habitCreatedAt(h);const result=window.HabitRules.stats(h,range.from,range.to,data.days);return {h,...result,rate:result.expected?Math.round(result.done/result.expected*100):null};}).filter(row=>row.expected>0);
}
function insightTotals(rows){const expected=rows.reduce((n,r)=>n+r.expected,0),done=rows.reduce((n,r)=>n+r.done,0);return {expected,done,rate:expected?Math.round(done/expected*100):null};}
function setInsightMode(mode){insightMode=mode==='month'?'month':'week';renderInsights();}
function renderInsights(){
  const page=document.getElementById('page-stat');if(!page)return;
  let host=document.getElementById('insightReport');if(!host){host=document.createElement('section');host.id='insightReport';page.insertBefore(host,page.firstChild);}
  const range=insightRange(insightMode,false),previous=insightRange(insightMode,true),rows=insightRows(range),totals=insightTotals(rows),prev=insightTotals(insightRows(previous));
  const delta=totals.rate!==null&&prev.rate!==null?totals.rate-prev.rate:null;
  const sorted=rows.slice().sort((a,b)=>b.rate-a.rate),steady=sorted.find(r=>r.done>0),missed=sorted.slice().reverse().find(r=>r.done<r.expected);
  const rate=totals.rate===null?0:Math.max(0,Math.min(100,totals.rate));
  host.innerHTML='<div class="sec-title"><h3>计划复盘</h3><div class="insight-switch"><div class="insight-period-switch" role="group" aria-label="复盘周期"><button type="button" aria-pressed="'+(insightMode==='week')+'" onclick="setInsightMode(\'week\')">本周</button><button type="button" aria-pressed="'+(insightMode==='month')+'" onclick="setInsightMode(\'month\')">月度</button></div><input class="stat-month-picker" type="month" aria-label="'+T('month_picker_label')+'" value="'+(statSelectedMonth||todayStr().slice(0,7))+'" max="'+todayStr().slice(0,7)+'" onchange="setStatMonth(this.value)"><button type="button" onclick="exportInsightReport()">导出报告</button></div></div>'
    +'<div class="card insight-card"><div class="insight-period"><span>'+(insightMode==='month'?'月度回顾':'本周回顾')+'</span><time>'+range.from+' 至 '+range.to+'</time></div>'
    +'<div class="insight-overview"><div class="insight-ring" role="img" aria-label="总体完成率 '+(totals.rate===null?'暂无计划':rate+'%')+'"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="insight-ring-track" cx="60" cy="60" r="51"/><circle class="insight-ring-fill" cx="60" cy="60" r="51" pathLength="100" stroke-dasharray="'+rate+' 100"/></svg><div><strong>'+(totals.rate===null?'—':rate+'<small>%</small>')+'</strong><span>计划完成率</span></div></div>'
    +'<div class="insight-numbers"><div class="insight-counts"><div><span>已完成</span><strong>'+totals.done+'<small> 次</small></strong></div><div><span>尚未完成</span><strong>'+Math.max(0,totals.expected-totals.done)+'<small> 次</small></strong></div></div><p class="insight-comparison" data-trend="'+(delta===null?'none':delta>0?'up':delta<0?'down':'same')+'">'+(delta===null?'上期暂无可比较计划':delta===0?'与上期持平':(delta>0?'↑ 比上期提升 ':'↓ 比上期减少 ')+Math.abs(delta)+' 个百分点')+'</p><span class="insight-total">本期共 '+totals.expected+' 次计划</span></div></div>'
    +(rows.length?'<div class="insight-highlights"><div class="insight-highlight"><span>完成率最高</span><strong>'+(steady?esc(steady.h.icon)+' '+esc(steady.h.name):'等待首次完成')+'</strong><small>'+(steady?steady.rate+'% · 继续保持节奏':'从一个小行动开始')+'</small></div><div class="insight-highlight insight-attention"><span>'+(missed?'值得关注':'本期进展')+'</span><strong>'+(missed?esc(missed.h.icon)+' '+esc(missed.h.name):'计划全部完成')+'</strong><small>'+(missed?'已完成 '+missed.done+' / '+missed.expected+' 次':'每一次坚持都算数')+'</small></div></div>':'<div class="insight-empty">本期暂无执行计划<br><small>设置习惯计划后，这里会展示完成进度。</small></div>')
    +'<div class="insight-list-heading"><strong>习惯进度</strong><span>'+(rows.length?'点击查看周期记录':'暂无记录')+'</span></div><div class="insight-rows">'+rows.map(row=>'<button type="button" class="insight-habit" onclick="openInsightDates(\''+jsStr(row.h.key)+'\')"><span class="insight-habit-icon" aria-hidden="true">'+esc(row.h.icon)+'</span><span class="insight-habit-body"><span class="insight-habit-heading"><strong>'+esc(row.h.name)+'</strong><span class="insight-habit-rate">'+row.rate+'<small>%</small></span></span><span class="insight-progress" role="progressbar" aria-label="'+esc(row.h.name)+'完成率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+row.rate+'"><span style="width:'+Math.max(0,Math.min(100,row.rate))+'%"></span></span><span class="insight-habit-caption">已完成 '+row.done+' / '+row.expected+' 次</span></span><span class="insight-chevron" aria-hidden="true">›</span></button>').join('')+'</div>'
    +'<details class="report-definition"><summary>统计怎么算？</summary><p>每日 / 指定星期只统计应执行日；暂停、请假及创建前不计缺卡。每周 N 次按周一至周日汇总，每天最多计一次，局部周期按可执行天数限制目标。进行中的周目标尚未完成不立即打断连续记录。比较使用相同已过去天数；归档、删除前的计划仍参与复盘。</p><p>连续记录按计划周期计：每日 / 指定星期为执行日，周计划为周。星期分布只比较每日 / 指定星期计划。</p></details>'
    +'</div>';
}
function openInsightDates(key){
  const h=HMAP[key];if(!h)return;
  const range=insightRange(insightMode,false),groups=window.HabitRules.periods(h,range.from,range.to,data.days);
  let sheet=document.getElementById('insightDatesSheet');
  if(!sheet){sheet=document.createElement('div');sheet.className='sheet';sheet.id='insightDatesSheet';sheet.innerHTML='<div class="sheet-bar"></div><h3 id="insightDatesTitle"></h3><div id="insightDateList"></div><button type="button" class="btn-ghost" onclick="closeSheet()">关闭</button>';document.body.appendChild(sheet);}
  document.getElementById('insightDatesTitle').textContent=h.name+' · 周期记录';
  const host=document.getElementById('insightDateList');host.replaceChildren();
  groups.forEach(g=>{
    const label=document.createElement('p');label.className='planning-hint';label.textContent=(g.weekly?'周计划 '+g.key.slice(2):g.start)+' · '+g.done+'/'+g.expected;host.appendChild(label);
    g.dates.forEach(ds=>{const b=document.createElement('button');b.type='button';b.className='insight-row';b.textContent=ds+' · '+(isDone(key,dayObj(ds))?'已完成':'尚无完成记录')+'　查看 ›';b.onclick=()=>{closeSheet(true);viewDate=ds;viewDateLabel();renderViewDateChange();go('today');if(habitsVisibleOn(ds).some(h=>h.key===key))jumpToHabit(key);else toast('该日没有打卡记录，已打开对应日期');};host.appendChild(b);});
  });
  openSheet('insightDatesSheet');
}
function exportInsightReport(){
  const range=insightRange(insightMode,false),rows=insightRows(range),totals=insightTotals(rows);
  const content='# 时迹计划复盘\n\n'+range.from+' 至 '+range.to+'\n\n完成 '+totals.done+' / '+totals.expected+' 次计划\n\n'+rows.map(r=>'- '+r.h.name+'：'+r.done+'/'+r.expected+'（'+r.rate+'%）').join('\n')+'\n\n口径：每日/指定星期按执行日；周计划按周计数，每天一次，局部周期目标不超过可执行天数。暂停和请假不计缺卡。\n';
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));link.href=url;link.download='时迹复盘-'+range.from+'-'+range.to+'.md';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
