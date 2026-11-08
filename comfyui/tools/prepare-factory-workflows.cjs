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

// Arcade art per fighter: two optional in-between sheets (2K) and one ending illustration (1K);
// motion art adds two more 2K sheets (strike transitions, breathing loop and air cels).
const arcade = config => !!config.extraSheets;
const motion = config => arcade(config) && !!config.motionSheets;
function factoryCounts(config, allEnvironments = false) {
  const fighters = config.fighters.length, extras = arcade(config);
  const environments = allEnvironments ? config.stages : config.stages.filter(s => s.enabled);
  const stages = environments.length;
  const inventedCharacters=config.fighters.filter(item=>item.sourceMode==='Invent fictional reference').length;
  const inventedEnvironments=environments.filter(item=>item.sourceMode==='Invent fictional reference').length;
  // Shared art: title, select, logo, HUD, icons and the menu frame at 1K, plus the 2K effects sheet.
  const sheets = extras ? motion(config) ? 7 : 5 : 3;
  const oneK = fighters * (extras ? 5 : 4) + 6 + inventedCharacters, twoK = fighters * sheets + stages + 1 + inventedEnvironments;
  return { paidImages: oneK + twoK, sourceSaves: fighters + stages, mappedAssets: fighters * (sheets + (extras ? 6 : 5)) + stages * 2 + 7,
    oneK, twoK, estimatedUSD: Number((oneK * 0.048048 + twoK * 0.072072).toFixed(6)) };
}

// Startup art and videos: the cast ensemble (2K), one 16:9 intro keyframe per fighter (1K) and silent
// 720p LTX-2.5 Fast clips (an eight-second menu loop and four-second fight introductions).
// Per-second list prices of the cloud video models the project node offers; LTX always renders 720p.
const VIDEO_RATES = Object.freeze({ 'LTX-2.5 (Fast)': { '720p': 0.1287, '1080p': 0.1287 }, 'Seedance 1.5 Pro': { '720p': 0.026, '1080p': 0.059 } });
const DEFAULT_VIDEO_MODEL = 'LTX-2.5 (Fast)', DEFAULT_VIDEO_RESOLUTION = '720p';
function videoRate(config = {}) {
  const model = config.videoModel || DEFAULT_VIDEO_MODEL, resolution = config.videoResolution || DEFAULT_VIDEO_RESOLUTION, rate = VIDEO_RATES[model]?.[resolution];
  if (!rate) throw new Error(`Unsupported video model or resolution: ${model} ${resolution}`);
  return { model, resolution, rate };
}
const MENU_SECONDS = 8, SELECT_SECONDS = 8, INTRO_SECONDS = 4, IDLE_SECONDS = 6;
function mediaCounts(config) {
  // Per fighter: an intro keyframe and clip plus a portrait idle keyframe and loop for the select screen.
  const fighters = config.fighters.length, oneK = fighters * 2, twoK = 1, videoSeconds = MENU_SECONDS + SELECT_SECONDS + fighters * (INTRO_SECONDS + IDLE_SECONDS);
  const video = videoRate(config), videoUSD = Number((videoSeconds * video.rate).toFixed(6));
  return { paidImages: oneK + twoK, oneK, twoK, clips: 2 + fighters * 2, videoSeconds, mappedAssets: 1, videoModel: video.model, videoResolution: video.resolution, videoRate: video.rate, videoUSD,
    estimatedUSD: Number((oneK * 0.048048 + twoK * 0.072072 + videoUSD).toFixed(6)) };
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
  // Free preview nodes so a person can review each stage of a run inside ComfyUI.
  function preview(from, outputIndex, type, title, pos, size = [420, 360]) {
    const image = type === 'PreviewImage', input = { name: image ? 'images' : 'source', type: image ? 'IMAGE' : '*', link: null };
    const item = { id: ++graph.last_node_id, type, title, pos, size, flags: {}, order: graph.nodes.length, mode: 0, inputs: [input], outputs: [],
      properties: { 'Node name for S&R': type }, widgets_values: [] };
    graph.nodes.push(item);
    const output = from.outputs[outputIndex], link = ++graph.last_link_id;
    if (image && output.type !== 'IMAGE') throw new Error(`Socket type mismatch: ${output.type} -> IMAGE`);
    output.links.push(link); input.link = link; graph.links.push([link, from.id, outputIndex, item.id, 0, input.type]);
    return item;
  }
  return { graph, node, connect, note, group, loadImage, fictionalReference, preview };
}

function projectValues(config, suffix = '') {
  return { root_directory: path.resolve(ROOT, config.assetRoot, suffix), title: config.title, subtitle: config.subtitle || '',
    style: config.style, ui_style: config.uiStyle, stage_style: config.stageStyle, model: config.model, seed: 42,
    video_model: config.videoModel || DEFAULT_VIDEO_MODEL, video_resolution: config.videoResolution || DEFAULT_VIDEO_RESOLUTION };
}
function arcadeValues(fighter) {
  return { fighting_style: fighter.style || 'balanced', super_name: fighter.superMove?.name || '', super_description: fighter.superMove?.description || '',
    win_quote: fighter.winQuote || '', ending: fighter.ending || '', role: fighter.boss ? 'Final boss' : 'Fighter' };
}
function characterValues(fighter, includeSheets = true, includeArcade = true, includeMotion = true) {
  const source_mode=fighter.sourceMode||'Upload reference';
  return { image: source_mode==='Invent fictional reference'?'':fighter.sourceInput || '', source_mode, name: fighter.name, description: fighter.description,
    special_name: fighter.specialMove.name, special_description: fighter.specialMove.description,
    intro_tagline: fighter.introTagline || '', color: fighter.color, character_id: fighter.id, include_sprite_sheets: includeSheets,
    ...arcadeValues(fighter), include_arcade_art: includeArcade, include_motion_art: includeArcade && includeMotion };
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

// The cast ensemble for the startup screen, its looping menu video and one fight introduction per
// fighter, exported as video.json. Returns the ensemble node, whose bundle joins assets.json.
function attachMedia(b, project, characters, fighters, stage, [x, y], shared = null) {
  const title = b.node('CFZTitleArt', 'Startup image | cast ensemble', {}, [x, y], [440, 420]);
  b.connect(project, 0, title, 'project'); b.connect(stage, 1, title, 'stage_reference');
  characters.slice(0, 8).forEach((character, i) => b.connect(character, 1, title, `fighter_${i + 1}`));
  const menu = b.node('CFZTitleVideo', 'Menu video | looping title animation', { duration: String(MENU_SECONDS) }, [x, y + 480], [440, 170]);
  b.connect(project, 0, menu, 'project'); b.connect(title, 1, menu, 'title_image');
  const intros = characters.map((character, i) => {
    const intro = b.node('CFZIntroVideo', `Fight intro | ${fighters[i].name}`, { duration: String(INTRO_SECONDS) }, [x + 490, y + i * 230], [420, 200]);
    b.connect(project, 0, intro, 'project'); b.connect(character, 2, intro, 'character');
    b.connect(character, 1, intro, 'reference'); b.connect(stage, 1, intro, 'stage_reference');
    return intro;
  });
  const select = shared ? b.node('CFZSelectVideo', 'Select video | looping roster backdrop', { duration: String(SELECT_SECONDS) }, [x, y + 680], [440, 170]) : null;
  if (select) { b.connect(project, 0, select, 'project'); b.connect(shared, 1, select, 'select_image'); }
  const idles = characters.map((character, i) => {
    const idle = b.node('CFZSelectIdleVideo', `Select idle | ${fighters[i].name}`, { duration: String(IDLE_SECONDS) }, [x + 960, y + i * 230], [420, 200]);
    b.connect(project, 0, idle, 'project'); b.connect(character, 2, idle, 'character'); b.connect(character, 1, idle, 'reference');
    return idle;
  });
  const clips = [menu, ...(select ? [select] : []), ...intros, ...idles];
  const exporter = b.node('CFZExportVideos', 'Export video.json', {}, [x, y + 880], [440, 230], clips.length);
  b.connect(project, 0, exporter, 'project');
  clips.forEach((video, i) => b.connect(video, 0, exporter, `videos.video_${i}`));
  b.group('Startup image + menu, select and fight videos', [x - 25, y - 75, 1430, Math.max(1050, characters.length * 230 + 120)], '#6f4f7f');
  return title;
}

function makeFactoryGraph(config, { media: withMedia = true } = {}) {
  // Six fighter slots, an optional seventh final-boss slot and three environment slots.
  const bosses = config.fighters.filter(f => f.boss).length;
  if (![6, 7].includes(config.fighters.length) || bosses !== config.fighters.length - 6 || (bosses && !config.fighters[6].boss) || config.stages.length !== 3) throw new Error('The main template has six character slots, one optional final-boss slot and three environment slots');
  const b = graphBuilder(`${config.title}: compact upload factory`);
  const project = b.node('CFZProjectSettings', 'Project settings | output folder + game title', projectValues(config), [-510, 120], [450, 470]);
  const bundles = [];
  config.fighters.forEach((fighter, i) => {
    const character = b.node('CFZCharacterFactory', fighter.boss ? `Final boss | ${fighter.name}` : `Character ${i + 1} | ${fighter.name}`, characterValues(fighter, true, arcade(config), motion(config)),
      [(i % 3) * 490, 120 + Math.floor(i / 3) * 820], [440, 720]);
    character.color = fighter.boss ? '#4b2630' : '#26374b'; character.bgcolor = fighter.boss ? '#341720' : '#172334';
    b.connect(project, 0, character, 'project'); bundles.push(character);
  });
  const environments = config.stages.map((stage, i) => {
    const environment = b.node('CFZEnvironmentFactory', `Environment ${i + 1} | ${stage.enabled ? stage.name : 'disabled'}`,
      environmentValues(stage), [i * 490, 2600], [440, 540]);
    environment.color = stage.enabled ? '#29463d' : '#3a3e46'; environment.bgcolor = '#1b2927';
    b.connect(project, 0, environment, 'project'); bundles.push(environment); return environment;
  });
  const shared = b.node('CFZSharedArtFactory', 'Shared art | menus, logo, HUD + effects', {}, [1510, 620], [440, 160]);
  b.connect(project, 0, shared, 'project'); b.connect(environments[0], 1, shared, 'stage_reference'); bundles.push(shared);
  if (withMedia) bundles.push(attachMedia(b, project, bundles.slice(0, config.fighters.length), config.fighters, environments[0], [2060, 120], shared));
  attachExporter(b, project, bundles, [1510, 970], true);
  const count = factoryCounts(config), full = factoryCounts(config, true), media = withMedia ? mediaCounts(config) : { paidImages: 0, oneK: 0, twoK: 0, clips: 0, videoSeconds: 0, mappedAssets: 0, estimatedUSD: 0 };
  b.note(`# ${config.title}\n## Invent fictional fighters and a final boss. Build your arcade game.\n\nThe demo cards use Invent fictional reference: they create fresh designs from text and ignore the image selector. No photos or old sheets are loaded. To use your own new image, explicitly switch that card to Upload reference. Six fighter slots plus one Final boss slot close Arcade mode. Environment 1 supplies the title/select venue; disable slots 2 and 3 to build a one-stage game. Each fighter's arcade art adds two in-between sheets (45 poses) and an ending illustration. Set a NEW output folder, then load its assets.json + raw/ in /builder/.\n\n**CLOUD ONLY / PAID:** default ${count.paidImages} image calls / ${count.mappedAssets} mapped assets (about $${count.estimatedUSD.toFixed(3)}). Source-reference generation is included when Invent is selected. ${withMedia ? `The startup image and videos add ${media.paidImages} image calls and ${media.clips} silent LTX clips (${media.videoSeconds} seconds), about $${media.estimatedUSD.toFixed(3)}. ` : ''}Audio is the separate comfy-audio.json. Opening this graph spends nothing.`, [-510, -260], [1940, 290]);
  b.note('## Before you run\n\n1. Install comfyui/custom_nodes/comfy_fighter_assets and restart ComfyUI.\n2. Edit fictional descriptions, specials, supers, win quotes, endings and taglines; keep Invent mode for a demo without photo inputs.\n3. Validate and review paid-call costs.\n4. Review all 45 poses per fighter (27 required + 18 arcade in-betweens) before exporting a release.\n\nUse comfyui/workflows/factory/ for one character, one sheet, one art image or one environment. The full native graph is under comfyui/workflows/advanced/.', [1510, 1470], [440, 440]);
  b.group('Six character factories + final boss', [-25, 45, 1470, 2460], '#4b6387');
  b.group('Three environment factories', [-25, 2525, 1470, 675], '#4b7f6d');
  b.group('Shared artwork + mapped export', [1485, 545, 490, 830], '#826947');
  return b.graph;
}

function makeCharacterTemplate(config) {
  const fighter = config.fighters[0], b = graphBuilder(`${config.title}: one character pack`);
  const project = b.node('CFZProjectSettings', 'Separate character patch folder', projectValues(config, `character-${fighter.id}`), [-510, 110], [440, 470]);
  const character = b.node('CFZCharacterFactory', 'Upload character | identity, selection and ending art', characterValues(fighter, false, arcade(config), motion(config)), [0, 110], [440, 720]);
  b.connect(project, 0, character, 'project');
  const bundles = [character];
  const sheets = arcade(config) ? ['sheet', 'sheetB', 'sheetC', 'sheetD', 'sheetE'] : ['sheet', 'sheetB', 'sheetC'];
  sheets.forEach((sheet, i) => {
    const node = b.node('CFZSpriteSheet', `Sprite sheet ${'ABCDE'[i]} | ${i < 3 ? 'nine required poses' : 'nine arcade in-betweens'}`, { sheet }, [540, 110 + i * 235], [420, 170]);
    b.connect(project, 0, node, 'project'); b.connect(character, 2, node, 'character'); b.connect(character, 1, node, 'reference'); bundles.push(node);
  });
  attachExporter(b, project, bundles, [1060, 250], false);
  b.note('# One complete character pack\n\nInvent mode creates a fresh fictional source from text, then identity, portrait, hero, cut-in and arcade ending art. Its internal sheets are OFF: the five visible sheet nodes reuse that identity (sheets A-C hold the 27 required poses; D and E add 18 optional in-betweens). Eleven paid images in Invent mode; ten when explicitly uploading a new reference. No previous photos are selected. Produces a PARTIAL assets.json; merge into a complete game before export. Keep this output root separate from the accepted bundle.', [-510, -230], [1940, 220]);
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
  b.note(fighter.acceptedReferenceInput ? '# One sprite sheet from an accepted fictional identity\n\nUpload the explicitly named, newly generated identity; no old photo is selected. Choose sheet, sheetB or sheetC (27 required poses) or sheetD/sheetE (optional arcade in-betweens). One paid 2K image (~$0.072). Writes a PARTIAL assets.json into its own root for review and merge.' : '# One fictional sprite sheet\n\nThe custom Fictional Reference node invents a fresh character reference from text, then the custom Sprite Sheet node generates the selected nine-pose sheet. Two paid image calls (~$0.120); no Load Image node or previous-session file is used. Exports a PARTIAL assets.json into its own root. For consistent full-character production use the complete character pack, whose three sheets share one identity.', [-510, -230], [1940, 220]);
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

// Adds arcade art to an ACCEPTED cast: per existing fighter two in-between sheets and an
// ending illustration from its uploaded identity, plus the final boss and the extra
// environments. Writes a PARTIAL assets.json for a reviewed --saga merge.
function expansionParts(config) {
  return { fighters: config.fighters.filter(f => !f.boss), boss: config.fighters.find(f => f.boss), stages: config.stages.slice(1).filter(s => s.enabled) };
}
function expansionCounts(config) {
  const { fighters, boss, stages } = expansionParts(config);
  const bossOneK = boss ? 5 + (boss.sourceMode === 'Invent fictional reference' ? 1 : 0) : 0, bossTwoK = boss ? 5 : 0;
  const stageTwoK = stages.reduce((sum, stage) => sum + (stage.sourceMode === 'Invent fictional reference' ? 2 : 1), 0);
  const oneK = fighters.length + bossOneK, twoK = fighters.length * 2 + bossTwoK + stageTwoK;
  return { paidImages: oneK + twoK, oneK, twoK, mappedAssets: fighters.length * 3 + (boss ? 11 : 0) + stages.length * 2,
    estimatedUSD: Number((oneK * 0.048048 + twoK * 0.072072).toFixed(6)) };
}
function makeExpansionGraph(config, { rootDirectory } = {}) {
  const { fighters, boss, stages } = expansionParts(config);
  if (!arcade(config)) throw new Error('The arcade expansion requires extraSheets in the configuration');
  const b = graphBuilder(`${config.title}: arcade expansion for an accepted cast`);
  const values = projectValues(config, 'arcade-expansion');
  if (rootDirectory) values.root_directory = rootDirectory;
  const project = b.node('CFZProjectSettings', 'Separate expansion patch folder', values, [-510, 110], [440, 470]);
  const bundles = [];
  fighters.forEach((fighter, i) => {
    const x = (i % 3) * 1010, y = 110 + Math.floor(i / 3) * 900;
    const reference = b.loadImage(fighter.acceptedReferenceInput || `cfz-accepted-${fighter.id}-reference.png`, [x, y]);
    reference.title = `Accepted identity | ${fighter.name}`;
    const definition = b.node('CFZCharacterDefinition', `${fighter.name} | accepted definition`, characterValues(fighter), [x, y + 500], [440, 330]);
    ['sheetD', 'sheetE'].forEach((sheet, j) => {
      const node = b.node('CFZSpriteSheet', `${fighter.name} | ${sheet} in-betweens`, { sheet }, [x + 480, y + j * 200], [420, 170]);
      b.connect(project, 0, node, 'project'); b.connect(definition, 0, node, 'character'); b.connect(reference, 0, node, 'reference'); bundles.push(node);
    });
    const art = b.node('CFZCharacterArt', `${fighter.name} | arcade ending art`, { kind: 'ending' }, [x + 480, y + 400], [420, 170]);
    b.connect(project, 0, art, 'project'); b.connect(definition, 0, art, 'character'); b.connect(reference, 0, art, 'reference'); bundles.push(art);
  });
  if (boss) {
    // Internal sheets are off: five visible sheet nodes reuse the boss identity, so at most four
    // art calls run together (workspaces limited to one concurrent job rate-limit larger bursts).
    const node = b.node('CFZCharacterFactory', `Final boss | ${boss.name}`, characterValues(boss, false, true, false), [3060, 110], [440, 720]);
    node.color = '#4b2630'; node.bgcolor = '#341720';
    b.connect(project, 0, node, 'project'); bundles.push(node);
    ['sheet', 'sheetB', 'sheetC', 'sheetD', 'sheetE'].forEach((sheet, i) => {
      const sheetNode = b.node('CFZSpriteSheet', `${boss.name} | sheet ${'ABCDE'[i]}`, { sheet }, [3540, 110 + i * 200], [420, 170]);
      b.connect(project, 0, sheetNode, 'project'); b.connect(node, 2, sheetNode, 'character'); b.connect(node, 1, sheetNode, 'reference'); bundles.push(sheetNode);
    });
  }
  stages.forEach((stage, i) => {
    const node = b.node('CFZEnvironmentFactory', `Environment | ${stage.name}`, environmentValues({ ...stage, enabled: true }), [3060, 1180 + i * 620], [440, 540]);
    b.connect(project, 0, node, 'project'); bundles.push(node);
  });
  attachExporter(b, project, bundles, [4040, 600], false);
  const count = expansionCounts(config);
  b.note(`# Arcade expansion for the accepted cast\n\nMUTED BY DEFAULT. Upload each accepted identity reference (cfz-accepted-<id>-reference.png) into ComfyUI's input folder first; nothing older is selected automatically. Then unmute every node (select all, Ctrl+M). For each existing fighter this graph generates sheetD and sheetE (18 in-between poses) and an arcade ending illustration from that identity, invents the final boss from text, and invents the extra environments from text.\n\n**CLOUD ONLY / PAID:** ${count.paidImages} image calls (about $${count.estimatedUSD.toFixed(3)}). It writes a PARTIAL assets.json in its own root. Review every pose, then merge with build/tools/merge-bundles.cjs --saga into a fresh complete bundle.`, [-510, -260], [1940, 260]);
  // Accepted identities are explicit uploads: ship muted until the reviewer selects them.
  b.graph.nodes.forEach(node => { if (node.type !== 'MarkdownNote') node.mode = 2; });
  b.graph.extra.cfzArcadeExpansion = { mutedByDefault: true, acceptedReferences: fighters.map(f => f.acceptedReferenceInput || `cfz-accepted-${f.id}-reference.png`) };
  b.graph.extra.ds = { scale: 0.32, offset: [620, 360] };
  return b.graph;
}

// Living stage scenery for one ACCEPTED stage painting, all inside ComfyUI: the scene director (Gemini vision, priced
// per token and bounded by its output cap) plans the background additions and the effects on painted features; two 2K
// edits paint the additions in place and separate them onto chroma green; the local extractor cuts placed layers and
// writes scenery/<stage>.json; a PARTIAL assets.json maps them for a reviewed apply into the bundle.
const DIRECTOR_MODEL = 'Gemini 3.8 Flash';
const DIRECTOR_RATES = Object.freeze({ 'Gemini 3.8 Flash': { input: .002145, output: .010725 }, 'Gemini 3.1 Pro': { input: .002, output: .012 } });
const DIRECTOR_TOKENS = Object.freeze({ input: 6000, maxOutput: 16384 });
function sceneryCounts(stages = 1, model = DIRECTOR_MODEL) {
  const rate = DIRECTOR_RATES[model];
  if (!rate) throw new Error(`Unsupported scene director model: ${model}`);
  const director = Number((DIRECTOR_TOKENS.input / 1000 * rate.input + DIRECTOR_TOKENS.maxOutput / 1000 * rate.output).toFixed(6)), twoK = stages * 2;
  return { stages, paidImages: twoK, twoK, directorCalls: stages, directorModel: model, directorMaxUSD: Number((director * stages).toFixed(6)),
    estimatedUSD: Number((twoK * 0.072072 + director * stages).toFixed(6)) };
}
function makeSceneryGraph(config, { stage = config.stages[0], stageImage, rootDirectory, project: projectInputs, direction = '', elementCount = 12, model = DIRECTOR_MODEL, reroll = 0, muted = true } = {}) {
  const b = graphBuilder(`${config.title}: living scenery for ${stage.name}`);
  const values = projectInputs ? { ...projectInputs } : projectValues(config, `scenery-${stage.id}`);
  if (rootDirectory) values.root_directory = rootDirectory;
  const project = b.node('CFZProjectSettings', 'Scenery patch folder', values, [-510, 120], [440, 470]);
  const painting = b.loadImage(stageImage || `cfz-accepted-${stage.id}-stage.png`, [0, 120]);
  painting.title = `Accepted stage painting | ${stage.name}`;
  const identity = { stage_id: stage.id, name: stage.name, description: stage.description || '' };
  const director = b.node('CFZSceneDirector', 'Scene director | plan additions, effects and weather', { ...identity, direction, element_count: elementCount, director_model: model, reroll },
    [480, 120], [440, 560]);
  b.connect(project, 0, director, 'project'); b.connect(painting, 0, director, 'stage');
  const painter = b.node('CFZStageScenery', 'Populated scene | the additions painted in place (2K)', { ...identity, reroll }, [960, 120], [440, 360]);
  b.connect(project, 0, painter, 'project'); b.connect(painting, 0, painter, 'stage_reference'); b.connect(director, 0, painter, 'plan');
  const isolate = b.node('CFZSceneIsolate', 'Separation | the additions alone on chroma green (2K)', { ...identity, reroll }, [960, 540], [440, 320]);
  b.connect(project, 0, isolate, 'project'); b.connect(painter, 1, isolate, 'scene'); b.connect(director, 0, isolate, 'plan');
  const extract = b.node('CFZExtractScenery', 'Extract | placed layers, effects + review sheet', identity, [1440, 120], [440, 420]);
  b.connect(project, 0, extract, 'project'); b.connect(painting, 0, extract, 'stage'); b.connect(painter, 1, extract, 'scene');
  b.connect(isolate, 1, extract, 'isolated'); b.connect(director, 0, extract, 'plan');
  b.preview(director, 0, 'PreviewAny', 'Plan (JSON)', [480, 720], [440, 300]);
  b.preview(painter, 1, 'PreviewImage', 'Populated scene', [960, 900]);
  b.preview(isolate, 1, 'PreviewImage', 'Isolated additions', [960, 1300]);
  b.preview(extract, 1, 'PreviewImage', 'Review sheet: elements over the scene, effects over the plate', [1440, 600], [520, 560]);
  attachExporter(b, project, [painter, isolate, extract], [1920, 120], false);
  const count = sceneryCounts(1, model);
  b.note(`# Living scenery for ${stage.name}\n\nAnimated background characters, props and scene effects for an ACCEPTED stage painting, Street Fighter style. MUTED BY DEFAULT: nothing runs until you unmute it (select all, Ctrl+M). Upload the accepted painting (default name \`${stageImage || `cfz-accepted-${stage.id}-stage.png`}\`) into ComfyUI's input folder and select it in the image node; set the stage ID, name and description to the accepted stage; optionally steer the director with a direction.\n\n1. **Scene director** (Gemini vision, priced per token, at most about $${count.directorMaxUSD.toFixed(2)}): reads the painting and plans ${elementCount} additions (what, where, how each moves), the effects on features already painted (beacons, billboards, vents, puddles, sky, foliage...) and the weather.\n2. **Populated scene** (one 2K edit, $0.07): the painting repainted with exactly those additions.\n3. **Separation** (one 2K edit, $0.07): the additions alone, in place, on chroma green.\n4. **Extract** (local, free): cuts every addition out at its exact position and scale, keeps the scene's other changes as still layers, and writes \`scenery/${stage.id}.json\` plus a review sheet.\n5. **Export** writes a PARTIAL assets.json in this patch folder.\n\nAbout $${count.estimatedUSD.toFixed(2)} at most. Review the sheet, edit motions in \`scenery/${stage.id}.json\` if needed, then fold it into the accepted bundle:\n\n    node build/tools/stage-scenery.cjs apply --patch <this folder> --bundle <accepted bundle>\n\nCloud image models do not promise identical pixels on a rerun: the patch folder keeps the plan, the scene, the isolated layer and every cut-out.`,
    [-510, 650], [440, 760]);
  b.group('Plan, paint, separate, extract and export', [-25, 45, 2390, 1700], '#3f6b7f');
  b.graph.extra.ds = { scale: 0.5, offset: [620, 300] };
  // The accepted painting is an explicit upload: the shipped template stays muted until the reviewer selects it.
  if (muted) b.graph.nodes.forEach(node => { if (node.type !== 'MarkdownNote') node.mode = 2; });
  b.graph.extra.cfzStageScenery = { mutedByDefault: muted, stage: stage.id, stageImage: stageImage || `cfz-accepted-${stage.id}-stage.png`, ...count };
  return b.graph;
}

// UI graph -> API prompt. Named widgets carry values; a few local nodes only have positional widgets.
const POSITIONAL = { LoadImage: ['image'], CFZAssetRoot: ['root_directory', 'config_json'], CFZSaveAudio: ['asset_json'] };
function apiPrompt(workflow) {
  const links = new Map(workflow.links.map(link => [link[0], link])), prompt = {};
  for (const node of workflow.nodes) {
    if (node.type === 'MarkdownNote' || node.mode === 2 || node.mode === 4) continue;
    const inputs = node.widgets_values_named ? { ...node.widgets_values_named }
      : Object.fromEntries((POSITIONAL[node.type] || []).map((name, index) => [name, node.widgets_values[index]]));
    if (!node.widgets_values_named && node.widgets_values?.length && !POSITIONAL[node.type]) throw new Error(`No widget mapping for ${node.type}.`);
    delete inputs.control_after_generate;
    for (const input of node.inputs || []) if (input.link !== null && input.link !== undefined) {
      const link = links.get(input.link);
      if (!link) throw new Error(`Missing link ${input.link} on ${node.type}.`);
      inputs[input.name] = [String(link[1]), link[2]];
    }
    prompt[node.id] = { class_type: node.type, inputs, _meta: { title: node.title || node.type } };
  }
  return prompt;
}

function builderMetadata(config) {
  const slots = items => items.map(item => ({ id: item.id, name: item.name, enabled: item.enabled !== false,
    sourceMode:item.sourceMode||'Upload reference', reference: item.sourceMode==='Invent fictional reference'?'':item.sourceInput || '', sourceInput:item.sourceMode==='Invent fictional reference'?'':item.sourceInput || '' }));
  return { title: config.title, subtitle: config.subtitle, workflowURL: '/builder/templates/comfy-hackathon.json',
    fictional:true,characters: slots(config.fighters), environments: slots(config.stages),
    templates: [{id:'character',label:'One complete character pack',url:'/builder/templates/character-factory.json'},
      {id:'sheet',label:'One sprite sheet',url:'/builder/templates/sprite-sheet.json'},
      {id:'expansion',label:'Arcade expansion for an accepted cast',url:'/builder/templates/arcade-expansion.json'},
      {id:'environment',label:'One environment',url:'/builder/templates/environment-factory.json'},
      {id:'scenery',label:'Living scenery for an accepted stage',url:'/builder/templates/stage-scenery.json'}],
    nodePack: { name:'Comfy Fighter Z Asset Factory',
      installInstructions:'Copy comfyui/custom_nodes/comfy_fighter_assets into your ComfyUI custom_nodes folder and restart ComfyUI. Then open the downloaded workflow.' } };
}

function prepareFactory() {
  const config = read('comfyui/config/factory.json');
  const main = makeFactoryGraph(config);
  write('comfyui/workflows/comfy-hackathon.json', main); write('build/public/builder/templates/comfy-hackathon.json', main);
  const templates = { 'character-factory': makeCharacterTemplate(config), 'sprite-sheet': makeSheetTemplate(config), 'environment-factory': makeEnvironmentTemplate(config), 'arcade-expansion': makeExpansionGraph(config),
    'stage-scenery': makeSceneryGraph(config) };
  for (const [name, workflow] of Object.entries(templates)) {
    write(`comfyui/workflows/factory/${name}.json`, workflow); write(`build/public/builder/templates/${name}.json`, workflow);
  }
  write('build/public/builder/factory-template.json', builderMetadata(config));
  write('comfyui/workflows/factory/catalog.json', { schema:'comfy-fighter-factory/v1', cloudOnly:true, config:'comfyui/config/factory.json',
    workflow:'comfyui/workflows/comfy-hackathon.json', advancedWorkflow:'comfyui/workflows/advanced/full-image-graph.json',
    characterSlots:7, bossSlots:1, environmentSlots:3, defaults:factoryCounts(config), allEnvironments:factoryCounts(config,true), expansion:expansionCounts(config), scenery:sceneryCounts(1),
    templates:Object.keys(templates).map(name=>`comfyui/workflows/factory/${name}.json`) });
  console.log(`Prepared compact ${main.nodes.filter(node => node.type !== 'MarkdownNote').length}-node factory (six fighters, final boss, three environments, startup image and videos), ${Object.keys(templates).length} focused templates and matching builder downloads. No generation submitted.`);
}
if (require.main === module) prepareFactory();
module.exports = { sceneryCounts, makeSceneryGraph, apiPrompt, DIRECTOR_RATES, factoryCounts, mediaCounts, motion, videoRate, VIDEO_RATES, expansionCounts, attachMedia, graphBuilder, characterValues, environmentValues, projectValues, attachExporter, makeFactoryGraph, makeCharacterTemplate, makeSheetTemplate, makeEnvironmentTemplate, makeExpansionGraph, builderMetadata, prepareFactory };
