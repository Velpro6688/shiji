/* ============ 主题（v2.1 深色模式）：浅色 / 深色 / 跟随系统 ============
   settings.theme ∈ light|dark|system（缺省 light：老用户视觉零变化）。
   浅色表 = v1.2 定稿蓝白外观原值（原 fixed 表逐字保留）；深色表 = 同名变量的保守深色板
   （保留 DeepSeek 蓝体系，只换中性色/表面色，强调色微调亮度保证深底对比），
   并扩展覆盖静态 :root 的 --rose/--sage/--gold/--sky/--shadow 等伴生变量。
   'system' 经 window.hbShell.getTheme / onThemeChanged 跟随 Windows 深浅（nativeTheme）。
   <html>.dark 类供 v33 覆盖层处理少量 CSS 硬编码色。 */
function themePalette(dark){
  if(dark)return {
    /* —— v3.0 Apple-style 深色简洁主题 —— */
    '--coffee':'#141416','--coffee-d':'#202023','--coffee-l':'#2C2C30',
    '--cream':'#202023','--cream-d':'#141416','--cream-soft':'#202023',
    '--theme-core':'#202023','--tile':'#202023','--tile-2':'#2C2C30','--tile-3':'#3B3B42',
    '--accent':'#0071E3','--accent-d':'#005BB5','--accent-t':'#1D3149',
    '--ink':'#F5F5F7','--on-bg':'#F5F5F7','--on-bg-2':'#B6B6BF','--on-bg-3':'#A7A7B0',
    '--on-bg-fill':'rgba(0,113,227,.16)','--on-bg-fill-s':'rgba(0,113,227,.09)',
    '--on-grad':'#F5F5F7','--on-grad-2':'#B6B6BF','--on-grad-3':'#A7A7B0',
    '--on-grad-fill':'rgba(0,113,227,.18)','--on-grad-fill-s':'rgba(0,113,227,.10)',
    '--grad1':'#202023','--grad2':'#202023','--dot':'transparent',
    '--app-bg':'#141416','--panel-soft':'rgba(32,32,35,.96)','--line':'#3B3B42',
    '--shadow-card':'0 1px 3px rgba(0,0,0,.25), 0 2px 6px rgba(0,0,0,.18)',
    '--tabbar-bg':'rgba(32,32,35,.96)','--tabbar-line':'#3B3B42',
    /* —— 规范变量 —— */
    '--brand':'#0071E3','--brand-deep':'#005BB5','--brand-light':'#8DBFFF','--cyan':'#64D2FF',
    '--brand-grad':'linear-gradient(135deg,#0071E3 0%,#005BB5 100%)',
    '--bg-page-1':'#141416','--bg-page-2':'#202023',
    '--bg-card':'#202023','--bg-card-2':'#2C2C30',
    '--card-grad':'#202023',
    '--bg-fill':'#2C2C30','--bg-fill-2':'#3B3B42',
    '--fill-grad':'#2C2C30',
    '--track':'#3B3B42',
    '--text-1':'#F5F5F7','--text-2':'#B6B6BF','--text-3':'#A7A7B0',
    '--text-on-brand':'#FFFFFF','--text-brand':'#8DBFFF',
    '--line-2':'#3B3B42','--line-dash':'#505057',
    '--ok':'#72D9A2','--warn':'#FFCC66','--danger':'#FF938E','--orange':'#FFCC66',
    '--red-soft-bg':'#3A1F1F','--green-soft-bg':'#1C3323','--orange-soft-bg':'#3A2818','--blue-soft-bg':'#1C2A3A',
    '--heat-0':'#202023','--heat-1':'#1D3149','--heat-2':'#1A5DA3','--heat-3':'#0071E3',
    '--shadow-pop':'0 4px 12px rgba(0,0,0,.35), 0 14px 28px rgba(0,0,0,.40)',
    '--shadow-anchor':'0 8px 24px rgba(0,0,0,.45)',
    '--shadow-btn':'0 2px 6px rgba(0,0,0,.28)',
    '--bevel-light':'inset 0 1px 0 rgba(255,255,255,.04)',
    '--bevel-brand':'inset 0 1px 0 rgba(255,255,255,.05)',
    '--bevel-press':'inset 0 2px 4px rgba(0,0,0,.28)',
    /* —— 深色扩展 —— */
    '--ink-soft':'#B6B6BF','--ink-mute':'#A7A7B0',
    '--rose':'#FF938E','--rose-t':'#3A2424','--sage':'#72D9A2','--sage-t':'#1F3A2C',
    '--gold':'#FFCC66','--gold-t':'#3A3222','--sky':'#8DBFFF','--sky-t':'#1D3149',
    '--shadow':'0 12px 32px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.22)','--shadow-s':'0 3px 10px rgba(0,0,0,.22)',
    '--dot-cream':'rgba(255,255,255,.02)'
  };
  return {
    /* —— v3.0 Apple-style 浅色简洁主题 Token —— */
    '--coffee':'#F5F5F7','--coffee-d':'#FFFFFF','--coffee-l':'#FFFFFF',
    '--cream':'#FFFFFF','--cream-d':'#F0F0F3','--cream-soft':'#FFFFFF',
    '--theme-core':'#F5F5F7','--tile':'#F0F0F3','--tile-2':'#FFFFFF','--tile-3':'#E4E4E9',
    '--accent':'#0071E3','--accent-d':'#005BB5','--accent-t':'#EAF3FF',
    '--ink':'#1D1D1F','--on-bg':'#1D1D1F','--on-bg-2':'#626269','--on-bg-3':'#6B6B73',
    '--on-bg-fill':'rgba(0,113,227,.08)','--on-bg-fill-s':'rgba(0,113,227,.05)',
    '--on-grad':'#1D1D1F','--on-grad-2':'#626269','--on-grad-3':'#6B6B73',
    '--on-grad-fill':'rgba(0,113,227,.09)','--on-grad-fill-s':'rgba(0,113,227,.05)',
    '--grad1':'#FFFFFF','--grad2':'#FFFFFF','--dot':'transparent',
    '--app-bg':'#F5F5F7','--panel-soft':'rgba(255,255,255,.94)','--line':'#E4E4E9',
    '--shadow-card':'0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.02)',
    '--tabbar-bg':'rgba(255,255,255,.94)','--tabbar-line':'#E4E4E9',
    /* —— 规范变量 —— */
    '--brand':'#0071E3','--brand-deep':'#005BB5','--brand-light':'#0066CC','--cyan':'#1683B8',
    '--brand-grad':'linear-gradient(135deg,#0071E3 0%,#005BB5 100%)',
    '--bg-page-1':'#F5F5F7','--bg-page-2':'#FFFFFF',
    '--bg-card':'#FFFFFF','--bg-card-2':'#F0F0F3',
    '--card-grad':'#FFFFFF',
    '--bg-fill':'#F0F0F3','--bg-fill-2':'#E4E4E9',
    '--fill-grad':'#F0F0F3',
    '--track':'#E4E4E9',
    '--text-1':'#1D1D1F','--text-2':'#626269','--text-3':'#6B6B73',
    '--text-on-brand':'#FFFFFF','--text-brand':'#0066CC',
    '--line-2':'#E4E4E9','--line-dash':'#C8C8CF',
    '--ok':'#187344','--warn':'#8A4B00','--danger':'#BD2424','--orange':'#8A4B00',
    '--red-soft-bg':'#FFECEA','--green-soft-bg':'#E9F9EE','--orange-soft-bg':'#FFF5E5','--blue-soft-bg':'#E8F2FF',
    '--heat-0':'#F0F0F3','--heat-1':'#C9DFFF','--heat-2':'#74AEE8','--heat-3':'#0071E3',
    '--shadow-pop':'0 4px 12px rgba(0,0,0,.06), 0 12px 24px rgba(0,0,0,.05)',
    '--shadow-anchor':'0 8px 24px rgba(0,122,255,.12)',
    '--shadow-btn':'0 1px 2px rgba(0,122,255,.10)',
    '--bevel-light':'inset 0 1px 0 rgba(255,255,255,.60)',
    '--bevel-brand':'inset 0 1px 0 rgba(255,255,255,.25)',
    '--bevel-press':'inset 0 2px 4px rgba(0,0,0,.06)',
    /* ── 浅色镜像键（v2.2.2 残留根治）：与深色表键集完全一致 ──
       深色表设置了这 13 个键而浅色表没有 → 深→浅切换后深值残留（浅色芯片变深）。
       浅色值与 :root 基线一致，两表键集 100% 对齐后切换零残留。 */
    '--ink-soft':'#626269','--ink-mute':'#6B6B73',
    '--rose':'#BD2424','--rose-t':'#FCEDEC','--sage':'#187344','--sage-t':'#E9F5EE',
    '--gold':'#8A4B00','--gold-t':'#FFF4E5','--sky':'#0066CC','--sky-t':'#EAF3FF',
    '--shadow':'0 16px 40px rgba(23,38,80,.10),0 2px 8px rgba(23,38,80,.04)',
    '--shadow-s':'0 4px 14px rgba(23,38,80,.08)',
    '--dot-cream':'rgba(59,46,40,.05)'
  };
}
function themeMode(){ try{ var t=data&&data.settings&&data.settings.theme; return ['light','dark','system'].indexOf(t)>=0?t:'light'; }catch(_){ return 'light'; } }
function applyTheme(){
  try{
    var t=themeMode();
    var dark=(t==='dark')||(t==='system'&&!!window.__hbSystemDark);
    var pal=themePalette(dark);
    var rs=document.documentElement.style;
    Object.keys(pal).forEach(function(key){rs.setProperty(key,pal[key]);});
    document.documentElement.classList.toggle('dark',dark);
  }catch(_){}
}
function setThemeMode(mode){
  if(['light','dark','system'].indexOf(mode)<0)return;
  if(!data.settings)data.settings={remindPerHabit:true,remindSummary:true,sound:true};
  data.settings.theme=mode;
  saveDebounced();
  applyTheme();
  renderThemeUI();
  /* 反馈：跟随系统模式下若系统外观恰好与切换前相同，视觉上"没变化"，必须用 toast 说明 */
  try{
    var msg=T('theme_toast_'+mode);
    if(mode==='system')msg=msg.replace('{s}',window.__hbSystemDark?T('theme_sys_dark'):T('theme_sys_light'));
    toast(msg,'good');
  }catch(_){}
}
function renderThemeUI(){
  var select=document.getElementById('themeSelect');
  if(select)select.value=themeMode();
}

window.__hbSystemDark=false;
function watchSystemTheme(){
  if(!(window.hbShell&&window.hbShell.getTheme))return;
  try{
    Promise.resolve(window.hbShell.getTheme()).then(function(r){
      window.__hbSystemDark=!!(r&&r.dark);
      applyTheme();
    }).catch(function(){});
    if(window.hbShell.onThemeChanged)window.hbShell.onThemeChanged(function(p){ window.__hbSystemDark=!!(p&&p.dark); applyTheme(); renderThemeUI(); });
  }catch(_){}
}


/* ============ 管理员模式（自律锁）：默认关闭→反悔/作弊类操作需设计款弹窗确认 ============ */
function adminOn(){ try{ return localStorage.getItem('hb_admin_mode')==='1'; }catch(_){ return false; } }
function setAdminUI(){ var el=document.getElementById('tgAdmin'); if(el){ el.classList.toggle('on',adminOn()); el.setAttribute('aria-checked',adminOn()?'true':'false'); } }
function toggleAdmin(el){
  if(adminOn()){ try{ localStorage.setItem('hb_admin_mode','0'); }catch(_){} setAdminUI(); toast(T('admin_off'),'good'); return; }
  showConfirm(T('admin_on_title'),T('admin_on_confirm'),function(){
    try{ localStorage.setItem('hb_admin_mode','1'); }catch(_){}
    setAdminUI(); toast(T('admin_on'),'good');
  },true);
  setAdminUI();   /* 取消时保持关 */
}
function adminGate(reason,onOk){
  

  if(adminOn()){ onOk&&onOk(); return; }
  showConfirm(T('admin_need_title'),T('admin_need_msg')+'\n\n'+reason,function(){
    showConfirm(T('admin_on_title'),T('admin_on_confirm'),function(){
      try{ localStorage.setItem('hb_admin_mode','1'); }catch(_){}
      setAdminUI(); toast(T('admin_on'),'good');
      onOk&&onOk();
    },true);
  },true);
}
window.adminOn=adminOn; window.adminGate=adminGate; window.setAdminUI=setAdminUI;
