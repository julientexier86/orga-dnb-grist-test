const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
(async () => {
  const dom = new JSDOM('<iframe></iframe>', {url:'https://example.test/', runScripts:'outside-only'});
  const w = dom.window.document.querySelector('iframe').contentWindow;
  w.document.body.innerHTML = '';
  w.eval('var DB = {config:{year:"2026"}, students:[{nom:"Fictif"}], rooms:[], teachers:[]};');
  let optionHandler, saved, loaded;
  w.grist = {ready(o){assert.equal(o.requiredAccess,'full');}, onOptions(fn){optionHandler=fn;}, docApi:{
    async fetchTable(){return saved ? {id:[1], Date_UTC:[saved.Date_UTC], Donnees_JSON:[saved.Donnees_JSON]} : {id:[], Date_UTC:[], Donnees_JSON:[]};},
    async applyUserActions(actions){saved=actions[0][3];}
  }};
  w.showConfirm = (message, cb) => cb();
  w.loadGlobalData = f => {loaded=f;};
  w.eval(fs.readFileSync('js/grist_bridge.js','utf8'));
  w.document.querySelector('script').onload();
  optionHandler({}, {access_level:'full'});
  const buttons=w.document.querySelectorAll('button');
  buttons[0].click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(JSON.parse(saved.Donnees_JSON).students[0].nom,'Fictif');
  buttons[1].click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(loaded instanceof w.File);
  assert.match(w.document.body.textContent,/Chargement demandé/);
  console.log('Grist bridge: sauvegarde et restauration simulées OK');
  dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
