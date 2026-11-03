const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {runtimeSources}=require('../tools/lib/runtime-validation.cjs');
const root=path.resolve(__dirname,'../..');
function files(folder){return fs.existsSync(folder)?fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(folder,entry.name)):[path.join(folder,entry.name)]):[];}

test('demo runtime contains only the fictional roster and explicitly mapped media',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'build/public/assets/manifest.json'),'utf8'));
 const fictional=JSON.parse(fs.readFileSync(path.join(root,'comfyui/config/fictional-demo.json'),'utf8'));
 assert.deepEqual(manifest.fighters.map(f=>f.id),fictional.fighters.map(f=>f.id));
 const mapped=new Set(runtimeSources(manifest).map(src=>path.resolve(root,'build/public',src)));
 const metadata=new Set(['manifest.json','production.json','source-manifest.json']);
 for(const file of files(path.join(root,'build/public/assets'))){
  if(metadata.has(path.relative(path.join(root,'build/public/assets'),file)))continue;
  assert.ok(mapped.has(file),`Unmapped media must not remain publicly served: ${path.relative(root,file)}`);
 }
 if(manifest.generationPending){
  assert.equal(mapped.size,0,'Pending fiction cannot fall back to previous artwork or audio');
  assert.equal(manifest.openingVideo,undefined);
  assert.deepEqual(fs.readdirSync(path.join(root,'build/public/assets')),['manifest.json']);
 }
});

test('shipped reference images are limited to the fictional demo directory',()=>{
 for(const file of files(path.join(root,'comfyui/ref')).filter(file=>/\.(png|jpe?g|webp)$/i.test(file))){
  assert.ok(file.startsWith(path.join(root,'comfyui/ref/demo')+path.sep),`Private reference remains in the shipped ref tree: ${path.relative(root,file)}`);
 }
});
