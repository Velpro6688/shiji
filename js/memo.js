/* Notes, rich-text editing and image operations. */
function placeCaretAtEnd(el){
  if(!el)return;
  try{
    el.focus();
    var r=document.createRange();r.selectNodeContents(el);r.collapse(false);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);
  }catch(_){}
}
/* 把光标送到「最后一个含文字的段落」末尾（跳空段/图片块）。
   用途：用户没点过正文就直接点对齐/格式按钮时，格式化落点应是可见文字，
   而不是文末空 div——否则点了没反应，看着像功能失效。 */
function placeCaretAtLastTextBlock(el){
  if(!el)return;
  function texty(n){
    if(n.nodeType===3)return (n.textContent||'').replace(/\s/g,'')!=='';
    if(n.nodeType!==1)return false;
    if(n.classList&&n.classList.contains('memo-image-wrap'))return false;
    if(/^(IMG|BR|BUTTON|INPUT|TEXTAREA)$/i.test(n.tagName))return false;
    var t=(n.innerText!==undefined)?n.innerText:((n.textContent||''));
    return !!t&&t.replace(/\s/g,'')!=='';
  }
  var blocks=[].slice.call(el.querySelectorAll('div,p,li,h1,h2,h3,h4,h5,h6,blockquote'));
  var hit=null;
  for(var i=blocks.length-1;i>=0;i--){if(texty(blocks[i])){hit=blocks[i];break;}}
  if(!hit&&texty(el))hit=el;
  if(!hit){placeCaretAtEnd(el);return;}
  try{
    el.focus();
    var r=document.createRange();r.selectNodeContents(hit);r.collapse(false);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);
  }catch(_){placeCaretAtEnd(el);}
}
var MEMO_TAIL_CLASS='memo-tail-line';    
function memoTailLine(el){
  /* 取文末锚点行：仅当它确实是最后一个元素子节点时算数 */
  if(!el)return null;
  var last=el.lastElementChild;
  return (last&&last.classList&&last.classList.contains(MEMO_TAIL_CLASS))?last:null;
}
function memoPlaceCaretInTail(el){
  /* 把光标放进文末锚点行内 —— 点在图片下方/点图片本体时用它，保证光标「看得见」。
     返回 true = 已成功落位。 */
  if(!el)return false;
  var tail=memoTailLine(el);
  if(!tail)return false;
  try{
    el.focus();
    var r=document.createRange();r.selectNodeContents(tail);r.collapse(false);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);
    return true;
  }catch(_){return false;}
}
function memoEnsureTailEditable(el){
  

  if(!el||!el.lastChild)return false;
  var last=el.lastChild;
  while(last&&last.nodeType===3&&(last.textContent||'')==='')last=last.previousSibling;  /* 跳过末尾纯空白文本 */
  if(!last)return false;
  if(last.nodeType===1&&last.classList&&last.classList.contains(MEMO_TAIL_CLASS))return false;  /* 已是锚点行 */
  var imgTail=false;
  if(last.nodeType===1){
    var tag=(last.tagName||'').toUpperCase();
    if(tag==='IMG'){imgTail=true;}
    else if(tag==='SPAN'&&last.classList&&last.classList.contains('memo-image-wrap')){imgTail=true;}
    else if(tag==='DIV'||tag==='P'){
      /* 段内末尾也可能是图片（曾把图插进段落中间）：逐层下探 */
      var leaf=last.lastChild;
      while(leaf&&leaf.nodeType===3&&(leaf.textContent||'')==='')leaf=leaf.previousSibling;
      if(leaf){
        if(leaf.nodeType===3)return false;
        var lt=(leaf.tagName||'').toUpperCase();
        if(lt==='BR')return false;
        if(lt==='IMG'){imgTail=true;}
        else if(lt==='SPAN'&&leaf.classList&&leaf.classList.contains('memo-image-wrap')){imgTail=true;}
      }
    }
  }
  if(imgTail){
    var tail=document.createElement('div');
    tail.className=MEMO_TAIL_CLASS;
    tail.appendChild(document.createElement('br'));
    el.appendChild(tail);
    return true;
  }
  return false;
}
var memoTimer=null;
var memoCommitPending=false;   /* 正文提交（sanitize+toText）已排进防抖、尚未执行 */
var memoHistory=[],memoHistoryPos=-1,memoHistoryLock=false,memoHistoryNoteId=null;
var memoHistoryTimer=null,memoHistoryPending=false,memoComposing=false;
function syncMemoToolbarState(){
  var tools=document.getElementById('memoTools'),el=document.getElementById('memoInput');if(!tools||!el)return;
  var locked=document.body.classList.contains('app-locked')||el.getAttribute('contenteditable')==='false';
  tools.querySelectorAll('button[data-cmd]').forEach(function(button){
    var cmd=button.dataset.cmd,on=false;
    if(cmd==='undo')button.disabled=locked||(!memoHistoryPending&&memoHistoryPos<=0);
    else if(cmd==='redo')button.disabled=locked||memoHistoryPending||memoHistoryPos<0||memoHistoryPos>=memoHistory.length-1;
    else button.disabled=locked;
    if(['bold','italic','underline','strikeThrough'].indexOf(cmd)>=0){try{on=document.queryCommandState(cmd);}catch(_){} }
    else if(cmd==='ul'){try{on=document.queryCommandState('insertUnorderedList');}catch(_){} }
    else if(cmd==='ol'){try{on=document.queryCommandState('insertOrderedList');}catch(_){} }
    else if(['color','hilite','size','align'].indexOf(cmd)>=0){
      try{
        var range=memoCaretRange(el),node=range&&(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement);
        if(node){
          var css=getComputedStyle(node),probe=document.createElement('span');
          if(cmd==='color'||cmd==='hilite'){
            probe.style.color=button.dataset.v;
            var value=probe.style.color;
            if(cmd==='color')on=css.color===value;
            else{
              while(node&&node!==el&&getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)')node=node.parentElement;
              on=!!node&&getComputedStyle(node).backgroundColor===value;
            }
          }else if(cmd==='align')on=css.textAlign===button.dataset.v||(button.dataset.v==='left'&&css.textAlign==='start');
          else on=String(document.queryCommandValue('fontSize'))===button.dataset.v;
        }
      }catch(_){}
    }
    button.classList.toggle('on',!!on);
    if(['undo','redo','image','todo','clear','link'].indexOf(cmd)<0)button.setAttribute('aria-pressed',String(!!on));
    else button.removeAttribute('aria-pressed');
  });
}
function memoResetHistory(el,noteId){
  clearTimeout(memoHistoryTimer);memoHistoryPending=false;memoComposing=false;
  memoHistory=[];memoHistoryPos=-1;memoHistoryNoteId=noteId||null;
  if(el)memoRecordHistory(el);
  syncMemoToolbarState();
}
function memoRecordHistory(el){
  if(memoHistoryLock||memoComposing||!el)return;
  clearTimeout(memoHistoryTimer);memoHistoryPending=false;
  var html=el.innerHTML;
  if(memoHistoryPos>=0&&memoHistory[memoHistoryPos]===html){syncMemoToolbarState();return;}
  memoHistory=memoHistory.slice(0,memoHistoryPos+1);memoHistory.push(html);
  if(memoHistory.length>50)memoHistory.shift();
  memoHistoryPos=memoHistory.length-1;syncMemoToolbarState();
}
/* 连续输入只记录停顿后的完整状态；立即撤销时先补齐最后一次输入。 */
function memoRecordHistoryThrottled(el){
  if(memoHistoryLock||memoComposing)return;
  memoHistoryPending=true;clearTimeout(memoHistoryTimer);
  memoHistoryTimer=setTimeout(function(){memoRecordHistory(el);},200);
  syncMemoToolbarState();
}
function memoRestoreHistory(el,pos){
  if(memoComposing||!el||pos<0||pos>=memoHistory.length)return false;
  memoHistoryLock=true;
  try{el.innerHTML=memoHistory[pos];prepareMemoCanvas(el);memoHistoryPos=pos;placeCaretAtEnd(el);saveMemoHtml();}
  finally{memoHistoryLock=false;syncMemoToolbarState();}
  return true;
}
function memoUndo(){var el=document.getElementById('memoInput');if(memoHistoryPending)memoRecordHistory(el);return memoRestoreHistory(el,memoHistoryPos-1);}
function memoRedo(){var el=document.getElementById('memoInput');if(memoHistoryPending)memoRecordHistory(el);return memoRestoreHistory(el,memoHistoryPos+1);}
document.addEventListener('keydown',function(e){if(e.isComposing||memoComposing||!e.ctrlKey&&!e.metaKey)return;const editor=document.getElementById('memoInput');if(!editor||!editor.isContentEditable||!editor.contains(e.target))return;if((e.key==='z'||e.key==='Z')&&!e.shiftKey){e.preventDefault();memoUndo();}else if((e.key==='y'||e.key==='Y')||(e.key==='z'||e.key==='Z')&&e.shiftKey){e.preventDefault();memoRedo();}});
function memoEscape(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function sanitizeMemoHtml(html){
  if(!html)return '';
  var box=document.createElement('div');box.innerHTML=String(html);
  /* 旧存档和浏览器格式命令可能产生 FONT；转成可保存的 span，保留子节点。 */
  box.querySelectorAll('font').forEach(function(font){
    var span=document.createElement('span'),sizes=['','10px','13px','16px','18px','24px','32px','48px'];
    span.style.cssText=font.style.cssText;
    var size=font.getAttribute('size'),color=font.getAttribute('color');
    if(sizes[size])span.style.fontSize=sizes[size];
    if(color)span.style.color=color;
    while(font.firstChild)span.appendChild(font.firstChild);
    font.replaceWith(span);
  });
  
/<script> 源码泄漏成正文） */
  try{
    Array.prototype.slice.call(box.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select,option,video,audio,source,svg,math,noscript,template,base'))
      .forEach(function(el){el.remove();});
  }catch(_){}
  /* 2) 标签白名单；表格族为 Word/网页粘贴的常见结构，予以保留 */
  var allowed={A:1,B:1,STRONG:1,I:1,EM:1,U:1,S:1,STRIKE:1,DEL:1,INS:1,BR:1,P:1,DIV:1,UL:1,OL:1,LI:1,BLOCKQUOTE:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,SPAN:1,IMG:1,HR:1,CODE:1,PRE:1,FIGURE:1,FIGCAPTION:1,SUB:1,SUP:1,MARK:1,TABLE:1,THEAD:1,TBODY:1,TFOOT:1,TR:1,TD:1,TH:1};
  /* 3) 属性白名单（class 必须保留：便签图片块的 .memo-image-wrap 等结构依赖它）
     crossorigin：v2.1 图片落盘后以 hbimg:// 引用，需带 crossorigin="anonymous" 才能
     保证裁剪等 canvas drawImage 不被跨源污染（协议响应带 ACAO:*） */
  var attrOk={class:1,style:1,title:1,alt:1,colspan:1,rowspan:1,width:1,height:1,src:1,href:1,contenteditable:1,crossorigin:1};
  /* v2.1：图片三来源——落盘文件(hbimg://) + 嵌入 dataURL(旧数据/迁移过渡) + 外链；javascript: 等协议一律挡掉 */
  var imgSrc=/^(?:hbimg:\/\/[A-Za-z0-9]+|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,|https?:\/\/)/i;
  var linkOk=/^https?:\/\//i;
  Array.prototype.slice.call(box.querySelectorAll('*')).forEach(function(el){
    if(!allowed[el.tagName]){el.replaceWith(...el.childNodes);return;}
    Array.prototype.slice.call(el.attributes).forEach(function(a){
      var n=a.name.toLowerCase(),v=a.value||'';
      if(n.indexOf('on')===0){el.removeAttribute(a.name);return;}      /* on* 事件属性一律清除 */
      if(!attrOk[n]){el.removeAttribute(a.name);return;}               /* 未知属性（含 data-*）清除 */
      if(n==='src'){ if(!(el.tagName==='IMG'&&imgSrc.test(v)))el.removeAttribute(a.name); return; }
      if(n==='crossorigin'){ if(!/^anonymous$/i.test(v))el.removeAttribute(a.name); return; }   /* 只允许 anonymous */
      if(n==='href'){                                                   /* 外链强制新窗口 + noopener */
        if(el.tagName==='A'&&linkOk.test(v)){el.setAttribute('rel','noopener noreferrer');el.setAttribute('target','_blank');}
        else el.removeAttribute(a.name);
        return;
      }
      if(n==='style'){
        var sv=v.replace(/expression|url\s*\(|javascript:|vbscript:|@import|behavior|-moz-binding|[<>]|position\s*:\s*fixed/ig,'');
        if(sv.trim())el.setAttribute('style',sv.slice(0,2000));else el.removeAttribute('style');
        return;
      }
      if(n==='contenteditable'){ if(/^(?:true|false|inherit)$/i.test(v)){}else el.removeAttribute(a.name); return; }
      if(v.length>400)el.setAttribute(n,v.slice(0,400));                 /* 挡掉畸形超长属性值 */
    });
  });
  return box.innerHTML.slice(0,2000000);
}
function memoNodeText(node){
  var copy=node.cloneNode(true);
  Array.prototype.forEach.call(copy.querySelectorAll('.memo-image-wrap,.memo-canvas-placeholder,.memo-image-grip,.memo-image-save,.memo-image-remove'),function(item){item.remove();});
  Array.prototype.forEach.call(copy.querySelectorAll('br'),function(br){br.replaceWith('\n');});
  return (copy.textContent||'').replace(/\u200b/g,'');
}
function memoHtmlToText(html){
  var box=document.createElement('div');box.innerHTML=html||'';
  var blocks=box.querySelectorAll('.memo-text-block');
  if(blocks.length)return Array.prototype.map.call(blocks,memoNodeText).filter(function(text){return text.length;}).join('\n').trim();
  return memoNodeText(box).trim();
}
function memoCharacterCount(text){
  if(window.Intl&&Intl.Segmenter){
    try{return Array.from(new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(text)).length;}catch(_){}
  }
  return Array.from(text).length;
}
function memoImgCount(){var el=document.getElementById('memoInput');return el?el.querySelectorAll('img').length:0;}
function createMemoImageWrap(src,width){
  /* 嵌入型图片块：块级元素占独立一行，不设 left/top（不参与绝对定位，不遮文字） */
  var wrap=document.createElement('span');
  wrap.className='memo-image-wrap';wrap.setAttribute('contenteditable','false');wrap.draggable=false;
  if(width)wrap.style.width=Math.round(width)+'px';
  var img=document.createElement('img');img.src=src;img.alt='';img.draggable=false;
  /* hbimg:// 落盘图片带 CORS 属性：裁剪/再压缩的 canvas 不被污染（协议响应带 ACAO:*） */
  if(/^hbimg:\/\//i.test(src||''))img.setAttribute('crossorigin','anonymous');
  var grip=document.createElement('span');grip.className='memo-image-grip';grip.setAttribute('role','button');grip.setAttribute('aria-label','拖动调整图片大小');grip.title='拖动调整图片大小';
  var cropBtn=document.createElement('button');cropBtn.type='button';cropBtn.className='memo-image-crop';cropBtn.setAttribute('aria-label','裁剪图片');cropBtn.title='裁剪图片';cropBtn.textContent='裁';
  var remove=document.createElement('button');remove.type='button';remove.className='memo-image-remove';remove.setAttribute('aria-label','删除图片');remove.title='删除图片';remove.textContent='×';
  wrap.appendChild(img);wrap.appendChild(grip);wrap.appendChild(cropBtn);wrap.appendChild(remove);
  return wrap;
}
/* —— 嵌入型图片定位辅助：图片作为块级元素占独立一行，按“光标处 / 某段文字前或后”插入，永不与文字重叠 —— */
function memoCaretRange(el){
  /* 编辑器内当前光标/选区（焦点丢失但选区仍在正文时也能取到）；不在正文返回 null */
  var s=window.getSelection();
  try{
    if(!s||!s.rangeCount)return null;
    var r=s.getRangeAt(0);
    if(!el.contains(r.startContainer)||!el.contains(r.endContainer))return null;
    return r;
  }catch(_){return null;}
}
function insertMemoWrapAtCaret(el,wrap){
  /* 插到当前光标：光标在文字中间时图片自然断行、独占一行；无光标/选区 → 文末追加 */
  var range=memoCaretRange(el);
  if(range){
    var c=range.startContainer,c2=(c&&c.nodeType===3)?c.parentNode:c;
    if(!(c2&&c2.closest&&c2.closest('.memo-image-wrap'))){   /* 别把图片嵌进另一张图片块里 */
      if(insertMemoWrapAtRange(el,wrap,range))return;
    }
  }
  el.appendChild(wrap);
}
function insertMemoWrapAtRange(el,wrap,range){
  /* 按事先保存的 Range 插入（粘贴/选文件是异步的，先把光标快照下来，读图完成仍插回原位） */
  if(!range)return false;
  try{
    var sc=range.startContainer,ec=range.endContainer;
    if(!el.contains(sc)||!el.contains(ec))return false;
    var c=sc,c2=(c&&c.nodeType===3)?c.parentNode:c;
    if(c2&&c2.closest&&c2.closest('.memo-image-wrap'))return false;
    var r=document.createRange();r.setStart(sc,range.startOffset);r.setEnd(ec,range.endOffset);
    if(!r.collapsed)r.deleteContents();            /* 有选区时：先删选中文字，再插图（同 Word 替换） */
    r.insertNode(wrap);
    try{r.setStartAfter(wrap);r.collapse(true);var sel=window.getSelection();if(sel){sel.removeAllRanges();sel.addRange(r);}}catch(_){}
    return true;
  }catch(_){return false;}
}
function insertMemoWrapAfter(el,wrap,prevWrap){
  /* 紧随上一张已插入的图片（多图连续粘贴/拖入时保持顺序） */
  if(!prevWrap||!prevWrap.parentNode||!el.contains(prevWrap.parentNode))return false;
  prevWrap.parentNode.insertBefore(wrap,prevWrap.nextSibling);
  return true;
}
function memoDropAnchor(el,x,y,ignoreWrap){
  /* 由屏幕坐标求“放置点”：命中段落文字→上/下半区=插其前/后；命中图片块→插它前/后；
     命中编辑区本体（直排 text+<br> 或空白）→ 用 caretRangeFromPoint 求精确文字位；都不中 → 文末 */
  var n=null;try{n=document.elementFromPoint(x,y);}catch(_){}
  if(!n)return null;
  var hitWrap=n.closest?n.closest('.memo-image-wrap'):null;
  if(hitWrap&&hitWrap!==el&&hitWrap!==ignoreWrap){
    var wr=hitWrap.getBoundingClientRect();
    return {image:hitWrap,before:(y<wr.top+wr.height/2)};
  }
  var top=(n===el)?el:n;
  while(top&&top!==el&&top.parentNode!==el)top=top.parentNode;
  if(top&&top!==el&&top.nodeType===1){
    var tr=null;try{tr=top.getBoundingClientRect();}catch(_){}
    if(tr)return {line:top,before:(y<tr.top+tr.height/2)};
  }
  var range=null;try{if(document.caretRangeFromPoint)range=document.caretRangeFromPoint(x,y);}catch(_){}
  if(range&&range.startContainer&&el.contains(range.startContainer))return {range:range};
  return null;
}
function insertMemoWrapAt(el,wrap,anchor){
  /* 统一落点：图片块前/后、段落前/后、或精确文字光标位，图片都作为块级单独成行 */
  if(!anchor)return false;
  if(anchor.image&&anchor.image.parentNode){
    try{
      if(!el.contains(anchor.image.parentNode))return false;
      anchor.image.parentNode.insertBefore(wrap,anchor.before?anchor.image:anchor.image.nextSibling);
      return true;
    }catch(_){return false;}
  }
  if(anchor.range)return insertMemoWrapAtRange(el,wrap,anchor.range);
  return insertMemoWrapAtLine(el,wrap,anchor);
}
function insertMemoWrapAtLine(el,wrap,anchor){
   
  if(!anchor||!anchor.line||!el.contains(anchor.line))return false;
  var ref=anchor.before?anchor.line:anchor.line.nextSibling;
  el.insertBefore(wrap,ref);   /* ref 为 null 时自动追加到文末 */
  return true;
}
function memoDefaultImgWidth(el,natural){
  /* 图片显示宽度：原图多宽就多宽，但不超过编辑区可容纳宽度（留出边距） */
  var cap=Math.max(120,el.clientWidth-48);
  var w=natural>0?natural:cap;
  return Math.max(40,Math.min(cap,w));
}
function refreshMemoPlaceholder(editor){
  var ph=editor.querySelector('.memo-canvas-placeholder');if(!ph)return;
  var has=editor.querySelector('.memo-text-block,.memo-image-wrap');ph.hidden=!!has;
}


function memoBlankBlock(e){
  if(!e||e.nodeType!==1)return false;
  if(e.tagName==='BR')return true;
  if(e.querySelector&&e.querySelector('img,table,video,audio,iframe,.memo-image-wrap'))return false;
  var t=(e.textContent||'').replace(/\u00a0/g,'').trim();
  if(t)return false;
  var kids=e.children||[];
  for(var i=0;i<kids.length;i++){ if(!memoBlankBlock(kids[i]))return false; }
  return true;
}
function trimMemoBlankEdges(editor){
  if(!editor)return;
  var guard=0;
  while(editor.firstElementChild&&memoBlankBlock(editor.firstElementChild)&&editor.children.length>1&&guard++<50){
    editor.removeChild(editor.firstElementChild);
  }
  guard=0;
  while(editor.lastElementChild&&memoBlankBlock(editor.lastElementChild)&&editor.children.length>1&&guard++<50){
    editor.removeChild(editor.lastElementChild);
  }
  if(!editor.firstElementChild&&!(editor.textContent||'').trim())editor.innerHTML='<p><br></p>';
}
function prepareMemoCanvas(editor){
  if(!editor)return;
  editor.classList.add('memo-canvas');
  editor.setAttribute('contenteditable','true');   /* 整篇文档直接输入，同 Word */
   
  Array.prototype.forEach.call(editor.querySelectorAll('.memo-text-block'),function(b){
    b.classList.remove('memo-text-block');
    b.removeAttribute('contenteditable');
    b.style.cssText='';
    if(!(b.textContent||'').trim()&&!b.querySelector('img,br'))b.remove();
  });
  /* 原位包裹图片，保留粘贴内容的文字、图片顺序。 */
  Array.prototype.forEach.call(editor.querySelectorAll('img'),function(img){
    if(img.closest('.memo-image-wrap'))return;
    var w=document.createElement('span');w.className='memo-image-wrap';w.setAttribute('contenteditable','false');w.draggable=false;
    img.draggable=false;
    img.replaceWith(w);
    w.appendChild(img);
  });
   
  Array.prototype.forEach.call(editor.querySelectorAll('.memo-image-wrap'),function(wrap){
    wrap.classList.remove('is-selected','is-positioning');
    wrap.querySelectorAll('.memo-image-shrink,.memo-image-save,.memo-image-replace,.memo-image-rotate,.memo-image-size,.memo-image-align').forEach(function(control){control.remove();});
    wrap.draggable=false;
    try{wrap.style.removeProperty('left');wrap.style.removeProperty('top');wrap.style.removeProperty('margin');}catch(_){}
    var hasW=wrap.style.width&&parseFloat(wrap.style.width)>0;
    if(!hasW){
      var wimg=wrap.querySelector('img');
      var nat=wimg&&wimg.naturalWidth?wimg.naturalWidth:0;
      wrap.style.width=Math.round(memoDefaultImgWidth(editor,nat))+'px';
    }
    var wimg2=wrap.querySelector('img');if(wimg2)wimg2.draggable=false;
    if(!wrap.querySelector('.memo-image-grip')){var grip=document.createElement('span');grip.className='memo-image-grip';grip.setAttribute('role','button');grip.setAttribute('aria-label','拖动调整图片大小');grip.title='拖动调整图片大小';wrap.appendChild(grip);}
    if(!wrap.querySelector('.memo-image-crop')){var cb=document.createElement('button');cb.type='button';cb.className='memo-image-crop';cb.setAttribute('aria-label','裁剪图片');cb.title='裁剪图片';cb.textContent='裁';wrap.appendChild(cb);}
    if(!wrap.querySelector('.memo-image-remove')){var remove=document.createElement('button');remove.type='button';remove.className='memo-image-remove';remove.setAttribute('aria-label','删除图片');remove.title='删除图片';remove.textContent='×';wrap.appendChild(remove);}
  });
  /* 旧式绝对定位占位节点不再需要：空态由 .memo-edit:empty:before 呈现 */
  var ph=editor.querySelector('.memo-canvas-placeholder');if(ph)ph.remove();
  

  Array.prototype.forEach.call(editor.querySelectorAll('.memo-image-wrap img'),function(img){
    var wrap=img.closest('.memo-image-wrap');if(!wrap)return;
    var die=function(){wrap.classList.add('memo-image-dead');};
    var alive=function(){wrap.classList.remove('memo-image-dead');};
    if(img.complete&&img.naturalWidth===0)die();
    else if(img.complete&&img.naturalWidth>0)alive();
    else{img.addEventListener('error',die,{once:true});img.addEventListener('load',alive,{once:true});}
  });
  trimMemoBlankEdges(editor);
  memoEnsureTailEditable(editor);   /* 末尾是图片块时补 <br> 空行锚点，保证点空白能出光标 */
  refreshMemoPlaceholder(editor);
}


var IS_EDITOR_WIN = /[?&]view=editor/.test(location.search||'');


var memoNotesSeeded=false;
function seedNotesOnce(){
  if(memoNotesSeeded)return;
  memoNotesSeeded=true;
  if(!data.memoNotes||!Array.isArray(data.memoNotes))data.memoNotes=[];
  if(data.memoNotes.length===0){
    var m0=data.memo||{};
    if(((m0.html||'').trim())||((m0.text||'').trim())){
      data.memoNotes.push({id:'n'+Date.now(),ts:Date.now(),html:m0.html||'',text:m0.text||'',title:typeof m0.title==='string'?m0.title:''});
    }
  }
}
function getNotes(){
  /* 纯读取：既不补建、也不写副作用。删到一条不剩时应保持为空，由列表空态提示用户新建。 */
  if(!data.memoNotes||!Array.isArray(data.memoNotes))data.memoNotes=[];
  return data.memoNotes;
}
seedNotesOnce();


function notesSorted(){
  return getNotes().slice().sort(function(a,b){
    var pa=a.pin?1:0,pb=b.pin?1:0;
    if(pa!==pb)return pb-pa;                                        /* 置顶优先 */
    var oa=(typeof a.ord==='number'&&isFinite(a.ord))?a.ord:null;
    var ob=(typeof b.ord==='number'&&isFinite(b.ord))?b.ord:null;
    if(oa!==null&&ob!==null&&oa!==ob)return oa-ob;                  /* 手动顺序 */
    if(oa!==null&&ob===null)return -1;                              /* 排过序的（多为新建）在前 */
    if(oa===null&&ob!==null)return 1;
    return (b.ts||0)-(a.ts||0);                                     /* 兜底：新→旧 */
  });
}
var currentNoteDragId=null;   /* 便签拖动中的 id（dragstart→drop 之间有效） */
var memoDragClickUntil=0;
var memoListRefreshPending=false;
function memoDropTarget(box,event){
  const source=noteById(currentNoteDragId);if(!source)return null;
  let card=event.target&&event.target.closest?event.target.closest('.memo-note[data-nid]'):null;
  if(card&&card.dataset.nid===source.id)return null;
  if(card){const target=noteById(card.dataset.nid);if(!target)return null;if(!!target.pin!==!!source.pin)return {blocked:true};}
  if(!card){
    const candidates=[...box.querySelectorAll('.memo-note[data-nid]')].filter(n=>{const note=noteById(n.dataset.nid);return note&&note.id!==source.id&&!!note.pin===!!source.pin;});
    let nearest=Infinity;
    candidates.forEach(n=>{const r=n.getBoundingClientRect(),dx=Math.max(r.left-event.clientX,0,event.clientX-r.right),dy=Math.max(r.top-event.clientY,0,event.clientY-r.bottom),distance=dx*dx+dy*dy;if(distance<nearest){nearest=distance;card=n;}});
  }
  if(!card)return null;
  const r=card.getBoundingClientRect(),columns=getComputedStyle(box).gridTemplateColumns.trim().split(/\s+/).length;
   
  const after=event.clientY<r.top?false:event.clientY>r.bottom?true:columns>1?event.clientX>r.left+r.width/2:event.clientY>r.top+r.height/2;
  return {card,after,horizontal:columns>1};
}
function clearMemoDrag(box){
  currentNoteDragId=null;box.classList.remove('memo-drag-active');
  box.querySelectorAll('.memo-note').forEach(n=>n.classList.remove('dragging','drop-before','drop-after','drop-horizontal'));
  if(memoListRefreshPending)renderMemoList();
}
var lastMovedNoteId=null;     /* 刚移动过的便签：重渲染后闪一下，给视觉反馈 */
function noteById(id){
  var ns=getNotes();for(var i=0;i<ns.length;i++)if(ns[i].id===id)return ns[i];
  return null;
}
function memoMinOrd(){
  var min=Infinity;
  getNotes().forEach(function(n){if(typeof n.ord==='number'&&isFinite(n.ord)&&n.ord<min)min=n.ord;});
  return min;
}
function memoNormalizeOrder(keepId){
  /* 把「当前视觉顺序」实体化为 ord（0,1,2…），此后拖动/置顶都在确定序列上运算。
     不会改变当前看到的位置；pin 字段原样保留。 */
  notesSorted().forEach(function(n,i){n.ord=i;});
  if(keepId)lastMovedNoteId=keepId;
}
var memoOrderNeedsSave=false,memoOrderRevision=0;
function persistNoteOrder(){
  /* 便签顺序专用落盘：只合并 ord/pin，绝不覆盖编辑窗刚保存的正文（主进程 applyNoteOrder 按 id 合并） */
  if(window.hbShell&&window.hbShell.dataNoteOrder){
    memoOrderNeedsSave=true;
    const revision=++memoOrderRevision;
    var list=getNotes().map(function(n){return {id:n.id,ord:(typeof n.ord==='number'&&isFinite(n.ord))?n.ord:null,pin:!!n.pin};});
    return hbSaveFields({},function(){return window.hbShell.dataNoteOrder(WIN_TOKEN,list);}).then(function(ok){
      if(ok&&revision===memoOrderRevision)memoOrderNeedsSave=false;
      if(ok&&!memoOrderNeedsSave&&!pendingCommits.size&&!lastCommitFailed)setSaveState('saved');
      return ok;
    });
  }
  return save();   /* 无数据层兜底（浏览器直开）：整包提交 */
}
function toggleNotePin(id){
  var n=noteById(id);if(!n)return;
  var willPin=!n.pin;
  if(willPin)n.pin=true;else delete n.pin;
  memoNormalizeOrder(id);   /* 先固化当前顺序，置顶/取消置顶后其余便签相对次序不变 */
  const saving=persistNoteOrder();
  renderMemoList();
  Promise.resolve(saving).then(function(ok){if(ok&&!memoOrderNeedsSave)toast(willPin?'已置顶，固定在最前 📌':'已取消置顶（保留当前位置）','good');});
}
function reorderNotes(sourceId,targetId,after){
  if(!sourceId||!targetId||sourceId===targetId)return;
  const source=noteById(sourceId),target=noteById(targetId);
  if(!source||!target)return;
  if(!!source.pin!==!!target.pin){toast('置顶便签固定在前，请在同一分组内调整顺序');return;}
  memoNormalizeOrder();                       /* 固化当前顺序 */
  var arr=notesSorted();
  const before=arr.map(n=>n.id).join('|');
  var from=-1;for(var i=0;i<arr.length;i++)if(arr[i].id===sourceId){from=i;break;}
  if(from<0)return;
  var moved=arr.splice(from,1)[0];
  var to=-1;for(var j=0;j<arr.length;j++)if(arr[j].id===targetId){to=j;break;}
  if(to<0){arr.push(moved);}else{arr.splice(after?to+1:to,0,moved);}
  if(arr.map(n=>n.id).join('|')===before)return;
  arr.forEach(function(n,i){n.ord=i;});
  lastMovedNoteId=sourceId;
  const saving=persistNoteOrder();
  renderMemoList();
  Promise.resolve(saving).then(function(ok){if(ok&&!memoOrderNeedsSave)toast('已放到新位置，顺序已保存','good');});
}
function curNote(){
  if(!curNoteId)return null;
  var ns=getNotes();for(var i=0;i<ns.length;i++)if(ns[i].id===curNoteId)return ns[i];
  return null;
}
function fmtNoteDate(d){
  d=d instanceof Date?d:new Date(d||Date.now());
  var now=new Date(),pad=function(x){return (x<10?'0':'')+x;};
  var sameDay=function(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();};
  var yest=new Date(now);yest.setDate(now.getDate()-1);
  var hm=pad(d.getHours())+':'+pad(d.getMinutes());
  if(sameDay(d,now))return '今天 '+hm;
  if(sameDay(d,yest))return '昨天 '+hm;
  if(d.getFullYear()===now.getFullYear())return (d.getMonth()+1)+'月'+d.getDate()+'日 '+hm;
  return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
}
var curNoteId=null;
var memoSearchQuery='';
var _mnSearchT=null;
function memoSearchDebounced(ev){
  var input=document.getElementById('memoSearch');
  memoSearchQuery=input?input.value:'';
  if((ev&&ev.isComposing)||(input&&input.dataset.composing==='1'))return;
  clearTimeout(_mnSearchT);
  _mnSearchT=setTimeout(function(){try{renderMemoList();}catch(_){}},180);
}  /* 输入法组合提交后再过滤，普通输入轻量防抖 */
var _mnPrevCache={};   
function clearMemoSearch(){try{memoSearchQuery='';var _ms=document.getElementById('memoSearch');if(_ms)_ms.value='';renderMemoList();}catch(_){}}
function renderMemoList(){
  if(currentNoteDragId){memoListRefreshPending=true;return;}
  memoListRefreshPending=false;
  var box=document.getElementById('memoList');if(!box)return;
  var all=notesSorted(),q=(memoSearchQuery||'').trim().toLowerCase();
  const existingIds=new Set([...box.querySelectorAll('.memo-note')].map(n=>n.dataset.nid));
  var ns=q?all.filter(function(n){return ((n.title||'')+' '+(n.text||'')).toLowerCase().indexOf(q)>=0;}):all;
  var cnt=document.getElementById('memoCountBadge');
  if(cnt)cnt.textContent=ns.length?ns.length+' 条':'';
  if(ns.length===0){box.innerHTML='<div class="memo-list-empty">'+(q?('没有匹配的便签<button type="button" class="st-add" style="margin-left:10px" onclick="clearMemoSearch()">清除搜索</button>'):'<strong>还没有便签</strong><p>记下想法、图片和片段，随时贴成桌面便签</p><button type="button" class="memo-empty-create" onclick="newNote()">新建便签</button>')+'</div>';return;}   
  var html='';
  

  ns.forEach(function(n,i){
    var preview='';
    if(n.html){
      preview=n.html;
    }else if(n.text){
      preview=memoEscape(n.text).replace(/\n/g,'<br>');
    }
    var noteTitle=(n.title||'').trim();
    if(!noteTitle){noteTitle=((n.text||'').split(String.fromCharCode(10))[0]||'').trim().slice(0,24);}
    var empty=!(n.text&&n.text.trim())&&!n.html;
    var prevKey=n.id+'|'+(n.ts||0)+'|'+String(preview||'').length;
    var cls='memo-note mn-c'+(i%4)+(n.pin?' pinned':'')+(n.id===lastMovedNoteId?' just-moved':'')+(existingIds.has(n.id)?' mn-existing':'');
    html+='<div class="'+cls+'" data-nid="'+memoEscape(n.id)+'" draggable="true" tabindex="0" role="button" aria-label="'+memoEscape(noteTitle||'便签')+'">'
        +'<button type="button" class="mn-pin'+(n.pin?' on':'')+'" data-pin="1" title="'+(n.pin?'取消置顶':'置顶这条便签')+'" aria-label="'+(n.pin?'取消置顶':'置顶这条便签')+'">📌</button>'
        +'<button type="button" class="mn-del" data-del="1" title="删除这条便签" aria-label="删除这条便签">✕</button>'
        +'<div class="mn-title">'+memoEscape(noteTitle)+'</div>'+'<div class="mn-preview">'+(empty?'<span class="mn-empty">空白便签</span>':(function(){var pv=_mnPrevCache[prevKey];if(pv===undefined){pv=sanitizeMemoHtml(preview);if(Object.keys(_mnPrevCache).length>400)_mnPrevCache={};_mnPrevCache[prevKey]=pv;}return pv;})())+'</div>'
        +'<div class="mn-date">'+fmtNoteDate(n.ts)+'</div>'
        +'</div>';
  });
  lastMovedNoteId=null;   /* 闪烁反馈只生效一次 */
  box.innerHTML=html;
  if(!box.__memoDelBound){
    box.__memoDelBound=true;
    box.addEventListener('click',function(e){
      if(Date.now()<memoDragClickUntil){e.preventDefault();e.stopPropagation();return;}
      var t=e.target;
      if(!t||!t.closest)return;
      var card=t.closest('.memo-note[data-nid]');
      if(!card)return;
      var nid=card.getAttribute('data-nid');
      if(!nid)return;
      if(t.closest('.mn-del')){e.stopPropagation();delNoteById(nid);return;}
      if(t.closest('.mn-pin')){e.stopPropagation();toggleNotePin(nid);return;}
      openNote(nid);
    });
  }
  if(!box.__memoSortBound){
    box.__memoSortBound=true;
    /* 拖动排序：整卡做落点（中线判断前后），整卡按住即可发起拖动。
       置顶优先级高于手动顺序 —— 拖动只在「同置顶状态」分组内换位（与 📌 语义一致）。 */
    box.addEventListener('dragstart',function(e){
      var card=e.target&&e.target.closest?e.target.closest('.memo-note[data-nid]'):null;if(!card)return;
      if(e.target.closest('button,input,a')){e.preventDefault();return;}
      var nid=card.getAttribute('data-nid');if(!nid)return;
      currentNoteDragId=nid;
      try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',nid);}catch(_){}
      box.classList.add('memo-drag-active');
      try{
        var img=card.cloneNode(true);
        img.style.position='fixed';img.style.left='-9999px';img.style.top='0';
        img.style.width=card.getBoundingClientRect().width+'px';
        img.style.opacity='0.85';img.style.transform='rotate(2deg)';img.style.pointerEvents='none';
        img.style.boxShadow='0 12px 28px rgba(15,23,42,.28)';
        document.body.appendChild(img);
        e.dataTransfer.setDragImage(img,36,18);
        setTimeout(function(){if(img.parentNode)img.parentNode.removeChild(img);},0);
      }catch(_){}
      requestAnimationFrame(function(){if(currentNoteDragId===nid&&card.isConnected)card.classList.add('dragging');});
    });
    box.addEventListener('dragover',function(e){
      if(!currentNoteDragId)return;
      e.preventDefault();const hit=memoDropTarget(box,e);
      box.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after','drop-horizontal'));
      if(e.dataTransfer)e.dataTransfer.dropEffect=hit&&!hit.blocked?'move':'none';
      if(!hit||hit.blocked)return;
      hit.card.classList.add(hit.after?'drop-after':'drop-before');
      hit.card.classList.toggle('drop-horizontal',hit.horizontal);
      const scroller=document.getElementById('page-memo'),r=scroller.getBoundingClientRect();
      if(e.clientY<r.top+36)scroller.scrollTop-=16;else if(e.clientY>r.bottom-36)scroller.scrollTop+=16;
    });
    box.addEventListener('dragleave',function(e){
      const card=e.target&&e.target.closest?e.target.closest('.memo-note[data-nid]'):null;
      if(card&&(!e.relatedTarget||!card.contains(e.relatedTarget)))card.classList.remove('drop-before','drop-after','drop-horizontal');
    });
    box.addEventListener('drop',function(e){
      if(!currentNoteDragId)return;e.preventDefault();
      const source=currentNoteDragId,hit=memoDropTarget(box,e);
      memoDragClickUntil=Date.now()+250;clearMemoDrag(box);
      if(hit&&hit.blocked){toast('置顶便签固定在前，请在同一分组内调整顺序');return;}
      if(hit)reorderNotes(source,hit.card.dataset.nid,hit.after);
    });
    box.addEventListener('dragend',function(){memoDragClickUntil=Date.now()+250;clearMemoDrag(box);});
  }
}
function openNote(id){
  var n=curNote();
  if(!n||n.id!==id){curNoteId=id;n=curNote();}
  if(!n){openMemoList();return;}
  var ti0=document.getElementById('memoEdTitle');if(ti0)ti0.value=(n.title||'');
  if(IS_EDITOR_WIN){
    /* 便签编辑窗内：显示编辑覆盖层，并短暂浮出顶栏/工具栏提示操作位置 */
    renderNoteToEditor(n,false);
    if(window.memoFlashChrome)window.memoFlashChrome();
    return;
  }
  if(document.body.classList.contains('app-locked')){
    /* 主窗锁定（贴桌面）态：本地渲染便签正文，不再弹独立编辑窗（否则锁定流程会多出一个空白便签窗口） */
    renderNoteToEditor(n,true);
    return;
  }
  /* 主窗口：隐藏自身，弹出独立便签编辑窗口（软件窗口消失，只剩便签） */
  if(window.hbShell&&window.hbShell.editorOpen){window.hbShell.editorOpen(id);return;}
  /* 无 IPC 环境（纯浏览器调试）退化为窗内覆盖层 */
  document.body.classList.add('memo-editor-open');
  renderMemo();
}
/* 把指定便签渲染进 memoInput（编辑窗与主窗锁定态共用）：
   force=true 强制回写正文（锁定态加载/恢复时用）；false 则保留正在编辑时的焦点保护 */
function renderNoteToEditor(n,force){
  const titleInput=document.getElementById('memoEdTitle');
  if(titleInput&&(force||document.activeElement!==titleInput))titleInput.value=n.title||'';
  document.body.classList.add('memo-editor-open');
  var el=document.getElementById('memoInput');
  if(el&&(force||!el.contains(document.activeElement))){
    el.innerHTML=sanitizeMemoHtml(n.html)||(n.text?memoEscape(n.text).replace(/\n/g,'<br>'):'');
    prepareMemoCanvas(el);
    if(memoHistoryNoteId!==n.id)memoResetHistory(el,n.id);
    if(!IS_EDITOR_WIN&&document.body.classList.contains('app-locked'))el.setAttribute('contenteditable','false');
  }
  var d=document.getElementById('memoEdDate');
  if(d)d.textContent=fmtNoteDate(n.ts);
  updateMemoCount();
}
function openMemoList(){
  if(IS_EDITOR_WIN){editorBack();return;}
  document.body.classList.remove('memo-editor-open');
  renderMemoList();
}
function flushPendingMemoSave(sync){
  try{ if(memoCommitPending)commitMemoHtml(); if(memoTimer){ clearTimeout(memoTimer); memoTimer=null; if(sync&&window.hbShell&&window.hbShell.dataSaveSync){ window.hbShell.dataSaveSync(WIN_TOKEN,noteSaveFields()); return; } save(); } }catch(_){}
}
function editorBack(){
  flushPendingMemoSave();
  if(window.hbShell&&window.hbShell.editorBack){window.hbShell.editorBack();return;}
  document.body.classList.remove('memo-editor-open');
  renderMemoList();
}
function newNote(){
  /* 编辑窗内：当前便签已是空白时直接聚焦它，避免堆叠多条空便签 */
  if(document.body.classList.contains('memo-editor-open')){
    var cn0=curNote();
    if(cn0&&!(cn0.text||'').trim()&&!(cn0.html||'').trim()){
      var e0=document.getElementById('memoInput');
      if(e0){e0.innerHTML='';prepareMemoCanvas(e0);setTimeout(function(){e0.focus();placeCaretAtEnd(e0);},60);}
      return;
    }
  }
  var ns=getNotes();
  var n={id:'n'+Date.now(),ts:Date.now(),html:'',text:''};
  /* 新便签排到未置顶分组的最前：ord 取当前最小 ord 再减 1（置顶便签不受影响，pin 优先级更高） */
  var mo=memoMinOrd();
  n.ord=(mo===Infinity?0:mo-1);
  ns.unshift(n);curNoteId=n.id;
  if(!IS_EDITOR_WIN){
    saveMemoFields();  /* 主窗先落盘新便签（memo 属主字段提交），再弹编辑窗（编辑窗 boot 读到的就是含新便签的档） */
    if(window.hbShell&&window.hbShell.editorOpen){window.hbShell.editorOpen(n.id);return;}
  }
  document.body.classList.add('memo-editor-open');
  var el=document.getElementById('memoInput');
  var ti=document.getElementById('memoEdTitle');if(ti)ti.value='';
  if(el){el.innerHTML='';prepareMemoCanvas(el);}
  memoResetHistory(el,n.id);
  var d=document.getElementById('memoEdDate');if(d)d.textContent=fmtNoteDate(n.ts);
  updateMemoCount();
  setTimeout(function(){if(el){el.focus();placeCaretAtEnd(el);}},80);
}
/* —— 自动备份（v2.1）：主进程 store.js 持有——写盘后按真实 mtime 判定间隔，
   频率/份数可配置，「立即备份」在「我的→数据管理」；旧渲染层每小时心跳退役 —— */
function delNoteById(id){
  showConfirm('删除便签','删除后无法恢复，确定删除这条便签吗？',function(){
    var ns=getNotes().filter(function(n){return n.id!==id;});
    data.memoNotes=ns;
    if(curNoteId===id){
      var sorted=notesSorted();
      curNoteId=sorted.length?sorted[0].id:null;
    }
    /* 镜像同步：若删的是当前便签，data.memo 改指向剩余最新一条 */
    if(curNoteId){var n=curNote();if(n){data.memo={html:n.html,text:n.text};}}
    else data.memo={html:'',text:''};
    saveMemoFields();   /* 便签字段属主提交（主窗 save() 不携带 memo 字段） */
    if(document.body.classList.contains('memo-editor-open')&&curNoteId)openNote(curNoteId);
    else openMemoList();
    toast('便签已删除');
  },true);
}
function renderMemo(){
  renderMemoList();
  if(!document.body.classList.contains('memo-editor-open'))return;
  var el=document.getElementById('memoInput');
  if(!el)return;
  var n=curNote();
  if(!n){openMemoList();return;}
  if(el.contains(document.activeElement))return;  /* 正在编辑时不回写，避免光标跳动 */
  if(n.html){el.innerHTML=sanitizeMemoHtml(n.html);}
  else if(n.text){el.innerHTML=memoEscape(n.text).replace(/\n/g,'<br>');}
  else{el.innerHTML='';}
  prepareMemoCanvas(el);
  var d=document.getElementById('memoEdDate');
  if(d)d.textContent=fmtNoteDate(n.ts);
  updateMemoCount();
}
/* 便签命名：顶栏输入框实时改名（防抖保存），回车跳到正文 */
(function(){
  var ti=document.getElementById('memoEdTitle');
  if(!ti)return;
  ti.addEventListener('input',function(){
    var n=curNote();if(!n)return;
    n.title=ti.value;saveDebounced();  /* 标题输入也使用统一防抖保存 */
  });
  ti.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();var el=document.getElementById('memoInput');if(el)el.focus();}
  });
})();

/* 编辑窗：Esc = 返回列表（确认弹窗打开时除外） */
window.addEventListener('keydown',function(e){
  if(!IS_EDITOR_WIN||e.key!=='Escape')return;
  var cm=document.getElementById('confirmMask');
  if(cm&&cm.classList.contains('show'))return;
  editorBack();
});

 
(function(){
  var chromeFlashUntil=0;
  

  function syncMemoChromeHeights(){
    var ed=document.getElementById('memoEditor');if(!ed)return;
    try{
      var top=ed.querySelector('.me-top'), tools=ed.querySelector('.memo-tools');
      var th=top?top.offsetHeight:0, sh=tools?tools.offsetHeight:0;
      if(th>0)ed.style.setProperty('--me-top-h',th+'px');
      if(sh>0)ed.style.setProperty('--me-tools-h',sh+'px');
    }catch(_){}
  }
  window.syncMemoChromeHeights=syncMemoChromeHeights;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(syncMemoChromeHeights,0);});
  else setTimeout(syncMemoChromeHeights,0);
  window.addEventListener('resize',function(){syncMemoChromeHeights();});
  window.memoFlashChrome=function(){
    chromeFlashUntil=Date.now()+8000;
    var ed=document.getElementById('memoEditor');
    if(ed){syncMemoChromeHeights();ed.classList.add('chrome-on');clearTimeout(ed._ct);ed._ct=setTimeout(function(){if(Date.now()>=chromeFlashUntil)ed.classList.remove('chrome-on');},8100);}
  };
  document.addEventListener('mousemove',function(e){
    if(!document.body.classList.contains('memo-editor-open'))return;
    if(document.body.classList.contains('app-locked')||document.body.classList.contains('sticky-sticker'))return;   
    var ed=document.getElementById('memoEditor');
    if(!ed)return;
    var near=e.clientY<72||e.clientY>window.innerHeight-124;
    if(near||Date.now()<chromeFlashUntil){
      if(!ed.classList.contains('chrome-on'))syncMemoChromeHeights();
      ed.classList.add('chrome-on');clearTimeout(ed._hideT);ed._hideT=null;
    } else if(!ed._hideT){
      ed._hideT=setTimeout(function(){ed.classList.remove('chrome-on');ed._hideT=null;},8000);
    }
  });
})();
function updateMemoCount(){
  var el=document.getElementById('memoInput'),c=document.getElementById('memoCount');
  if(!el||!c)return;
  var txt=el.innerText||'';    
  var imgs=el.querySelectorAll('img').length;
  c.textContent=memoCharacterCount(txt)+' 字'+(imgs?' · '+imgs+' 图':'');
}
/* —— 备忘录颜色：不依赖 execCommand 的确定性实现（v29）——
   有选区 → 手工包 span 上色（原生 foreColor 成功则优先，失败兜底）
   无选区 → 油漆桶：插入双层 span，后续输入自动带色（Word 式） */
function memoWrapSelColor(rng,color){
  var el=document.getElementById('memoInput');if(!el||!rng)return false;
  try{
    if(!el.contains(rng.commonAncestorContainer))return false;
    if(rng.collapsed)return false;
    var frag=rng.extractContents();
    var span=document.createElement('span');
    span.style.color=color;
    span.appendChild(frag);
    rng.insertNode(span);
    var sel=window.getSelection();
    if(sel){sel.removeAllRanges();
      var nr=document.createRange();nr.selectNodeContents(span);
      sel.addRange(nr);}
    el.focus();
    return true;
  }catch(_){return false;}
}
function memoArmColorPicker(color){
  var el=document.getElementById('memoInput');if(!el)return;
  try{
    var sel=window.getSelection();
    if(!sel||sel.rangeCount===0){el.focus();placeCaretAtEnd(el);sel=window.getSelection();}
    var rng=sel.getRangeAt(0).cloneRange();
    if(!el.contains(rng.commonAncestorContainer)){placeCaretAtEnd(el);sel=window.getSelection();rng=sel.getRangeAt(0).cloneRange();}
    if(!rng.collapsed)rng.collapse(true);
    /* 找落点最近带色 span：直接复用改色（不套娃） */
    var node=rng.startContainer,colorSpan=null;
    while(node&&node!==el){
      if(node.nodeType===1&&node.tagName==='SPAN'&&node.style&&node.style.color){colorSpan=node;break;}
      node=node.parentNode;
    }
    if(colorSpan){colorSpan.style.color=color;el.focus();return;}
    var outer=document.createElement('span');outer.style.color=color;
    var inner=document.createElement('span');
    outer.appendChild(inner);
    rng.insertNode(outer);
    var nr=document.createRange();nr.selectNodeContents(inner);nr.collapse(true);
    sel.removeAllRanges();sel.addRange(nr);
    el.focus();
    saveMemoHtml();
  }catch(_){try{placeCaretAtEnd(el);}catch(__){}}
}
function memoApplyColor(color){
  var el=document.getElementById('memoInput');if(!el)return;
  var sel=window.getSelection();
  var rng=null;
  if(sel&&sel.rangeCount>0)rng=sel.getRangeAt(0).cloneRange();
  if(rng&&el.contains(rng.commonAncestorContainer)){
    el.focus();
    sel=window.getSelection();sel.removeAllRanges();sel.addRange(rng);
    rng=sel.getRangeAt(0);
  }else{el.focus();}
  if(rng&&el.contains(rng.commonAncestorContainer)){
    if(!rng.collapsed){
      /* 优先生态原生命令（保留原生撤销栈）；失败或无变化则手工 wrap（用 cloneRange 防被破坏） */
      var cloneRng=rng.cloneRange();
      var before=el.innerHTML;
      var ok=false;
      try{document.execCommand('styleWithCSS',true);ok=document.execCommand('foreColor',false,color);}catch(_){}
      if(!ok||el.innerHTML===before){memoWrapSelColor(cloneRng,color);}
      saveMemoHtml();
      return;
    }
  }
  memoArmColorPicker(color);   /* 无选区/焦点丢失 → 油漆桶：后续输入自动带色 */
}
function memoApplyAlign(align){
  var el=document.getElementById('memoInput');if(!el)return;
  el.focus();
  var sel=window.getSelection();
  var rng=(sel&&sel.rangeCount>0)?sel.getRangeAt(0):null;
  /* 焦点丢在正文外时把光标放到最后一个有文字的段落（而不是文末空行），保证命令落在看得见的文字上 */
  if(!rng||!el.contains(rng.commonAncestorContainer)){placeCaretAtLastTextBlock(el);sel=window.getSelection();rng=sel&&sel.rangeCount?sel.getRangeAt(0):null;}
  if(!rng)return;
  /* 块级元素白名单：text-align 只有设在块级容器上才生效 */
  function isBlockEl(n){return !!(n&&n.nodeType===1&&/^(DIV|P|LI|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE|TABLE|TD|TH|PRE)$/i.test(n.tagName));}
  /* 从任意内联节点/文本节点向上找最近块级祖先；直达根编辑区则返回根（整篇对齐） */
  function nearestBlock(n){
    var node=(n.nodeType===3)?n.parentElement:(n.nodeType===1?n:null);
    while(node&&node!==el){if(isBlockEl(node))return node;node=node.parentElement;}
    return el;
  }
  function setAlign(b){b.style.textAlign=align;}
  function clearInlineAlign(b){
    /* 清掉历史遗留/Chromium 误写到内联元素上的 text-align（对内联无视觉作用，只会干扰后续判断） */
    if(b===el)return;
    var kids=b.querySelectorAll?b.querySelectorAll('*'):[];
    for(var i=0;i<kids.length;i++){var x=kids[i];if(!isBlockEl(x)&&x.style&&x.style.textAlign){x.style.textAlign='';}}
  }
  

  function wrapRootIntoBlock(){
    if(el.childNodes.length===1&&el.firstElementChild&&el.childNodes[0].nodeType===1&&isBlockEl(el.firstElementChild))return el.firstElementChild;
    var div=document.createElement('div');
    while(el.firstChild)div.appendChild(el.firstChild);
    el.appendChild(div);
    return div;
  }
  var sB=nearestBlock(rng.startContainer),eB=nearestBlock(rng.endContainer);
  var targets=[];
  if(rng.collapsed||sB===eB){
    targets.push(sB);
  }else{
    /* 多段选区：命中共同祖先下的所有块级容器 */
    var ca=(rng.commonAncestorContainer&&rng.commonAncestorContainer.nodeType===1)?rng.commonAncestorContainer:rng.commonAncestorContainer.parentElement;
    if(!ca||ca===el||!el.contains(ca))ca=el;
    var base=isBlockEl(ca)?ca.parentElement||el:ca;
    var cand=[].slice.call(base.querySelectorAll('div,p,li,h1,h2,h3,h4,h5,h6,blockquote,section,article,table'));
    var iS=cand.indexOf(sB),iE=cand.indexOf(eB);
    if(iS<0){cand.unshift(sB);iS=0;iE+=1;}
    if(iE<0){cand.push(eB);iE=cand.length-1;}
    if(iS>iE){var t=iS;iS=iE;iE=t;}
    for(var j=iS;j<=iE;j++)targets.push(cand[j]);
  }
  /* 先去内联残留，再直接设块级 text-align：结果确定、所见即所得 */
  var caretLost=false;
  for(var k=0;k<targets.length;k++){
    var b=targets[k];
    if(b===el){b=wrapRootIntoBlock();caretLost=true;}   /* 根编辑区 → 换成块级容器，对齐才会落盘 */
    if(b&&b.style){clearInlineAlign(b);setAlign(b);}
  }
  if(caretLost){
    /* 内容被搬进新容器后原选区可能失效，把光标放回最后一个有文字的段落，便于继续输入 */
    try{ var s2=window.getSelection(); if(!s2||!s2.rangeCount||!el.contains(s2.getRangeAt(0).startContainer))placeCaretAtLastTextBlock(el); }catch(_){}
  }
  saveMemoHtml();
}
/* 插入/编辑链接：选区已有链接 → 直接编辑；无选区 → 在光标处生成新链接；粘贴弹窗简单，原生 prompt 够用 */
function memoInsertLink(){
  var el=document.getElementById('memoInput');if(!el)return;
  el.focus();
  var sel=window.getSelection();
  var rng=(sel&&sel.rangeCount>0)?sel.getRangeAt(0):null;
  if(!rng||!el.contains(rng.commonAncestorContainer)){placeCaretAtLastTextBlock(el);return;}
  /* 查找选区内已有 a 链接，以便编辑 */
  var anchor=null;
  if(!rng.collapsed){
    var ca=rng.commonAncestorContainer.nodeType===1?rng.commonAncestorContainer:rng.commonAncestorContainer.parentElement;
    anchor=ca&&ca.closest?ca.closest('a'):null;
  }
  var def=anchor?(anchor.href||anchor.textContent||''):'';
  var url=window.prompt(anchor?'编辑链接地址：':'插入链接地址（http/https）：',def||'https://');
  if(url===null)return;
  url=String(url).trim();
  if(!url)return;
  /* 缺协议时自动补 https://，避免锚点/无协议打开错乱 */
  if(!/^[a-z][a-z0-9+.\-]*:\/\//i.test(url)&&!/^mailto:|^tel:/i.test(url))url='https://'+url;
  try{
    if(anchor){
      anchor.href=url;
      if(!rng.collapsed&&!anchor.textContent)anchor.textContent=rng.toString()||url;
    }else if(!rng.collapsed){
      document.execCommand('createLink',false,url);
    }else{
      var a=document.createElement('a');a.href=url;a.textContent=url;a.style.color='var(--accent)';a.target='_blank';a.rel='noopener noreferrer';
      rng.insertNode(a);
      /* 把光标移到链接后，便于继续输入 */
      var r2=document.createRange();r2.setStartAfter(a);r2.collapse(true);sel.removeAllRanges();sel.addRange(r2);
    }
  }catch(_){}
  saveMemoHtml();
}
/* 便签正文提交（sanitize 全量解析 + toText 再解析，是热路径最贵的两步）：
   连续输入只走 600ms 防抖后的这一份；工具栏/插图/撤销等离散操作传 light!==true 立即提交，保持旧语义。
   关窗兜底 flushPendingMemoSave 会先补提交防抖中的正文，绝不丢最后一次输入。 */
function commitMemoHtml(){
  var el=document.getElementById('memoInput');
  if(!el||!IS_EDITOR_WIN){memoCommitPending=false;return;}
  var html=sanitizeMemoHtml(el.innerHTML);
  if(!data.memo||typeof data.memo!=='object')data.memo={};
  data.memo.html=(html&&html!=='<br>')?html:'';
  data.memo.text=memoHtmlToText(html);          /* 纯文本留档，供备份/远端兼容 */
  var curN=curNote();
  if(curN){curN.html=data.memo.html;curN.text=data.memo.text;curN.ts=Date.now();}
  memoCommitPending=false;
}
function saveMemoHtml(light){
  if(!IS_EDITOR_WIN)return;  /* 便签写入仅发生在编辑窗：主窗 DOM 恒为空，回写会把当前便签清空 */
  var el=document.getElementById('memoInput');
  if(!el)return;
  if(memoComposing){memoCommitPending=true;return;}
  /* v29：清掉未使用的空油漆桶 span（光标所在的例外——它可能是刚激活、待输入的油漆桶） */
  try{
    var bu=[].slice.call(el.querySelectorAll('span:empty')).filter(function(sp){return !sp.closest('.memo-image-wrap');});
    var sel0=window.getSelection();
    for(var bi=0;bi<bu.length;bi++){
      var sp0=bu[bi],isCaret=false;
      try{isCaret=sel0&&sel0.rangeCount>0&&sel0.containsNode(sp0,true);}catch(_){}
      if(!isCaret){try{sp0.remove();}catch(_){}}
    }
  }catch(_){}
  /* v27：保存时不再归一化 DOM，避免每次输入重排破坏浏览器原生 Ctrl+Z 撤销栈 */
  if(!data.memo||typeof data.memo!=='object')data.memo={};
  /* 删空文档时清掉 Chrome 残留的 <br>/空 div，让占位文案回归（保留仅含图片的情况） */
  if(!(el.innerText||'').replace(/\s+/g,'')&&!el.querySelector('img'))el.innerHTML='';
  if(light===true)memoRecordHistoryThrottled(el);else memoRecordHistory(el);
  memoCommitPending=true;
  updateMemoCount();
  clearTimeout(memoTimer);
  memoTimer=setTimeout(function(){commitMemoHtml();save();},600);   /* 防抖：停止输入 0.6s 后落盘并上行 */
  if(light!==true)commitMemoHtml();
}
/* —— 编辑器初始化：工具栏命令 + 粘贴/拖拽插图 —— */
function initMemoEditor(){
  var el=document.getElementById('memoInput');
  if(!el)return;
  prepareMemoCanvas(el);
  var movingMemoImage=null,selectedMemoImage=null;
  function selectMemoImage(wrap){
    el.querySelectorAll('.memo-image-wrap.is-selected').forEach(function(image){if(image!==wrap)image.classList.remove('is-selected');});
    selectedMemoImage=wrap||null;
    if(selectedMemoImage)selectedMemoImage.classList.add('is-selected');
    el.classList.toggle('has-selected-image',!!selectedMemoImage);
    syncMemoToolbarState();
  }
  document.addEventListener('pointerdown',function(e){
    if(!e.target.closest||!e.target.closest('.memo-image-wrap'))selectMemoImage(null);
  });
  /* 多张图片连续插入：第一张按 at 定位，其余依次紧跟上一张（读图是异步的，用回调链保证顺序） */
  function chainInsertFiles(files,at){
    var idx=0,prev=null,noteId=curNoteId;
    (function step(){
      if(curNoteId!==noteId)return;
      if(idx>=files.length){if(prev){selectMemoImage(prev);try{prev.scrollIntoView({block:'nearest',behavior:'smooth'});}catch(_){}}return;}
      var file=files[idx++];
      var useAt=(idx===1)?at:(prev?{prev:prev}:null);
      memoInsertImage(file,useAt,function(w){prev=w||prev;step();});
    })();
  }
  /* 保持富文本选区：按钮 mousedown 不夺焦 */
  var pendingMemoImageRange=null;
  document.getElementById('memoTools').addEventListener('mousedown',function(e){
    var control=e.target.closest('button,summary');if(control)e.preventDefault();
  });
  document.getElementById('memoTools').addEventListener('click',function(e){
    var b=e.target.closest('button');if(!b)return;
    var cmd=b.getAttribute('data-cmd'),v=b.getAttribute('data-v');
    if(cmd==='undo'){memoUndo();return;}
    if(cmd==='redo'){memoRedo();return;}
    memoRecordHistory(el);
    if(cmd==='image'){
      var liveRange=memoCaretRange(el);pendingMemoImageRange=liveRange?liveRange.cloneRange():null;
      var f=document.getElementById('memoFile');if(f)f.click();return;
    }
    /* Word 式：格式化作用于正文当前光标/选区；若焦点丢了则把光标放到最后可见文字段 */
    var active=document.activeElement;
    if(!active||!el.contains(active)){
      var savedRange=memoCaretRange(el);el.focus();
      if(savedRange){var selection=window.getSelection();selection.removeAllRanges();selection.addRange(savedRange);}
      else placeCaretAtLastTextBlock(el);
    }
    if(cmd==='bold')document.execCommand('bold');
    else if(cmd==='italic')document.execCommand('italic');
    else if(cmd==='underline')document.execCommand('underline');
    else if(cmd==='strikeThrough')document.execCommand('strikeThrough');
    else if(cmd==='size'){
      var cssMode=document.queryCommandState('styleWithCSS');
      try{document.execCommand('styleWithCSS',false,true);document.execCommand('fontSize',false,String(v||'3'));}
      finally{document.execCommand('styleWithCSS',false,cssMode);}
    }
    else if(cmd==='color'){memoApplyColor(v||'#111');}
    else if(cmd==='align'){memoApplyAlign(v||'left');}
    else if(cmd==='ul'){try{document.execCommand('insertUnorderedList');}catch(_){}}
    else if(cmd==='ol'){try{document.execCommand('insertOrderedList');}catch(_){}}
    else if(cmd==='quote'){try{document.execCommand('formatBlock',false,'blockquote');}catch(_){}}
    else if(cmd==='todo'){
      /* 待办行：☐ + 可编辑文本，保存为普通 HTML，点击 ☐ 在委托里切换勾选态 */
      try{document.execCommand('insertHTML',false,'<div class="memo-todo"><span class="mt-cb" contenteditable="false" tabindex="-1">☐</span><span class="mt-tx">待办事项</span></div>');}
      catch(_){el.insertAdjacentHTML('beforeend','<div class="memo-todo"><span class="mt-cb" contenteditable="false" tabindex="-1">☐</span><span class="mt-tx">待办事项</span></div>');}
    }
    else if(cmd==='hilite'){try{document.execCommand('hiliteColor',false,v||'#FFF59D');}catch(_){}}
    else if(cmd==='link'){memoInsertLink();}
    else if(cmd==='clear'){document.execCommand('removeFormat');}
    saveMemoHtml();syncMemoToolbarState();
    var more=b.closest('.memo-more');if(more)more.open=false;
  });
  /* 在给定屏幕坐标放置键入光标（优先点哪落哪，找不到可编辑位 → 文末兜底，绝不落进图片块里） */
  function memoFocusCaretNear(x,y){
    memoEnsureTailEditable(el);   /* 先保证文末有可编辑锚点（图片结尾时补 <br>），光标才能显示 */
    var s=window.getSelection();
    var rng=null;
    try{if(document.caretRangeFromPoint)rng=document.caretRangeFromPoint(x,y);}catch(_){}
    function insideImage(node){
      var n=node;while(n&&n!==el){if(n.nodeType===1&&n.classList&&n.classList.contains('memo-image-wrap'))return true;n=n.parentNode;}return false;
    }
    function valid(n){return n&&el.contains(n)&&!insideImage(n);}
    if(rng&&valid(rng.startContainer)){
      try{el.focus();}catch(_){}
      if(s){s.removeAllRanges();s.addRange(rng);}
      return true;
    }
    /* 兜底：优先落在文末锚点行【行内】（图片结尾时唯一可见的光标位）；没有锚点行才退回文末 */
    try{el.focus();}catch(_){}
    if(memoPlaceCaretInTail(el))return false;
    placeCaretAtEnd(el);
    return false;
  }
  /* 点空白处 = Word 光标定位；点图片相关区也保证能立即打字
     （点图本体 → 选中图 + 光标放到图后；点图片侧边 auto-margin 空白 → 落图前/图后最近文字位） */
  el.addEventListener('pointerdown',function(e){
    if(document.body.classList.contains('app-locked'))return;
    /* 待办 ☐ 短路：点 ☐ 不应触发图片选择/光标错乱，交给 click 切勾选 */
    if(e.target.closest&&e.target.closest('.mt-cb')){e.preventDefault();selectMemoImage(null);return;}
    var wrap=e.target.closest&&e.target.closest('.memo-image-wrap');
    if(wrap){
      if(e.target.closest&&e.target.closest('.memo-image-grip,.memo-image-remove,.memo-image-crop'))return;
      selectMemoImage(wrap);
      if(e.target===wrap.querySelector('img')){
        

        var _ms=null;try{_ms=window.getSelection&&window.getSelection();}catch(_){}
        if(!(_ms&&_ms.rangeCount&&!_ms.isCollapsed)){
          memoEnsureTailEditable(el);   /* 图是末尾时补锚点行，否则光标放不上也看不见 */
          try{el.focus();}catch(_){}
          if(!memoPlaceCaretInTail(el))placeCaretAtEnd(el);   /* 优先落进锚点行（可见光标） */
        }
      } else {
        memoFocusCaretNear(e.clientX,e.clientY);                                              /* 点图片两侧空白沟 → 落最近文字位 */
      }
      return;
    }
    selectMemoImage(null);
    if(e.target===el){
      /* 点编辑区空白/留白：原生通常已落位；没落位则按点击坐标求最近文字位 */
      memoFocusCaretNear(e.clientX,e.clientY);
    }
  });
  el.addEventListener('input',function(e){
    if(!document.body.classList.contains('app-locked')&&el.contains(e.target)){selectMemoImage(null);saveMemoHtml(true);syncMemoToolbarState();}
  });
  el.addEventListener('compositionstart',function(){memoRecordHistory(el);memoComposing=true;clearTimeout(memoTimer);});
  el.addEventListener('compositionend',function(){memoComposing=false;saveMemoHtml(true);});
  el.addEventListener('keyup',syncMemoToolbarState);
  el.addEventListener('pointerup',function(){setTimeout(syncMemoToolbarState,0);});
  document.addEventListener('selectionchange',function(){if(document.body.classList.contains('memo-editor-open'))syncMemoToolbarState();});
  /* 选文件插图 */
  var file=document.getElementById('memoFile');
  file.addEventListener('change',function(){
    if(file.files&&file.files.length){
      var range=pendingMemoImageRange||memoCaretRange(el);   /* 文件对话框会夺走焦点，使用打开前保存的选区 */
      var picked=Array.prototype.slice.call(file.files).filter(function(f){return f.type&&f.type.indexOf('image/')===0;});
      chainInsertFiles(picked,range?{range:range}:null);
    }
    pendingMemoImageRange=null;file.value='';
  });
  /* 剪贴板：文字保持原有选区粘贴；图片转成嵌入型图片块（插在当前光标处，单独成行）。 */
  el.addEventListener('paste',function(e){
    var clipboard=e.clipboardData,items=clipboard&&clipboard.items;if(!clipboard||!items)return;
    var range=memoCaretRange(el);   /* 先把光标快照下来：读图是异步的，稍后仍插回原位 */
    var images=[];
    for(var i=0;i<items.length;i++){
      if(items[i].type&&items[i].type.indexOf('image/')===0){var fileItem=items[i].getAsFile();if(fileItem)images.push(fileItem);}
    }
    var html=clipboard.getData('text/html')||'',rich=html.trim();
    /* 有完整 HTML 图文时保留整段内容；只有图片文件时走压缩插图。 */
    if(images.length&&!rich){
      e.preventDefault();
      chainInsertFiles(images,range?{range:range}:null);
      return;
    }
    /* Word/网页富文本：浏览器默认粘贴会把 <img onerror>、<iframe>、<script> 原样带入并可能立即执行，
       改为「先过滤再插入」——保留富文本与换行，挡掉脚本与危险属性。 */
    if(!rich)return;                    /* 纯文本没有 text/html，走浏览器默认行为，天然安全 */
    e.preventDefault();
    var clean=sanitizeMemoHtml(rich);
    if(!clean)return;
    var noteId=curNoteId,pasted=document.createElement('div');pasted.innerHTML=clean;
    var missing=Array.from(pasted.querySelectorAll('img:not([src])'));
    function insertRich(){
      if(curNoteId!==noteId){toast('便签已切换，请在目标便签重新粘贴');return;}
      memoRecordHistory(el);
      try{
        el.focus();
        if(range&&el.contains(range.startContainer)&&el.contains(range.endContainer)){
          var selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        }
        var inserted=false,content=pasted.innerHTML;
        try{inserted=document.execCommand('insertHTML',false,content);}catch(_){}
        if(!inserted){
          if(range&&el.contains(range.startContainer)){
            range.deleteContents();var fragment=range.createContextualFragment(content),last=fragment.lastChild;
            range.insertNode(fragment);if(last){range.setStartAfter(last);range.collapse(true);}
          }else el.insertAdjacentHTML('beforeend',content);
        }
        prepareMemoCanvas(el);
        memoRecordHistory(el);saveMemoHtml();
        if(pasted.querySelector('img:not([src])'))toast('文字已粘贴，部分图片无法读取，请单独插入图片','bad');
      }catch(_){toast('粘贴失败，请重试或先粘贴为纯文字','bad');}
    }
    if(missing.length&&images.length){
      Promise.all(missing.map(function(img,index){
        var file=images[index];if(!file||file.size>15*1024*1024)return Promise.resolve();
        return new Promise(function(resolve){
          var reader=new FileReader();reader.onload=function(){img.src=reader.result;resolve();};reader.onerror=function(){resolve();};reader.readAsDataURL(file);
        });
      })).then(insertRich);
    }else insertRich();
  });
  /* 常规文字选择仍交给浏览器复制；选中一张便签图片后 Ctrl/Cmd+C 则复制图片本身。 */
  el.addEventListener('copy',function(e){
    if(!selectedMemoImage||!selectedMemoImage.contains(document.activeElement)&&window.getSelection().toString())return;
    var img=selectedMemoImage.querySelector('img');if(!img||!img.src)return;
    e.preventDefault();
    var html='<img src="'+img.src.replace(/"/g,'&quot;')+'">';
    e.clipboardData.setData('text/html',html);
    e.clipboardData.setData('text/plain','[便签图片]');
    if(navigator.clipboard&&window.ClipboardItem&&img.complete&&img.naturalWidth){
      try{
        var canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        canvas.getContext('2d').drawImage(img,0,0);
        canvas.toBlob(function(blob){if(blob)navigator.clipboard.write([new ClipboardItem({'image/png':blob})]).catch(function(){});},'image/png');
      }catch(_){} /* 跨域图片无法读像素时仍保留上面的 HTML 剪贴板内容。 */
    }
  });
  /* 从资源管理器拖入：支持多张图片，并在可投放区域给出反馈。 */
  var box=el.closest('.memo-box'),dragDepth=0;
  el.addEventListener('dragenter',function(e){
    if(e.dataTransfer&&Array.from(e.dataTransfer.types||[]).includes('Files')){e.preventDefault();dragDepth++;if(box)box.classList.add('drop-active');}
  });
  el.addEventListener('dragstart',function(e){
    var wrap=e.target.closest&&e.target.closest('.memo-image-wrap');
    if(!wrap)return;
    movingMemoImage=wrap;
    if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-memo-image','move');}
  });
  el.addEventListener('dragend',function(){movingMemoImage=null;});
  el.addEventListener('dragover',function(e){
    var isMove=movingMemoImage||((e.dataTransfer&&Array.from(e.dataTransfer.types||[]).includes('application/x-memo-image')));
    if(isMove){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';return;}
    if(e.dataTransfer&&Array.from(e.dataTransfer.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}
  });
  el.addEventListener('dragleave',function(e){if(e.dataTransfer&&Array.from(e.dataTransfer.types||[]).includes('Files')){dragDepth=Math.max(0,dragDepth-1);if(!dragDepth&&box)box.classList.remove('drop-active');}});
  el.addEventListener('drop',function(e){
    if(movingMemoImage){
      /* 便签内图片原生拖拽换位（与按住拖动的效果一致）：按松开处位置流内插入 */
      e.preventDefault();
      var mv=movingMemoImage;movingMemoImage=null;
      var anchor=memoDropAnchor(el,e.clientX,e.clientY,mv);
      if(!anchor||!insertMemoWrapAt(el,mv,anchor))el.appendChild(mv);
      saveMemoHtml();return;
    }
    e.preventDefault();dragDepth=0;if(box)box.classList.remove('drop-active');
    var files=Array.from((e.dataTransfer&&e.dataTransfer.files)||[]).filter(function(f){return f.type&&f.type.indexOf('image/')===0;});
    if(!files.length){
      /* 拖进来的是文本/HTML（非图片文件）：默认行为已阻止，需自行过滤后插入 */
      var dtHtml=(e.dataTransfer&&e.dataTransfer.getData)?(e.dataTransfer.getData('text/html')||''):'';
      var dtText=(!dtHtml&&e.dataTransfer&&e.dataTransfer.getData)?(e.dataTransfer.getData('text/plain')||''):'';
      var cleanDrop=dtHtml?sanitizeMemoHtml(dtHtml):'';
      if(!cleanDrop&&dtText)cleanDrop=memoEscape(dtText).replace(/\n/g,'<br>');
      if(cleanDrop){
        try{
          el.focus();
          memoFocusCaretNear(e.clientX,e.clientY);
          var okDrop=false;
          try{okDrop=document.execCommand('insertHTML',false,cleanDrop);}catch(_){okDrop=false;}
          if(!okDrop)el.insertAdjacentHTML('beforeend',cleanDrop);
          prepareMemoCanvas(el);saveMemoHtml();
        }catch(_){}
      }
      return;
    }
    /* 从资源管理器拖入：插到松开鼠标所在的位置（图片单独成行），多张按顺序紧跟 */
    anchor=memoDropAnchor(el,e.clientX,e.clientY,null);
    chainInsertFiles(files,anchor);
  });
  /* 双击已插入图片进入裁剪，不影响正文其他内容。 */
  /* 双击图片进入裁剪；右下角把手保留等比缩放。 */
  el.addEventListener('dblclick',function(e){if(e.target&&e.target.tagName==='IMG')openMemoCrop(e.target);});
  /* 待办勾选：点击 ☐/☑ 切换完成态（事件委托，contenteditable=false 不夺焦） */
  el.addEventListener('click',function(e){
    var cb=e.target&&e.target.closest?e.target.closest('.mt-cb'):null;
    if(!cb)return;
    var row=cb.closest('.memo-todo');if(!row)return;
    var done=row.classList.toggle('todo-done');
    cb.textContent=done?'☑':'☐';
    e.preventDefault();
    saveMemoHtml();
  });
  /* 悬停图片右上角的 × 删除图片：弹自定义确认层（与清空数据/删除习惯等弹窗风格一致）。
     pointerdown 仅阻止默认（防图片拖动抢 click）并标记待删除；click 时弹层，回调里执行删除。
     原生 confirm 在新版 Electron 会带浏览器标题栏，与应用风格不符。 */
  function removeMemoImageFromControl(e){
    if(document.body.classList.contains('app-locked'))return;
    var crop=e.target.closest&&e.target.closest('.memo-image-crop');
    if(crop&&e.type==='pointerdown'){e.preventDefault();e.stopImmediatePropagation();selectMemoImage(crop.closest('.memo-image-wrap'));return;}
    if(crop&&e.type==='click'){e.preventDefault();e.stopImmediatePropagation();var cw=crop.closest('.memo-image-wrap'),ci=cw&&cw.querySelector('img');if(ci)openMemoCrop(ci);return;}
    var remove=e.target.closest&&e.target.closest('.memo-image-remove');if(!remove)return;
    if(document.body.classList.contains('app-locked'))return;
    if(e.type==='pointerdown'){
      e.preventDefault();e.stopImmediatePropagation();
      remove.dataset.removePending='1';   /* 标记：等 click 弹层 */
      return;
    }
    if(e.type==='click'){
      if(remove.dataset.removePending!=='1')return;
      delete remove.dataset.removePending;
      e.preventDefault();e.stopImmediatePropagation();
      var wrap=remove.closest('.memo-image-wrap');if(!wrap)return;
      showConfirm(T('del_image_title'),T('confirm_del_image'),function(){
        var sel=window.getSelection(),rng=document.createRange();
        try{
          rng.selectNode(wrap);sel.removeAllRanges();sel.addRange(rng);el.focus();
          document.execCommand('delete');
        }catch(_){ }
        if(wrap.parentNode)wrap.remove();
        refreshMemoPlaceholder(el);saveMemoHtml();
      },true);
    }
  }
  el.addEventListener('pointerdown',removeMemoImageFromControl);
  el.addEventListener('click',removeMemoImageFromControl);
  el.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&selectedMemoImage){e.preventDefault();selectMemoImage(null);return;}
    if(e.key!=='Delete'&&e.key!=='Backspace')return;
    var selection=window.getSelection();if(!selection||!selection.rangeCount)return;
    var node=selection.anchorNode;
    var li=node&&node.nodeType===1?node:node&&node.parentElement;
    li=li&&li.closest?li.closest('li'):null;
    if(e.key==='Backspace'&&li&&el.contains(li)&&selection.isCollapsed){
      var before=document.createRange();before.selectNodeContents(li);
      before.setEnd(selection.anchorNode,selection.anchorOffset);
      var atStart=!before.toString()&&!before.cloneContents().querySelector('img');
      if(atStart){
        e.preventDefault();
        var prev=li.previousElementSibling,list=li.parentElement;
        if(prev&&prev.tagName==='LI'){
          while(li.firstChild)prev.appendChild(li.firstChild);
          li.remove();
          var end=document.createRange();end.selectNodeContents(prev);end.collapse(false);
          selection.removeAllRanges();selection.addRange(end);
        }else{
          var block=document.createElement('div');
          while(li.firstChild)block.appendChild(li.firstChild);
          if(list&&list.parentNode)list.parentNode.insertBefore(block,list);
          li.remove();
          if(list&&!list.children.length)list.remove();
          var start=document.createRange();start.selectNodeContents(block);start.collapse(true);
          selection.removeAllRanges();selection.addRange(start);
        }
        el.focus();saveMemoHtml();return;
      }
    }
    if(li&&el.contains(li)&&!li.textContent.trim()&&selection.isCollapsed){
      e.preventDefault();
      list=li.parentElement;var after=list&&list.nextSibling;
      li.remove();
      var holder=document.createElement('div');holder.appendChild(document.createElement('br'));
      if(list&&list.parentNode){
        if(!list.children.length)list.parentNode.insertBefore(holder,after);
        else list.parentNode.insertBefore(holder,list.nextSibling);
      }
      var r=document.createRange();r.selectNodeContents(holder);r.collapse(true);
      selection.removeAllRanges();selection.addRange(r);el.focus();
      saveMemoHtml();
      return;
    }
    var selected=(selectedMemoImage&&selectedMemoImage.isConnected)?selectedMemoImage:(node&&node.nodeType===1&&node.classList&&node.classList.contains('memo-image-wrap')?node:null);
    if(selected){
      e.preventDefault();
      showConfirm(T('del_image_title'),T('confirm_del_image'),function(){
        selected.remove();selectMemoImage(null);refreshMemoPlaceholder(el);saveMemoHtml();
      },true);
    }
  });
  /* 拖右下角手柄等比缩放图片，尺寸作为内联样式保存在当天备忘录中。 */
  el.addEventListener('pointerdown',function(e){
    var grip=e.target.closest&&e.target.closest('.memo-image-grip');if(!grip)return;
    if(e.button!==0||document.body.classList.contains('app-locked'))return;
    var wrap=grip.closest('.memo-image-wrap');if(!wrap)return;
    e.preventDefault();e.stopImmediatePropagation();
    selectMemoImage(wrap);
    var rect=wrap.getBoundingClientRect();
    memoRecordHistory(el);clearTimeout(memoTimer);commitMemoHtml();
    var state={wrap:wrap,startX:e.clientX,startWidth:rect.width,originalWidth:wrap.style.width,min:60,max:Math.max(60,el.clientWidth-44)},ended=false;
    try{if(grip.setPointerCapture)grip.setPointerCapture(e.pointerId);}catch(_){}
    function move(ev){
      if(ev.pointerId!==e.pointerId)return;
      var width=Math.max(state.min,Math.min(state.max,state.startWidth+ev.clientX-state.startX));
      state.wrap.style.width=Math.round(width)+'px';
    }
    function end(ev,cancelled){
      if(ended||ev&&ev.pointerId!==undefined&&ev.pointerId!==e.pointerId)return;
      ended=true;
      grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',finish);grip.removeEventListener('pointercancel',cancel);grip.removeEventListener('lostpointercapture',cancel);window.removeEventListener('blur',cancel);
      if(cancelled)wrap.style.width=state.originalWidth;
      try{grip.releasePointerCapture&&grip.releasePointerCapture(e.pointerId);}catch(_){}
      selectMemoImage(wrap);
      saveMemoHtml();
    }
    function finish(ev){end(ev,false);}
    function cancel(ev){end(ev,true);}
    grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',cancel);grip.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);
  });
  /* 按住图片拖动 = 换段落位置（流内移动，不遮文字）：拖到某段文字上/下半区即插到该段前/后，
     目标段落会亮出蓝色落点线提示；拖到另一张图片上则插到它前/后。 */
  el.addEventListener('pointerdown',function(e){
    if(e.button!==0||document.body.classList.contains('app-locked')||e.target.closest('.memo-image-grip,.memo-image-remove,.memo-image-crop'))return;
    var wrap=e.target.closest&&e.target.closest('.memo-image-wrap');if(!wrap)return;
    

    if(e.target!==wrap.querySelector('img'))return;
    selectMemoImage(wrap);
    e.preventDefault();e.stopPropagation();
    var startX=e.clientX,startY=e.clientY,moved=false,target=null;
    wrap.classList.add('is-positioning');
    try{wrap.setPointerCapture&&wrap.setPointerCapture(e.pointerId);}catch(_){}
    function clearTarget(){
      if(target){
        if(target.line&&target.line.classList){target.line.classList.remove('memo-drop-before');target.line.classList.remove('memo-drop-after');}
        if(target.image&&target.image.classList){target.image.classList.remove('memo-drop-before');target.image.classList.remove('memo-drop-after');}
        target=null;
      }
    }
    function move(ev){
      if(!moved&&Math.abs(ev.clientX-startX)+Math.abs(ev.clientY-startY)<6)return; /* 拖够 6px 才算移动，否则当作点击选中 */
      moved=true;
      clearTarget();
      var anc=memoDropAnchor(el,ev.clientX,ev.clientY,wrap);
      if(anc){
        if(anc.line&&anc.line!==wrap&&!anc.line.contains(wrap)&&!wrap.contains(anc.line)){
          anc.line.classList.add(anc.before?'memo-drop-before':'memo-drop-after');
          target=anc;
        }else if(anc.image&&anc.image!==wrap){
          anc.image.classList.add(anc.before?'memo-drop-before':'memo-drop-after');
          target=anc; /* 落到另一张图片上：放它前/后（不插进图片内部） */
        }else if(anc.range){
          target=anc; /* 直排文本（text+<br>）：精确插到指针所在位置 */
        }
      }
      /* 拖到编辑区上下边缘自动滚动，长文档也能一路拖到底 */
      var r=el.getBoundingClientRect();
      if(ev.clientY<r.top+28)el.scrollTop=Math.max(0,el.scrollTop-18);
      else if(ev.clientY>r.bottom-28)el.scrollTop=Math.min(el.scrollHeight,el.scrollTop+18);
    }
    function end(ev,cancelled){
      wrap.removeEventListener('pointermove',move);wrap.removeEventListener('pointerup',finish);wrap.removeEventListener('pointercancel',cancel);wrap.removeEventListener('lostpointercapture',lost);
      wrap.classList.remove('is-positioning');
      try{wrap.releasePointerCapture&&wrap.releasePointerCapture(ev.pointerId);}catch(_){}
      var placed=!cancelled&&target?insertMemoWrapAt(el,wrap,target):false;
      clearTarget();
      if(moved&&placed)saveMemoHtml();
    }
    function finish(ev){end(ev,false);}
    function cancel(ev){end(ev,true);}
    function lost(ev){if(ev.pointerId===e.pointerId)end(ev,true);}
    wrap.addEventListener('pointermove',move);wrap.addEventListener('pointerup',finish);wrap.addEventListener('pointercancel',cancel);wrap.addEventListener('lostpointercapture',lost);
  });
  syncMemoToolbarState();
}
/* 图片压缩到 ≤900px 宽后插入（base64 存本地；手动 DOM 插入，绕开 execCommand('insertImage')
   处理超大 dataURL 的 Blink 内部路径 —— 该路径曾在 Electron 软渲染下触发 V8 int3 崩溃）
   at：放置点快照 —— 无 = 光标处（无光标则文末）；{range} = 粘贴/选文件前保存的光标；
       {line}/{image} = 段落或图片前/后落点；{prev} = 紧跟上一张。done(wrap) 插入完成后回调（多图链式用） */
function memoInsertImage(file,at,done){
  var el=document.getElementById('memoInput');
  if(!el||!file)return;
  var noteId=curNoteId;
  if(file.size>15*1024*1024){toast('这张图超过 15MB 啦～压一压再放进来','bad');if(done)done(null);return;}
  if(memoImgCount()>=12){toast('图片有点多啦（12 张）～记得定期「导出备份」留个底','backup');}
  var fr=new FileReader();
  fr.onload=function(){
    var img=new Image();
    img.onload=function(){
      try{
        var MAX=720,scale=Math.min(1,MAX/img.width),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
        var cv=document.createElement('canvas');cv.width=w;cv.height=h;
        var cx=cv.getContext('2d');cx.fillStyle='#FFFFFF';cx.fillRect(0,0,w,h);
        cx.drawImage(img,0,0,w,h);
        var data=cv.toDataURL('image/jpeg',0.8);
        /* v2.1：压缩后交给主进程落盘 images/<id>，正文引用 hbimg://（5MB 配额上限就此消失）；
           落盘失败退回内嵌 dataURL，绝不丢图（迁移/导入会再次尝试抽取） */
        hbPersistMemoImage(data,function(ref){
          try{
            if(curNoteId!==noteId){toast('便签已切换，请在目标便签重新插入图片');if(done)done(null);return;}
            memoRecordHistory(el);
            prepareMemoCanvas(el);
            var im=createMemoImageWrap(ref||data,memoDefaultImgWidth(el,img.naturalWidth||w));
            var placed=false;
            if(at&&at.prev)placed=insertMemoWrapAfter(el,im,at.prev);
            else if(at)placed=insertMemoWrapAt(el,im,at);
            if(!placed)insertMemoWrapAtCaret(el,im);   /* 锚点失效/未传 → 当前光标，再不行就文末 */
            memoEnsureTailEditable(el);                /* 图成为文末时补 <br> 锚点，插入后即可直接输入 */
            refreshMemoPlaceholder(el);
            saveMemoHtml();
            if(done)done(im);
          }catch(_){toast('图片插入失败','bad');if(done)done(null);}
        });
      }catch(err){toast('图片插入失败','bad');if(done)done(null);}
    };
    img.onerror=function(){toast('图片读取失败','bad');if(done)done(null);};
    img.src=fr.result;
  };
  fr.onerror=function(){toast('图片读取失败','bad');if(done)done(null);};
  fr.readAsDataURL(file);
}

/* ============ 备忘录图片裁剪（纯本地 Canvas，不上传文件） ============ */
var memoCropTarget=null;
var memoCropBox={x:0,y:0,w:0,h:0};
var memoCropDrag=null;
function cropStageSize(){
  var stage=document.getElementById('cropStage');
  return {w:stage.clientWidth,h:stage.clientHeight};
}
function paintMemoCrop(){
  var sel=document.getElementById('cropSelection');if(!sel)return;
  sel.style.left=memoCropBox.x+'px';sel.style.top=memoCropBox.y+'px';
  sel.style.width=memoCropBox.w+'px';sel.style.height=memoCropBox.h+'px';
}
function openMemoCrop(img){
  if(!img||!img.src)return;
  var overlay=document.getElementById('cropOverlay'),preview=document.getElementById('cropImage');
  memoCropTarget=img;overlay.classList.add('show');
  /* hbimg:// 源必须以 CORS 模式加载，否则裁剪的 canvas 被跨源污染、toDataURL 抛错 */
  try{ if(/^hbimg:\/\//i.test(img.src||''))preview.setAttribute('crossorigin','anonymous'); else preview.removeAttribute('crossorigin'); }catch(_){}
  preview.onload=function(){
    var s=cropStageSize(),pad=Math.max(14,Math.round(Math.min(s.w,s.h)*.1));
    memoCropBox={x:pad,y:pad,w:Math.max(40,s.w-pad*2),h:Math.max(40,s.h-pad*2)};
    paintMemoCrop();
  };
  preview.src=img.src;
}
function closeMemoCrop(){
  document.getElementById('cropOverlay').classList.remove('show');
  document.getElementById('cropImage').removeAttribute('src');memoCropTarget=null;memoCropDrag=null;
}
function cropPoint(e){
  var r=document.getElementById('cropStage').getBoundingClientRect();
  return {x:Math.max(0,Math.min(r.width,e.clientX-r.left)),y:Math.max(0,Math.min(r.height,e.clientY-r.top))};
}
function startMemoCropDrag(e){
  var sel=document.getElementById('cropSelection');
  if(!e.target.closest||!e.target.closest('#cropSelection'))return;
  e.preventDefault();
  var p=cropPoint(e),handle=e.target.dataset.handle||'move';
  memoCropDrag={handle:handle,start:p,box:{x:memoCropBox.x,y:memoCropBox.y,w:memoCropBox.w,h:memoCropBox.h}};
  sel.setPointerCapture&&sel.setPointerCapture(e.pointerId);
}
function moveMemoCropDrag(e){
  if(!memoCropDrag)return;
  var p=cropPoint(e),dx=p.x-memoCropDrag.start.x,dy=p.y-memoCropDrag.start.y;
  var b=memoCropDrag.box,s=cropStageSize(),min=40,n={x:b.x,y:b.y,w:b.w,h:b.h};
  if(memoCropDrag.handle==='move'){
    n.x=Math.max(0,Math.min(s.w-b.w,b.x+dx));n.y=Math.max(0,Math.min(s.h-b.h,b.y+dy));
  }else if(memoCropDrag.handle==='nw'){
    n.x=Math.max(0,Math.min(b.x+b.w-min,b.x+dx));n.y=Math.max(0,Math.min(b.y+b.h-min,b.y+dy));n.w=b.x+b.w-n.x;n.h=b.y+b.h-n.y;
  }else if(memoCropDrag.handle==='ne'){
    n.w=Math.max(min,Math.min(s.w-b.x,b.w+dx));n.y=Math.max(0,Math.min(b.y+b.h-min,b.y+dy));n.h=b.y+b.h-n.y;
  }else if(memoCropDrag.handle==='sw'){
    n.x=Math.max(0,Math.min(b.x+b.w-min,b.x+dx));n.w=b.x+b.w-n.x;n.h=Math.max(min,Math.min(s.h-b.y,b.h+dy));
  }else if(memoCropDrag.handle==='se'){
    n.w=Math.max(min,Math.min(s.w-b.x,b.w+dx));n.h=Math.max(min,Math.min(s.h-b.y,b.h+dy));
  }
  memoCropBox=n;paintMemoCrop();
}
function endMemoCropDrag(){memoCropDrag=null;}
function applyMemoCrop(){
  var target=memoCropTarget,img=document.getElementById('cropImage');
  if(!target||!img.naturalWidth||!img.clientWidth)return;
  var scaleX=img.naturalWidth/img.clientWidth,scaleY=img.naturalHeight/img.clientHeight;
  var sx=Math.max(0,Math.round(memoCropBox.x*scaleX)),sy=Math.max(0,Math.round(memoCropBox.y*scaleY));
  var sw=Math.max(1,Math.round(memoCropBox.w*scaleX)),sh=Math.max(1,Math.round(memoCropBox.h*scaleY));
  sw=Math.min(sw,img.naturalWidth-sx);sh=Math.min(sh,img.naturalHeight-sy);
  var max=1000,ratio=Math.min(1,max/Math.max(sw,sh)),w=Math.max(1,Math.round(sw*ratio)),h=Math.max(1,Math.round(sh*ratio));
  var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  var ctx=canvas.getContext('2d');ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,w,h);ctx.drawImage(img,sx,sy,sw,sh,0,0,w,h);
  var data=canvas.toDataURL('image/jpeg',0.82);
  /* v2.1：裁剪结果同样落盘为独立文件（旧 src 失效由 GC 延迟回收），失败退回内嵌 dataURL */
  hbPersistMemoImage(data,function(ref){
    target.src=ref||data;
    if(/^hbimg:\/\//i.test(target.src||''))target.setAttribute('crossorigin','anonymous');
    closeMemoCrop();saveMemoHtml();toast('图片已裁剪并保存','good');
  });
}
(function initMemoCrop(){
  var sel=document.getElementById('cropSelection');if(!sel)return;
  sel.addEventListener('pointerdown',startMemoCropDrag);
  sel.addEventListener('pointermove',moveMemoCropDrag);
  sel.addEventListener('pointerup',endMemoCropDrag);sel.addEventListener('pointercancel',endMemoCropDrag);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.getElementById('cropOverlay').classList.contains('show'))closeMemoCrop();});
})();


/* ============ 渲染：习惯页 ============ */
