/* ============ 连续天数（漏一天归零） ============ */


var _streakCache={},_streakCacheDirty=true;
function streakCacheReset(){_streakCacheDirty=true;_streakCache={};aggCacheReset();}


var _aggCache={},_aggCacheDirty=true;
function aggCacheReset(){_aggCacheDirty=true;_aggCache={};}
function _agg(key,fn){
  if(!_aggCacheDirty&&_aggCache[key]!==undefined)return _aggCache[key];
  const v=fn();_aggCache[key]=v;return v;
}
function streakOf(key,endDate){
  const ck='cur|'+key+'|'+(endDate||'');
  if(!_streakCacheDirty&&_streakCache[ck]!==undefined)return _streakCache[ck];
  const planned=HMAP[key];
  if(planned&&(planned.schedule||planned.scheduleHistory||planned.pauseRanges)){const n=window.HabitRules.streak(planned,habitCreatedAt(planned),endDate||todayStr(),data.days,false,window.HabitRules.rule(planned,endDate||todayStr()).mode==='weekly');_streakCache[ck]=n;return n;}
  let s=0;const anchor=endDate||todayStr();const dt=new Date(anchor+'T12:00:00');
  // 当前基准日没打不算断，从前一天往前数
  if(!isDone(key,dayObj(anchor)))dt.setDate(dt.getDate()-1);
  while(true){
    const ds=fmt(dt);
    if(isDone(key,dayObj(ds))){s++;dt.setDate(dt.getDate()-1);}
    else break;
  }
  _streakCache[ck]=s;
  return s;
}
function bestStreakOf(key){
  const ck='best|'+key;
  if(!_streakCacheDirty&&_streakCache[ck]!==undefined)return _streakCache[ck];
  const planned=HMAP[key];
  if(planned&&(planned.schedule||planned.scheduleHistory||planned.pauseRanges)){const n=window.HabitRules.streak(planned,habitCreatedAt(planned),todayStr(),data.days,true,window.HabitRules.rule(planned,todayStr()).mode==='weekly');_streakCache[ck]=n;return n;}
  const dates=Object.keys(data.days).filter(ds=>isDone(key,data.days[ds])).sort();
  let best=0;
  if(dates.length){
    best=1;let cur=1;
    for(let i=1;i<dates.length;i++){
      const prev=new Date(dates[i-1]),now=new Date(dates[i]);
      const diff=Math.round((now-prev)/86400000);
      if(diff===1){cur++;best=Math.max(best,cur);}else cur=1;
    }
  }
  _streakCache[ck]=best;
  return best;
}
/* 标签是「最长连续」，就必须用历史最佳而不是当前连续：
   原来这里取 max(streakOf(当前))，断签后顶栏/统计/我的三处数字会一起变小，
   徽章（7/14/30 天）也会跟着退回未解锁。软删除的习惯历史保留，故一并计入。 */
function bestDailyStreak(h){
  if(!(h.schedule||h.scheduleHistory||h.pauseRanges))return bestStreakOf(h.key);
  let current=0,best=0;
  window.HabitRules.periods(h,habitCreatedAt(h),todayStr(),data.days).forEach(g=>{if(g.weekly||g.done<g.expected)current=0;else{current++;best=Math.max(best,current);}});
  return best;
}
function maxStreakAll(){return _agg('maxStreakAll',()=>Math.max(0,...HABITS.map(bestDailyStreak)));}


function migrateCreatedAt(h,days){
  if(!h||/^\d{4}-\d{2}-\d{2}$/.test(h.createdAt||''))return;
  let mn=null;
  Object.keys(days||{}).forEach(function(ds){
    const day=days[ds];
    if(day&&((h.key in day)||((h.key+'_s') in day)||((h.key+'_e') in day))&&(!mn||ds<mn))mn=ds;
  });
  if(!mn)Object.keys(days||{}).forEach(function(ds){if(!mn||ds<mn)mn=ds;});
  const t=todayStr();
  h.createdAt=(mn&&mn<=t)?mn:t;
}
function habitCreatedAt(h){if(h) migrateCreatedAt(h,data.days);return (h&&h.createdAt)||todayStr();}
/* 正午锚定的日历天数差（DST 安全，与项目日期处理同套路），含首尾两天 */
function dateSpanDays(a,b){return Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000)+1;}
function completionRate(key){
  return _agg('rate|'+key,()=>{
    const h=HMAP[key];if(!h)return 0;
    const from=habitCreatedAt(h),to=todayStr();
    if(h.schedule||h.scheduleHistory||h.pauseRanges){const s=window.HabitRules.stats(h,from,to,data.days);return s.expected?Math.round(s.done/s.expected*100):0;}
    if(from>to)return 0;
    let done=0;
    Object.keys(data.days).forEach(function(ds){if(ds>=from&&ds<=to&&isDone(key,data.days[ds]))done++;});
    return Math.round(done/dateSpanDays(from,to)*100);
  });
}
function totalCheckins(){
  return _agg('totalCheckins',()=>{
    let n=0;Object.values(data.days).forEach(d=>{HABITS.forEach(h=>{if(isDone(h.key,d))n++;});});return n;
  });
}


function hasPerfectDay(){
  return _agg('hasPerfectDay',()=>Object.values(data.days).some(d=>{
    if(!d||typeof d!=='object')return false;
    const keys=HABITS.filter(h=>d[h.key]!==undefined||d[h.key+'_s']!==undefined||d[h.key+'_e']!==undefined).map(h=>h.key);
    return keys.length>0&&keys.every(k=>isDone(k,d));
  }));
}
function moodCount(){return _agg('moodCount',()=>Object.values(data.days).filter(d=>d.mood).length);}
/* 只计「有真实内容」的记录日：打卡值/心情/备注都算；仅带 _late 补记标记的空壳日不算
   （打卡入口在确认弹窗前已不再物化空日，此处把历史遗留空壳日一并排除） */
function dayHasRecord(d){
  if(!d||typeof d!=='object')return false;
  return Object.keys(d).some(function(k){return k!=='_late'&&d[k]!==undefined;});
}
function recordCount(){return _agg('recordCount',()=>Object.values(data.days).filter(dayHasRecord).length);}

