/* Shared calendar rules: renderer and reminder process use the same decisions. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HabitRules=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const validDate=ds=>/^\d{4}-\d{2}-\d{2}$/.test(ds||'')&&fmt(new Date(ds+'T12:00:00'))===ds;
  function date(ds){return new Date(ds+'T12:00:00');}
  function fmt(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function shift(ds,n){const d=date(ds);d.setDate(d.getDate()+n);return fmt(d);}
  function week(ds){const d=date(ds);d.setDate(d.getDate()-(d.getDay()+6)%7);return fmt(d);}
  function rule(h,ds){
    const history=Array.isArray(h.scheduleHistory)?h.scheduleHistory:[];
    const row=history.filter(r=>r&&validDate(r.from)&&r.from<=ds).sort((a,b)=>a.from.localeCompare(b.from)).pop();
    const raw=row?row.rule:(history.length?null:h.schedule);
    if(raw&&raw.mode==='weekly')return {mode:'weekly',times:Math.max(1,Math.min(7,Math.round(Number(raw.times)||1)))};
    if(raw&&raw.mode==='weekdays')return {mode:'weekdays',days:[...new Set((Array.isArray(raw.days)?raw.days:[]).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))]};
    return {mode:'daily'};
  }
  function exception(h,ds){return (Array.isArray(h.pauseRanges)?h.pauseRanges:[]).find(r=>r&&validDate(r.from)&&r.from<=ds&&(!r.to||r.to>=ds));}
  function eligible(h,ds){
    if(!h||!validDate(ds)||(h.createdAt&&ds<h.createdAt)||(h.archivedAt&&ds>=h.archivedAt)||(h.deletedAt&&ds>=h.deletedAt)||exception(h,ds))return false;
    const r=rule(h,ds);return r.mode!=='weekdays'||r.days.includes(date(ds).getDay());
  }
  function done(h,d){
    if(!d)return false;
    if(d[h.key+'_done']!==undefined)return d[h.key+'_done']===1||d[h.key+'_done']===true;
    if(h.type==='bool')return !!d[h.key];
    return Number(d[h.key]||0)>=Number(d[h.key+'_t']||h.target||1);
  }
  function weeklyProgress(h,ds,days){
    const start=week(ds),r=rule(h,ds);let completed=0,available=0;
    for(let i=0;i<7;i++){const key=shift(start,i);if(eligible(h,key)&&rule(h,key).mode==='weekly'){available++;if(done(h,days[key]))completed++;}}
    return {done:completed,target:Math.min(r.times||1,available),start,end:shift(start,6)};
  }
  function due(h,ds,days){
    if(!eligible(h,ds))return false;
    if(rule(h,ds).mode!=='weekly')return true;
    const p=weeklyProgress(h,ds,days||{});return done(h,(days||{})[ds])||p.done<p.target;
  }
  function periods(h,from,to,days){
    if(!validDate(from)||!validDate(to)||from>to)return [];
    const groups=new Map();let steps=0;
    for(let ds=from;ds<=to&&steps++<36600;ds=shift(ds,1)){
      if(!eligible(h,ds))continue;
      const r=rule(h,ds),key=r.mode==='weekly'?'w:'+week(ds):'d:'+ds;
      if(!groups.has(key))groups.set(key,{key,start:ds,end:r.mode==='weekly'?shift(week(ds),6):ds,weekly:r.mode==='weekly',target:r.times||1,dates:[],done:0});
      const g=groups.get(key);if(g.weekly)g.target=r.times;g.dates.push(ds);if(done(h,(days||{})[ds]))g.done++;
    }
    return [...groups.values()].map(g=>({...g,expected:g.weekly?Math.min(g.target,g.dates.length):1,done:Math.min(g.done,g.weekly?Math.min(g.target,g.dates.length):1)}));
  }
  function stats(h,from,to,days){
    const rows=periods(h,from,to,days);return {expected:rows.reduce((n,g)=>n+g.expected,0),done:rows.reduce((n,g)=>n+g.done,0),periods:rows};
  }
  function streak(h,from,to,days,best,weeklyMode){
    const rows=periods(h,from,to,days);let current=0,maximum=0;
    rows.forEach((g,i)=>{if(typeof weeklyMode==='boolean'&&g.weekly!==weeklyMode){current=0;return;}const expected=g.weekly&&g.end>=to?weeklyProgress(h,to,days||{}).target:g.expected;if(g.done>=expected){current++;maximum=Math.max(maximum,current);}else if(best||i!==rows.length-1||g.end<to)current=0;});
    return best?maximum:current;
  }
  function cleanPlan(h){
    const out={pinned:h.pinned===true};
    const cleanRule=r=>{
      if(!r||!['daily','weekly','weekdays'].includes(r.mode))throw new Error('执行计划格式无效');
      if(r.mode==='daily')return {mode:'daily'};
      if(r.mode==='weekly'){if(!Number.isInteger(r.times)||r.times<1||r.times>7)throw new Error('每周目标次数无效');return {mode:'weekly',times:r.times};}
      if(!Array.isArray(r.days)||!r.days.length||r.days.some(n=>!Number.isInteger(n)||n<0||n>6))throw new Error('执行星期无效');return {mode:'weekdays',days:[...new Set(r.days)].sort()};
    };
    if(h.schedule)out.schedule=cleanRule(h.schedule);
    if(h.scheduleHistory!==undefined){
      if(!Array.isArray(h.scheduleHistory)||h.scheduleHistory.length>2000)throw new Error('计划历史超出限制');
      out.scheduleHistory=h.scheduleHistory.map(r=>{if(!r||!validDate(r.from))throw new Error('计划生效日期无效');return {from:r.from,rule:cleanRule(r.rule)};});
    }
    if(h.pauseRanges!==undefined){
      if(!Array.isArray(h.pauseRanges)||h.pauseRanges.length>2000)throw new Error('暂停记录超出限制');
      out.pauseRanges=h.pauseRanges.map(r=>{if(!r||!validDate(r.from)||(r.to&&(!validDate(r.to)||r.to<r.from))||!['pause','leave'].includes(r.kind))throw new Error('暂停日期无效');return {from:r.from,to:r.to||'',kind:r.kind};});
    }
    return out;
  }
  return {validDate,fmt,shift,week,rule,exception,eligible,done,weeklyProgress,due,periods,stats,streak,cleanPlan};
});
