const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
(async () => {
 const ctx = {window:{}}; vm.runInNewContext(fs.readFileSync('js/grist_schema.js','utf8'),ctx);
 let actions; const api={listTables:async()=>[],applyUserActions:async a=>{actions=a;}};
 assert.equal(await ctx.window.createDnbDemoSchema(api),16);
 const tables=actions.filter(a=>a[0]==='AddTable');
 const names=tables.map(a=>a[1]); assert.equal(new Set(names).size,16);
 for(const action of tables) for(const col of action[2]) if(col.type.startsWith('Ref:')) assert.ok(names.indexOf(col.type.slice(4)) < names.indexOf(action[1]), col.id);
 assert.ok(actions.some(a=>a[0]==='AddRecord' && a[1]==='DNB_Affectations' && a[3].Eleve===1 && a[3].Salle===1));
 let called=false; await assert.rejects(ctx.window.createDnbDemoSchema({listTables:async()=>['DNB_Eleves'],applyUserActions:async()=>{called=true;}}),/tables DNB existent/); assert.equal(called,false);
 console.log('Schéma Grist : références et prévention des collisions OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
