'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
const output=path.join(root,'artifacts','release-'+pkg.version);
const inputs=[
 ['artifacts/portable-staging-'+pkg.version+'/时迹-便携版-'+pkg.version+'.exe','shiji-'+pkg.version+'-portable.exe'],
 ['artifacts/installer-staging-'+pkg.version+'/时迹-'+pkg.version+'-Setup.exe','shiji-'+pkg.version+'-Setup.exe'],
 ['LICENSE','LICENSE.txt']
];
for(const [source]of inputs)if(!fs.existsSync(path.join(root,source)))throw Error('Missing release input: '+source);
fs.mkdirSync(output,{recursive:true});
const expected=inputs.map(([,name])=>name).concat('SHA256SUMS.txt');
for(const name of fs.readdirSync(output))if(!expected.includes(name))throw Error('Unexpected file in release directory: '+name);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sums=[];
for(const [source,name]of inputs){const from=path.join(root,source),to=path.join(output,name);fs.copyFileSync(from,to);const digest=hash(to);if(hash(from)!==digest)throw Error('Release copy mismatch: '+name);sums.push(digest+'  '+name);}
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log('Prepared '+pkg.version+' release: '+inputs.length+' files and SHA256SUMS.txt');
