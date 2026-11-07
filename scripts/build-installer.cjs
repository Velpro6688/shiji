'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
const stage=path.join(root,'artifacts','installer-staging-'+pkg.version),source=path.join(root,'artifacts','portable-staging-'+pkg.version,'win-unpacked');
if(!fs.existsSync(path.join(source,'resources/app.asar')))throw new Error('Build and verify the portable payload first');
if(fs.existsSync(path.join(source,'data')))throw new Error('A user data directory must never be included in the installer payload');
fs.mkdirSync(stage,{recursive:true});
for(const file of ['installer.nsi','license.txt','logo.ico'])fs.copyFileSync(path.join(root,'安装包制作',file),path.join(stage,file));
fs.cpSync(source,path.join(stage,'payload'),{recursive:true});
const files=[],dirs=[];
function walk(dir,rel){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const next=rel?rel+'\\'+item.name:item.name;if(item.isDirectory()){walk(path.join(dir,item.name),next);dirs.push(next);}else files.push(next);}}
walk(source,'');
function escaped(text){return text.replace(/\$/g,'$$').replace(/"/g,'$\\"');}
const manifest=files.map(file=>'Delete "$INSTDIR\\'+escaped(file)+'"').concat(dirs.map(dir=>'RMDir "$INSTDIR\\'+escaped(dir)+'"')).join('\r\n');
fs.writeFileSync(path.join(stage,'payload-uninstall.nsh'),'; Exact packaged files only; data/ is never listed.\r\n'+manifest+'\r\n');
const compiler=process.env.NSIS_EXE||path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe');
const result=spawnSync(compiler,['/V2','installer.nsi'],{cwd:stage,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
console.log('Installer: '+path.join(stage,'时迹-'+pkg.version+'-Setup.exe'));
