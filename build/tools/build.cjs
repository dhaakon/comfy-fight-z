const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sourceFile, runtimeSources, directoryTarget } = require('./lib/runtime-validation.cjs');
const root = path.resolve(__dirname,'../..');
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
const production=path.join(root,'build/public/assets/production.json');
const manifestPath=path.join(root,'build/public/assets/manifest.json');
const current=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
if(current?.generationPending && !from && !regenerate) {
  if(strict) throw new Error('Fictional demo artwork is awaiting generation; a strict release requires an accepted complete asset bundle.');
  if(runtimeSources(current).length) throw new Error('Pending fictional demo must not reference any previous media.');
  if(fs.readdirSync(path.dirname(manifestPath)).some(name=>name!=='manifest.json')) throw new Error('Pending fictional demo contains unexpected asset files; move retired media outside the public folder.');
  console.log('Fictional demo artwork is awaiting generation. Copying the media-free preview; no old assets or placeholders are generated.');
} else if(from || regenerate || !fs.existsSync(production)) {
  const result=spawnSync(process.execPath,[path.join(__dirname,'build-assets.cjs'),...(strict?['--strict']:[])],{cwd:root,stdio:'inherit'});
  if(result.status!==0) process.exit(result.status||1);
} else {
  const manifest=current;
  const config=JSON.parse(fs.readFileSync(path.join(root,'comfyui/config/game.json'),'utf8'));
  const plan=JSON.parse(fs.readFileSync(path.join(root,'comfyui/assets/plan.json'),'utf8'));
  const sources=runtimeSources(manifest,{config,plan,strict});
  for(const src of sources)sourceFile(path.join(root,'build/public/assets'),src.slice('assets/'.length));
  console.log(`Using ${sources.length} accepted runtime assets; no regeneration requested.`);
}
// Resolve existing ancestors before replacing only this project's output/game directory.
const dist=path.resolve(root,'output/game');
const expected=path.join(fs.realpathSync(root),'output/game');
if(directoryTarget(dist)!==expected) throw new Error('Distribution path resolves outside output/game');
fs.rmSync(dist,{recursive:true,force:true});
fs.cpSync(path.join(root,'build/public'),dist,{recursive:true});
console.log('Built output/game/. Run npm start to play. Build never submits cloud jobs.');
