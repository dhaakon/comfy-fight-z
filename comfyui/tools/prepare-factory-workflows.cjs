const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const write = (file, value) => {
  const target = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
};
const SCHEMAS = read('comfyui/workflows/templates/compact-factory-schema.json');
const WIDGET_TYPES = new Set(['STRING', 'BOOLEAN', 'COMBO', 'INT', 'FLOAT']);

function factoryCounts(config, allEnvironments = false) {
  const fighters = config.fighters.length;
  const environments = allEnvironments ? config.stages : config.stages.filter(s => s.enabled);
  const stages = environments.length;
  const inventedCharacters=config.fighters.filter(item=>item.sourceMode==='Invent fictional reference').length;
  const inventedEnvironments=environments.filter(item=>item.sourceMode==='Invent fictional reference').length;
  const oneK = fighters * 4 + 5 + inventedCharacters, twoK = fighters * 3 + stages + 1 + inventedEnvironments;
  return { paidImages: oneK + twoK, sourceSaves: fighters + stages, mappedAssets: fighters * 8 + stages * 2 + 6,
    oneK, twoK, estimatedUSD: Number((oneK * 0.048048 + twoK * 0.072072).toFixed(6)) };
}

function graphBuilder(title) {
  const hash = createHash('sha256').update(title).digest('hex');
  const graph = { id: `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`,
    revision: 0, last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {},
    extra: { ds: { scale: 0.36, offset: [610, 350] } }, version: 0.4 };
  function node(type, title, values, pos, size = [420, 450], bundleCount = 0) {
    const schema = SCHEMAS[type];
    if (!schema) throw new Error(`Missing actual node schema: ${type}`);
    const inputs = [], named = {};
    for (const section of ['required', 'optional']) {
      const definitions = schema.input[section] || {};
      for (const name of schema.input_order?.[section] || Object.keys(definitions)) {
        const [inputType, options = {}] = definitions[name];
        if (inputType === 'COMFY_AUTOGROW_V3') {
          const template = options.template;
          if (bundleCount < template.min || bundleCount > template.max) throw new Error('Invalid export bundle count');
          const itemType = Object.values(template.input.required)[0][0];
          for (let i = 0; i < bundleCount; i++) inputs.push({ name: `${name}.${template.prefix}${i}`, type: itemType, link: null });
        } else if (WIDGET_TYPES.has(inputType) && !options.forceInput) {
          named[name] = values[name] ?? options.default;
          if (named[name] === undefined) throw new Error(`Missing widget value: ${type}.${name}`);
          if (options.control_after_generate) named.control_after_generate = 'fixed';
        } else inputs.push({ name, type: inputType, link: null });
      }
    }
    const item = { id: ++graph.last_node_id, type, title, pos, size, flags: {}, order: graph.nodes.length, mode: 0,
      inputs, outputs: schema.output.map((type, i) => ({ name: schema.output_name[i], type, links: [] })),
      properties: { 'Node name for S&R': type }, widgets_values: Object.values(named), widgets_values_named: named };
    graph.nodes.push(item);
    return item;
  }
  function connect(from, outputIndex, to, name) {
    const index = to.inputs.findIndex(i => i.name === name);
    if (index < 0) throw new Error(`Missing graph socket: ${to.type}.${name}`);
    const input = to.inputs[index], output = from.outputs[outputIndex];
    if (input.type !== output.type) throw new Error(`Socket type mismatch: ${output.type} -> ${input.type}`);
    const link = ++graph.last_link_id;
    output.links.push(link); input.link = link;
    graph.links.push([link, from.id, outputIndex, to.id, index, input.type]);
  }
  function note(text, pos, size = [900, 230]) {
    graph.nodes.push({ id: ++graph.last_node_id, type: 'MarkdownNote', pos, size, flags: {}, order: graph.nodes.length,
      mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [text] });
  }
  function group(title, bounding, color) {
    graph.groups.push({ id: graph.groups.length + 1, title, bounding, color, font_size: 26, flags: {} });
  }
  function loadImage(filename, pos) {
    const item = { id: ++graph.last_node_id, type: 'LoadImage', title: 'Upload accepted anime identity', pos, size: [420, 480],
      flags: {}, order: graph.nodes.length, mode: 0, inputs: [],
      outputs: [{name: 'IMAGE', type: 'IMAGE', links: []}, {name: 'MASK', type: 'MASK', links: []}],
      properties: {'Node name for S&R': 'LoadImage'}, widgets_values: [filename, 'image'], widgets_values_named: { image: filename } };
    graph.nodes.push(item); return item;
  }
  function fictionalReference(fighter,config,pos) {
    return node('CFZFictionalReference','Invent a fresh fictional reference | no image inputs',{
      prompt:fighter.referencePrompt||`${config.style}\nInvent this adult fictional fighter from text only: ${fighter.description}. Full-body right-facing neutral guard, complete hands and shoes, green chroma background, no external image or real person.`,aspect:'2:3',resolution:'1K'},pos,[440,470]);
  }
  return { graph, node, connect, note, group, loadImage, fictionalReference };
}

function projectValues(config, suffix = '') {
  return { root_directory: path.resolve(ROOT, config.assetRoot, suffix), title: config.title, subtitle: config.subtitle || '',
    style: config.style, ui_style: config.uiStyle, stage_style: config.stageStyle, model: config.model, seed: 42 };
}
function characterValues(fighter, includeSheets = true) {
  const source_mode=fighter.sourceMode||'Upload reference';
  return { image: source_mode==='Invent fictional reference'?'':fighter.sourceInput || '', source_mode, name: fighter.name, description: fighter.description,
    special_name: fighter.specialMove.name, special_description: fighter.specialMove.description,
    intro_tagline: fighter.introTagline || '', color: fighter.color, character_id: fighter.id, include_sprite_sheets: includeSheets };
}
function environmentValues(stage) {
  const source_mode=stage.sourceMode||'Upload reference';
  return { image: source_mode==='Invent fictional reference'?'':stage.sourceInput || '', source_mode, enabled: !!stage.enabled, name: stage.name, description: stage.description, stage_id: stage.id };
}
function attachExporter(builder, project, bundles, pos, complete) {
  const exporter = builder.node(complete ? 'CFZExportGameAssets' : 'CFZExportAssetPatch', complete ? 'Export complete assets.json' : 'Export PARTIAL assets.json', {}, pos, [440, 340], bundles.length);
  builder.connect(project, 0, exporter, 'project');
  bundles.forEach((bundle, i) => builder.connect(bundle, 0, exporter, `bundles.bundle_${i}`));
  return exporter;
}

function makeFactoryGraph(config) {
  if (config.fighters.length !== 6 || config.stages.length !== 3) throw new Error('The main template has exactly six character and three environment slots');
  const b = graphBuilder(`${config.title}: compact upload factory`);
  const project = b.node('CFZProjectSettings', 'Project settings | output folder + game title', projectValues(config), [-510, 120], [450, 470]);
  const bundles = [];
  config.fighters.forEach((fighter, i) => {
    const character = b.node('CFZCharacterFactory', `Character ${i + 1} | ${fighter.name}`, characterValues(fighter),
      [(i % 3) * 490, 120 + Math.floor(i / 3) * 820], [440, 720]);
    character.color = '#26374b'; character.bgcolor = '#172334';
    b.connect(project, 0, character, 'project'); bundles.push(character);
  });
  const environments = config.stages.map((stage, i) => {
    const environment = b.node('CFZEnvironmentFactory', `Environment ${i + 1} | ${stage.enabled ? stage.name : 'disabled'}`,
      environmentValues(stage), [i * 490, 1780], [440, 540]);
    environment.color = stage.enabled ? '#29463d' : '#3a3e46'; environment.bgcolor = '#1b2927';
    b.connect(project, 0, environment, 'project'); bundles.push(environment); return environment;
  });
  const shared = b.node('CFZSharedArtFactory', 'Shared art | menus, logo, HUD + effects', {}, [1510, 620], [440, 160]);
  b.connect(project, 0, shared, 'project'); b.connect(environments[0], 1, shared, 'stage_reference'); bundles.push(shared);
  attachExporter(b, project, bundles, [1510, 970], true);
  const count = factoryCounts(config), full = factoryCounts(config, true);
  b.note(`# ${config.title}\n## Invent fictional fighters. Build your game.\n\nThe demo cards use Invent fictional reference: they create fresh designs from text and ignore the image selector. No photos or old sheets are loaded. To use your own new image, explicitly switch that card to Upload reference. Environment 1 supplies the title/select venue; slots 2 and 3 stay disabled until enabled. Set a NEW output folder, then load its assets.json + raw/ in /builder/.\n\n**CLOUD ONLY / PAID:** default ${count.paidImages} image calls / ${count.mappedAssets} mapped assets (~$${count.estimatedUSD.toFixed(3)}). All three environments: ${full.paidImages} calls / ${full.mappedAssets} records (~$${full.estimatedUSD.toFixed(3)}). Source-reference generation is included when Invent is selected. Audio/video are separate. Opening this graph spends nothing.`, [-510, -260], [1940, 290]);
  b.note('## Before you run\n\n1. Install comfyui/custom_nodes/comfy_fighter_assets and restart ComfyUI.\n2. Edit fictional descriptions, specials and taglines; keep Invent mode for a demo without photo inputs.\n3. Validate and review paid-call costs.\n4. Review all 27 poses per fighter before exporting a release.\n\nUse comfyui/workflows/factory/ for one character, one sheet or one environment. The full native graph is under comfyui/workflows/advanced/.', [1510, 1470], [440, 440]);
  b.group('Six character factories', [-25, 45, 1470, 1620], '#4b6387');
  b.group('Up to three environment factories', [-25, 1705, 1470, 675], '#4b7f6d');
  b.group('Shared artwork + mapped export', [1485, 545, 490, 830], '#826947');
  return b.graph;
}

function makeCharacterTemplate(config) {
  const fighter = config.fighters[0], b = graphBuilder(`${config.title}: one character pack`);
  const project = b.node('CFZProjectSettings', 'Separate character patch folder', projectValues(config, `character-${fighter.id}`), [-510, 110], [440, 470]);
  const character = b.node('CFZCharacterFactory', 'Upload character | identity + selection art', characterValues(fighter, false), [0, 110], [440, 720]);
  b.connect(project, 0, character, 'project');
  const bundles = [character];
  ['sheet', 'sheetB', 'sheetC'].forEach((sheet, i) => {
    const node = b.node('CFZSpriteSheet', `Sprite sheet ${'ABC'[i]} | nine poses`, { sheet }, [540, 110 + i * 235], [420, 170]);
    b.connect(project, 0, node, 'project'); b.connect(character, 2, node, 'character'); b.connect(character, 1, node, 'reference'); bundles.push(node);
  });
  attachExporter(b, project, bundles, [1060, 250], false);
  b.note('# One complete character pack\n\nInvent mode creates a fresh fictional source from text, then identity, portrait, hero and cut-in. Its internal sheets are OFF: the three visible sheet nodes reuse that identity. Eight paid images in Invent mode; seven when explicitly uploading a new reference. No previous photos are selected. Produces a PARTIAL assets.json; merge into a complete game before export. Keep this output root separate from the accepted bundle.', [-510, -230], [1940, 220]);
  b.graph.extra.ds = { scale: 0.65, offset: [570, 290] }; return b.graph;
}

function makeSheetTemplate(config) {
  const fighter = config.fighters[0], b = graphBuilder(`${config.title}: one accepted-reference sprite sheet`);
  const project = b.node('CFZProjectSettings', 'Separate sheet patch folder', projectValues(config, `sheet-${fighter.id}`), [-510, 100], [440, 470]);
  const definition = b.node('CFZCharacterDefinition', 'Describe the accepted fighter', characterValues(fighter), [0, 100], [440, 450]);
  const reference = fighter.acceptedReferenceInput ? b.loadImage(fighter.acceptedReferenceInput, [0, 640]) : b.fictionalReference(fighter,config,[0,640]);
  if(reference.type==='CFZFictionalReference')b.connect(project,0,reference,'project');
  const sheet = b.node('CFZSpriteSheet', 'Choose sheet A, B or C', { sheet: 'sheet' }, [540, 330], [420, 190]);
  b.connect(project, 0, sheet, 'project'); b.connect(definition, 0, sheet, 'character'); b.connect(reference, 0, sheet, 'reference');
  attachExporter(b, project, [sheet], [1060, 330], false);
  b.note(fighter.acceptedReferenceInput ? '# One sprite sheet from an accepted fictional identity\n\nUpload the explicitly named, newly generated identity; no old photo is selected. Choose sheet, sheetB or sheetC. One paid 2K image (~$0.072). Writes a PARTIAL assets.json into its own root for review and merge.' : '# One fictional sprite sheet\n\nThe custom Fictional Reference node invents a fresh character reference from text, then the custom Sprite Sheet node generates the selected nine-pose sheet. Two paid image calls (~$0.120); no Load Image node or previous-session file is used. Exports a PARTIAL assets.json into its own root. For consistent full-character production use the complete character pack, whose three sheets share one identity.', [-510, -230], [1940, 220]);
  b.graph.extra.ds = { scale: 0.6, offset: [570, 290] }; return b.graph;
}

function makeEnvironmentTemplate(config) {
  const stage = config.stages[0], b = graphBuilder(`${config.title}: one source-referenced environment`);
  const project = b.node('CFZProjectSettings', 'Separate environment patch folder', projectValues(config, `environment-${stage.id}`), [-510, 100], [440, 470]);
  const environment = b.node('CFZEnvironmentFactory', 'Upload venue | clean playable arena', environmentValues({...stage, enabled: true}), [0, 100], [440, 570]);
  b.connect(project, 0, environment, 'project'); attachExporter(b, project, [environment], [540, 250], false);
  b.note('# One fictional environment\n\nInvent mode creates a fresh fictional source from text then one playable stage: two paid 2K calls (~$0.144). Upload mode uses only the new reference you explicitly select and costs one stage call (~$0.072). Full-bleed artwork without speed-line borders. This is a PARTIAL replacement patch: keep a stage ID already in the complete base bundle. To add venues, enable their slots in the complete main factory.', [-510, -230], [1490, 220]);
  b.graph.extra.ds = { scale: 0.75, offset: [570, 290] }; return b.graph;
}

function builderMetadata(config) {
  const slots = items => items.map(item => ({ id: item.id, name: item.name, enabled: item.enabled !== false,
    sourceMode:item.sourceMode||'Upload reference', reference: item.sourceMode==='Invent fictional reference'?'':item.sourceInput || '', sourceInput:item.sourceMode==='Invent fictional reference'?'':item.sourceInput || '' }));
  return { title: config.title, subtitle: config.subtitle, workflowURL: '/builder/templates/comfy-hackathon.json',
    fictional:true,characters: slots(config.fighters), environments: slots(config.stages),
    templates: [{id:'character',label:'One complete character pack',url:'/builder/templates/character-factory.json'},
      {id:'sheet',label:'One sprite sheet',url:'/builder/templates/sprite-sheet.json'},
      {id:'environment',label:'One environment',url:'/builder/templates/environment-factory.json'}],
    nodePack: { name:'Comfy Fighter Z Asset Factory',
      installInstructions:'Copy comfyui/custom_nodes/comfy_fighter_assets into your ComfyUI custom_nodes folder and restart ComfyUI. Then open the downloaded workflow.' } };
}

function prepareFactory() {
  const config = read('comfyui/config/factory.json');
  const main = makeFactoryGraph(config);
  write('comfyui/workflows/comfy-hackathon.json', main); write('build/public/builder/templates/comfy-hackathon.json', main);
  const templates = { 'character-factory': makeCharacterTemplate(config), 'sprite-sheet': makeSheetTemplate(config), 'environment-factory': makeEnvironmentTemplate(config) };
  for (const [name, workflow] of Object.entries(templates)) {
    write(`comfyui/workflows/factory/${name}.json`, workflow); write(`build/public/builder/templates/${name}.json`, workflow);
  }
  write('build/public/builder/factory-template.json', builderMetadata(config));
  write('comfyui/workflows/factory/catalog.json', { schema:'comfy-fighter-factory/v1', cloudOnly:true, config:'comfyui/config/factory.json',
    workflow:'comfyui/workflows/comfy-hackathon.json', advancedWorkflow:'comfyui/workflows/advanced/full-image-graph.json',
    characterSlots:6, environmentSlots:3, defaults:factoryCounts(config), allEnvironments:factoryCounts(config,true),
    templates:Object.keys(templates).map(name=>`comfyui/workflows/factory/${name}.json`) });
  console.log('Prepared compact 12-node upload factory, three focused templates and matching builder downloads. No generation submitted.');
}
if (require.main === module) prepareFactory();
module.exports = { factoryCounts, makeFactoryGraph, makeCharacterTemplate, makeSheetTemplate, makeEnvironmentTemplate, builderMetadata, prepareFactory };
