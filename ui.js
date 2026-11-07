(function () {
  'use strict';

  var filter = 'all';
  var scrollPositions = Object.create(null);
  var sheetReturnFocus = null;
  var managerReturnFocus = null;
  var activeSheet = null;
  var sheetBaseline = '';
  var lastActionTarget = null;
  var filterLabels = {
    all: ['habit_filter_all', '全部', 'habitFilterCountAll'],
    pending: ['habit_filter_pending', '待完成', 'habitFilterCountPending'],
    done: ['habit_filter_done', '已完成', 'habitFilterCountDone'],
    pinned: ['habit_filter_pinned', '置顶', 'habitFilterCountPinned']
  };

  function t(key, fallback) {
    try {
      var value = typeof window.T === 'function' ? window.T(key) : fallback;
      return !value || value === key ? fallback : value;
    }
    catch (_) { return fallback; }
  }

  function isVisible(element) {
    if (!element || element.disabled || element.hidden || element.closest('[inert]')) return false;
    var style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function focusable(root) {
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex]:not([tabindex="-1"])'
    )).filter(isVisible);
  }

  function focusDialog(root, preferred) {
    if (!root) return;
    var nodes = focusable(root);
    var target = preferred && isVisible(preferred) ? preferred : nodes[0];
    if (target) target.focus({ preventScroll: true });
    else {
      root.setAttribute('tabindex', '-1');
      root.focus();
    }
  }

  function currentDialog() {
    // 焦点顺序与实际绘制层级保持一致；同层级按后出现的 DOM 优先。
    var top = null, level = -Infinity;
    document.querySelectorAll('#rewardMask:not([hidden]),#cropOverlay.show,#dayNoteMask.show,#confirmMask.show,.sheet.show,#habitManager.is-open,#focusOverlay.show,#guideMask').forEach(function (node) {
      if (!isVisible(node)) return;
      var z = Number(getComputedStyle(node).zIndex) || 0;
      if (z >= level) { top = node; level = z; }
    });
    return top;
  }

  function snapshotSheet(root) {
    if (!root) return '';
    var fields = Array.prototype.map.call(root.querySelectorAll('input,select,textarea'), function (field) {
      return [field.id, field.value, field.checked ? 1 : 0];
    });
    var choices = Array.prototype.map.call(root.querySelectorAll('.sel,.on'), function (item) {
      /* .on：分段选择钮的选中态（如待办编辑抽屉的优先级 todo-pri-seg），漏掉会让「改了优先级再取消」静默丢弃 */
      return [item.parentElement && item.parentElement.id, item.textContent.trim()];
    });
    var preview = root.querySelector('#pfPreview');
    return JSON.stringify({ fields: fields, choices: choices, preview: preview ? [preview.textContent, preview.style.backgroundImage] : null });
  }

  function setDialogSemantics(root, labelId) {
    if (!root) return;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    if (labelId) root.setAttribute('aria-labelledby', labelId);
  }

  function groupSettings(body, nodes, label, id) {
    var group = document.createElement('details'); group.className = 'sheet-group'; group.id = id;
    var summary = document.createElement('summary'); summary.textContent = label;
    group.appendChild(summary); body.insertBefore(group, nodes[0]);
    nodes.forEach(function(node){ group.appendChild(node); });
    return group;
  }
  function structureSheet(root) {
    root.inert = !root.classList.contains('show');
    if (root.querySelector('.sheet-body')) return;
    var top = document.createElement('div'), body = document.createElement('div'), footer = document.createElement('div');
    top.className='sheet-top';body.className='sheet-body';footer.className='sheet-footer';
    Array.from(root.children).forEach(function(node){
      if(node.matches('.sheet-bar,.sheet-head,h3,.sub'))top.appendChild(node);
      else if(node.matches('.btn-primary,.btn-ghost'))footer.appendChild(node);
      else body.appendChild(node);
    });
    root.append(top,body,footer);
    if(root.id==='editorSheet'){
      var icons=document.getElementById('edIcons').closest('.field'),sizes=document.getElementById('edSizes').closest('.field');
      groupSettings(body,[icons,sizes],t('appearance_settings','图标与卡片外观'),'appearanceSettings');
      var reminders=['edRemindAt','edRemindDays','edRemindCustom'].map(function(id){return document.getElementById(id).closest('.field');});
      groupSettings(body,reminders,t('reminder_settings','提醒安排'),'reminderSettings');
      groupSettings(body,[document.getElementById('edRewardText').closest('.field')],t('reward_settings','完成奖励'),'rewardSettings');
      var templates=document.getElementById('edTemplates'),details=document.createElement('details'),summary=document.createElement('summary');
      details.className='template-picker';summary.textContent=t('template_start','从常用模板开始');templates.parentNode.insertBefore(details,templates);details.append(summary,templates);
      ['appearanceSettings','reminderSettings','rewardSettings'].forEach(function(id){body.appendChild(document.getElementById(id));});
    }
  }
  function prepareSheet(root) {
    if (!root) return;
    structureSheet(root);
    var body=root.querySelector('.sheet-body');if(body)body.scrollTop=0;
    if(root.id==='editorSheet'){
      document.getElementById('reminderSettings').open=!!document.getElementById('edRemindAt').value;
      document.getElementById('rewardSettings').open=!!document.getElementById('edRewardText').value;
    }
    Array.prototype.forEach.call(root.querySelectorAll('.field'), function (field, index) {
      var label = field.querySelector(':scope > label');
      if (!label) return;
      var control = Array.prototype.find.call(field.querySelectorAll('input,select,textarea'), function (item) {
        return item.closest('.field') === field;
      });
      if (!control) return;
      if (!control.id) control.id = 'sheetField' + index;
      label.htmlFor = control.id;
    });
    Array.prototype.forEach.call(root.querySelectorAll('.icon-opt,.type-opt'), function (option) {
      option.setAttribute('role', 'button');
      option.setAttribute('tabindex', '0');
      option.setAttribute('aria-pressed', String(option.classList.contains('sel')));
    });
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('button,[role="button"],[onclick]');
    if (!target) return;
    lastActionTarget = target;
    setTimeout(function () { if (lastActionTarget === target) lastActionTarget = null; }, 0);
  }, true);

  function restoreFocus(target, fallback) {
    requestAnimationFrame(function () {
      if (isVisible(target)) target.focus();
      else if (isVisible(fallback)) fallback.focus();
    });
  }

  function updateFilterButtons(counts) {
    var group = document.getElementById('habitFilters');
    if (group) group.setAttribute('aria-label', t('habit_filter_group', '习惯筛选'));
    Object.keys(filterLabels).forEach(function (key) {
      var count = document.getElementById(filterLabels[key][2]);
      var button = document.querySelector('.habit-filter [data-filter="' + key + '"]');
      if (count) count.textContent = String(counts[key]);
      if (button) button.setAttribute('aria-pressed', String(filter === key));
    });
  }

  function filterHabits(items, day, isDone) {
    var counts = { all: items.length, pending: 0, done: 0, pinned: items.filter(h=>h.pinned).length };
    items.forEach(function (habit) {
      if (isDone(habit.key, day)) counts.done++;
      else counts.pending++;
    });
    updateFilterButtons(counts);
    if (filter === 'pinned') return items.filter(h=>h.pinned);
    if (filter === 'pending') return items.filter(function (h) { return !isDone(h.key, day); });
    if (filter === 'done') return items.filter(function (h) { return isDone(h.key, day); });
    return items;
  }

  function emptyMarkup(total) {
    if (!total) {
      if(window.activeHabits&&window.activeHabits().length)return '<section class="checkin-empty"><strong>这个日期暂无待执行计划</strong><p>本周目标可能已完成，或习惯处于休息 / 请假期间。</p><button type="button" onclick="openHabitManager()">管理习惯计划</button></section>';
      return '<section class="checkin-empty"><strong>' + t('empty_create_title', '从一个小目标开始') +
        '</strong><p>' + t('empty_create_body', '选一个容易坚持的习惯，今天就开始记录。') +
        '</p><button type="button" onclick="openAdd()">' + t('empty_create_action', '创建第一个习惯') + '</button></section>';
    }
    var copy = filter === 'pinned' ? ['还没有置顶的习惯','在习惯管理中选择置顶，常用习惯会排在前面。'] : filter === 'done'
      ? [t('filter_empty_done_title', '还没有完成的习惯'), t('filter_empty_done_body', '完成一项后，它会出现在这里。')]
      : [t('filter_empty_pending_title', '这个日期已全部完成'), t('filter_empty_pending_body', '今天的待完成列表已经清空。')];
    return '<section class="filter-empty"><strong>' + copy[0] + '</strong><p>' + copy[1] +
      '</p><button type="button" data-filter-reset>' + t('habit_filter_show_all', '显示全部') + '</button></section>';
  }

  function focusCard(key) {
    var cards = Array.prototype.slice.call(document.querySelectorAll('#checkinList .hcard'));
    var card = cards.find(function (item) { return item.dataset.habitKey === key; });
    var target = card && card.querySelector('.big-btn:not(:disabled), .mini-btn, .sbtn, input, .habit-sort');
    if (target) target.focus();
    return !!target;
  }

  function activeTab() {
    var page = document.querySelector('.page.active');
    return page ? page.id.replace('page-', '') : 'today';
  }

  function syncNavigation(tab) {
    document.querySelectorAll('.tab[role="tab"]').forEach(function (button) {
      var selected = button.dataset.tab === tab;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function initializeNavigation() {
    var tabbar = document.querySelector('.tabbar');
    if (tabbar) {
      tabbar.setAttribute('role', 'tablist');
      tabbar.setAttribute('aria-label', t('tab_group', '主导航'));
    }
    ['today', 'stat', 'todo', 'memo', 'mine'].forEach(function (name) {
      var tab = document.querySelector('.tab[data-tab="' + name + '"]');
      var page = document.getElementById('page-' + name);
      if (!tab || !page) return;
      tab.id = 'tab-' + name;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', page.id);
      page.setAttribute('role', 'tabpanel');
      page.setAttribute('aria-labelledby', tab.id);
      page.setAttribute('tabindex', '0');
      var label = tab.querySelector('.tl');
      if (label) {
        label.dataset.i18n = 'tab_' + name;
        label.textContent = t('tab_' + name, label.textContent);
      }
    });
  }

  window.HabitUI = {
    filterHabits: filterHabits,
    emptyMarkup: emptyMarkup,
    resetFilter: function () { filter = 'all'; window.renderCheckin(); },
    beforeNavigate: function () { scrollPositions[activeTab()] = document.getElementById('scroll').scrollTop; },
    afterNavigate: function (tab) {
      syncNavigation(tab);
      var scroll = document.getElementById('scroll');
      scroll.scrollTop = scrollPositions[tab] || 0;
    },
    syncNavigation: syncNavigation,
    currentDialog: currentDialog,
    sheetOpened: function (id) {
      var root = document.getElementById(id);
      if (!root) return;
      activeSheet = id;
      sheetReturnFocus = isVisible(lastActionTarget) ? lastActionTarget : document.activeElement;
      lastActionTarget = null;
      prepareSheet(root);
      sheetBaseline = snapshotSheet(root);
      var title = root.querySelector('h3');
      if (title && !title.id) title.id = id + 'Title';
      setDialogSemantics(root, id === 'editorSheet' ? 'edTitle' : (title && title.id));
      var preferred = id === 'editorSheet' ? document.getElementById('edName') :
        id === 'profileSheet' ? document.getElementById('pfName') : null;
      requestAnimationFrame(function () { focusDialog(root, preferred); });
    },
    allowSheetClose: function (force) {
      if (force || !activeSheet) return true;
      var root = document.getElementById(activeSheet);
      if (!root || snapshotSheet(root) === sheetBaseline) return true;
      if (typeof window.showConfirm === 'function') {
        window.showConfirm(t('unsaved_title', '未保存的更改'), t('unsaved_message', '放弃这次编辑吗？'), function () {
          window.closeSheet(true);
        }, true, {cancel:t('continue_editing','继续编辑'),confirm:t('discard_edits','放弃修改')});
      }
      return false;
    },
    markSheetClean: function () {
      var root = activeSheet && document.getElementById(activeSheet);
      if (root) sheetBaseline = snapshotSheet(root);
    },
    sheetClosed: function () {
      var target = sheetReturnFocus;
      if (!activeSheet && !target) return;
      activeSheet = null;
      sheetReturnFocus = null;
      sheetBaseline = '';
      restoreFocus(target, document.querySelector('.tab[aria-selected="true"]'));
    },
    managerOpened: function () {
      var root = document.getElementById('habitManager');
      if (!root) return;
      managerReturnFocus = isVisible(lastActionTarget) ? lastActionTarget : document.activeElement;
      lastActionTarget = null;
      var title = root.querySelector('h3');
      if (title && !title.id) title.id = 'habitManagerTitle';
      setDialogSemantics(root, title && title.id);
      requestAnimationFrame(function () { focusDialog(root, root.querySelector('.hm-close')); });
    },
    managerClosed: function () {
      var target = managerReturnFocus;
      managerReturnFocus = null;
      restoreFocus(target, document.querySelector('.tab[aria-selected="true"]'));
    },
    confirmOpened: function () {
      var root = document.getElementById('confirmMask');
      if (!root) return;
      setDialogSemantics(root, 'confirmTitle');
      var preferred = document.getElementById('confirmOk');
      if (preferred && preferred.classList.contains('danger')) preferred = document.getElementById('confirmCancel');
      requestAnimationFrame(function () { focusDialog(root, preferred); });
    }
  };

  document.querySelector('.habit-filter').addEventListener('click', function (event) {
    var button = event.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    window.renderCheckin();
    button.focus();
  });

  function reconcileFilteredFocus(event) {
    if (event.target.closest('[data-filter-reset]')) {
      filter = 'all';
      window.renderCheckin();
      document.querySelector('.habit-filter [data-filter="all"]').focus();
      return;
    }
    var card = event.target.closest('.hcard');
    if (!card || filter === 'all') return;
    var key = card.dataset.habitKey;
    var keys = Array.prototype.slice.call(document.querySelectorAll('#checkinList .hcard'))
      .map(function (item) { return item.dataset.habitKey; });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (Array.prototype.some.call(document.querySelectorAll('#checkinList .hcard'), function (item) { return item.dataset.habitKey === key; })) return;
        var index = keys.indexOf(key);
        var next = keys.slice(index + 1).concat(keys.slice(0, index).reverse());
        var moved = false;
        for (var i = 0; i < next.length; i++) {
          if (focusCard(next[i])) { moved = true; break; }
        }
        var selected = document.querySelector('.habit-filter [data-filter="' + filter + '"]');
        if (!moved && selected) selected.focus();
        var status = document.getElementById('habitFilterStatus');
        if (status) status.textContent = '';
        if (status) requestAnimationFrame(function () { status.textContent = t('filter_item_removed', '完成状态已更改，项目已从当前筛选结果中移除。'); });
      });
    });
  }
  ['click', 'change'].forEach(function (type) {
    document.getElementById('checkinList').addEventListener(type, reconcileFilteredFocus, true);
  });

  document.querySelector('.tabbar').addEventListener('keydown', function (event) {
    var current = event.target.closest('[role="tab"]');
    if (!current) return;
    var tabs = Array.prototype.slice.call(this.querySelectorAll('[role="tab"]'));
    var index = tabs.indexOf(current);
    var next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var root = currentDialog();
    if (!root) return;
    var nodes = focusable(root);
    if (!nodes.length) {
      event.preventDefault();
      focusDialog(root);
      return;
    }
    var first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  window.addEventListener('resize', function () { scrollPositions[activeTab()] = document.getElementById('scroll').scrollTop; });
  initializeNavigation();
  document.querySelectorAll('.sheet').forEach(structureSheet);
  var mine=document.getElementById('page-mine'),columns=document.createElement('div'),group=null;
  columns.className='settings-columns';
  Array.from(mine.children).forEach(function(node){
    if(node.id==='appBuildLine')return;
    if(node.classList.contains('sec-title')){group=document.createElement('section');group.className='settings-section';columns.appendChild(group);}
    if(group)group.appendChild(node);
  });
  mine.insertBefore(columns,document.getElementById('appBuildLine'));
  /* Group by user intent; move the original controls so save and confirmation handlers stay intact. */
  var settingsCard=document.getElementById('themeRow').closest('.menu-card');
  var backupCard=document.getElementById('backupState').nextElementSibling;
  function settingRow(id){var node=document.getElementById(id);return node&&node.closest('.menu-item');}
  function actionRow(action){return Array.from(backupCard.querySelectorAll('.menu-item')).find(function(row){return row.getAttribute('onclick')===action;});}
  function settingGroup(card,key,rows){
    var group=document.createElement('details'),summary=document.createElement('summary');
    group.className='settings-group';group.dataset.settingsGroup=key;summary.dataset.i18n=key;summary.textContent=t(key,key);group.appendChild(summary);
    group.addEventListener('keydown',function(event){
      if(event.key!=='Escape'||!group.open||event.defaultPrevented)return;
      group.open=false;summary.focus();event.preventDefault();event.stopPropagation();
    });
    rows.filter(Boolean).forEach(function(row){group.appendChild(row);});card.appendChild(group);return group;
  }
  function settingActions(key,actions){
    var line=document.createElement('div'),label=document.createElement('span'),buttons=document.createElement('div');
    line.className='settings-action-line';label.className='settings-action-label';label.dataset.i18n=key;label.textContent=t(key,key);buttons.className='settings-inline-actions';
    actions.forEach(function(action){var row=action[0];if(!row)return;var title=row.querySelector('.mi-t'),sub=row.querySelector('.mi-s');row.title=sub?sub.textContent:'';title.dataset.i18n=action[1];title.textContent=t(action[1],action[1]);buttons.appendChild(row);});
    line.append(label,buttons);backupCard.appendChild(line);
  }
  settingGroup(settingsCard,'settings_startup',[settingRow('tgStartup'),settingRow('tgRestore')]);
  settingGroup(settingsCard,'settings_notifications',[settingRow('tgRemindPer'),settingRow('tgRemindSum'),settingRow('tgRemindTodo'),settingRow('tgSound')]);
  settingGroup(settingsCard,'settings_operations',[settingRow('tgAdmin'),document.getElementById('copyDiagnostics'),Array.from(backupCard.querySelectorAll('.menu-item')).find(function(row){return (row.getAttribute('onclick')||'').startsWith('adminGate(');})]);
  var localBackup=actionRow('backupNowManual()'),exportFile=actionRow('exportBackup()'),importFile=actionRow("document.getElementById('backupFile').click()");
  var interval=actionRow("cycleBackupCfg('interval')"),keep=actionRow("cycleBackupCfg('keep')"),directory=actionRow('moveDataDir()'),portable=actionRow('togglePortable()');
  settingActions('settings_save',[[localBackup,'backup_local_action'],[exportFile,'backup_export_action']]);
  settingActions('settings_restore',[[document.getElementById('backupHistoryEntry'),'backup_history_action'],[importFile,'backup_import_action']]);
  settingGroup(backupCard,'settings_auto_backup',[interval,keep]);
  settingGroup(backupCard,'settings_storage',[document.getElementById('openDataDirectory'),directory,portable]);

  var replay=document.createElement('button');replay.id='guideReplay';replay.className='guide-replay';replay.type='button';replay.dataset.i18n='guide_replay';replay.textContent=t('guide_replay','重新查看新手引导');replay.onclick=function(){window.runNewbieGuide();};settingsCard.after(replay);
  var memo=document.getElementById('page-memo'),switcher=document.createElement('div');switcher.className='memo-view-switch';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','便签显示方式');
  switcher.innerHTML='<button type="button" data-view="grid">'+t('view_grid','卡片')+'</button><button type="button" data-view="list">'+t('view_list','列表')+'</button>';
  var memoList=document.getElementById('memoList');if(memoList)memoList.parentNode.insertBefore(switcher,memoList);
  function memoView(mode){memo.classList.toggle('memo-list-view',mode==='list');switcher.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.view===mode));});try{localStorage.setItem('hb_memo_view',mode);}catch(_){} }
  switcher.addEventListener('click',function(e){var b=e.target.closest('button');if(b)memoView(b.dataset.view);});
  var remembered='grid';try{remembered=localStorage.getItem('hb_memo_view')||'grid';}catch(_){}memoView(remembered);
  var tools=document.getElementById('memoTools'),more=document.createElement('details'),moreLabel=document.createElement('summary'),popover=document.createElement('div');
  more.className='memo-more';moreLabel.textContent=t('more_tools','更多');moreLabel.title=t('more_tools','更多格式');moreLabel.setAttribute('aria-label',t('more_tools','更多格式'));popover.className='memo-more-tools';more.append(moreLabel,popover);
  [['文字',['strikeThrough','size','clear']],['段落',['align','ul','ol']],['文字颜色',['color']],['高亮',['hilite']]].forEach(function(def){
    var group=document.createElement('div'),label=document.createElement('span'),buttons=document.createElement('div');
    group.className='memo-tool-group';group.setAttribute('role','group');group.setAttribute('aria-label',def[0]);
    label.className='memo-tool-label';label.textContent=def[0];buttons.className='memo-tool-buttons';
    tools.querySelectorAll('[data-cmd]').forEach(function(button){
      if(!def[1].includes(button.dataset.cmd))return;
      if(['color','hilite'].includes(button.dataset.cmd)){
        button.classList.add('memo-swatch');button.style.setProperty('--swatch-color',button.dataset.v);
      }
      buttons.appendChild(button);
    });
    group.append(label,buttons);popover.appendChild(group);
  });
  tools.querySelectorAll('.mt-sep,.mt-brk').forEach(function(node){node.remove();});tools.appendChild(more);
  document.addEventListener('pointerdown',function(event){if(!more.contains(event.target))more.open=false;});
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&more.open){more.open=false;moreLabel.focus();event.preventDefault();event.stopImmediatePropagation();}},true);
  syncNavigation(activeTab());
  if (typeof window.renderCheckin === 'function') window.renderCheckin();
}());
