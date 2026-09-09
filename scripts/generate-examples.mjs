/** Generate editable sample projects from the same original geometry used by the app. */
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {EXAMPLES} from '../src/core/examples.js';
import {ModelDocument} from '../src/core/document.js';
const root=new URL('../examples/',import.meta.url);
await mkdir(root,{recursive:true});
for(const [id,make] of Object.entries(EXAMPLES)){
  const d=new ModelDocument(), example=make();
  Object.assign(d,example);d.validate();
  const path=new URL(`${id}.avl`,root);
  await writeFile(path,JSON.stringify(d.serialize()));
  console.log(`Wrote ${fileURLToPath(path)} (${d.bodies.length} bodies)`);
}
