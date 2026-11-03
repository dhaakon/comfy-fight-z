const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sourceFile, runtimeSources } = require('./lib/runtime-validation.cjs');
const root = path.resolve(__dirname,'..');
const args=process.argv.slice(2);
let from, strict=false, regenerate=false;
for(let i=0;i<args.length;i++) {
  if(args[i]==='--strict') strict=true;
  else if(args[i]==='--regenerate-assets') regenerate=true;
  else if(args[i]==='--from' && args[i+1] && !args[i+1].startsWith('--')) from=args[++i];
  else throw new Error('Usage: npm run build -- [--strict] [--regenerate-assets] [--from <ComfyUI/output>]');
}
if(from) {
  const imported=spawnSync(process.execPath,[path.join(__dirname,'import-assets.cjs'),'--from',from],{cwd:root,stdio:'inherit'});
  if(imported.status!==0) process.exit(imported.status||1);
}
const production=path.join(root,'public/assets/production.json');
if(from || regenerate || !fs.existsSync(production)) {
  const result=spawnSync(process.execPath,[path.join(__dirname,'build-assets.cjs'),...(strict?['--strict']:[])],{cwd:root,stdio:'inherit'});
  if(result.status!==0) process.exit(result.status||1);
} else {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/assets/manifest.json'),'utf8'));
  const config=JSON.parse(fs.readFileSync(path.join(root,'config/game.json'),'utf8'));
  const plan=JSON.parse(fs.readFileSync(path.join(root,'assets/plan.json'),'utf8'));
  const sources=runtimeSources(manifest,{config,plan,strict});
  for(const src of sources)sourceFile(path.join(root,'public/assets'),src.slice('assets/'.length));
  console.log(`Using ${sources.length} accepted runtime assets; no regeneration requested.`);
}
// Remove only this project's generated distribution, after checking the exact path.
const dist=path.resolve(root,'dist');
if(path.dirname(dist)!==root || path.basename(dist)!=='dist') throw new Error('Unexpected distribution path');
fs.rmSync(dist,{recursive:true,force:true});
fs.cpSync(path.join(root,'public'),dist,{recursive:true});
console.log('Built dist/. Run npm start to play. Build never submits cloud jobs.');
