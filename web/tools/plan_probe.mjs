import {decodeRLE} from '/Users/unlink/code/solarwinds/web/src/rle.ts';
import fs from 'node:fs';
const raw=new Uint8Array(fs.readFileSync('web/data/BH_PLAN.DAT'));
const dec=decodeRLE(raw,'stone');
const buf=dec.decoded??dec;
console.log('stone decoded bytes:',buf.length);
let o=0,n=0,sizes=[];
while(o+2<=buf.length){const w=buf[o],h=buf[o+1]; if(w===0||h===0||w>255||h>255||o+2+w*h>buf.length) break; sizes.push([n,w,h,o]); o+=2+w*h; n++;}
console.log('records:',n,'end at',o,'of',buf.length);
console.log('first 12:',sizes.slice(0,12).map(s=>`${s[0]}:${s[1]}x${s[2]}@${s[3].toString(16)}`).join(' '));
console.log('distinct sizes:',[...new Set(sizes.map(s=>s[1]+'x'+s[2]))].join(' '));
