// Prepare cloud-only cinematic and stage-edit recipes. Never submits a model job.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { makeBundleGraph } = require('./prepare-workflows.cjs');
const { makeEnvironmentTemplate } = require('./prepare-factory-workflows.cjs');
const ROOT = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const DURATION = 25;

function openingPrompt(config) {
  const stage = config.stages[0];
  const cast = config.fighters.map((fighter, index) => `Image ${index + 1} is ${fighter.name}, an entirely fictional adult character: preserve the illustrated design, build, hairstyle, clothing and accessories when translating it to lifelike film. ${fighter.description} Their fictional power is ${fighter.specialMove.name}: ${fighter.specialMove.description}`).join('\n');
  const pairs = [[0, 1], [2, 3], [4, 5]].map(([a, b]) => [config.fighters[a], config.fighters[b]]);
  const duel = ([a, b]) => `${a.name} demonstrates ${a.specialMove.name}; ${b.name} answers with ${b.specialMove.name}. Follow their configured power descriptions, keep both faces visible, and use a short readable exchange with grounded stances.`;
  return `Create one continuous 25-second cinematic opening movie for an original fighting game. Photorealistic LIVE-ACTION visual style with entirely imaginary adult performers, natural skin texture, believable cloth and hair, weight and lens depth, cinematic lighting and practical-looking energy VFX. Translate the supplied fictional character illustrations into convincing lifelike designs without imitating a real person. Capture the dramatic martial-arts energy and heroic power-up spectacle of 1990s battle anime while keeping this original cast and their configured outfits. No franchise characters, costumes, emblems or recognizable music.\nREFERENCE CAST:\n${cast}\nImage 7 is ${stage.name}, a fictional environment reference. ${stage.description} Keep its architecture, terrain, lighting and clear fight plane consistent. Only the six configured fictional fighters appear. Keep each accessory singular and anatomically attached. No real event branding, name tags or identifiable bystanders.\nSHOT PLAN, exactly 25 seconds, with coherent match cuts and the same venue throughout:\n0-4s: Low tracking camera glides over the ${stage.name} fight plane into a wide lifelike reveal of all six fighters forming two opposing groups. Match the environment lighting, with dust gently lifting as power builds. Every face receives a readable moment.\n4-9s: Medium close-up and low side angle. ${duel(pairs[0])} Exchange one rapid blocked palm strike and recoil safely.\n9-14s: Match cut to the next pair. ${duel(pairs[1])} Use one controlled dodge and a clean stop. No injury, gore or property destruction.\n14-19s: The final pair steps forward. ${duel(pairs[2])} One compact projectile meets a controlled guard, with a sharp energy crack and readable choreography.\n19-25s: Wide orbit resolves into all six facing the camera in a heroic group formation. Their distinct configured energy colors stay close to their bodies. A brief synchronized power surge ripples across the floor, then they settle into strong ready stances. Finish on a steady full-frame heroic shot that cuts naturally to the game's title screen.\nCAMERA AND SOUND: 16:9 landscape, consistent lifelike anatomy, realistic optical motion blur, crisp faces, restrained film grain, sweeping low-angle camera. Native synchronized footfalls, cloth movement, impact whooshes and electrical energy sounds with an ORIGINAL rising guitar/orchestral battle score. No intelligible dialogue and no voice imitation. No narration, on-screen titles, captions, text, logo, watermark, comic borders, graphic speed-line frames, split screens or letterboxing. No black opening/closing frames. Every shot is moving footage, never a still-image slideshow.`;
}

function imageLoader(id, title, sourceInput, position) {
  return { id, type: 'LoadImage', title, pos: position, size: [340, 310], flags: {}, order: 0, mode: 0, inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }, { name: 'MASK', type: 'MASK', links: null }], properties: { 'Node name for S&R': 'LoadImage' }, widgets_values: [sourceInput, 'image'] };
}

function fictionalProject(config,id) {
  const node=structuredClone(makeEnvironmentTemplate(config).nodes.find(node=>node.type==='CFZProjectSettings'));
  node.id=id;node.title='Fictional film references | cloud settings';node.pos=[-520,120];node.outputs.forEach(output=>output.links=[]);return node;
}
function fictionalImage(id,item,index,project,link) {
  return {id,type:'CFZFictionalReference',title:`Invent reference ${index+1}: ${item.name}`,pos:[0,index*350],size:[400,300],flags:{},order:0,mode:0,
    inputs:[{name:'project',type:'CFZ_PROJECT',link}],outputs:[{name:'reference',type:'IMAGE',links:[]}],properties:{'Node name for S&R':'CFZFictionalReference'},
    widgets_values_named:{prompt:item.referencePrompt||`Invent this entirely fictional ${index<6?'adult character':'environment'} from text only, with no real-person photos or image inputs: ${item.description}`,aspect:index<6?'2:3':'16:9',resolution:index<6?'1K':'2K'},
    widgets_values:[item.referencePrompt||`Invent this entirely fictional ${index<6?'adult character':'environment'} from text only, with no real-person photos or image inputs: ${item.description}`,index<6?'2:3':'16:9',index<6?'1K':'2K']};
}

function makeOpeningGraph(config, template, { resolution = '1080p' } = {}) {
  if (!['1080p', '720p'].includes(resolution)) throw new Error('Opening resolution must be 1080p or 720p.');
  if (config.fighters.length !== 6 || config.stages.length !== 1) throw new Error('Opening requires six fighters and one configured arena.');
  const nodes = [], links = [], sources=[]; let nextId = 1, nextLink = 1;
  const invent=config.demoSource==='fictional-text-only';
  const project=invent?fictionalProject(config,nextId++):null;if(project)nodes.push(project);
  const generation = structuredClone(template.nodes.find(node => node.type === 'ByteDance2ReferenceNodeV2'));
  if (!generation) throw new Error('The verified Seedance reference template is missing its API node.');
  for (const [index, item] of [...config.fighters, config.stages[0]].entries()) {
    const source=invent?fictionalImage(nextId++,item,index,project,nextLink):imageLoader(nextId++,`Reference ${index+1}: ${item.name}`,item.sourceInput,[0,index*350]);
    if(project){project.outputs[0].links.push(nextLink);links.push([nextLink++,project.id,0,source.id,0,'CFZ_PROJECT']);}
    nodes.push(source);sources.push(source);
  }
  generation.id = nextId++; generation.title = `25-second live-action opening | Seedance 2.5 ${resolution}`; generation.pos = [470, 220]; generation.size = [660, 1000];
  generation.inputs = sources.map((node, index) => ({ name: `model.reference_images.image_${index + 1}`, type: 'IMAGE', shape: 7, link: null }));
  generation.outputs = [{ name: 'VIDEO', type: 'VIDEO', links: [] }, { name: 'draft_task_id', type: 'STRING', links: null }];
  generation.widgets_values_named = { model: 'Seedance 2.5', 'model.prompt': openingPrompt(config), 'model.resolution': resolution, 'model.ratio': '16:9', 'model.duration': DURATION, 'model.generate_audio': true, 'model.task_type': 'reference', 'model.output_format': 'mp4', 'model.auto_downscale': true, 'model.auto_upscale': false, seed: 20261102, control_after_generate: 'fixed', watermark: false };
  generation.widgets_values = Object.values(generation.widgets_values_named);
  for (const [index, source] of sources.entries()) { const id = nextLink++; source.outputs[0].links.push(id); generation.inputs[index].link = id; links.push([id, source.id, 0, generation.id, index, 'IMAGE']); }
  nodes.push(generation);
  const save = structuredClone(template.nodes.find(node => node.type === 'SaveVideo'));
  save.id = nextId++; save.title = 'Save opening movie for local browser normalization'; save.pos = [1230, 280]; save.inputs = [{ name: 'video', type: 'VIDEO', link: nextLink }]; save.outputs = [{ name: 'video', type: 'VIDEO', links: null }];
  save.widgets_values_named = { filename_prefix: `comfy-fighter-z/opening/opening-${resolution}`, format: 'auto', codec: 'auto' }; save.widgets_values = Object.values(save.widgets_values_named);
  generation.outputs[0].links.push(nextLink); links.push([nextLink++, generation.id, 0, save.id, 0, 'VIDEO']); nodes.push(save);
  nodes.push({ id: nextId++, type: 'MarkdownNote', title: 'Opening movie: paid cloud generation', pos: [460, -200], size: [1000, 350], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [`# Comfy Fighter Z: 25-second fictional opening\n\nONE paid Seedance 2.5 reference-to-video request, ${resolution}, 16:9, native audio. ${invent?'PLUS seven paid text-to-image reference calls (six 1K characters + one 2K environment, estimated $0.36036 in addition to video). CFZ Fictional Reference nodes create every input from text; no photos, old sheets or prior-session files are loaded.':'Seven Load Image nodes use only explicitly uploaded accepted fictional references.'} This optional film is a separate paid batch, excluded from the demo image/audio estimate. No local model weights, no voice cloning.\n\nAfter reviewing the saved video, use tools/assemble-opening.cjs --input <downloaded.mp4> --out <separate-bundle-root> to normalize browser codecs and create raw/opening.mp4 plus video.json.\n\nThe 1080p and 720p workflows are alternatives: run only the authorized one. Preparing these recipes spends nothing.`] });
  nodes.forEach((node, index) => node.order = index);
  const digest = createHash('sha256').update(`opening-seedance25-${resolution}`).digest('hex');
  return { id: `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`, revision: 0, last_node_id: nextId - 1, last_link_id: nextLink - 1, nodes, links, groups: [], config: {}, extra: { ds: { scale: .5, offset: [40, 230] } }, version: .4 };
}

function prepareOpeningTemplates() {
  const config=read(path.join(ROOT,'config/game.json')),template=read(path.join(ROOT,'workflows/templates/cloud-seedance-reference.json'));
  for(const resolution of ['1080p','720p']){
    const graph=makeOpeningGraph(config,template,{resolution});
    write(path.join(ROOT,'workflows/video',`opening-${resolution}.json`),graph);
    if(resolution==='1080p')write(path.join(ROOT,'comfy-opening.json'),graph);
  }
  console.log('Prepared optional fictional opening recipes with seven fresh text-only references; no generation submitted.');
}

function yardEditPrompt(config) {
  const stage = config?.stages?.[0] || { name: 'configured arena', description: '' };
  return `Use case: precise-object-edit. Image 1 is the accepted anime ${stage.name} stage to edit. Image 2 is the generated fictional environment reference only for reconstructing surfaces behind the unwanted graphic lines. ENVIRONMENT: ${stage.description} CHANGE ONLY the decorative speed-line / directional-line border: remove every superimposed black radial ray, manga motion line, comic-frame stroke, edge vignette, halftone border and diagonal accent that intrudes inward from any of the four edges, including the bottom floor and top corners. Repaint those pixels as continuous ordinary floor, terrain, walls, sky or foliage, matching nearby colors and existing cel-shaded material texture. Preserve actual architectural and landscape lines; remove only the artificial radiating overlay. Preserve the existing wide composition, perspective, configured environment details, lighting palette and clear playable floor at the same vertical position. Keep the current hand-painted anime environment style. Do not invent people, fighters, props, new architecture, text, logos or interface. Full-bleed clean environment artwork extending naturally to all four edges. No graphic border, speed lines, radial rays, comic frame, streaks, letterbox or painted screen overlay anywhere. Output the same 16:9 composition at 2K.`;
}

function makeYardEditGraph(config, template, { acceptedYardInput, acceptedSourceInput, outputRoot }) {
  const stage = config.stages[0];
  const job = { id: stage.id, kind: 'stage', stage: stage.id, key: false, aspect: '16:9', resolution: '2K', reference: `accepted_${stage.id}`, sourceInput: acceptedYardInput, prompt: yardEditPrompt(config) };
  const graph = makeBundleGraph([job], config, template, { externalReference: true, rootDirectory: outputRoot, patch: true, title: `${stage.name}: remove graphic border only` });
  const source = imageLoader(++graph.last_node_id, 'Fictional environment design: reconstruction reference only', acceptedSourceInput || stage.sourceInput || `${stage.id}_source.png`, [-450, 760]);
  const generation = graph.nodes.find(node => node.type === 'GeminiNanoBanana2V2');
  const link = ++graph.last_link_id, input = generation.inputs.length;
  generation.inputs.push({ name: 'model.images.image_2', shape: 7, type: 'IMAGE', link }); source.outputs[0].links.push(link);
  graph.links.push([link, source.id, 0, generation.id, input, 'IMAGE']); graph.nodes.push(source); graph.nodes.forEach((node, index) => node.order = index);
  graph.nodes.find(node => node.type === 'MarkdownNote').widgets_values[0] = `# ${stage.name}: remove only the graphic border\n\nONE paid Gemini Nano Banana 2.1 MINIMAL 2K edit. Accepted stage is Image 1, generated fictional environment reference is Image 2. Preserve the stage layout and fight plane; remove radiating speed lines and comic borders.\n\nThe partial assets.json contains only ${stage.id}. Merge it by ID into the complete accepted image/audio bundle after visual approval. It is independent of the opening video; never run an unapproved video variant. No local model inference and no automatic retry.`;
  graph.nodes.find(node => node.type === 'DFZAssetRoot').pos = [-960, 220];
  graph.nodes.find(node => node.type === 'DFZSaveAsset').pos = [980, 220];
  graph.nodes.find(node => node.type === 'DFZExportManifest').pos = [1520, 220];
  graph.nodes.find(node => node.type === 'MarkdownNote').pos = [-960, -220];
  const loaders = graph.nodes.filter(node => node.type === 'LoadImage');
  loaders.forEach((node, index) => node.pos = [-400, 180 + index * 370]);
  generation.pos = [80, 220];
  graph.groups = [{ id: 1, title: 'Accepted stage + fictional environment design -> clean stage patch', bounding: [-440, 100, 2400, 900], color: '#3d7a81', font_size: 24, flags: {} }];
  graph.extra.ds = { scale: .5, offset: [1050, 300] };
  return graph;
}

function prepare({ baseDirectory, outputDirectory } = {}) {
  if (!baseDirectory) throw new Error('Choose an accepted fictional demo bundle with --base.');
  const config = read(path.join(ROOT, 'config/game.json'));
  const base = path.resolve(ROOT, baseDirectory);
  const out = path.resolve(ROOT, outputDirectory || 'test-runs/fictional-demo-cinematic');
  if (out === base || out.startsWith(base + path.sep) || base.startsWith(out + path.sep)) throw new Error('Cinematic output must be separate from the accepted bundle.');
  const stage = config.stages[0];
  const bundle=read(path.join(base,'assets.json'));
  if(config.demoSource==='fictional-text-only' && (bundle.game?.fighters?.length!==config.fighters.length || config.fighters.some(f=>!bundle.game.fighters.some(item=>item.id===f.id))))throw new Error('Accepted bundle does not match the current fictional roster; historic photo bundles cannot be reused.');
  const accepted = bundle.assets.find(asset => asset.id === stage.id && asset.kind === 'stage');
  if (!accepted?.src) throw new Error(`Accepted stage asset missing: ${stage.id}.`);
  const yardPath = path.resolve(base, accepted.src); if (!yardPath.startsWith(base + path.sep)) throw new Error('Stage source leaves the accepted bundle.');
  const videoTemplate = read(path.join(ROOT, 'workflows/templates/cloud-seedance-reference.json'));
  const imageTemplate = read(path.join(ROOT, 'workflows/templates/cloud-image.json'));
  const alternatives = [];
  for (const resolution of ['1080p', '720p']) {
    const graph = makeOpeningGraph(config, videoTemplate, { resolution });
    const workflow = path.join(out, 'workflows', `opening-${resolution}.json`);
    write(workflow, graph); write(path.join(ROOT, 'workflows/video', `opening-${resolution}.json`), graph);
    if (resolution === '1080p') write(path.join(ROOT, 'comfy-opening.json'), graph);
    const perFrame = resolution === '1080p' ? 2025 : 900, rate = resolution === '1080p' ? .016731 : .015301;
    const videoUSD = Math.floor(perFrame * (24 * DURATION + 1)) / 1000 * rate;
    const referenceImageUSD=config.demoSource==='fictional-text-only'?6*.048048+.072072:0;
    alternatives.push({ resolution, workflow, videoRequests: 1, referenceImageRequests:referenceImageUSD?7:0, duration: DURATION, videoUSD,referenceImageUSD, yardEditUSD: .072072, totalUSD: videoUSD + referenceImageUSD + .072072 });
  }
  const stageWorkflow = path.join(out, 'workflows/yard-clean.json'), stageRoot = path.join(out, 'stage-patch');
  const stageSource=bundle.assets.find(asset=>asset.kind==='source'&&asset.stage===stage.id);
  if(!stageSource?.src)throw new Error('Accepted bundle is missing its fictional environment source.');
  const stageSourcePath=path.resolve(base,stageSource.src);if(!stageSourcePath.startsWith(base+path.sep))throw new Error('Environment source leaves the accepted bundle.');
  write(stageWorkflow, makeYardEditGraph(config, imageTemplate, { acceptedYardInput: path.basename(yardPath), acceptedSourceInput:path.basename(stageSourcePath), outputRoot: stageRoot }));
  const uploads = config.demoSource==='fictional-text-only'?[]:[...config.fighters, config.stages[0]].map(item => ({ id: item.id, source: path.resolve(ROOT, item.sourceImage), sourceInput: item.sourceInput }));
  uploads.push({id:`${stage.id}_source`,source:stageSourcePath,sourceInput:path.basename(stageSourcePath)});
  uploads.push({ id: `accepted_${stage.id}`, source: yardPath, sourceInput: path.basename(yardPath) });
  uploads.forEach(item => item.sha256 = hash(item.source));
  const plan = { schema: 'comfy-fighter-cinematic-plan/v1', cloudOnly: true, paid: true, automaticSubmission: false, baseDirectory: base, outputDirectory: out, duration: DURATION,
    model: { node: 'ByteDance2ReferenceNodeV2', name: 'Seedance 2.5', id: 'dreamina-seedance-2-5-260628', minimumDuration: 4, maximumDuration: 30, durationStep: 1, maximumReferenceImages: 30, maximumReferenceVideos: 10, maximumReferenceAudioClips: 10, nativeAudio: true },
    alternatives, stageOnly: { workflow: stageWorkflow, root: stageRoot, imageRequests: 1, estimatedUSD: .072072 }, uploads,
    priceSource: 'Live installed ComfyUI price_badge, 2026-11-02: Seedance2.5 reference images only, 16:9, cost floor(perFrameTokens*(24*seconds+1))/1000*rate; 1080p 2025 and0.016731; 720p900 and0.015301. Gemini Nano Banana2.1 MINIMAL2K $0.072072. Approximate, actual billing may vary.',
    acceptance: 'Choose one video resolution plus the stage edit, or stage only. No paid retry is included. Review all six fictional designs, moving lifelike footage, 25-second duration and clean stage edges. Assemble accepted video into video.json/raw/opening.mp4, merge the stage patch by ID, then verify the startup Space-to-title flow.' };
  write(path.join(out, 'plan.json'), plan);
  console.log(`Prepared 25-second Seedance 2.5 alternatives: 1080p + stage $${alternatives[0].totalUSD.toFixed(3)}, 720p + stage $${alternatives[1].totalUSD.toFixed(3)}. No generation submitted.`);
  return plan;
}
if (require.main === module) { const args = process.argv.slice(2), get = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }; if(args.includes('--templates-only'))prepareOpeningTemplates();else prepare({ baseDirectory: get('--base'), outputDirectory: get('--out') }); }
module.exports = { makeOpeningGraph, makeYardEditGraph, openingPrompt, yardEditPrompt, prepare, prepareOpeningTemplates };
