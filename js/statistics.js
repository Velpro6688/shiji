 
var statSelectedMonth='';
function setStatMonth(value){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value>todayStr().slice(0,7)){document.querySelectorAll('.stat-month-picker').forEach(n=>{n.value=statSelectedMonth||todayStr().slice(0,7);});toast('请选择本月或更早的有效月份','bad');return;}
  statSelectedMonth=value;insightMode='month';renderStatExtras();renderInsights();
}
function statExtrasMonthRange(){
  var now=statSelectedMonth?new Date(statSelectedMonth+'-01T12:00:00'):new Date();
  var start=new Date(now.getFullYear(),now.getMonth(),1);
  return {y:now.getFullYear(),m:now.getMonth()+1,start:start};
}
function renderStatExtras(){
  var page=document.getElementById('page-stat'); if(!page)return;
  var host=document.getElementById('statExtras');
  if(!host){host=document.createElement('div');host.id='statExtras';page.appendChild(host);}
  var today=todayStr();
  var mr=statExtrasMonthRange();
  var mk=mr.y+'-'+String(mr.m).padStart(2,'0');
  var act=HABITS;
  /* —— 月度报告 —— */
  var monthDays=[],d,mEnd=new Date(mr.y,mr.m,0).getDate();
  for(var di=1;di<=mEnd;di++){ d=mk+'-'+String(di).padStart(2,'0'); if(d<=today)monthDays.push(d); }
  var expected=0,done=0,best={key:null,name:'',done:-1};  /* v2.3.1：expected 按各习惯 createdAt 起算，创建前的天数不再计入缺卡 */
  act.forEach(function(h){
    habitCreatedAt(h);
    const summary=window.HabitRules.stats(h,monthDays[0],monthDays[monthDays.length-1],data.days);
    if(!summary.expected)return;
    var c=summary.done;expected+=summary.expected;
    done+=c;
    if(c>best.done)best={key:h.key,name:h.name,done:c};
  });
  var rate=expected>0?Math.round(done/expected*100):0;
  /* 月内最长连续（任一习惯在月内的最长连续天数） */
  var bestStreak=0;
  act.forEach(function(h){bestStreak=Math.max(bestStreak,window.HabitRules.streak(h,monthDays[0],monthDays[monthDays.length-1],data.days,true));});
  /* 心情分布（当月） */
  var moodCnt={};
  monthDays.forEach(function(ds){ var mo=(data.days[ds]||{}).mood; if(mo&&MMAP[mo])moodCnt[mo]=(moodCnt[mo]||0)+1; });
  var moodHtml=Object.keys(moodCnt).sort(function(a,b){return moodCnt[b]-moodCnt[a];}).map(function(mo){
    return '<span class="se-mood">'+MMAP[mo].emoji+' '+MMAP[mo].name+'×'+moodCnt[mo]+'</span>';
  }).join(' ')||'<span class="se-dim">'+T('se_nodata')+'</span>';
  /* 当月备注 */
  var notes=monthDays.filter(function(ds){ var n=(data.days[ds]||{}).__note; return n; }).map(function(ds){
    return '<div class="se-note"><b>'+ds.slice(5)+'</b>'+esc((data.days[ds]||{}).__note)+'</div>';
  }).join('')||'<div class="se-dim">'+T('se_nonotes')+'</div>';
  /* —— 最佳时段（基于 key_ts 首完成时刻，仅对新打卡累积） —— */
  var hourCnt={},hourTotal=0;
  Object.keys(data.days||{}).forEach(function(ds){
    var day=data.days[ds]||{};
    Object.keys(day).forEach(function(k){
      if(!/_ts$/.test(k))return;
      var base=k.replace(/_ts$/,'');
      var h=HMAP[base]; if(!h||h.archived||h.deleted)return;
      if(day[base+'_tsb'])return;   /* 补记时刻不代表当天真实完成时刻，不计入时段分布 */
      var ts=String(day[k]||'');
      if(/^\d{2}:/.test(ts)){ var hh=ts.slice(0,2); hourCnt[hh]=(hourCnt[hh]||0)+1; hourTotal++; }   
    });
  });
  var hourRows=Object.keys(hourCnt).map(function(hh){return {h:hh,n:hourCnt[hh]};}).sort(function(a,b){return b.n-a.n;});
  var hourHtml;
  if(!hourTotal){ hourHtml='<div class="se-dim">'+T('se_hour_nodata')+'</div>'; }
  else{
    var maxN=hourRows[0].n;
    hourHtml=hourRows.slice(0,5).map(function(x){
      var w=Math.round(x.n/maxN*100);
      return '<div class="se-brow"><span class="se-bh">'+x.h+'</span><span class="se-bar-track"><i class="se-bar" style="width:'+w+'%"></i></span><b>'+x.n+'</b></div>';
    }).join('')+ '<div class="se-best">'+T('se_hour_best').replace('{h}',hourRows[0].h).replace('{n}',hourRows[0].n)+'</div>';
  }
  /* —— 星期分布（近 90 天） —— */
  var wdDone=[0,0,0,0,0,0,0],wdExp=[0,0,0,0,0,0,0];
  var start=new Date();start.setDate(start.getDate()-89);
  for(var dt=new Date(start);dt<=new Date();dt.setDate(dt.getDate()+1)){
    var ds=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
    var dow=dt.getDay();
    act.forEach(function(h){ if(ds<habitCreatedAt(h)||!window.HabitRules.eligible(h,ds)||window.HabitRules.rule(h,ds).mode==='weekly')return; wdExp[dow]++; if(isDone(h.key,data.days[ds]||{}))wdDone[dow]++; });
  }
  var wdNames=T('se_weekdays');
  var wdRows=wdDone.map(function(v,i){ return {i:i,rate:wdExp[i]?v/wdExp[i]:-1,n:v}; }).filter(function(x){return x.rate>=0;});
  var wdHtml;
  if(!wdRows.length){ wdHtml='<div class="se-dim">'+T('se_nodata')+'</div>'; }
  else{
    var sorted=wdRows.slice().sort(function(a,b){return b.rate-a.rate;});
    var hi=sorted[0],lo=sorted[sorted.length-1];
    wdHtml=wdRows.map(function(x){
      var w=Math.round(x.rate*100);
      return '<div class="se-brow"><span class="se-bh">'+wdNames[x.i]+'</span><span class="se-bar-track"><i class="se-bar" style="width:'+w+'%"></i></span><b>'+w+'%</b></div>';
    }).join('')
    +'<div class="se-best">'+T('se_wd_best').replace('{w}',wdNames[hi.i]).replace('{r}',Math.round(hi.rate*100))+(sorted.length>1?' · '+T('se_wd_low').replace('{w}',wdNames[lo.i]).replace('{r}',Math.round(lo.rate*100)):'')+'</div>';
  }
  host.innerHTML=
    '<details class="stat-details"><summary>查看月度细节、最佳时段与星期分布</summary><div class="sec-title"><span class="st-em">'+icn('calendar',18,2)+'</span><h3>'+T('se_month_title')+' · '+mk+'</h3>'
    +'<button type="button" class="se-csv" onclick="exportStatsCsv()">'+T('se_csv')+'</button></div>'
    +'<div class="card se-card"><div class="se-grid">'
    +'<div class="se-cell"><b>'+rate+'%</b><span>'+T('se_month_rate')+'</span></div>'
    +'<div class="se-cell"><b>'+bestStreak+'</b><span>'+T('se_month_streak')+'</span></div>'
    +'<div class="se-cell"><b>'+(best.done>=0?esc(best.name):'—')+'</b><span>'+T('se_month_best')+(best.done>=0?'（'+best.done+'）':'')+'</span></div>'
    +'</div>'
    +'<div class="se-moods">'+moodHtml+'</div>'
    +'<div class="se-notes">'+notes+'</div></div>'
    +'<div class="sec-title"><span class="st-em">'+icn('clock',18,2)+'</span><h3>'+T('se_hour_title')+'</h3></div>'
    +'<div class="card se-card">'+hourHtml+'</div>'
    +'<div class="sec-title"><span class="st-em">'+icn('calendar',18,2)+'</span><h3>'+T('se_wd_title')+'</h3></div>'
    +'<div class="card se-card">'+wdHtml+'</div></details>';
}
 


function csvCell(v){
  var s=(v===undefined||v===null)?'':String(v);
  if(/^[=+\-@\t\r]/.test(s))s="'"+s;                    /* 中和 Excel 公式注入 */
  if(/[",\r\n]/.test(s)||/^\s|\s$/.test(s))s='"'+s.replace(/"/g,'""')+'"';
  return s;
}
function exportStatsCsv(){
  try{
    var rows=[['date','habit','type','value','target','done','first_done_at','mood','note']];
    Object.keys(data.days||{}).sort().forEach(function(ds){
      var day=data.days[ds]||{};
      var mood=day.mood||'', note=(typeof day.__note==='string')?day.__note:'';
      HABITS.forEach(function(h){
        var v=day[h.key];var has=(v!==undefined&&v!==null&&v!=='');
        if(!has&&day[h.key+'_ts']===undefined)return;
        var done=isDone(h.key,day)?1:0;
        rows.push([ds,h.name,h.type,(v===undefined?'':v),(h.type==='bool'?'':targetOf(h.key,day,h)),done,(day[h.key+'_ts']||''),mood,note]);
      });
      if(!Object.keys(day).some(function(k){return k!=='mood'&&k!=='__note'&&k.indexOf('_')!==0;})){
        if(mood||note)rows.push([ds,'','','','','','',mood,note]);
      }
    });
    var csv='\uFEFF'+rows.map(function(r){return r.map(csvCell).join(',');}).join('\r\n');
    var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='habit-stats_'+todayStr()+'.csv';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
    toast(T('t_exported'),'good');
  }catch(err){toast(T('t_import_bad'),'bad');}
}

function renderStat(){
  renderStatExtras();renderInsights();
  // 概览
  const _todos=Array.isArray(data.todos)?data.todos:[];
  const _tdDone=_todos.filter(t=>t&&t.done).length;
  const _tdOpen=_todos.length-_tdDone;
  document.getElementById('statGrid').innerHTML=`
    <div class="stat-mini a"><div class="sm-ico">${icn('fire',22,2)}</div><b>${maxStreakAll()}</b><span>${T('stat_maxstreak')}</span></div>
    <div class="stat-mini g"><div class="sm-ico">${icn('calendar',22,2)}</div><b>${recordCount()}</b><span>${T('stat_recorddays')}</span></div>
    <div class="stat-mini s"><div class="sm-ico">${icn('check',22,2.4)}</div><b>${totalCheckins()}</b><span>${T('stat_checkins')}</span></div>
    <div class="stat-mini r"><div class="sm-ico">${icn('palette',22,2)}</div><b>${moodCount()}</b><span>${T('stat_moods')}</span></div>
    <div class="stat-mini t"><div class="sm-ico">${icn('pin',22,2)}</div><b>${_tdDone}</b><span>${T('stat_todos').replace('{n}',_tdOpen)}</span></div>`;
  renderTrend();
  renderHeat();renderWeekChart();renderMoodChart();renderBadges();
}
function renderTrend(){var box=document.getElementById('trendCard');if(!box)return;if(HABITS.some(h=>h.schedule||h.scheduleHistory||h.pauseRanges)){let a=insightTotals(insightRows({from:daysAgoStr(6),to:todayStr()})),b=insightTotals(insightRows({from:daysAgoStr(13),to:daysAgoStr(7)}));box.innerHTML='<div><b>'+(a.rate===null?'—':a.rate+'%')+'</b><span>近 7 天</span></div><div><b>'+(b.rate===null?'—':b.rate+'%')+'</b><span>前 7 天</span></div><div><b>'+(a.rate===null||b.rate===null?'—':(a.rate-b.rate)+' pp')+'</b><span>计划完成率变化</span></div>';return;}var act=activeHabits(),now=0,prev=0,nowExp=0,prevExp=0;act.forEach(function(h){var from=habitCreatedAt(h);for(var i=0;i<7;i++){var ds=daysAgoStr(i);if(ds<from)continue;nowExp++;if(isDone(h.key,dayObj(ds)||{}))now++;}for(var j=7;j<14;j++){var ps=daysAgoStr(j);if(ps<from)continue;prevExp++;if(isDone(h.key,dayObj(ps)||{}))prev++;}});var a=nowExp?Math.round(now/nowExp*100):0,b=prevExp?Math.round(prev/prevExp*100):0,delta=a-b; var _dk=document.documentElement.classList.contains('dark'),_cUp=_dk?'#30D158':'#0F7A34',_cDn=_dk?'#FF6961':'#C81E1E';box.innerHTML='<div><b>'+a+'%</b><span>近 7 天</span></div><div><b>'+b+'%</b><span>前 7 天</span></div><div><b style="color:'+(delta>=0?_cUp:_cDn)+'">'+(delta>=0?'+':'')+delta+'%</b><span>趋势变化</span></div>';}

/* —— 30天热力图：过去 15 天、今天、未来 14 天；仅累计开始使用后的真实记录。 —— */
function renderHeat(){
  const wrap=document.getElementById('heatWrap');
  // 统一按本地"日历日"生成 30 列：过去 29 天 + 今天（无未来列），固定在中午，避免零点/DST 导致日期偏移。
  const days=[];const today=new Date();today.setHours(12,0,0,0);
  for(let i=29;i>=0;i--){const dd=new Date(today);dd.setDate(today.getDate()-i);days.push(dd);}
  /* 行集合：未删除习惯（含已归档）+ 30 天窗口内仍有记录的已删除习惯——历史保留可见，无记录的墓碑不占行 */
  const winStart=fmt(days[0]);
  const rows=HABITS.filter(h=>!h.deleted).concat(HABITS.filter(h=>h.deleted&&Object.keys(data.days).some(function(ds){return ds>=winStart&&habitHasRecord(h,data.days[ds]);})));
  if(!rows.length){wrap.innerHTML=`<div class="empty-tip" style="color:var(--ink-soft)">${T('heat_addfirst')}</div>`;return;}
  const heatStart=/^\d{4}-\d{2}-\d{2}$/.test(data.meta.heatStartDate||'')?data.meta.heatStartDate:todayStr();
  // 左侧标签列：顶部一个日期占位行 + 每个习惯一行
  let labels='<div class="heat-labels">';
  labels+=`<div class="heat-lb head">${T('heat_date')}</div>`;
  rows.forEach(h=>{labels+=`<div class="heat-lb"${h.archived||h.deleted?' style="opacity:.55"':''} title="${esc(h.name)}${h.archived?'（'+T('state_archived')+'）':h.deleted?'（'+T('state_deleted')+'）':''}">${esc(h.icon)}<span style="max-width:52px;overflow:hidden;text-overflow:ellipsis">${esc(h.name)}</span>${h.archived?'<i class="heat-tag">归</i>':h.deleted?'<i class="heat-tag">删</i>':''}</div>`;});
  labels+='</div>';
  // 右侧网格：每列 = 一天
  let grid=`<div class="heat-grid" role="grid" aria-label="${esc(T('heat_title'))}，方向键浏览日期和习惯" aria-rowcount="${rows.length}" aria-colcount="${days.length}" aria-readonly="true">`;
  days.forEach((dd,idx)=>{
    const ds=fmt(dd);const d=dayObj(ds);
    const isToday=idx===days.length-1;
    const beforeStart=ds<heatStart;
    const weekName=(T('weekdays')||[])[dd.getDay()]||'';
    let col=`<div class="heat-col ${isToday?'today':''}">`;
    const label=(dd.getMonth()+1)+'/'+dd.getDate();
    const detail=isToday?`今天 · ${weekName}`:weekName;
    col+=`<div class="heat-date ${isToday?'today':''}" role="columnheader" aria-label="${ds}，${esc(detail)}" title="${ds}"><span class="heat-day">${label}</span><span class="heat-week">${detail}</span></div>`;
    rows.forEach((h,rowIndex)=>{
      const r=beforeStart?0:doneRatio(h.key,d);
      const bg=beforeStart?'var(--heat-0)':(r<=0?'var(--heat-0)':(r<0.34?'var(--heat-1)':(r<0.67?'var(--heat-2)':'var(--heat-3)')));   
      const status=beforeStart?T('heat_cell_before'):(isDone(h.key,d)?T('ro_done'):T('ro_undone'));
      const value=d&&Number(d[h.key])||0;
      const target=targetOf(h.key,d,h);
      const progress=h.type==='bool'?'':`${T('target')} ${h.type==='hours'||h.type==='range'?formatHours(value):value} / ${target} ${esc(h.unit||T('unit_hour'))}`;
      const label=`${ds}，${h.name}，${status}${progress?'，'+progress:''}`;
      col+=`<div class="heat-cell" role="gridcell" tabindex="${isToday&&rowIndex===0?'0':'-1'}" aria-rowindex="${rowIndex+1}" aria-colindex="${idx+1}" aria-label="${esc(label)}" data-day-index="${idx}" data-habit-index="${rowIndex}" style="background:${bg}" title="${esc(label)}"></div>`;
    });
    col+='</div>';
    grid+=col;
  });
  grid+='</div>';
  wrap.innerHTML=labels+grid;
  if(!wrap.dataset.heatKeyboardBound){
    wrap.addEventListener('keydown',function(event){
      const cell=event.target.closest('.heat-cell[role="gridcell"]');
      if(!cell)return;
      let dayIndex=Number(cell.dataset.dayIndex),habitIndex=Number(cell.dataset.habitIndex);
      if(event.key==='ArrowLeft')dayIndex--;
      else if(event.key==='ArrowRight')dayIndex++;
      else if(event.key==='ArrowUp')habitIndex--;
      else if(event.key==='ArrowDown')habitIndex++;
      else return;
      const next=wrap.querySelector('.heat-cell[data-day-index="'+dayIndex+'"][data-habit-index="'+habitIndex+'"]');
      if(!next)return;
      event.preventDefault();cell.tabIndex=-1;next.tabIndex=0;next.focus();
    });
    wrap.dataset.heatKeyboardBound='true';
  }
  const scroll=wrap.closest('.heat-scroll');
  if(scroll){
    var hint=document.getElementById('heatScrollHint');
    if(!hint){hint=document.createElement('p');hint.id='heatScrollHint';hint.className='heat-scroll-hint';scroll.parentNode.appendChild(hint);}
    hint.textContent=T('heat_scroll_hint');
    var updateHint=function(){hint.hidden=scroll.scrollWidth<=scroll.clientWidth+1;};updateHint();
    if(window.ResizeObserver&&!scroll._hintObserver){scroll._hintObserver=new ResizeObserver(updateHint);scroll._hintObserver.observe(scroll);}
  }
  const todayCol=wrap.querySelector('.heat-col.today');
  if(scroll&&todayCol)requestAnimationFrame(function(){
     
    scroll.scrollLeft=scroll.scrollWidth-scroll.clientWidth;
  });
}

/* —— 本周柱状图（手绘 SVG） —— */
function renderWeekChart(){
  const dt=new Date();const arr=[];
  for(let i=6;i>=0;i--){const dd=new Date(dt);dd.setDate(dt.getDate()-i);arr.push(dd);}
  const list=HABITS;
  const total=list.length||1;
  const vals=arr.map(dd=>{const d=dayObj(fmt(dd));return d?list.filter(h=>isDone(h.key,d)).length:0;});
  const W=340,H=168,padX=14,base=128,top=26,bw=30,gap=(W-padX*2-bw*7)/6,maxH=base-top-8;
  let bars='';
  arr.forEach((dd,i)=>{
    const v=vals[i];const rate=v/total;
    const bh=v?Math.max(10,Math.round(rate*maxH)):5;
    const x=padX+i*(bw+gap);const y=base-bh;
    const lb=T('weekshort')[dd.getDay()];
    const isToday=fmt(dd)===todayStr();
    if(v){
      bars+=`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${isToday?'url(#wkGrad)':'var(--wk-bar)'}" class="wk-bar"/>`;
      bars+=`<text x="${x+bw/2}" y="${y-7}" text-anchor="middle" font-size="11" font-weight="800" fill="${isToday?'#007AFF':'var(--text-2,#6E6E73)'}" font-family="inherit">${v}</text>`;
    }else{
      bars+=`<rect x="${x+7}" y="${base-5}" width="${bw-14}" height="5" rx="2.5" fill="var(--wk-bar-empty)"/>`;
    }
    bars+=`<text x="${x+bw/2}" y="${base+18}" text-anchor="middle" font-size="11" fill="${isToday?'#007AFF':'var(--text-3,#8E8E93)'}" font-weight="${isToday?'800':'600'}" font-family="inherit">${lb}</text>`;
    if(isToday)bars+=`<circle cx="${x+bw/2}" cy="${base+30}" r="2.4" fill="#007AFF"/>`;
  });
  document.getElementById('weekChart').innerHTML=`<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block">
    <defs><linearGradient id="wkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4DA2FF"/><stop offset="1" stop-color="#007AFF"/></linearGradient></defs>
    <line x1="${padX-4}" y1="${base}" x2="${W-padX+4}" y2="${base}" stroke="#E5E5EA" stroke-width="1"/>
    ${bars}
  </svg><div style="text-align:center;font-size:11px;color:#8E8E93;margin-top:2px">${T('week_bar_hint')(total)}</div>`;
}

/* —— 月度心情曲线（手绘 SVG） —— */
function renderMoodChart(){
  const now=new Date();const y=now.getFullYear(),m=now.getMonth();
  const dim=new Date(y,m+1,0).getDate();
  const moodVal={happy:5,calm:4,normal:3,tired:2,sad:1};
  const pts=[];
  for(let day=1;day<=dim;day++){
    const ds=fmt(new Date(y,m,day));const d=dayObj(ds);
    if(d&&d.mood)pts.push({day,v:moodVal[d.mood]||3,color:MMAP[d.mood].color});
  }
  const box=document.getElementById('moodChart');
  if(pts.length<2){box.innerHTML=`<div class="empty-tip" style="color:var(--ink-soft);padding:20px">${T('mood_need')}</div>`;return;}
  const W=340,H=150,pl=16,pr=16,pt=16,pb=24;
  const xw=W-pl-pr,yh=H-pt-pb;
  const xOf=day=>pl+(day-1)/(dim-1)*xw;
  const yOf=v=>pt+(5-v)/4*yh;
  // 网格线
  let grid='';for(let i=1;i<=5;i++){const yy=pt+(5-i)/4*yh;grid+=`<line x1="${pl}" y1="${yy}" x2="${W-pr}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>`;}
  // 折线
  const poly=pts.map(p=>`${xOf(p.day).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
  // 面积
  const area=`${xOf(pts[0].day).toFixed(1)},${H-pb} `+poly+` ${xOf(pts[pts.length-1].day).toFixed(1)},${H-pb}`;
  let dots=pts.map(p=>`<circle cx="${xOf(p.day).toFixed(1)}" cy="${yOf(p.v).toFixed(1)}" r="3.5" fill="#007AFF" stroke="#fff" stroke-width="1.5"/>`).join('');
  box.innerHTML=`<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block">
    ${grid}
    <polygon points="${area}" fill="url(#mg)" opacity="0.18"/>
    <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#007AFF" stop-opacity="0.22"/><stop offset="1" stop-color="#007AFF" stop-opacity="0"/></linearGradient></defs>
    <polyline points="${poly}" fill="none" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg><div style="display:flex;justify-content:space-between;font-size:9px;color:var(--ink-mute);padding:0 4px;">${MOODS.slice().reverse().map(m=>`<span>${m.emoji}${m.name}</span>`).join('')}</div>`;
}

/* —— 徽章 —— */
function renderBadges(){
  if(!data.meta)data.meta={};
  if(!data.meta.badges||typeof data.meta.badges!=='object'||Array.isArray(data.meta.badges))data.meta.badges={};
  let newlyEarned=false;
  document.getElementById('badgeGrid').innerHTML=BADGES.map(b=>{
    /* 首次达成就定格：原来 got 每次重算，断一次签徽章就从「已解锁」退回锁住，
       用户看到的是「我拿到的东西被收回了」。 */
    if(b.test(data)&&!data.meta.badges[b.id]){ data.meta.badges[b.id]=Date.now(); newlyEarned=true; }
    const got=!!data.meta.badges[b.id];
    const rem=(b.g&&!got)?badgeGaugeText(b):'';
    return `<div class="badge ${got?'got':'locked'}"><div class="bi">${b.icon}</div><div class="bn">${b.name}</div><div class="bd">${b.desc}</div>${rem?`<div class="bg-rem">${rem}</div>`:''}</div>`;
  }).join('');
  if(newlyEarned)saveDebounced();
}
/* 未解锁徽章："还差 X" 进度提示（数值型徽章专用） */
function badgeGaugeText(b){
  try{
    const cur=Math.max(0,Math.floor(Number(b.g.cur(data))||0));
    const need=b.g.goal-cur;
    if(need<=0)return '';
    const u=(LANG==='en')?b.g.uen:b.g.uzh;
    return (LANG==='en')?(need+' '+u+' to go'):('还差 '+need+' '+u);
  }catch(_){return '';}
}

/* ============ 渲染：我的页 ============ */
