/* ============ 自定义奖励机制（待领队列 + 墙钟倒计时） ============ */
/* 状态只有两种，且全部落盘，所以刷新 / 缩托盘 / 切页都不会把奖励弄丢：
   meta.rewardQueue —— 待领取队列（「稍后再说」也留在这里，从卡片角标可再领）
   meta.rewardRun  —— 正在进行的倒计时，存 endAt（墙钟毫秒）而不是剩余秒数
   旧实现用「一个全局 interval + 弹窗没关就直接 return」表达状态，因此
   跨两小时只弹一次、两个习惯互踩、点「退出」后按钮态残留，都在这里收口。 */
let rewardTicker=null;
let rwCelebrating=false;
let rwCardItem=null;   /* 当前领取卡对应的那条队列项：习惯被彻底删除时要连带收起，别让人领一个已不存在的奖励 */
function rwMeta(){ if(!data.meta)data.meta={}; return data.meta; }
function rwQueue(){ const m=rwMeta(); if(!Array.isArray(m.rewardQueue))m.rewardQueue=[]; return m.rewardQueue; }
function rwMask(){ return document.getElementById('rewardMask'); }
function rwMaskOpen(){ const m=rwMask(); return !!m && !m.hidden; }
function rwRunning(){ const r=rwMeta().rewardRun; return (r&&r.endAt&&r.endAt>Date.now())?r:null; }
/* 到点但没人结算的记录（缩托盘/休眠期间过去的）必须被取回来补一次庆祝，
   否则奖励又变成「默默蒸发」——这正是本次要收口的病灶之一。 */
function rwTakeExpired(){ const m=rwMeta(), r=m.rewardRun; if(r&&!(r.endAt>Date.now())){ delete m.rewardRun; return r; } return null; }
function rwFmt(s){ s=Math.max(0,s|0); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }
function rwLeft(r){ return Math.max(0,Math.round(((r&&r.endAt||0)-Date.now())/1000)); }
function rwNormMin(v){ return Math.max(1,Math.min(600,Math.round(Number(v)||20))); }
/* 台账：原来奖励结算即弃，用户看不到「这段时间到底领了多少、哪几条没领」。
   只保留最近 200 条，避免 localStorage 无界增长。 */
function rwLog(key,text,min,state){
  try{
    const m=rwMeta();
    if(!Array.isArray(m.rewardLedger))m.rewardLedger=[];
    m.rewardLedger.push({k:key,t:String(text||'').slice(0,30),m:rwNormMin(min),ts:Date.now(),s:state});
    if(m.rewardLedger.length>200)m.rewardLedger=m.rewardLedger.slice(-200);
  }catch(_){}
}
function rwStopTicker(){ if(rewardTicker){clearInterval(rewardTicker);rewardTicker=null;} }
function rwStartTicker(){ rwStopTicker(); rewardTicker=setInterval(rwPaint,1000); }
/* 卡片只重置可见态，不动队列与倒计时 */
function rwResetCard(){
  const run=document.getElementById('rwRun'); if(run)run.hidden=true;
  const bs=document.getElementById('rwStart'), bl=document.getElementById('rwLater');
  if(bs)bs.style.display=''; if(bl)bl.style.display='';
  const mask=rwMask(); if(mask)mask.onclick=null;
}
function rwCloseCard(){ const m=rwMask(); if(m)m.hidden=true; rwCardItem=null; rwSyncPill(); }
/* kind: 'check'=完成一次；'hours'=专注小时累计 */
function maybeReward(h,kind,hoursAdded,deferPresentation){
  try{
    var rw=h&&h.reward; if(!rw||!rw.text)return;
    var per=rw.per||'check';   /* 老存档/导入件可能没有 per，按表单默认「每次完成」兜底，别静默永不触发 */
    if(kind==='check'&&per==='check'){ rwEnqueue(h); return; }
    if(kind==='hours'&&per==='hour'&&hoursAdded>0){
      var m=rwMeta(); if(!m.rewardHourAcc)m.rewardHourAcc={};
      var acc=Math.round(((Number(m.rewardHourAcc[h.key])||0)+hoursAdded)*3600000)/3600000;
      var got=0;
      while(acc+1e-9>=1){ acc=Math.max(0,acc-1); got++; }
      m.rewardHourAcc[h.key]=acc;
      for(var i=0;i<got;i++)rwEnqueue(h,true);
      if(got){ saveDebounced(); rwSyncAffordances(); if(!deferPresentation)pumpReward(); }
    }
  }catch(_){}
}
function rwEnqueue(h,silent){
  const rw=h&&h.reward; if(!rw||!rw.text)return;
  rwQueue().push({key:h.key,text:String(rw.text).slice(0,30),min:rwNormMin(rw.minutes),icon:h.icon||'🎁',name:h.name||'',ts:Date.now()});
  rwLog(h.key,rw.text,rw.minutes,'earned');
  saveDebounced(); rwSyncAffordances();
  if(!silent)pumpReward();   /* 批量入队（跨多小时）时只弹一次，其余留在角标待领 */
}
/* 消费端：弹窗开着 / 有倒计时在跑时不抢屏，交给角标和 pill 承接 */
function pumpReward(){
  if(rwMaskOpen()||rwRunning())return;
  const q=rwQueue(); if(!q.length)return;
  rwOpenCard(q[0]);
}
function rwOpenCard(item){
  const mask=rwMask(); if(!mask||!item)return;
  rwCelebrating=false; rwResetCard(); rwCardItem=item;
  document.getElementById('rwTitle').textContent=T('rw_title');
  document.getElementById('rwDesc').textContent=(item.icon||'')+' '+item.text;
  document.getElementById('rwTimer').textContent='';
  document.getElementById('rwBar').style.width='0%';
  const bs=document.getElementById('rwStart'), bl=document.getElementById('rwLater');
  bs.textContent=T('rw_start')+(item.min?('（'+item.min+'min）'):'');
  bl.textContent=T('rw_later');
  mask.hidden=false;
  /* 「稍后再说」不再等于作废：挪到队尾，角标上的待领数会保留 */
  bl.onclick=function(){ const q=rwQueue(),i=q.indexOf(item); if(i>=0){q.splice(i,1);q.push(item);} saveDebounced(); rwCloseCard(); rwSyncAffordances(); };
  bs.onclick=function(){ rwStart(item); };
}
function rwStart(item){
  if(rwRunning())return;                     /* 一次只享一个奖励 */
  const q=rwQueue(), i=q.indexOf(item); if(i>=0)q.splice(i,1);
  const total=rwNormMin(item.min)*60;
  rwMeta().rewardRun={key:item.key,text:item.text,min:item.min,total:total,endAt:Date.now()+total*1000};
  saveDebounced();
  rwShowRun();
}
function rwShowRun(){
  const r=rwRunning(), mask=rwMask(); if(!r||!mask)return;
  rwCelebrating=false; rwResetCard();
  document.getElementById('rwTitle').textContent=T('rw_title');
  document.getElementById('rwDesc').textContent=r.text;
  const bs=document.getElementById('rwStart'), bl=document.getElementById('rwLater');
  if(bs)bs.style.display='none'; if(bl)bl.style.display='none';
  const run=document.getElementById('rwRun'); if(run)run.hidden=false;
  document.getElementById('rwBg').textContent=T('rw_bg');
  document.getElementById('rwExit').textContent=T('rw_exit');
  rwPaint();
  mask.hidden=false;
  /* 每个出口都走同一条收口，避免上一版「退出后按钮残留」 */
  document.getElementById('rwBg').onclick=function(){ rwCloseCard(); };
  document.getElementById('rwExit').onclick=function(){ rwAbandon(); };
  mask.onclick=function(e){ if(e.target===mask)rwCloseCard(); };   /* 点遮罩=转后台，弹窗不会卡住操作 */
  rwStartTicker();
}
function rwPaint(){
  const r=rwRunning();
  if(!r){
    const done=rwTakeExpired();
    if(done){ rwFinish(done); return; }        /* 节流/休眠期间到点：回来补结算 */
    rwStopTicker(); if(!rwCelebrating){ rwCloseCard(); pumpReward(); } return;
  }
  const left=rwLeft(r);
  const tm=document.getElementById('rwTimer'), bar=document.getElementById('rwBar');
  if(tm)tm.textContent=rwFmt(left);
  if(bar&&r.total)bar.style.width=Math.round((r.total-left)/r.total*100)+'%';
  rwSyncPill(left);
  if(left<=0)rwFinish(r);
}
function rwFinish(r){
  if(rwCelebrating)return;
  rwCelebrating=true; rwStopTicker();
  const m=rwMeta(); if(m.rewardRun)delete m.rewardRun;
  if(r)rwLog(r.key,r.text,r.min,'used');
  saveDebounced(); rwSyncAffordances();
  const tm=document.getElementById('rwTimer'), bar=document.getElementById('rwBar');
  if(tm)tm.textContent='🎉'; if(bar)bar.style.width='100%';
  rwSyncPill();
  const h=r&&HMAP[r.key];
  try{ celebrate(null,(h&&h.color)||'#007AFF',true,false,h&&h.icon); }catch(_){}
  try{ playFocusCompleteSound(); }catch(_){}
  try{ beep(1568,.18); setTimeout(function(){beep(2093,.28);},180); }catch(_){}   /* 到点铃声 */
  toast(T('rw_done'),'good');
  setTimeout(function(){ rwCelebrating=false; rwCloseCard(); pumpReward(); },1800);
}
function rwAbandon(){ rwStopTicker(); const m=rwMeta(); if(m.rewardRun){ rwLog(m.rewardRun.key,m.rewardRun.text,m.rewardRun.min,'quit'); delete m.rewardRun; } saveDebounced(); rwResetCard(); rwCloseCard(); rwSyncAffordances(); pumpReward(); }
function rwSyncPill(left){
  const p=document.getElementById('rwPill'); if(!p)return;
  const r=rwRunning();
  if(!r){ p.hidden=true; p.classList.remove('is-pulse'); return; }
  p.textContent='🎁 '+rwFmt(left===undefined?rwLeft(r):left);
  p.hidden=rwMaskOpen();
}
/* 角标：把「有没有奖励、值多少、攒到哪了、能不能领」直接画在卡片标题旁 */
function rewardChipHTML(h){
  const rw=h&&h.reward; if(!rw||!rw.text)return '';
  const per=rw.per||'check';
  const sq=h.size==='square';
  const acc=Number((rwMeta().rewardHourAcc||{})[h.key])||0;
  const mins=rwNormMin(rw.minutes);
  const q=rwQueue(); let n=0;
  for(let i=0;i<q.length;i++){ if(q[i].key===h.key)n++; }
  let body;
  if(n>0)body='🎁 '+T('rw_pending')+' ×'+n;
  else if(per==='hour')
    /* 方形卡放不下两段：只留奖励时长，攒多少进 title 提示（原来靠 CSS display:none 抠掉时长，
       结果整张方卡的角标塌成一个裸 🎁，还留下一个孤零零的「 · 」） */
    body=sq?'🎁 '+mins+'min'
           :'🎁 '+mins+'min · <span class="rw-c-pct">'+T('rw_banked')+' '+acc.toFixed(1)+'/1h</span>';
  else body='🎁 <span class="rw-c-min">'+mins+'min</span>';
  const tip=T('rw_label')+'：'+rw.text+' ｜ '+mins+'min ｜ '+T(per==='hour'?'rw_per_hour':'rw_per_check')
    +(per==='hour'?(' ｜ '+T('rw_banked')+' '+acc.toFixed(1)+'/1h'):'')+(n>0?(' ｜ '+T('rw_ready')):'');
  return `<span class="rw-chip${n>0?' is-ready':''}"${n>0?` onclick="claimReward(event,'${jsStr(h.key)}')"`:''} title="${esc(tip)}">${body}</span>`;
}
function claimReward(e,key){
  try{ if(e){e.stopPropagation();e.preventDefault();} }catch(_){}
  if(rwRunning()){ const p=document.getElementById('rwPill'); if(p){p.hidden=false;p.classList.remove('is-pulse');void (p.offsetWidth);p.classList.add('is-pulse');} toast(T('rw_busy')); return; }
  const q=rwQueue(); let it=null;
  for(let i=0;i<q.length;i++){ if(q[i].key===key){ it=q.splice(i,1)[0]; break; } }
  if(!it)return;
  q.unshift(it); saveDebounced();
  if(rwMaskOpen())rwCloseCard();
  rwOpenCard(it);
}
function rwSyncAffordances(){ checkinDirty=true; habitDirty=true; renderAll(true); }
/* 彻底删除习惯时连历史一起清掉，别留下幽灵余额 / 领不到的奖励 */
function rwDropHabit(key){
  const m=rwMeta();
  if(m.rewardHourAcc)delete m.rewardHourAcc[key];
  if(Array.isArray(m.rewardQueue))m.rewardQueue=m.rewardQueue.filter(x=>x&&x.key!==key);
  if(m.rewardRun&&m.rewardRun.key===key){ rwStopTicker(); delete m.rewardRun; rwCloseCard(); }
  if(rwCardItem&&rwCardItem.key===key){ rwResetCard(); rwCloseCard(); }
}
/* 编辑器里的实时预览 + 触发方式与习惯类型的错配告警 */
function updateRewardPreview(){
  const box=document.getElementById('rwPreview'), warn=document.getElementById('rwWarn');
  if(!box)return;
  const txtEl=document.getElementById('edRewardText'), minEl=document.getElementById('edRewardMin'), perEl=document.getElementById('edRewardPer');
  const txt=txtEl?(txtEl.value||'').trim():'';
  const min=minEl?Math.max(0,Math.min(600,Math.round(Number(minEl.value)||0))):0;
  const per=perEl?perEl.value:'check';
  if(!txt){ box.className='rw-prev is-off'; box.textContent=T('rw_off'); if(warn)warn.hidden=true; return; }
  const mins=rwNormMin(min);
  box.className='rw-prev';
  box.innerHTML='✅ '+T('rw_prev')+' <b>'+esc(txt)+'</b> · '+mins+'min · '+T(per==='hour'?'rw_per_hour':'rw_per_check');
  const dead=(edSel.type==='hours'&&per==='check')||(edSel.type!=='hours'&&per==='hour');
  if(warn){ warn.hidden=!dead; if(dead)warn.textContent=T(edSel.type==='hours'?'rw_warn_check':'rw_warn_hour'); }
}
function hideReward(){ rwCloseCard(); }   /* 兼容旧调用名：只收起弹窗，不作废队列或倒计时 */
/* 启动 / 唤醒时把状态接回来：倒计时按墙钟续上，队列靠角标与 pill 提示 */
function rwResume(){
  const p=document.getElementById('rwPill');
  if(p&&!p._bound){ p._bound=1; p.onclick=function(){ if(rwRunning())rwShowRun(); else pumpReward(); }; }
  if(rwRunning()){ rwStartTicker(); rwPaint(); return; }
  const done=rwTakeExpired();               /* 整个倒计时期间应用没醒：启动时补一次结算，别让它无声蒸发 */
  if(done){ rwFinish(done); return; }
  rwSyncPill();
  if(rwQueue().length){ rwResetCard(); rwSyncAffordances(); }
}
window.maybeReward=maybeReward; window.hideReward=hideReward; window.claimReward=claimReward;
window.updateRewardPreview=updateRewardPreview; window.rewardChipHTML=rewardChipHTML; window.rwResume=rwResume;

