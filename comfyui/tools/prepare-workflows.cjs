const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, value) => { const file = path.join(ROOT, p); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const clone = x => structuredClone(x);
const invents = item => item.sourceMode === 'Invent fictional reference';
const isPaidImage = job => job.kind !== 'source' || job.generateSource === true;
const POSES = {
  idle: 'relaxed fighting guard', walk: 'forward walking stride, left foot leading', punch: 'straight lead-hand jab fully extended',
  kick: 'high roundhouse kick fully extended', block: 'standing forearm guard', hit: 'recoiling from a torso hit', special: 'signature special attack release',
  down: 'lying knocked down horizontally', win: 'triumphant victory pose', stance2: 'upright fighting guard, second idle pose',
  crouch: 'low crouching guard', sweep: 'low sweeping leg kick with the attacking foot extended to the RIGHT of the hips', launcher: 'rising uppercut toward the RIGHT', jump: 'airborne with bent knees',
  airkick: 'airborne forward kick', hpunch: 'heavy rear-hand punch fully extended', dash: 'forward dash leaning toward right', tumble: 'airborne backward tumble',
  walk2: 'walking stride, right foot leading', lkick: 'quick low standing kick', cjab: 'crouching jab', airpunch: 'airborne punch',
  throw: 'empty-handed forward throwing motion without another person', taunt: 'playful confident taunt', getup: 'rising from one knee',
  powerup: 'powering up, clenched fists', entrance: 'confident entrance pose'
};
const GREEN = 'Flat uniform chroma green background RGB(0,255,0), no gradient, no floor shadow, no green on the subject, no lettering, borders, watermark, props outside the silhouette or detached debris. All clothing, shoes, soles, skin and accessories are fully opaque in their specified non-green colors: NO green apparel, green footwear, green reflections or translucent green body parts. Chroma green belongs only outside the character. Leave ample clear green padding around the whole subject. Use a solid clean ink silhouette, without a colored outline fringe. Accessories remain attached to the character; exactly one of each visible accessory.';

function makeJobs(config) {
  const jobs = [];
  const add = job => jobs.push({ ...job, output: `output/assets/generated/raw/${job.id}.png`, workflow: `comfyui/workflows/jobs/${job.id}.json` });
  for (const fighter of config.fighters) {
    const special = fighter.specialMove ? `${fighter.specialMove.name}: ${fighter.specialMove.description}` : 'A forward energy burst matching the character description.';
    const base = `${config.style}\nCHARACTER: ${fighter.description}\nSIGNATURE SPECIAL MOVE: ${special}\n`;
    const ref = `${fighter.id}_reference`;
    const hasSource = invents(fighter) || !!fighter.sourceImage;
    if (hasSource) add({ id: `${fighter.id}_source`, kind: 'source', fighter: fighter.id, key: false,
      ...(invents(fighter) ? {generateSource:true,aspect:'2:3',prompt:fighter.referencePrompt || `${base}Invent one entirely fictional adult fighter from text only. Full-body right-facing reference, complete hands and shoes. No real-person or image reference is supplied. ${GREEN}`} : {sourceImage:fighter.sourceImage,sourceInput:fighter.sourceInput}) });
    add({ id: ref, kind: 'reference', fighter: fighter.id, key: true, aspect: '2:3', ...(hasSource ? { reference: `${fighter.id}_source`, ...(!invents(fighter)&&fighter.sourceInput?{sourceInput:fighter.sourceInput}:{}) } : {}), prompt: `${base}Use the supplied reference design to preserve its appearance, costume and palette. Create one full-body character model reference, entire head and shoes visible, three-quarter side view facing RIGHT, neutral fighting stance. Complete unseen clothing details according to the character description. This design is the identity reference for every later asset. ${GREEN}` });
    for (const [sheet, poses] of Object.entries(config.sheets)) {
      add({ id: `${fighter.id}_${sheet}`, kind: 'sprites', fighter: fighter.id, sheet, key: true, poses, reference: ref, aspect: '1:1', resolution: '2K',
        prompt: `${base}Use the supplied accepted anime reference to preserve the recognizable face, natural body build, hairstyle, clothing, accessories and palette. Redraw that same original person with the stronger angular ink, sculpted cel shadows and powerful 1990s battle-anime posing described above. Produce a SINGLE square 3 by 3 sprite sheet, exactly 9 equally sized invisible cells in a uniform mathematical grid. Read left to right, then top to bottom. One COMPLETE full-body pose per cell, including BOTH shoes. All poses face RIGHT: the nose, chest, leading fist and attacking foot point toward the right edge; especially the sweep, airkick and punches attack RIGHT. Consistent side-on camera and body scale across all nine cells. Choose a small enough body scale that the widest kick and longest horizontal down pose fit their own cells. Each standing figure is approximately 60% of its cell height, with shoes at 82% of cell height and the head near 22%. Center each whole pose inside its cell, including horizontal and airborne poses. Every hand, shoe, hair tip, accessory and attached energy accent stays within the central 76% of its cell, with at least 12% clear green on ALL four sides. The bottom row, including entrance, must show both complete feet and clear green below them. No limb crosses a cell boundary. Every complete silhouette is separated from its neighbors by uninterrupted green corridors: keep horizontal canvas bands from 30% to 37% and from 63% to 70% entirely empty green. Keep matching vertical green corridors between the three columns. No shoe touches another pose's hair, hand or effects. Keep special energy compact and attached to the palms, without a long beam reaching a cell edge; the game supplies the traveling projectile. No cropping at the outer canvas edge. Cell divisions are completely invisible: NO grid lines, panels, frames, dividers, gutters in another color, numbers or labels. Avoid large aura clouds on sprites; use compact attached energy accents only. These are named key poses, not a smooth nine-frame loop.\n${poses.map((p,i)=>`Cell ${i+1} (row ${Math.floor(i/3)+1}, column ${i%3+1}): ${p} - ${p === 'special' ? special : POSES[p]}.`).join('\n')}\n${GREEN}` });
    }
    for (const [kind, aspect, direction] of [
      ['portrait','1:1','A bold 1990s battle-anime character-select portrait, head and shoulders, centered recognizable face, angular expressive eyes, strong ink eyebrows, dramatic hard cel shadows and a fierce competitive expression. Keep the complete head and hair inside the image with clear padding.'],
      ['hero','2:3','A single full-body 1990s battle-anime character-selection hero illustration for a large versus panel. Powerful planted fighting stance, clenched or open fighting hands, sharp two-tone muscle and cloth shading, dynamic foreshortening. Entire shoes, head, hands and hair fully visible with at least 10% clear padding. Compact gold and cyan power highlights attached to the silhouette.'],
      ['cutin','16:9',`A dramatic anime waist-up super-attack cut-in depicting ${special} Character and attack face RIGHT, complete face and arms, intense expression and tight inked energy accents.`]
    ]) add({ id: `${fighter.id}_${kind}`, kind, fighter: fighter.id, key: true, reference: ref, aspect,
      prompt: `${base}Preserve the supplied reference identity, outfit and palette while upgrading its rendering to the bold battle-anime art direction above. ${direction} ${GREEN}` });
  }
  for (const stage of config.stages) {
    const hasSource = invents(stage) || !!stage.sourceImage;
    if (hasSource) add({ id: `${stage.id}_source`, kind: 'source', stage: stage.id, key: false,
      ...(invents(stage) ? {generateSource:true,aspect:'16:9',resolution:'2K',prompt:stage.referencePrompt || `${config.stageStyle}\nInvent this fictional environment from text only: ${stage.description}. No image input or real venue is supplied.`} : {sourceImage:stage.sourceImage,sourceInput:stage.sourceInput}) });
    add({ id: stage.id, kind:'stage', stage:stage.id, aspect:'16:9', resolution:'2K', ...(hasSource ? { reference: `${stage.id}_source`, ...(!invents(stage)&&stage.sourceInput?{sourceInput:stage.sourceInput}:{}) } : {}),
      prompt: `${config.stageStyle || 'Original hand-painted anime environment background with clean architectural ink and rich cel-shaded materials. No decorative graphic border or speed lines.'}\nFighting arena: ${stage.description} Use the supplied environment design to preserve its architecture, surfaces and lighting. Recompose as a wide side-on anime stage background with an unobstructed horizontal playable floor at 82% image height, flat camera, clear central arena. Background props remain behind the fight plane. No fighters, people, HUD, letters or logos. Full-bleed landscape with natural surfaces reaching every edge. No superimposed directional lines, radial rays, speed-line border, comic frame, edge vignette or letterboxing.` });
  }
  // Interface art must not inherit the character-directed fighter style prompt.
  const uiStyle = config.uiStyle || 'Original 2D arcade interface artwork, crisp ink outlines, rich cel shading, warm suburban comedy, cohesive late-1990s hand-drawn arcade aesthetic. No existing franchise imagery.';
  const ui = {
    title: ['16:9', `An epic 1990s battle-anime fighting tournament title-screen background using the supplied ${config.stages[0].name} arena as its venue. Preserve its environment design. Golden electrical energy arcs climb the sides, cyan and magenta ki-like light clashes at the horizon, sweeping radial speed lines and dramatic inked clouds frame a dark empty central 55% for a code-rendered title and subtitle "${config.subtitle || ''}". Hand-painted cel-animation finish and deep atmospheric perspective. Environment artwork only; no people, fighters, faces, character illustrations, text, lettering or logos.`],
    select: ['16:9', `Anime fighting-game character selection backdrop inspired by the supplied ${config.stages[0].name} venue. Dark navy center for six portrait cards, yellow halftone bursts, cyan left and magenta right energy accents, opposing diagonal light beams. No characters, grids, text, icons or baked interface controls.`],
    logo: ['3:2', `A bold original anime arcade title emblem reading exactly "${config.title}". Typography only: electric yellow and white italic beveled letters, thick black outlines, a dramatic oversized Z, cyan and magenta edge accents. No people, faces, fighters, character illustrations, props or other lettering. ${GREEN.replace('no lettering, ', '')}`],
    hud: ['16:9', 'An isolated decorative anime arcade interface frame only. Thin cyan left top corner and magenta right top corner, angular yellow accents. All interior including health-bar, timer and fighting areas completely empty chroma green. No people, faces, fighters, character illustrations, props, text, digits or baked health bars. ' + GREEN.replace('borders, ', '')],
    icons: ['1:1', 'An original circular tournament badge made from three linked rectangular workflow nodes and an electric lightning bolt, yellow white cyan and magenta inked emblem, no text. ' + GREEN]
  };
  for (const [id,[aspect,prompt]] of Object.entries(ui)) add({ id, kind:'ui', key:['logo','hud','icons'].includes(id), aspect, ...(['title','select'].includes(id) ? { reference: config.stages[0].id } : {}), prompt:`${uiStyle}\n${prompt}` });
  const effects = ['hit','block','projectile','dust','ko','powerup','dash','launch','spark'];
  add({ id:'combat_effects', kind:'effects', key:true, aspect:'1:1', resolution:'2K', poses:effects,
    prompt:`${uiStyle}\nA square 3x3 anime combat effects atlas, exactly nine equally sized cells row-major, one isolated effect in each cell: ${effects.map((p,i)=>`${i+1}. ${p}`).join(', ')}. Orange, yellow, cream, magenta and cyan effects only. Projectile travels RIGHT. No characters. All effects fit their cell with 12% empty padding, equal visual scale. No grid, separators, borders, labels or text. ${GREEN}` });
  return jobs;
}

function makeGraph(jobs, config, seedTemplate, { externalReference = false, title = 'Cloud art workflow' } = {}) {
  const nodes = [], links = []; let nextId = 1, nextLink = 1;
  const generators = new Map();
  const connect = (from, to, inputIndex = 0) => {
    const id = nextLink++; from.outputs[0].links ??= []; from.outputs[0].links.push(id); to.inputs[inputIndex].link = id;
    links.push([id,from.id,0,to.id,inputIndex,'IMAGE']);
  };
  const source = seedTemplate.nodes.find(n=>n.type==='GeminiNanoBanana2V2');
  if (!source) throw new Error('Cloud node missing in comfyui/workflows/templates/cloud-image.json');
  const available = new Map(makeJobs(config).map(job=>[job.id,job]));
  function ensureGenerator(job,index) {
    if (generators.has(job.id)) return generators.get(job.id);
    let gen;
    if (job.kind === 'source' && !job.generateSource) {
      gen={id:nextId++,type:'LoadImage',title:`${job.id} | source image`,pos:[420,index*560+220],size:[340,420],flags:{},order:nodes.length,mode:0,inputs:[],outputs:[{name:'IMAGE',type:'IMAGE',links:[]},{name:'MASK',type:'MASK',links:null}],properties:{'Node name for S&R':'LoadImage',sourceImage:job.sourceImage},widgets_values:[job.sourceInput||path.basename(job.sourceImage),'image']};
    } else {
      gen=clone(source); gen.id=nextId++; gen.pos=[externalReference?460:420,index*560+220]; gen.size=[420,480];
      gen.title=`${job.id} | ${job.kind==='source'?'source image':'cloud generation'}`; gen.order=nodes.length;
      gen.inputs.forEach(i=>i.link=null); gen.outputs.forEach(o=>o.links=null);
      const values={prompt:job.prompt,model:config.model,'model.aspect_ratio':job.aspect,'model.resolution':job.resolution||'1K','model.thinking_level':'MINIMAL',seed:42,control_after_generate:'fixed',response_modalities:'IMAGE',system_prompt:'Create the requested original game art. Follow the layout and reference identity precisely.',temperature:1,top_p:0.95};
      gen.widgets_values_named=values;
      gen.widgets_values=Object.values(values);
    }
    nodes.push(gen); generators.set(job.id,gen);
    if(job.reference) {
      let ref=generators.get(job.reference);
      if(!ref && externalReference && config.demoSource==='fictional-text-only' && !job.sourceInput) {
        const dependency=available.get(job.reference);
        if(!dependency)throw new Error(`Unknown fictional dependency: ${job.reference}`);
        ref=ensureGenerator(dependency,index+1);
      }
      if(!ref && externalReference) {
        ref={id:nextId++,type:'LoadImage',title:`Accepted reference: ${job.reference} (upload first)`,pos:[40,index*560+220],size:[320,310],flags:{},order:nodes.length,mode:0,inputs:[],outputs:[{name:'IMAGE',type:'IMAGE',links:[]},{name:'MASK',type:'MASK',links:null}],properties:{'Node name for S&R':'LoadImage'},widgets_values:[job.sourceInput||`${job.reference}.png`,'image']}; nodes.push(ref); generators.set(job.reference,ref);
      }
      if(!ref) throw new Error(`Reference ${job.reference} must precede ${job.id}`);
      connect(ref,gen,gen.inputs.findIndex(i=>i.name==='model.images.image_1'));
    }
    return gen;
  }
  jobs.forEach((job,index)=> {
    const gen=ensureGenerator(job,index);
    const save={id:nextId++,type:'SaveImage',title:`Save ${job.id}`,pos:[950,index*560+220],size:[350,330],flags:{},order:nodes.length,mode:0,inputs:[{name:'images',type:'IMAGE',link:null}],outputs:[],properties:{'Node name for S&R':'SaveImage'},widgets_values:[`hackathon/${job.id}`]};
    nodes.push(save); connect(gen,save);
  });
  nodes.push({id:nextId++,type:'MarkdownNote',pos:[40,-100],size:[780,260],flags:{},order:nodes.length,mode:0,inputs:[],outputs:[],properties:{},widgets_values:[`# ${title}\n\nCLOUD ONLY. This graph contains ${nodes.filter(n=>n.type==='GeminiNanoBanana2V2').length} paid image-generation node(s). Running those nodes consumes Comfy credits. Save nodes only process local files. No generation is triggered by creating or building these files.\n\n${nodes.some(n=>n.type==='LoadImage')?'Select the intended accepted reference in Load Image before running.':'All references are invented from text in this graph. No photographs or files from previous sessions are loaded.'}\n\nOutputs: ComfyUI/output/hackathon/. Import with npm run import:assets -- --from <output-folder>, then npm run build. Inspect pose sheets and anchors before release. Do not put credentials in this workflow.`]});
  const hash=createHash('sha256').update(title).digest('hex');
  return {id:`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`,revision:0,last_node_id:nextId-1,last_link_id:nextLink-1,nodes,links,groups:[],config:{},extra:{ds:{scale:0.7,offset:[30,140]}},version:0.4};
}
function assetRecord(job) {
  const {id,kind,fighter,stage,sheet,poses,key}=job;
  return {id,kind,...(fighter?{fighter}:{}),...(stage?{stage}:{}),...(sheet?{sheet}:{}),...(poses?{poses}:{}),key:!!key};
}
function makeBundleGraph(jobs,config,template,{externalReference=false,rootDirectory:outputRoot,title,patch=false}={}) {
  if(jobs.length>100) throw new Error('A complete bundle supports up to 100 mapped assets; split larger rosters into separate bundles.');
  const graph=makeGraph(jobs,config,template,{externalReference,title:title||`${config.title}: complete game asset bundle`});
  const groups=[...config.fighters.map(f=>f.id),'environment'];
  const rootId=++graph.last_node_id, exportId=++graph.last_node_id;
  const rootDirectory=path.resolve(ROOT,outputRoot||config.assetRoot||'output/assets/generated/game-pack');
  const root={id:rootId,type:'DFZAssetRoot',title:'1. Set your asset output root',pos:[-550,200],size:[480,400],flags:{},order:0,mode:0,inputs:[],outputs:[{name:'root',type:'DFZ_ROOT',links:[]}],properties:{'Node name for S&R':'DFZAssetRoot'},widgets_values:[rootDirectory,JSON.stringify({...config,expectedAssets:jobs.map(j=>j.id)},null,2)]};
  const exporter={id:exportId,type:'DFZExportManifest',title:'3. Export assets.json (all art + sprite mappings)',pos:[groups.length*1300+100,240],size:[470,Math.max(360,jobs.length*25+130)],flags:{},order:graph.nodes.length+1,mode:0,inputs:[{name:'root',type:'DFZ_ROOT',link:null}],outputs:[{name:'manifest_path',type:'STRING',links:null}],properties:{'Node name for S&R':'DFZExportManifest'},widgets_values:[]};
  const connect=(from,to,inputIndex,type)=>{
    const id=++graph.last_link_id; from.outputs[0].links??=[]; from.outputs[0].links.push(id); to.inputs[inputIndex].link=id;
    graph.links.push([id,from.id,0,to.id,inputIndex,type]);
  };
  connect(root,exporter,0,'DFZ_ROOT');
  const rows={};
  jobs.forEach((job,index)=>{
    const gen=graph.nodes.find(n=>n.title===`${job.id} | ${job.kind==='source'?'source image':'cloud generation'}`);
    const save=graph.nodes.find(n=>n.title===`Save ${job.id}`);
    const group=job.fighter||'environment',column=groups.indexOf(group),row=rows[group]||0; rows[group]=row+1;
    gen.pos=[column*1300+60,row*580+240]; save.pos=[column*1300+530,row*580+240];
    save.type='DFZSaveAsset';save.title=`2. Save + map: ${job.id}`;save.size=[480,390];
    save.inputs[0].name='image';save.inputs.push({name:'root',type:'DFZ_ROOT',link:null});
    save.outputs=[{name:'asset',type:'DFZ_ASSET',links:[]}];save.properties={'Node name for S&R':'DFZSaveAsset'};
    save.widgets_values=[JSON.stringify(assetRecord(job),null,2)];
    connect(root,save,1,'DFZ_ROOT');
    exporter.inputs.push({name:`assets.asset_${index}`,type:'DFZ_ASSET',link:null});
    connect(save,exporter,exporter.inputs.length-1,'DFZ_ASSET');
  });
  const note=graph.nodes.find(n=>n.type==='MarkdownNote');
  note.pos=[-550,-250];note.size=[1000,360];
  note.widgets_values=[`# ${config.title}: complete game asset factory\n\n1. Set the absolute root_directory on Asset Root. Fictional source definitions are generated from text; this demo loads no prior-session files.\n2. Run the graph: ${jobs.filter(isPaidImage).length} CLOUD image-generation nodes (paid Comfy credits). Each Save + Map node saves a stable raw PNG and its metadata.\n3. The final exporter waits for ALL ${jobs.length} mapped assets, then writes assets.json in that root, including descriptions, special moves and source mappings.\n4. Open the Game Builder frontend, select that folder (assets.json + raw/), customize the roster/title, and export a playable directory or ZIP.\n\nNew source designs feed the anime identity references and stage; all sheets and cut-ins use those identities. Character descriptions and specialMove definitions drive the artwork. Audio has a separate cloud workflow writing audio.json into this root.\n\nInstall this project's comfyui/custom_nodes/dad_fighter_assets pack into ComfyUI/custom_nodes and restart ComfyUI once. Only model nodes call cloud services; root/save/manifest nodes process local files. No model downloads. Running the graph spends credits; preparing it does not.`];
  if(patch) note.widgets_values=[`# ${title||`${config.title}: incremental art refresh`}\n\n${jobs.length} paid CLOUD image jobs. Accepted existing fighter identities and The Yard stage load from uploaded PNGs; those reference assets are reused, never regenerated.\n\nThis graph writes a PARTIAL assets.json into its own patch root. Merge replacements by asset ID into the accepted complete bundle before a strict build. Keep all assets absent from this patch, including source photos, references, the one Yard stage and existing audio. Do not load this partial manifest as a complete game.\n\nThe main comfy-hackathon.json remains the complete asset factory. Verify all 27 poses, right-facing attacks and complete feet before accepting a patch. Preparing files spends nothing. Submitting cloud jobs requires spending authorization.`];
  graph.nodes.unshift(root);graph.nodes.push(exporter);
  graph.nodes.forEach((n,i)=>n.order=i);
  graph.groups=groups.map((id,index)=>({id:index+1,title:id==='environment'?'Stages, interface and effects':config.fighters.find(f=>f.id===id).name,bounding:[index*1300+20,160,1130,(rows[id]||1)*580],color:index===0?'#a5673f':index===1?'#3d7a81':'#5e6582',font_size:26,flags:{}}));
  graph.extra.ds={scale:0.25,offset:[650,400]};
  return graph;
}
function prepare() {
  const config=read('comfyui/config/game.json'), template=read('comfyui/workflows/templates/cloud-image.json');
  const ids=[...config.fighters,...config.stages].map(x=>x.id);
  if(ids.some(id=>!/^[-a-z0-9]+$/.test(id)) || new Set(ids).size!==ids.length) throw new Error('Fighter/stage IDs must be unique lowercase slugs');
  if(!config.fighters.length || !config.stages.length) throw new Error('Configure at least one fighter and stage');
  for(const poses of Object.values(config.sheets)) if(poses.length!==9 || poses.some(p=>!POSES[p])) throw new Error('Each sheet needs nine supported poses');
  for (const item of [...config.fighters,...config.stages]) if (item.sourceImage && !invents(item)) {
    if (!/^comfyui\/ref\/(?:demo\/)?(characters|levels)\/[a-z0-9_-]+\.(png|jpe?g)$/i.test(item.sourceImage) || !fs.existsSync(path.join(ROOT,item.sourceImage))) throw new Error(`Missing or invalid source image: ${item.sourceImage}`);
    if (item.sourceInput && !/^[a-z0-9_.-]+\.(png|jpe?g)$/i.test(item.sourceInput)) throw new Error(`Invalid ComfyUI input filename: ${item.sourceInput}`);
  }
  const jobs=makeJobs(config);
  if(new Set(jobs.map(j=>j.id)).size!==jobs.length) throw new Error('Job IDs collide; choose different fighter/stage IDs');
  const expectedFiles=new Set([...jobs.map(job=>job.workflow),...config.fighters.map(f=>`comfyui/workflows/packs/${f.id}.json`),'comfyui/workflows/packs/environment-and-ui.json']);
  const archive=path.resolve(ROOT,'output/private-archive',`retired-workflows-${Date.now()}`);
  for(const folder of ['comfyui/workflows/jobs','comfyui/workflows/packs'])for(const entry of fs.readdirSync(path.join(ROOT,folder),{withFileTypes:true})){
    const relative=`${folder}/${entry.name}`;
    if(!entry.isFile()||!entry.name.endsWith('.json')||expectedFiles.has(relative))continue;
    const source=path.resolve(ROOT,relative),destination=path.resolve(archive,relative);
    if(!source.startsWith(ROOT+path.sep)||!destination.startsWith(archive+path.sep)||fs.lstatSync(source).isSymbolicLink())throw new Error('Unsafe retired workflow path.');
    fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(source,destination);
  }
  write('comfyui/assets/plan.json',{version:1,jobs});
  for(const job of jobs) write(job.workflow,makeGraph([job],config,template,{externalReference:!!job.reference,title:job.id}));
  for(const fighter of config.fighters) write(`comfyui/workflows/packs/${fighter.id}.json`,makeGraph(jobs.filter(j=>j.fighter===fighter.id),config,template,{title:`${fighter.name}: full art pack`}));
  write('comfyui/workflows/packs/environment-and-ui.json',makeGraph(jobs.filter(j=>!j.fighter),config,template,{title:'Stages, menus, UI and effects'}));
  write('comfyui/workflows/advanced/full-image-graph.json',makeBundleGraph(jobs,config,template));
  write('build/public/builder/example-assets.json',{schema:'dad-fighter-assets/v1',root:'.',cloudOnly:true,game:{title:config.title,subtitle:config.subtitle,fighters:config.fighters,stages:config.stages,sheets:config.sheets},assets:jobs.map(job=>({...assetRecord(job),src:`raw/${job.id}.png`}))});
  write('comfyui/workflows/simple-image-generation.json',makeGraph(jobs.filter(j=>j.fighter===config.fighters[0].id && ['source','reference'].includes(j.kind)),config,template,{title:'Start here: invent a fictional anime fighter'}));
  write('comfyui/workflows/catalog.json',{model:config.model,cloudOnly:true,paid:true,paidGenerations:jobs.filter(isPaidImage).length,mappedAssets:jobs.length,sourceReferences:jobs.filter(j=>j.kind==='source').map(j=>({id:j.id,...(j.generateSource?{sourceMode:'Invent fictional reference',inputImages:0}:{sourceImage:j.sourceImage,sourceInput:j.sourceInput,sha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,j.sourceImage))).digest('hex')})})),jobs:jobs.map(({id,kind,workflow,reference,output,sourceImage,sourceInput,generateSource})=>({id,kind,workflow,reference,output,sourceImage,sourceInput,generateSource})),packs:[...config.fighters.map(f=>`comfyui/workflows/packs/${f.id}.json`),'comfyui/workflows/packs/environment-and-ui.json']});
  console.log(`Prepared ${jobs.length} individual workflows (${jobs.filter(isPaidImage).length} cloud generations) and ${config.fighters.length+1} packs. No images generated or credits spent.`);
  require('./prepare-factory-workflows.cjs').prepareFactory();
}
if(require.main===module) prepare();
module.exports={makeJobs,makeGraph,makeBundleGraph,assetRecord,POSES};
