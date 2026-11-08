const fs=require('node:fs');
const path=require('node:path');
const args=process.argv.slice(2);
// ComfyUI Desktop installs started with --base-directory load custom nodes from that base folder
// (for example Documents\ComfyUI), not from the source directory containing main.py.
if(args.length!==2||!['--comfy-root','--base-directory'].includes(args[0]))throw new Error('Usage: node comfyui/tools/install-comfy-nodes.cjs --comfy-root <ComfyUI directory containing main.py> | --base-directory <ComfyUI Desktop base folder>');
const root=fs.realpathSync(path.resolve(args[1]));
if(args[0]==='--comfy-root'&&(!fs.existsSync(path.join(root,'main.py'))||!fs.existsSync(path.join(root,'nodes.py'))))throw new Error('Not a ComfyUI source directory');
if(args[0]==='--base-directory'&&!['input','user','custom_nodes'].some(name=>fs.existsSync(path.join(root,name))))throw new Error('Not a ComfyUI base directory (expected input, user or custom_nodes)');
const custom=path.join(root,'custom_nodes'),target=path.join(custom,'comfy_fighter_assets');
fs.mkdirSync(custom,{recursive:true});
if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('Custom node destination must not be a symlink');
// Retain the project's previous pack outside the loader's active directories.
// Both versions define the same factory IDs, so leaving both active is unsafe.
const previous=path.join(custom,'dad_fighter_assets');
let backup;
if(fs.existsSync(previous)){
  const customReal=fs.realpathSync(custom);
  if(fs.lstatSync(previous).isSymbolicLink()||fs.realpathSync(previous)!==path.join(customReal,'dad_fighter_assets'))throw new Error('Previous custom node pack must be a plain directory inside custom_nodes');
  const entry=path.join(previous,'__init__.py');
  if(!fs.existsSync(entry)||!fs.readFileSync(entry,'utf8').includes('class DadFighterAssetsExtension'))throw new Error('Previous pack is not the expected project-owned installation; leave it unchanged and resolve the duplicate manually');
  const disabled=path.join(custom,'.disabled');
  if(fs.existsSync(disabled)&&fs.lstatSync(disabled).isSymbolicLink())throw new Error('Disabled-pack directory must not be a symlink');
  fs.mkdirSync(disabled,{recursive:true});
  if(fs.realpathSync(disabled)!==path.join(customReal,'.disabled'))throw new Error('Disabled-pack directory must stay inside custom_nodes');
  backup=path.join(disabled,`comfy-fighter-assets-before-rename-${Date.now()}`);
  if(path.dirname(path.resolve(backup))!==fs.realpathSync(disabled)||fs.existsSync(backup))throw new Error('Unexpected legacy-pack backup path');
}
fs.mkdirSync(target,{recursive:true});
for(const file of ['__init__.py','factories.py','scenery.py'])fs.copyFileSync(path.resolve(__dirname,'../custom_nodes/comfy_fighter_assets',file),path.join(target,file));
if(backup){
  fs.renameSync(previous,backup);
  console.log(`Preserved the previous project pack in ${backup}.`);
}
console.log(`Installed Comfy Fighter Z cloud factories and asset-mapping nodes in ${target}. Restart ComfyUI to load them.`);
