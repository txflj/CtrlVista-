// Adapted from RhineLabUI (MIT, Copyright 2026 LBEILC).
import {readFile,writeFile,readdir} from 'node:fs/promises';
const dir='node_modules/@kitlangton/rolling-number/dist';
const before='S={width:M.width/s,height:M.height/o};this.sizes.set(y,S)';
const after='S={width:parseFloat(t.getComputedStyle(y).width),height:parseFloat(t.getComputedStyle(y).height)};this.sizes.set(y,S)';
let found=false;
for(const file of await readdir(dir))if(file.endsWith('.js')){const path=`${dir}/${file}`,source=await readFile(path,'utf8');if(source.includes(after)){found=true;continue}if(source.includes(before)){await writeFile(path,source.replace(before,after));found=true;}}
if(!found)throw Error('Rolling Number patch no longer matches. Review before upgrading.');
