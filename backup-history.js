'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
function imageFiles(dir){
  if(!fs.existsSync(dir))return [];
  if(fs.lstatSync(dir).isSymbolicLink())throw new Error('图片目录不能是链接');
  return fs.readdirSync(dir).sort().map(name=>{
    const file=path.join(dir,name);
    if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw new Error('图片目录包含非法文件');
    return {name,sha256:hash(fs.readFileSync(file))};
  });
}
function manifest(dir){return {format:1,dataSHA256:hash(fs.readFileSync(path.join(dir,'data.json'))),images:imageFiles(path.join(dir,'images'))};}
function summary(doc){return {days:Object.keys(doc.days||{}).length,habits:(doc.habits||[]).filter(h=>h&&!h.deleted).length,notes:Array.isArray(doc.memoNotes)?doc.memoNotes.length:0,todos:Array.isArray(doc.todos)?doc.todos.length:0};}
function inspect(base,name){
  if(!/^habit-backup-\d{8}-\d{6}(?:-\d{3})?-v[\d.]+(?:-[a-f\d]+)?$/.test(name))throw new Error('非法备份名称');
  const dir=path.join(base,name);
  if(fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync(path.dirname(dir))!==fs.realpathSync(base))throw new Error('备份路径无效');
  const raw=fs.readFileSync(path.join(dir,'data.json'));
  const doc=JSON.parse(raw.toString('utf8'));
  if(!doc||typeof doc!=='object'||!doc.days||Array.isArray(doc.days)||!Array.isArray(doc.habits||[]))throw new Error('存档结构无效');
  const current=manifest(dir),files=current.images;
  const refs=[...new Set(JSON.stringify(doc).match(/hbimg:\/\/[A-Za-z0-9]+/g)||[])];
  const missing=refs.filter(ref=>!files.some(f=>f.name.replace(/\.[^.]+$/,'')===ref.slice(8)));
  let verified=false;
  if(fs.existsSync(path.join(dir,'manifest.json'))){
    const saved=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
    if(JSON.stringify(saved)!==JSON.stringify(current))throw new Error('备份校验失败，文件已改变');
    verified=true;
  }
  let info={};try{info=JSON.parse(fs.readFileSync(path.join(dir,'info.json'),'utf8'));}catch(_){}
  return {dir,doc,raw,current,row:{name,createdAt:info.createdAt||fs.statSync(dir).mtime.toISOString(),...summary(doc),images:files.length,missingImages:missing.length,verified,ok:missing.length===0,integrity:missing.length?'图片缺失':verified?'完整性校验通过':'旧版备份：引用图片齐全',fingerprint:hash(JSON.stringify(current))}};
}
module.exports={hash,manifest,inspect,summary};
