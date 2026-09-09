import fs from 'node:fs/promises';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const packed=Buffer.concat(await Promise.all(Array.from({length:8},(_,i)=>fs.readFile(`.bootstrap/source.br.part${i+1}`))));
const hash=createHash('sha256').update(packed).digest('hex');
if(hash!=='70b0638258d76d53e4b3c900f8dcebee945d37f8b4c1da5bf30554f0e3cb2b28')throw Error('Source transfer integrity mismatch');
const files=JSON.parse(brotliDecompressSync(packed).toString('utf8'));
for(const [name,text] of Object.entries(files)){
 if(name.startsWith('/')||name.split('/').includes('..')||typeof text!=='string')throw Error('Unsafe source path');
 await fs.mkdir(path.dirname(name),{recursive:true});await fs.writeFile(name,text);
}
console.log(`Imported ${Object.keys(files).length} original source files; SHA-256 verified.`);
