/* ============ 主窗口：跨窗数据同步（v2.1：主进程 hb-data-changed 广播驱动） ============ */
(function(){
  if(!window.hbShell||!window.hbShell.onDataChanged)return;
  window.hbShell.onDataChanged(function(p){
    /* 发起方自己忽略（自己刚提交的字段已在内存里）；其余窗口合并广播字段并重绘 */
    if(!p||p.token===WIN_TOKEN)return;
    var scopes=p.scopes||[];var f=p.fields||{};
    ['days','habits','settings','profile','meta','todos'].forEach(function(k){
      if(scopes.indexOf(k)>=0&&f[k]!==undefined)data[k]=f[k];
    });
    syncHabits();
    if(Array.isArray(f.memoNotes)){
      const local=(data.memoNotes||[]).filter(n=>noteContent(n)!==(noteBases.has(n.id)?noteBases.get(n.id):null)||(IS_EDITOR_WIN&&n.id===curNoteId&&(memoCommitPending||_saveTimer||!f.memoNotes.some(r=>r.id===n.id))));
      const removed=[...noteBases.keys()].filter(id=>!(data.memoNotes||[]).some(n=>n.id===id));
      data.memoNotes=f.memoNotes.filter(n=>!removed.includes(n.id)).map(n=>local.find(l=>l.id===n.id)||n);
      local.forEach(n=>{if(!data.memoNotes.some(r=>r.id===n.id))data.memoNotes.push(n);});
      f.memoNotes.forEach(n=>{if(!local.some(l=>l.id===n.id)&&!removed.includes(n.id))noteBases.set(n.id,noteContent(n));});
      [...noteBases.keys()].forEach(id=>{if(!f.memoNotes.some(n=>n.id===id)&&!local.some(n=>n.id===id))noteBases.delete(id);});
    }
    if(f.memo&&typeof f.memo==='object')data.memo=f.memo;
    if(scopes.indexOf('settings')>=0){applyTheme();renderThemeUI();}
    if(IS_EDITOR_WIN){
      if(document.body.classList.contains('m-sticky-today'))renderStickyToday();
      if(document.body.classList.contains('m-sticky-todo')&&typeof renderStickyTodo==='function')renderStickyTodo();
      if(scopes.indexOf('memoNotes')>=0&&!memoCommitPending&&!_saveTimer){var note=curNote();if(note)renderNoteToEditor(note,true);}
    }
    if(scopes.indexOf('memo')>=0||scopes.indexOf('memoNotes')>=0)renderMemoList();
    if(!IS_EDITOR_WIN&&document.body.classList.contains('app-locked')&&currentStickyMode()==='note'&&scopes.indexOf('memoNotes')>=0){
      const notes=notesSorted(),target=notes.find(n=>String(n.id)===String(curNoteId))||notes[0];
      if(target){curNoteId=String(target.id);renderNoteToEditor(target,true);localStorage.setItem('hb_sticky_note',curNoteId);renderStickyNavigation();}
      else{curNoteId=null;setStickyMode('today');}
    }
    /* 待办卡贴纸实时刷新：本窗勾选走本地渲染，跨窗变更（含编辑窗提交）在此同步 */
    if(document.body.classList.contains('app-locked')&&currentStickyMode()==='todo'&&typeof renderStickyTodo==='function')renderStickyTodo();
    if(!IS_EDITOR_WIN&&(scopes.indexOf('days')>=0||scopes.indexOf('habits')>=0||scopes.indexOf('meta')>=0||scopes.indexOf('settings')>=0||scopes.indexOf('profile')>=0||scopes.indexOf('todos')>=0)){
      try{syncHabits();renderAll();}catch(_){}
    }
  });
  /* 整档重载（导入/数据目录迁移）：主进程已换档，本窗整体刷新 */
  window.hbShell.onDataReloaded(function(){try{location.reload();}catch(_){}});
  

  if(window.hbShell.onDataRejected){
    var _rejNames={days:'打卡记录',habits:'习惯设置',settings:'设置',profile:'个人资料',meta:'元信息',memo:'便签',memoNotes:'便签列表',todos:'待办'};
    var _rejLast=0;
    window.hbShell.onDataRejected(function(p){
      var fs=(p&&Array.isArray(p.fields))?p.fields:[];
      if(!fs.length)return;
      var now=Date.now();
      if(now-_rejLast<4000)return;   /* 防抖：同一次保存风暴不刷屏 */
      _rejLast=now;
      var names=fs.map(function(k){return _rejNames[k]||k;}).join('、');
      try{console.error('[hb-data] 主进程拒收字段：'+fs.join(',')+'（未落盘）');}catch(_){}
      try{toast('未能保存：'+names+' 未写入磁盘（数据可能过大或格式异常）。请立即用「我的 → 导出备份」保存一份，然后重启应用。','bad');}catch(_){}
    });
  }
})();

/* ============ 便签直达模式：URL 带 ?view=memo 或 #memo 时，打开独立便签页 ============ */
(function(){
  var q=(location.search||'').toLowerCase(),h=(location.hash||'').toLowerCase();
  if(q.indexOf('view=memo')<0 && h.indexOf('memo')<0)return;
  var tries=0;
  var iv=setInterval(function(){
    tries++;
    var el=document.getElementById('memoInput');
    var scroll=document.getElementById('scroll');
    if(el&&scroll){
      clearInterval(iv);
      go('memo');
      scroll.scrollTop=0;
      setTimeout(function(){
        placeCaretAtEnd(el);
        // contenteditable 获取焦点会在部分 Electron/Windows 环境滚动根页面，
        // 从而把无边框窗口顶部的控件移出视口。只允许 #scroll 内部滚动。
        window.scrollTo(0,0);
        document.documentElement.scrollTop=0;
        document.body.scrollTop=0;
},120);
  }else if(tries>20){clearInterval(iv);}
  },150);
})();



(function(){
  if(IS_EDITOR_WIN)return;
  var run=function(){
    try{
      

      if(localStorage.getItem('hb_restore_sticky')!=='1')return;
      /* 从未贴过、也没有任何便签记录 → 不自动贴，避免启动时平白贴出一张空白便签 */
      if(localStorage.getItem('hb_lock_on_start')!=='1' && !localStorage.getItem('hb_sticky_note'))return;
      /* 便签形态但便签已被删除且一条都不剩 → 跳过（今日卡形态不受此限，它每次取当日数据） */
      var m0=null;try{ m0=localStorage.getItem('hb_lock_mode')||'today'; }catch(_){}
      if(m0!=='today'){
        var nsx=(typeof notesSorted==='function')?notesSorted():[];
        var sid=null;try{ sid=localStorage.getItem('hb_sticky_note'); }catch(_){}
        if(!(sid&&nsx.some(function(x){return x.id===sid;}))&&!nsx.length)return;
      }
      if(document.body.classList.contains('app-locked'))return;   /* 已经贴了 → 不重复 */
      if(document.body.classList.contains('editor-window'))return;
      if(!window.applyLock)return;
      setTimeout(function(){ try{ window.applyLock(true,true); }catch(_){} },420);
    }catch(_){}
  };
  if(document.readyState==='complete')setTimeout(run,300);
  else window.addEventListener('load',function(){setTimeout(run,300);});
})();

