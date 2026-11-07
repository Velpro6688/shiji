/* ============ 渲染：顶栏 ============ */
function renderTop(){
  const h=new Date().getHours();
  const hi=h<6?T('hi_night'):h<11?T('hi_morning'):h<14?T('hi_noon'):h<18?T('hi_afternoon'):h<22?T('hi_evening'):T('hi_night');
  document.getElementById('tbHi').textContent=hi;
  document.getElementById('tbName').textContent=data.profile.name||'用户';
  setAva('tbAva');
  const wk=T('weekdays')[new Date().getDay()];
  const dt=new Date();
  document.getElementById('tbDate').textContent=T('fmt_date')(dt.getMonth()+1,dt.getDate(),wk);
  document.getElementById('tbStreak').textContent=maxStreakAll();
}

/* ============ 渲染：今日进度环 ============ */
function renderRing(){
  const d=dayObj(viewDate)||{};
  const list=habitsVisibleOn(viewDate).filter(h=>window.HabitRules.eligible(h,viewDate));
  const total=list.length;
  const doneCnt=list.filter(h=>isDone(h.key,d)).length;
  const pct=total?Math.round(doneCnt/total*100):0;
  const weeklyDone=!total&&activeHabits().some(h=>window.HabitRules.rule(h,viewDate).mode==='weekly'&&window.HabitRules.eligible(h,viewDate)&&!window.HabitRules.due(h,viewDate,data.days));
  const R=44,C=2*Math.PI*R,off=C*(1-pct/100);
  document.getElementById('ringWrap').innerHTML=`
    <svg width="104" height="104" viewBox="0 0 104 104">
      <circle cx="52" cy="52" r="${R}" fill="none" stroke="var(--on-grad-fill)" stroke-width="9"/>
      <circle cx="52" cy="52" r="${R}" fill="none" stroke="var(--on-grad)" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 52 52)"
        style="transition:stroke-dashoffset .6s cubic-bezier(.22,.9,.3,1)"/>
    </svg>
    <div class="ring-center"><b>${weeklyDone?'✓':total?pct:'—'}<span style="font-size:14px">${total?'%':''}</span></b><small>${weeklyDone?'周目标完成':total?doneCnt+'/'+total+' '+T('complete'):'今日无安排'}</small></div>`;
  document.getElementById('ringTitle').textContent=weeklyDone?'本周计划已完成':!total?(activeHabits().length?'今天可以轻松一点':'从一个小习惯开始'):pct>=100?T('ring_done'):pct>=50?T('ring_half'):pct>0?T('ring_start'):T('ring_new');
  const motto=document.getElementById('ringMotto');
  if(motto&&!motto.matches(':focus'))motto.value=data.profile.motto||'';
  if(motto){motto.placeholder=T('motto_ph');resizeMotto(motto);}
  

  const streaks=list.map(h=>({h,s:streakOf(h.key,viewDate),done:isDone(h.key,d)}))
    .filter(x=>x.done&&x.s>0).sort((a,b)=>b.s-a.s).slice(0,12);   
  /* 单个习惯有待领时，卡片角标已经写清了，这里就不再重复一遍；
     只有跨多个习惯堆着奖励时，才值得在环上给一个「一次领完」的总入口。 */
  const pend=typeof rwQueue==='function'?rwQueue():[];
  const pendKeys={};pend.forEach(function(x){if(x&&x.key)pendKeys[x.key]=1;});
  const pendHabitCount=Object.keys(pendKeys).length;
  let tagHtml=(streaks.length?'<span class="rtag-group">'+T('ring_streak_tag')+'</span>':'')
    +streaks.map(x=>`<button type="button" class="rtag rtag-done" onclick="jumpToHabit('${jsStr(x.h.key)}')" title="${esc(x.h.name)} · ${T('ring_streak_tag')} ${x.s} ${window.HabitRules.rule(x.h,viewDate).mode==='weekly'?'周':T('unit_day')} · ${T('ring_todo_tip')}">✓ ${esc(x.h.name)} · ${x.s}${window.HabitRules.rule(x.h,viewDate).mode==='weekly'?'周':T('unit_day')}</button>`).join('');
  if(pendHabitCount>=2)tagHtml+=`<span class="rtag rtag-rw" onclick="claimNextReward()" title="${T('rw_ready')}">${T('rw_pending')} ×${pend.length}</span>`;
  document.getElementById('ringTags').innerHTML=tagHtml;
}
/* 定位到某张习惯卡并闪一下 */
var habitJumpGeneration=0;
function jumpToHabit(key,tries){
  const generation=++habitJumpGeneration;
  go('today');
  

  const locate=function(attempt){
    if(generation!==habitJumpGeneration)return;
    const card=Array.from(document.querySelectorAll('#checkinList .hcard')).find(el=>el.dataset.habitKey===key);
    if(!card){
      if(!attempt){
        if(habitsVisibleOn(viewDate).some(h=>h.key===key)&&window.HabitUI)window.HabitUI.resetFilter();
        requestAnimationFrame(function(){locate(1);});return;
      }
      console.warn('[jumpToHabit] 未找到习惯卡片：'+key);
      toast(T('ring_jump_missing'));
      return;
    }
    const scroll=document.getElementById('scroll'),rect=card.getBoundingClientRect(),sr=scroll.getBoundingClientRect();
    const nav=document.querySelector('#app > .date-nav'),nr=nav&&nav.getBoundingClientRect();
    const top=Math.max(sr.top,nr&&nr.height?nr.bottom+10:sr.top)+8;
    const height=Math.max(1,sr.bottom-top-12);
    const desired=rect.height<height?top+(height-rect.height)/2:top;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroll.scrollTo({top:Math.max(0,scroll.scrollTop+rect.top-desired),behavior:reduced?'auto':'smooth'});
    card.setAttribute('tabindex','-1');card.focus({preventScroll:true});
    

    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    if(card._flashT)clearTimeout(card._flashT);
    card._flashT=setTimeout(function(){card.classList.remove('flash');card._flashT=0;},1500);
  };
  requestAnimationFrame(function(){locate(tries||0);});
}
function claimNextReward(){
  if(rwRunning()){toast(T('rw_busy'));const p=document.getElementById('rwPill');if(p)p.hidden=false;return;}
  if(rwMaskOpen())rwCloseCard();
  pumpReward();
}
window.jumpToHabit=jumpToHabit; window.claimNextReward=claimNextReward;
let mottoSaveTimer=null;
function saveMotto(value){
  const motto=document.getElementById('ringMotto');if(motto)resizeMotto(motto);
  data.profile.motto=String(value||'').slice(0,160);
  clearTimeout(mottoSaveTimer);
  mottoSaveTimer=setTimeout(save,350);
}
function resizeMotto(el){
  if(!el)return;
  el.style.height='40px';
  el.style.height=Math.min(82,Math.max(40,el.scrollHeight))+'px';
}

/* ============ 渲染：今天还差什么 ============ */
function renderTodo(){
  const d=dayObj(viewDate);const late=viewDate===todayStr()&&new Date().getHours()>=20 && data.settings.remindSummary;
  const list=habitsVisibleOn(viewDate).filter(h=>window.HabitRules.eligible(h,viewDate));
  const undone=list.filter(h=>!isDone(h.key,d));
  var expand=document.getElementById('ringExpand');
  if(expand){expand.hidden=undone.length<=1;expand.textContent=expand.getAttribute('aria-expanded')==='true'?T('ring_collapse'):T('ring_show_all').replace('{n}',undone.length);}
  const box=document.getElementById('ringTodo');if(!box)return;
  if(!list.length){const weeklyDone=activeHabits().some(h=>window.HabitRules.rule(h,viewDate).mode==='weekly'&&window.HabitRules.eligible(h,viewDate)&&!window.HabitRules.due(h,viewDate,data.days));box.innerHTML='<span class="ring-todo-label">'+(weeklyDone?'本周目标已达成，继续保持节奏':activeHabits().length?'今日暂无待执行计划':T('todo_no_habit'))+'</span>';return;}
  if(!undone.length){box.innerHTML=`<span class="ring-todo-all">${T('ring_alldone')}</span>`;return;}
  /* 芯片可点：点了滚到那张卡并闪一下；超过 8 项折叠成 +N，避免习惯多时把环撑高 */
  box.innerHTML=`<span class="ring-todo-label">还差 ${undone.length} 项</span>`+undone.slice(0,8).map(h=>`<button type="button" class="ring-todo-chip ${late?'blink':''}" onclick="jumpToHabit('${jsStr(h.key)}')" title="${esc(h.name)} · ${T('ring_undone')} · ${T('ring_todo_tip')}">${esc(h.icon)}${esc(h.name)}</button>`).join('')+(undone.length>8?`<button type="button" class="ring-todo-chip" onclick="jumpToHabit('${jsStr(undone[8].key)}')">+${undone.length-8}</button>`:'');
}

function toggleRingDetails(){
  var card=document.querySelector('#page-today .ring-card'),button=document.getElementById('ringExpand');
  var expanded=card.classList.toggle('is-expanded');button.setAttribute('aria-expanded',String(expanded));renderTodo();
}
/* ============ 渲染：今日打卡列表 ============ */
function renderCheckin(){
  var __cl=document.getElementById('checkinList');
  if(__cl)__cl.classList.toggle('late-day',viewDate!==todayStr()&&(dayObj(viewDate)||{})._late===1);
  const d=dayObj(viewDate)||{};
  const box=document.getElementById('checkinList');
  if(!box)return;
  const allList=habitsVisibleOn(viewDate).slice().sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
  const list=window.HabitUI?window.HabitUI.filterHabits(allList,d,isDone):allList;
  if(!list.length){box.innerHTML=!allList.length&&activeHabits().length?'<div class="empty-tip">今日暂无待执行计划<br><button type="button" class="btn-ghost" onclick="openHabitManager()">查看习惯与本周进度</button></div>':window.HabitUI?window.HabitUI.emptyMarkup(allList.length):`<div class="empty-tip">${T('checkin_empty')}</div>`;return;}
  /* 整表重建前记住输入焦点：计时器 tick 等后台重绘会打断正在输入的数字/时间框（丢焦点+回滚未提交值） */
  const _foc=(function(){const af=document.activeElement;
    if(!af||af.tagName!=='INPUT'||!box.contains(af))return null;
    const card=af.closest('[data-habit-key]');if(!card)return null;
    const sibs=card.querySelectorAll('input'+(af.type?'[type="'+af.type+'"]':''));
    let idx=-1,i=0;for(const el of sibs){if(el===af){idx=i;break;}i++;}
    return {key:card.getAttribute('data-habit-key'),type:af.type,idx:idx,val:af.value,ss:af.selectionStart,se:af.selectionEnd};
  })();
  box.innerHTML=list.map(h=>{
    if(h.type!=='bool')h=Object.assign({},h,{target:targetOf(h.key,d,h)});
    const done=isDone(h.key,d);const st=streakOf(h.key,viewDate);
    const ro=h.archived||h.deleted||!!window.HabitRules.exception(h,viewDate);   /* 已归档/已删除：往期日期只读展示，记录可见不可改 */
    const sq=(h.size==='square');
    let body='';
    if(ro){
      /* 只读卡片：仅呈现当天记录值，无任何可点击/可输入控件 */
      if(h.type==='count'){
        const c=d[h.key]||0;let cups='';
        const show=Math.min(h.target||1,sq?6:12);
        for(let i=0;i<show;i++)cups+=`<div class="cup ${i<c?'full':''}"><div class="fill" style="background:linear-gradient(180deg,${cssColor(h.color)},${cssColor(h.color)})"></div></div>`;
        body=`<div class="cups">${cups}</div><div class="ro-row"><span class="info">${c}/${h.target||1} ${esc(h.unit||'')}</span></div>`;
      }else if(h.type==='hours'){
        body=`<div class="ro-row"><span class="info">${formatHours(d[h.key]||0)} / ${h.target||1} ${esc(h.unit||T('unit_hour'))}</span></div>`;
      }else if(h.type==='range'){
        const s=d[h.key+'_s'],e=d[h.key+'_e'];
        const hasRecordedTimes=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s||'')&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e||'');
        body=`<div class="ro-row">${hasRecordedTimes?`<span class="info">${esc(s)} → ${esc(e)}</span>`:''}<span class="info">${T('total_prefix')} <b>${d[h.key]||0}</b> ${esc(h.unit||T('unit_hour'))}</span></div>`;
      }else{
        body=`<button class="big-btn check-pill ${done?'on':''}" disabled>${done?`<svg class="tk" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> ${T('ro_done')}`:T('ro_undone')}</button>`;
      }
    }else if(h.type==='count'){
      const c=d[h.key]||0;let cups='';
      if(h.target>20){
        const pct=Math.max(0,Math.min(100,Math.round(c/h.target*100)));
        body=`<div class="count-progress" role="progressbar" aria-label="${T('count_value')} ${esc(h.name)}" aria-valuemin="0" aria-valuemax="${h.target}" aria-valuenow="${Math.min(c,h.target)}"><span style="width:${pct}%"></span></div><div class="count-entry"><span class="info">${c}/${h.target} ${esc(h.unit||'')}</span><input type="number" inputmode="numeric" min="0" max="${h.target}" step="1" value="${c}" aria-label="${T('count_value')} ${esc(h.name)}" onchange="setCountValue('${jsStr(h.key)}',this.value,event)"><button type="button" class="mini-btn" onclick="addCount('${jsStr(h.key)}',1,event)" aria-label="＋1">＋1</button></div>`;
      }else{
        const show=Math.min(h.target,sq?6:12);
        for(let i=0;i<show;i++)cups+=`<div class="cup ${i<c?'full':''}" onclick="setCount('${jsStr(h.key)}',${i},event)"><div class="fill" style="background:linear-gradient(180deg,${cssColor(h.color)},${cssColor(h.color)})"></div></div>`;
        body=`<div class="cups">${cups}</div><div class="cup-row"><span class="info">${c}/${h.target} ${esc(h.unit||'')}</span><button type="button" class="mini-btn" onclick="addCount('${jsStr(h.key)}',1,event)" aria-label="＋1">＋1</button></div>`;
      }
    }else if(h.type==='hours'){
      body=renderTimerPanel(h,d[h.key]||0);
    }else if(h.type==='range'){
      const dd=data.days[viewDate]||{};
      const hasDurationRecord=Number(d[h.key])>0;
      const s=dd[h.key+'_s']||(!hasDurationRecord?(h.start||'23:00'):'');
      const e=dd[h.key+'_e']||(!hasDurationRecord?(h.end||'07:00'):'');
      const dur=d[h.key]||0;
      body=`<div class="range-row">
          <div class="range-box"><label>${T('range_start')}${s?'':` <span class="range-unrecorded">${T('range_not_recorded')}</span>`}</label><input type="time" value="${esc(s)}" aria-label="${T('range_start')}${s?'':' · '+T('range_not_recorded')}" onchange="setRange('${jsStr(h.key)}','s',this.value,event)"></div>
          <div class="range-arrow">→</div>
          <div class="range-box"><label>${T('range_end')}${e?'':` <span class="range-unrecorded">${T('range_not_recorded')}</span>`}</label><input type="time" value="${esc(e)}" aria-label="${T('range_end')}${e?'':' · '+T('range_not_recorded')}" onchange="setRange('${jsStr(h.key)}','e',this.value,event)"></div>
        </div>
        <div class="range-result">${T('total_prefix')} <b>${dur||'—'}</b> ${dur?esc(h.unit||T('unit_hour')):''} ${sq?'':`· ${T('target')} ${h.target||1} ${esc(h.unit||T('unit_hour'))}`}</div>`;
    }else{
      body=`<button class="big-btn check-pill ${done?'on':''}" onclick="toggleBool('${jsStr(h.key)}',event)">${done?`<svg class="tk" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> ${T('btn_done')}`:T('btn_checkin')}</button>`;
    }
    return `<div class="hcard ${sq?'square':'wide'} ${h.type==='hours'&&!ro?'timer-card':''} ${done?'done':''} ${ro?'readonly':''}" data-habit-key="${esc(h.key)}">
      <div class="hh${h.type==='bool'?' hh-pill':''}">
        <div class="hi" ${ro?'':'role="button" tabindex="0" aria-label="'+T('edit_habit')+' '+esc(h.name)+'" data-dbedit="1" title="'+T('edit_habit')+'"'}>${esc(h.icon)}</div>
        <div class="hn">${h.pinned?'📌 ':''}${esc(h.name)}${window.HabitRules.rule(h,viewDate).mode==='weekly'?'<small class="weekly-progress">'+window.HabitRules.weeklyProgress(h,viewDate,data.days).done+'/'+window.HabitRules.weeklyProgress(h,viewDate,data.days).target+' 次 / 周</small>':''}${h.reward&&h.reward.text?rewardChipHTML(h):''}${ro?`<span class="ro-tag">${h.deleted?T('state_deleted'):h.archived?T('state_archived'):'暂停 / 请假'}</span>`:''}</div>
        ${ro?'':`<button type="button" class="habit-sort" draggable="true" title="拖动调整顺序" aria-label="拖动调整 ${esc(h.name)} 的顺序"></button>`}
        <div class="hstreak ${st?'':'zero'}">${st?`<span class="hstreak-fire">${icn('fire',12,2)}</span>`:''}${st?st+(window.HabitRules.rule(h,viewDate).mode==='weekly'?'周':T('unit_day')):''}</div>
        <div class="hstat">${done?icn('check',15,2.6):''}</div>
        ${ro?'':''
}
      </div>${body}</div>`;
  }).join('');
  if(_foc&&_foc.idx>=0){
    let newCard=null;
    box.querySelectorAll('[data-habit-key]').forEach(function(c){if(!newCard&&c.getAttribute('data-habit-key')===_foc.key)newCard=c;});
    const inputs=newCard?newCard.querySelectorAll('input'+(_foc.type?'[type="'+_foc.type+'"]':'')):[];
    const target=inputs[_foc.idx];
    if(target){
      if(_foc.val!==undefined&&target.value!==_foc.val)target.value=_foc.val;   /* 重绘会把 value 刷回存档值——保留用户未提交的输入 */
      target.focus();
      try{if(_foc.ss!=null&&target.setSelectionRange)target.setSelectionRange(_foc.ss,_foc.se);}catch(_){}
    }
  }
  initHabitSort();
  enhanceKeyboardTargets();
}

/* 今日卡片排序：仅拖标题旁手柄；拖动期间支持滚轮和靠边自动滚动。 */
let activeHabitDragKey=null;
let habitSortWheelBound=false;
let habitIconEditBound=false;    
function scrollHabitListAtEdge(clientY){
  const scroll=document.getElementById('scroll');if(!scroll)return;
  const rect=scroll.getBoundingClientRect(),edge=56;
  const max=Math.max(0,scroll.scrollHeight-scroll.clientHeight);
  if(clientY<rect.top+edge)scroll.scrollTop=Math.max(0,scroll.scrollTop-Math.ceil((rect.top+edge-clientY)/edge*22));
  else if(clientY>rect.bottom-edge)scroll.scrollTop=Math.min(max,scroll.scrollTop+Math.ceil((clientY-(rect.bottom-edge))/edge*22));
}
function initHabitSort(){
  const box=document.getElementById('checkinList');if(!box)return;
  if(!habitIconEditBound){
    box.addEventListener('click',function(e){
      

      const hi=e.target.closest('.hi');if(!hi||!hi.dataset.dbedit)return;
      const card=hi.closest('.hcard');if(!card||card.classList.contains('readonly'))return;
      const key=card.dataset.habitKey;if(key&&HMAP[key])openEdit(key);
    });
    habitIconEditBound=true;
  }
  let draggingKey=null;
  if(!habitSortWheelBound){
    document.addEventListener('wheel',function(event){
      if(!activeHabitDragKey)return;
      const scroll=document.getElementById('scroll');if(!scroll)return;
      const delta=event.deltaMode===1?event.deltaY*16:event.deltaY;
      const max=Math.max(0,scroll.scrollHeight-scroll.clientHeight);
      scroll.scrollTop=Math.max(0,Math.min(max,scroll.scrollTop+delta));
      event.preventDefault();
    },{capture:true,passive:false});
    habitSortWheelBound=true;
  }
  const scroll=document.getElementById('scroll');
  if(scroll&&!scroll.dataset.habitSortScrollBound){
    scroll.addEventListener('dragover',function(event){
      if(!activeHabitDragKey)return;
      event.preventDefault();
      if(event.dataTransfer)event.dataTransfer.dropEffect='move';
      scrollHabitListAtEdge(event.clientY);
    });
    scroll.dataset.habitSortScrollBound='1';
  }
  box.querySelectorAll('.habit-sort').forEach(handle=>{
    const card=handle.closest('.hcard');if(!card)return;
    handle.addEventListener('dragstart',event=>{
      draggingKey=card.dataset.habitKey;activeHabitDragKey=draggingKey;
      event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggingKey);
      box.classList.add('habit-drag-active');
      /* v31：幽灵图换成整卡截图（元素本身+克隆偏移微调），拖动「跟随的是卡片」而非小按钮 */
      try{
        const img=card.cloneNode(true);
        img.style.position='fixed';img.style.left='-9999px';img.style.top='0';
        img.style.width=card.getBoundingClientRect().width+'px';
        img.style.opacity='0.85';img.style.transform='rotate(2deg)';
        img.style.boxShadow='0 12px 28px rgba(15,23,42,.28)';
        img.style.pointerEvents='none';
        document.body.appendChild(img);
        event.dataTransfer.setDragImage(img, 36, 18);
        setTimeout(()=>{img.remove();},0);
      }catch(_){}
      requestAnimationFrame(()=>card.classList.add('dragging'));
    });
    handle.addEventListener('dragend',()=>{
      draggingKey=null;activeHabitDragKey=null;
      box.classList.remove('habit-drag-active');
      box.querySelectorAll('.hcard').forEach(el=>{el.classList.remove('dragging','drop-before','drop-after');el._dragLast=undefined;});
    });
  });
  box.querySelectorAll('.hcard:not(.readonly)').forEach(card=>{
    card.addEventListener('dragover',event=>{
      if(!draggingKey||draggingKey===card.dataset.habitKey)return;
      event.preventDefault();event.dataTransfer.dropEffect='move';
      scrollHabitListAtEdge(event.clientY);
      const r=card.getBoundingClientRect();
      const horiz=r.width<=r.height;
      const mid=(horiz?r.left+r.width/2:r.top+r.height/2);
      const cur=(horiz?event.clientX:event.clientY);
      let want=cur>mid;
      /* v32 滞回死区 ±6px：只有越过中线 6px 才翻转 before/after，交界处来回扫不再闪跳 */
      if(card._dragLast===undefined){card._dragLast=want;}
      else if(want!==card._dragLast){
        if(want&&cur>mid+6)card._dragLast=true;
        else if(!want&&cur<mid-6)card._dragLast=false;
      }
      card.classList.toggle('drop-after',card._dragLast);
      card.classList.toggle('drop-before',!card._dragLast);
    });
    card.addEventListener('dragleave',()=>{
      card.classList.remove('drop-before','drop-after');
      card._dragLast=undefined;
    });
    card.addEventListener('drop',event=>{
      event.preventDefault();
      const source=draggingKey||event.dataTransfer.getData('text/plain');
      activeHabitDragKey=null;
      const target=card.dataset.habitKey;if(!source||source===target)return;
      const after=card.classList.contains('drop-after');
      /* v31：落点卡片先脉冲反馈再重渲染（重渲染会清掉类） */
      card.classList.remove('drop-before','drop-after');
      card.classList.add('just-moved');
      setTimeout(function(){ reorderHabits(source,target,after); }, 190);
    });
  });
}
function reorderHabits(sourceKey,targetKey,after){
  const from=HABITS.findIndex(h=>h.key===sourceKey),to=HABITS.findIndex(h=>h.key===targetKey);
  if(from<0||to<0||from===to)return;
  const moved=HABITS.splice(from,1)[0];
  let destination=HABITS.findIndex(h=>h.key===targetKey);if(after)destination++;
  HABITS.splice(destination,0,moved);
  saveDebounced();mineDirty=true;syncHabits();renderAll();toast('已放到新位置，顺序已保存','good');
}

/* ============ 渲染：今日心情 ============ */
function renderMood(){
  const d=dayObj(viewDate)||{};
  document.getElementById('moodRow').innerHTML=MOODS.map(m=>{
    const sel=d.mood===m.key;
    return `<div class="mood-pick ${sel?'sel':''}" style="${sel?`--mood-tint:${hexA(m.color,.22)}`:''}" onclick="setMood('${m.key}',event)"><div class="me">${m.emoji}</div><div class="mn">${m.name}</div></div>`;
  }).join('');
  renderMoodExtras(d);
}

 
var MOOD_LINES={
  happy:['把这份好心情存进今天啦 ✨','笑容是最好的打卡 💛','今天的快乐已装罐保存 🫙'],
  calm:['平静也是一种力量 🍃','风平浪静的一天，很好 🌤️','心里安安静静，刚刚好 🫖'],
  normal:['平平淡淡，也是认真生活的一天 🍚','不好不坏，继续前进 ➡️','普通的一天，也值得记录 📖'],
  tired:['累了就早点休息，明天再战 💤','辛苦啦，给自己倒杯热水 🫗','电量不足，允许自己慢一点 🔋'],
  sad:['不开心也没关系，我陪着你 🫂','情绪像天气，阴天总会放晴 🌦️','抱抱你，今天辛苦了 🤍']
};
function moodLineFor(key){var pool=MOOD_LINES[key]||[];return pool.length?pool[(new Date().getDate()+key.length)%pool.length]:'';}
function moodBurst(e,key){
  var sets={happy:['💛','✨','🌟','😄'],calm:['🍃','🫖','💧','😌'],normal:['🍚','➡️','📖','🙂'],tired:['💤','🫗','🔋','😪'],sad:['🫂','🤍','🌧️','😢']};
  var ems=sets[key]||['✨'];
  var x=(e&&e.clientX)||window.innerWidth/2,y=(e&&e.clientY)||window.innerHeight/2;
  for(var i=0;i<8;i++){
    var p=document.createElement('div');p.className='particle';
    p.textContent=ems[Math.floor(Math.random()*ems.length)];
    var ang=Math.random()*Math.PI*2,dist=34+Math.random()*56;
    p.style.left=x+'px';p.style.top=y+'px';
    p.style.setProperty('--dx',Math.cos(ang)*dist+'px');
    p.style.setProperty('--dy',(Math.sin(ang)*dist-36)+'px');
    p.style.setProperty('--rot',(Math.random()*360)+'deg');
    document.body.appendChild(p);
    (function(pp){setTimeout(function(){pp.remove();},900);})(p);
  }
}
function renderMoodExtras(d){
  var bubble=document.getElementById('moodBubble');
  if(bubble){
    if(d&&d.mood){bubble.textContent=moodLineFor(d.mood);bubble.classList.add('show');}
    else{bubble.textContent=viewDate===todayStr()?'今天是什么心情？点一个告诉我们 🙂':'那天是什么心情？点一个记录下来 🙂';bubble.classList.remove('show');}
  }
  var trail=document.getElementById('moodTrail');
  if(trail){
    var html='';
    for(var i=6;i>=0;i--){
      var dt=new Date();dt.setDate(dt.getDate()-i);
      var ds=fmt(dt);
      var day=(data.days&&data.days[ds])||{};
      var mk=day.mood;
      var em=(mk&&MMAP[mk])?MMAP[mk].emoji:'';
      var wd='日一二三四五六'[dt.getDay()];
      html+='<div class="mt-day'+(i===0?' today':'')+'">'
        +'<div class="mt-em">'+(em||'<span class="mt-dot"></span>')+'</div>'
        +'<div class="mt-lb">'+(i===0?'今天':wd)+'</div></div>';
    }
    trail.innerHTML=html;
  }
}
/* ============ 渲染 / 保存：今日备忘录（富文本 + 图片） ============ */
/* contenteditable 光标移到末尾（原 textarea.setSelectionRange 对 div 无效，统一走这里） */
function renderHabits(){
  syncHabits();
  const box=document.getElementById('habitList');
  const visibleHabits=activeHabits();
  if(!visibleHabits.length){box.innerHTML=`<div class="empty-tip">${T('habit_empty')}</div>`;}
  else{
    box.innerHTML=visibleHabits.map(h=>{
      const st=streakOf(h.key),best=bestStreakOf(h.key),rate=completionRate(h.key);
      // 7天轨迹
      let week='';const dt=new Date();
      const arr=[];for(let i=6;i>=0;i--){const dd=new Date(dt);dd.setDate(dt.getDate()-i);arr.push(dd);}
      week=arr.map((dd,idx)=>{
        const on=isDone(h.key,dayObj(fmt(dd)));
        const lb=T('weekshort')[dd.getDay()];
        const isToday=idx===arr.length-1;
        return `<div class="wd ${isToday?'today':''}"><div class="dot ${on?'on':''}" style="${on?`background:var(--brand);color:#fff`:''}">${on?icn('check',12,3):''}</div><div class="lb">${lb}</div></div>`;
      }).join('');
      return `<div class="habit-card">
        <div class="habit-top">
          <div class="hi">${esc(h.icon)}</div>
          <div style="flex:1;"><div class="hn">${esc(h.name)}${h.reward&&h.reward.text?rewardChipHTML(h):''}</div><div class="h-type">${h.type==='bool'?T('type_bool_lbl'):h.type==='count'?T('type_count_lbl')(h.target,esc(h.unit||'')):h.type==='range'?T('type_range_lbl')(h.target||1,esc(h.unit||T('unit_hour'))):T('type_hours_lbl')(h.target||1,esc(h.unit||T('unit_hour')))}</div></div>
          <button class="habit-edit-btn" onclick="openEdit('${jsStr(h.key)}')">${icn('edit',15,2)}</button>
        </div>
        <div class="habit-mid">
          <div class="hstat-box hl"><b><span class="hb-fire">${icn('fire',15,2)}</span>${st}</b><span>${window.HabitRules.rule(h,todayStr()).mode==='weekly'?'连续达标周':T('cur_streak')}</span></div>
          <div class="hstat-box"><b>${best}</b><span>${window.HabitRules.rule(h,todayStr()).mode==='weekly'?'最长达标周':T('best_record')}</span></div>
          <div class="hstat-box"><b>${rate}%</b><span>${T('comp_rate')}</span></div>
        </div>
        ${habitAvailabilityControls(h)}<div class="week-dots">${week}</div>
      </div>`;
    }).join('');
  }
  appendHabitStateSections(box);
}
/* 习惯页底部：已归档 / 已删除分区——归档或删除后仍可找回，也可彻底删除 */
function appendHabitStateSections(box){
  if(!box)return;
  const arch=HABITS.filter(h=>h.archived&&!h.deleted);
  const del=HABITS.filter(h=>h.deleted);
  if(!arch.length&&!del.length)return;
  const stateRow=function(h,isDel){
    const when=isDel?(h.deletedAt?T('deleted_on')(h.deletedAt):''):(h.archivedAt?T('archived_on')(h.archivedAt):'');
    return `<div class="state-row ${isDel?'is-deleted':''}">
      <div class="hi">${esc(h.icon)}</div>
      <div class="sr-info"><b>${esc(h.name)}</b><span>${when}</span></div>
      <button class="sr-btn" onclick="restoreHabit('${jsStr(h.key)}')">${T('btn_restore')}</button>
      ${isDel?`<button class="sr-btn danger" onclick="confirmPurgeHabit('${jsStr(h.key)}')">${T('btn_purge')}</button>`:`<button class="sr-btn danger" onclick="confirmSoftDeleteHabit('${jsStr(h.key)}')">${T('btn_delete')}</button>`}
    </div>`;
  };
  let html='';
  if(arch.length){
    html+=`<div class="state-sec"><div class="state-sec-title">${T('sec_archived')} · ${arch.length}</div>${arch.map(h=>stateRow(h,false)).join('')}</div>`;
  }
  if(del.length){
    html+=`<div class="state-sec"><div class="state-sec-title">${T('sec_deleted')} · ${del.length}</div>${del.map(h=>stateRow(h,true)).join('')}</div>`;
  }
  box.insertAdjacentHTML('beforeend',html);
}

/* ============ 渲染：统计页 ============ */

function syncToggle(id,on){var el=document.getElementById(id);if(!el)return;el.classList.toggle('on',on);el.setAttribute('aria-checked',String(!!on));}
function renderMine(){
  setAva('pAva');
  document.getElementById('pName').textContent=data.profile.name||'用户';
  document.getElementById('psDays').textContent=recordCount();
  document.getElementById('psStreak').textContent=maxStreakAll();
  document.getElementById('psHabit').textContent=activeHabits().length;
  syncToggle('tgRemindPer',!!data.settings.remindPerHabit);
  syncToggle('tgRemindSum',!!data.settings.remindSummary);
  syncToggle('tgRemindTodo',data.settings.remindTodo!==false);   /* 3.1.0：待办到期提醒，默认开 */
  syncToggle('tgSound',!!data.settings.sound);
  setAdminUI();
  document.getElementById('clearSub').textContent=data.meta.sampleLoaded?T('clear_sub_sample'):T('clear_sub_all');
  /* 备份状态常显（v2.1：状态/频率/份数/目录都从主进程 store.js 读，含图片目录口径） */
  refreshBackupState();
  renderRewardLedger();
}
/* 奖励台账：容器由 JS 懒建并追加到「我的」页末尾（与 #badgeGrid / #moodChart 同套路，
   不再去动那段很长的标记）。 */
function renderRewardLedger(){
  const mine=document.getElementById('page-mine'); if(!mine)return;
  let host=document.getElementById('rewardLedger');
  if(!host){ host=document.createElement('div'); host.id='rewardLedger'; host.className='card rw-ledger'; mine.appendChild(host); }
  const led=(data.meta&&Array.isArray(data.meta.rewardLedger))?data.meta.rewardLedger:[];
  const q=rwQueue();
  const weekAgo=daysAgoTime(7);    
  const usedMin=led.filter(x=>x.s==='used'&&x.ts>=weekAgo).reduce((s,x)=>s+(Number(x.m)||0),0);
  const quitN=led.filter(x=>x.s==='quit').length;
  let html='<div class="rw-lg-t">'+esc(T('ledger_title'))+'</div>'
    +'<div class="rw-lg-sum"><span>'+esc(T('ledger_used_label'))+'</span><b>'+usedMin+'</b><span>'+esc(T('ledger_unit_min'))+'</span><i>·</i><b>'+q.length+'</b><span>'+esc(T('ledger_pending'))+'</span>'
    +(quitN?('<i>·</i><b>'+quitN+'</b><span>'+esc(T('ledger_quit'))+'</span>'):'')+'</div>';
  if(!led.length){ html+='<div class="rw-lg-empty">'+esc(T('ledger_empty'))+'</div>'; }
  else{
    html+=led.slice(-8).reverse().map(function(x){
      const dt=new Date(Number(x.ts)||Date.now());
      const p=n=>String(n).padStart(2,'0');
      const when=p(dt.getMonth()+1)+'-'+p(dt.getDate())+' '+p(dt.getHours())+':'+p(dt.getMinutes());
      return '<div class="rw-lg-row"><span class="rw-lg-when">'+when+'</span><span class="rw-lg-txt">'+esc(x.t)+'</span><span class="rw-lg-min">'+esc(String(x.m))+'min</span><span class="rw-lg-st st-'+esc(x.s)+'">'+esc(T('st_'+x.s))+'</span></div>';
    }).join('');
  }
  host.innerHTML=html;
}
function relTimeLabel(ts){
  const mins=Math.max(0,Math.floor((Date.now()-ts)/60000));
  if(mins<60)return T('ago_min').replace('{n}',mins);
  const hrs=Math.floor(mins/60);
  if(hrs<24)return T('ago_hour').replace('{n}',hrs);
  return T('ago_day').replace('{n}',Math.floor(hrs/24));
}

/* ============ 总渲染 ============ */
let statDirty=true,habitDirty=true,mineDirty=true;
let topDirty=true,ringDirty=true,todoDirty=true,checkinDirty=true,moodDirty=true;
var todoPageDirty=true;   /* 待办页脏标记（js/todo.js 亦有同名声明——同一次脚本加载只执行一份，var 重复声明无害，这里保 renderAll 单源可见） */
function renderAll(incremental){
  syncHabits();
  

  streakCacheReset();
  /* 普通入口保持全量刷新；高频 after() 入口传 false，仅刷新实际受影响区域。
     mineDirty 必须纳入全量刷新：清空示例/导入备份都走 renderAll()，漏掉会让"我的"页数字停留在旧值。 */
  if(incremental!==false){
    statDirty=habitDirty=mineDirty=true;
    topDirty=ringDirty=todoDirty=checkinDirty=moodDirty=true;
    todoPageDirty=true;
  }
  if(topDirty){renderTop();topDirty=false;}
  if(ringDirty){renderRing();ringDirty=false;}
  if(todoDirty){renderTodo();todoDirty=false;}
  if(checkinDirty){renderCheckin();checkinDirty=false;}
  if(moodDirty){renderMood();moodDirty=false;}
  if(mineDirty){renderMine();mineDirty=false;}
  updateTabDot();
  /* 3.1.0：待办页当前可见则重渲染；不可见保持脏标记等 go('todo') 时懒渲染。
     红点统一在此刷新——跨窗待办变更（勾选/到期）发生时用户可能停在其它页，
     ensureTodoTabDot 只挂在 renderTodoPage/todoChanged 上会漏。 */
  if(document.getElementById('page-todo')&&document.getElementById('page-todo').classList.contains('active')&&typeof renderTodoPage==='function'){renderTodoPage();todoPageDirty=false;}
  else if(typeof ensureTodoTabDot==='function'){ensureTodoTabDot();}
  if(document.getElementById('page-stat').classList.contains('active')){renderStat();statDirty=false;}
  if(habitManagerOpen()){renderHabits();habitDirty=false;}   /* 习惯管理已不是 tab，看它开没开 */
  enhanceKeyboardTargets();   /* 每次渲染后补一遍 tabindex：卡片是重绘出来的，不补就会掉 */
  

  _streakCacheDirty=false;
  _aggCacheDirty=false;
}
function updateTabDot(){
  const d=dayObj(todayStr());
  const activeHabitList=activeHabits();
  const undone=activeHabitList.filter(h=>!isDone(h.key,d)).length;
  document.querySelector('.tab[data-tab="today"]').classList.toggle('has-dot',undone>0&&activeHabitList.length>0);
}

