// Build cloud audio graphs from MCP-verified ComfyUI partner-node templates.
// Preparing these files does not submit any paid generation.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true }); fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + '\n'); };
// Fictional performances using stock voices, never recordings of real people.
const INTRO_VOICES = ['River (neutral, american)', 'Daniel (male, british)', 'Jessica (female, american)', 'Charlie (male, australian)', 'Brian (male, american)', 'Adam (male, american)'];

// The exporter node accepts at most 100 mapped clips (ComfyUI autogrow limit).
const MAX_AUDIO_CLIPS = 100;
const ANNOUNCER_VOICE = 'Roger (male, american)';
// Arcade announcer calls. IDs are stable runtime names; game.js falls back when one is absent.
const ANNOUNCER = [
  ['ann_title', 'Comfy Fighter Z!'], ['ann_select', 'Choose your fighter!'], ['ann_versus', 'Versus!'],
  ['ann_round1', 'Round one!'], ['ann_round2', 'Round two!'], ['ann_round3', 'Round three!'], ['ann_final', 'Final round!'],
  ['ann_ready', 'Ready?'], ['ann_go', 'GO!'], ['ann_ko', 'K! O!'], ['ann_doubleko', 'Double K! O!'], ['ann_timeover', 'Time over!'],
  ['ann_perfect', 'Perfect!'], ['ann_draw', 'Draw game!'], ['ann_victory', 'Victory!'], ['ann_youwin', 'You win!'], ['ann_youlose', 'You lose.'],
  ['ann_continue', 'Continue?'], ['ann_gameover', 'Game over.'], ['ann_finalbattle', 'Final battle!']
];
const SFX = [
  ['sfx_punch', 0.6, 'One isolated stylized anime fighting-game light punch impact: fast airy swoosh then a sharp solid thwack and tiny energy snap.'],
  ['sfx_kick', 0.8, 'One isolated arcade fighting-game medium kick impact: short fast swish followed by a punchy slam with a crisp crack.'],
  ['sfx_heavy', 1.0, 'One isolated heavy arcade fighting-game strike: deep whoomp, bone-rattling bass slam and a short crunchy crack.'],
  ['sfx_block', 0.6, 'One isolated anime fighting-game guard block: tight metallic energy clink with a bass thump and bright brief spark.'],
  ['sfx_special', 1.2, 'One isolated anime arcade energy projectile release: quick rising electrical charge followed by a powerful rushing blast and sparkling decay.'],
  ['sfx_projectile_hit', 0.9, 'One isolated energy-ball impact in an arcade fighting game: crackling burst, bright shatter and a quick electric fizzle.'],
  ['sfx_whiff', 0.5, 'One isolated quick light air whoosh of a fast punch missing its target.'],
  ['sfx_whiff_heavy', 0.6, 'One isolated heavy swinging whoosh of a big kick missing its target, low and airy.'],
  ['sfx_jump', 0.5, 'One isolated light springy hop sound of a fighter leaving the ground: sneaker scuff and short air puff.'],
  ['sfx_land', 0.5, 'One isolated fighter landing on a hard patio: firm double footstep thud with tiny dust scatter.'],
  ['sfx_dash', 0.6, 'One isolated quick dash in an arcade fighting game: rapid scuffing footsteps and a short rushing whoosh.'],
  ['sfx_throw', 1.0, 'One isolated fighting-game throw: cloth grab rustle, heave whoosh and a heavy body slam on the ground.'],
  ['sfx_super', 1.6, 'One isolated super-move activation flash: dramatic rising energy charge, bright shimmering chime and a deep impact boom.'],
  ['sfx_ko', 1.6, 'One isolated final knockout blow in an arcade fighting game: massive impact boom with a short reverberant echo tail.'],
  ['sfx_counter', 0.6, 'One isolated counter-hit accent: bright sharp metallic clang with a quick sparkle.'],
  ['sfx_dizzy', 1.2, 'One isolated cartoon dizzy daze: light swirling chirps and twinkling stars circling.'],
  ['sfx_menu_move', 0.5, 'One isolated crisp retro arcade menu cursor tick, short and clean.'],
  ['sfx_menu_select', 0.6, 'One isolated retro arcade menu confirm: punchy bright chord stab with a short sparkle.'],
  ['sfx_menu_back', 0.5, 'One isolated retro arcade menu cancel: short soft descending blip.'],
  ['sfx_timer', 0.5, 'One isolated urgent digital timer warning beep, single short tone.']
];

function makeAudioJobs(config) {
  const announcer = '[excited, powerful arcade announcer, crisp and energetic] ';
  const stages = config.stages?.length ? config.stages.filter(stage => stage.enabled !== false) : [{ id: 'yard', name: 'The Yard', description: 'An original neighborhood tournament arena.' }];
  const boss = config.fighters.find(fighter => fighter.boss);
  const tempos = [162, 154, 170];
  const music = [
    { id: 'menu_music', duration: 60, loop: true, prompt: 'Original instrumental anime arcade fighting-game title and menu theme. Bright electric guitar riffs, punchy bass, energetic drums, heroic synth brass, 148 BPM, confident memorable original melody. No vocals, no speech, no existing game or anime melody. Clean loop-friendly ending without a long fade. For Comfy Fighter Z.' },
    { id: 'select_music', duration: 45, loop: true, prompt: 'Original instrumental 1990s arcade fighting-game character select music: tense driving synth bass, staccato guitar chugs, crisp drums and a rising brass hook, 150 BPM, anticipation before battle. No vocals or speech, no existing game melody. Loop-friendly ending.' },
    ...stages.map((stage, index) => ({ id: `${stage.id}_music`, duration: 75, loop: true,
      prompt: `Original instrumental 1990s battle-anime fighting-game stage theme for ${stage.name}: ${(stage.description || 'An original tournament arena.').split('. ')[0]}. Fast electric guitar, tight breakbeat drums, driving bass, triumphant synth lead and energetic orchestral stabs, ${tempos[index % tempos.length]} BPM. Upbeat, dramatic and memorable. No vocals or speech, no existing game or anime melody. Steady full-energy groove with a clean loop-friendly ending.` })),
    ...(boss ? [{ id: 'boss_music', duration: 75, loop: true, prompt: `Original instrumental final-boss battle theme for an arcade fighting game: imposing pipe-organ chords, heavy distorted guitar, pounding orchestral drums, dark brass and a menacing minor-key melody, 140 BPM, grand and villainous yet playful. The boss is ${boss.name}. No vocals or speech, no existing game melody. Loop-friendly ending.` }] : []),
    { id: 'victory_music', duration: 10, loop: false, prompt: 'Original short triumphant arcade fighting-game victory jingle: bright brass fanfare and guitar flourish ending on a strong final chord. No vocals, no existing melody.' },
    { id: 'continue_music', duration: 20, loop: true, prompt: 'Original tense arcade continue-countdown music: ticking percussion, suspenseful pulsing synth bass and a pleading melodic motif, 120 BPM. No vocals, no existing melody. Loop-friendly.' },
    { id: 'gameover_music', duration: 8, loop: false, prompt: 'Original short melancholy arcade game-over sting: slow descending synth and soft piano, ending in a quiet minor chord. No vocals, no existing melody.' },
    { id: 'ending_music', duration: 60, loop: true, prompt: 'Original warm, nostalgic arcade ending credits theme: gentle electric piano, hopeful guitar melody, soft drums and a sunset feeling of a neighborhood celebrating together, 96 BPM. No vocals, no existing melody. Loop-friendly.' }
  ].map(job => ({ ...job, category: 'music' }));
  const fighterLines = config.fighters.flatMap((fighter, index) => {
    const voice = fighter.introVoice || INTRO_VOICES[index % INTRO_VOICES.length];
    const base = { category: 'voice', fighter: fighter.id, voice, characterDescription: fighter.description };
    const line = (id, prompt, extra = {}) => ({ ...base, id: `fighter_${fighter.id}_${id}`, prompt, ...extra });
    return [
      line('special', '[shouting the attack name with fierce energy] ' + (fighter.specialMove?.name || 'Special attack') + '!', { specialMove: fighter.specialMove }),
      line('super', '[roaring at full power, dramatic] ' + (fighter.superMove?.name || fighter.specialMove?.name || 'Super attack') + '!', fighter.superMove ? { superMove: fighter.superMove } : {}),
      line('attack', '[sharp fierce battle cry] Hyaah!'),
      line('hurt', '[pained grunt, short] Ugh!'),
      line('ko', '[long anguished defeated cry, fading] Nooooo...!'),
      line('win', '[confident, satisfied] ' + (fighter.winQuote || 'Better luck next time.'), { winQuote: fighter.winQuote || '' }),
      ...(fighter.introTagline ? [line('intro', '[confident, energetic anime tournament fighter, crisp delivery] ' + fighter.introTagline, { introTagline: fighter.introTagline, specialMove: fighter.specialMove })] : [])
    ];
  });
  const result = [
    ...music,
    ...ANNOUNCER.map(([id, text]) => ({ id, category: 'voice', voice: ANNOUNCER_VOICE, prompt: announcer + text })),
    ...SFX.map(([id, duration, prompt]) => ({ id, category: 'sfx', duration, prompt: prompt + ' Immediate attack, short clean decay. No voice, no music, no ambience.' })),
    ...fighterLines
  ].map(job => ({ ...job, kind: 'audio', model: job.category === 'music' ? 'SoniloTextToMusic' : job.category === 'sfx' ? 'ElevenLabsTextToSoundEffects' : 'ElevenLabsTextToSpeech' }));
  if (result.length > MAX_AUDIO_CLIPS) throw new Error(`The audio exporter supports ${MAX_AUDIO_CLIPS} clips; this configuration needs ${result.length}.`);
  return result;
}

function audioRecord(job) {
  return { id: job.id, kind: 'audio', category: job.category, ...(job.fighter ? { fighter: job.fighter } : {}), loop: !!job.loop };
}

function makeAudioGraph(jobs, config, templates, { rootDirectory, title = 'Comfy Fighter Z: complete audio bundle' } = {}) {
  let nextId = 1, nextLink = 1;
  const nodes = [], links = [];
  const node = (type, title, position, inputs, outputs, widgets = [], named) => {
    const result = { id: nextId++, type, title, pos: position, size: [430, 250], flags: {}, order: nodes.length, mode: 0, inputs, outputs, properties: { 'Node name for S&R': type }, widgets_values: widgets };
    if (named) result.widgets_values_named = named;
    nodes.push(result); return result;
  };
  const connect = (from, to, input, type) => {
    const id = nextLink++; from.outputs[0].links ??= []; from.outputs[0].links.push(id); to.inputs[input].link = id;
    links.push([id, from.id, 0, to.id, input, type]);
  };
  const root = node('CFZAssetRoot', 'Shared game asset root (same folder as images)', [-550, 180], [], [{ name: 'root', type: 'CFZ_ROOT', links: [] }],
    [rootDirectory || path.resolve(ROOT, config.assetRoot || 'output/assets/generated/game-pack'), JSON.stringify({ ...config, expectedAudio: jobs.map(job => job.id) }, null, 2)]);
  root.size = [470, 410];
  const exporter = node('CFZExportAudioManifest', 'Export audio.json after every track', [1550, 180], [{ name: 'root', type: 'CFZ_ROOT', link: null }], [{ name: 'manifest_path', type: 'STRING', links: null }]);
  exporter.size = [420, jobs.length * 25 + 130]; connect(root, exporter, 0, 'CFZ_ROOT');
  const voices = new Map();
  const voiceFor = job => {
    const preset = job.voice || 'Roger (male, american)';
    if (!voices.has(preset)) {
      const voice = structuredClone(templates.voice.nodes.find(n => n.type === 'ElevenLabsVoiceSelector'));
      voice.id = nextId++; voice.pos = [-550, 670 + voices.size * 160];
      voice.title = `Fictional performance: ${preset} (preset; no cloning)`;
      voice.widgets_values_named = { voice: preset }; voice.widgets_values = [preset];
      voice.outputs.forEach(output => output.links = []); nodes.push(voice); voices.set(preset, voice);
    }
    return voices.get(preset);
  };
  jobs.forEach((job, index) => {
    const template = templates[job.category === 'music' ? 'music' : job.category === 'sfx' ? 'sfx' : 'voice'];
    const generation = structuredClone(template.nodes.find(n => n.type === job.model));
    generation.id = nextId++; generation.title = `${job.id} | cloud audio`; generation.pos = [30, 180 + index * 400]; generation.size = [460, 320];
    generation.inputs.forEach(input => input.link = null); generation.outputs.forEach(output => output.links = []);
    if (job.category === 'music') {
      generation.widgets_values_named = { prompt: job.prompt, duration: job.duration, seed: 42, control_after_generate: 'fixed' };
    } else if (job.category === 'sfx') {
      // Effects lean harder on the prompt and are asked for dry, close-miked transients so they cut through the mix.
      generation.widgets_values_named = { text: job.category === 'sfx' ? `Crisp, punchy, dry, close-miked, no reverb, no music, single short 16-bit arcade fighting-game sound effect. ${job.prompt}` : job.prompt, model: 'eleven_sfx_v2', 'model.duration': job.duration, 'model.loop': false, 'model.prompt_influence': job.category === 'sfx' ? 0.75 : 0.5, output_format: 'mp3_44100_192' };
    } else {
      generation.widgets_values_named = { text: job.prompt, stability: 0.45, apply_text_normalization: 'auto', model: 'eleven_v4', 'model.similarity_boost': 0.75, language_code: 'en', seed: 42, control_after_generate: 'fixed', output_format: 'mp3_44100_192' };
      connect(voiceFor(job), generation, generation.inputs.findIndex(input => input.name === 'voice'), 'ELEVENLABS_VOICE');
    }
    generation.widgets_values = Object.values(generation.widgets_values_named); nodes.push(generation);
    const save = node('CFZSaveAudio', `Save + map ${job.id}`, [640, 180 + index * 400],
      [{ name: 'audio', type: 'AUDIO', link: null }, { name: 'root', type: 'CFZ_ROOT', link: null }], [{ name: 'audio_asset', type: 'CFZ_AUDIO_ASSET', links: [] }], [JSON.stringify(audioRecord(job), null, 2)]);
    connect(generation, save, 0, 'AUDIO'); connect(root, save, 1, 'CFZ_ROOT');
    exporter.inputs.push({ name: `assets.audio_${index}`, type: 'CFZ_AUDIO_ASSET', link: null }); connect(save, exporter, exporter.inputs.length - 1, 'CFZ_AUDIO_ASSET');
  });
  const note = node('MarkdownNote', title, [-550, -250], [], [], [
    `# ${title}\n\n${jobs.length} paid cloud audio jobs. Music: Sonilo (title, select, every stage, boss, victory, continue, game over and ending). Effects: ElevenLabs SFX. Announcer calls and every fighter line (special and super shouts, attack, hurt, KO, win quote and intro tagline): Eleven v4. Each fighter keeps one distinct stock preset voice for a fictional performance; it does not imitate any real person. No local model weights and no voice cloning.\n\nSet Asset Root to the SAME folder as the image graph. Audio saves are PCM WAVs under raw/. The exporter writes audio.json only after every track finishes; assets.json remains unchanged. Load the full folder in the builder to include both maps.\n\nMusic is requested as loop-friendly; audition the joins before release. Preparing this workflow spends nothing. Running it requires cloud credits and spending authorization.`
  ]); note.size = [1000, 330];
  nodes.forEach((item, index) => item.order = index);
  const digest = createHash('sha256').update(title).digest('hex');
  return { id: `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`, revision: 0, last_node_id: nextId - 1, last_link_id: nextLink - 1, nodes, links, groups: [], config: {}, extra: { ds: { scale: .45, offset: [650, 450] } }, version: .4 };
}

function prepareAudio() {
  const config = read('comfyui/config/game.json'), jobs = makeAudioJobs(config);
  const templates = { music: read('comfyui/workflows/templates/cloud-music.json'), sfx: read('comfyui/workflows/templates/cloud-sfx.json'), voice: read('comfyui/workflows/templates/cloud-voice.json') };
  const graph = makeAudioGraph(jobs, config, templates);
  write('comfyui/workflows/comfy-audio.json', graph); write('comfyui/workflows/audio/complete-audio.json', graph);
  // Rates are read from the installed live node price badges, not provider list prices.
  const estimatedUSD = jobs.reduce((sum, job) => sum + (job.category === 'music' ? .0025 * job.duration : job.category === 'sfx' ? .14 * job.duration / 60 : .1144 * job.prompt.length / 1000), 0);
  write('comfyui/assets/audio-plan.json', { schema: 'comfy-fighter-audio-plan/v1', cloudOnly: true, paid: true, workflow: 'comfyui/workflows/comfy-audio.json', estimatedUSD, estimateSource: 'Installed ComfyUI node price_badge: Sonilo $0.0025/s, ElevenLabs SFX ~$0.14/min, Eleven v4 ~$0.1144/1K chars; actual billing may vary.', jobs });
  console.log(`Prepared ${jobs.length} cloud audio jobs. Estimated $${estimatedUSD.toFixed(3)}; no generation submitted.`);
}
if (require.main === module) prepareAudio();
// Merge an audio graph into an image workflow: its asset root follows the workflow's Project
// Settings (one output folder for assets.json and audio.json) and each cloud node gets its own seed.
function attachAudioGraph(workflow, project, audio, { seed }) {
  const audioRoot = audio.nodes.find(node => node.type === 'CFZAssetRoot');
  const audioConfig = JSON.parse(audioRoot.widgets_values[1]);
  delete audioConfig.assetRoot;
  audioRoot.type = 'CFZProjectAudioRoot';
  audioRoot.title = 'Audio follows the same Project Settings folder';
  audioRoot.properties = { 'Node name for S&R': audioRoot.type };
  audioRoot.inputs = [{ name: 'project', type: 'CFZ_PROJECT', link: null }];
  audioRoot.widgets_values_named = { audio_config: JSON.stringify(audioConfig, null, 2) };
  audioRoot.widgets_values = Object.values(audioRoot.widgets_values_named);
  for (const node of audio.nodes) {
    if (node.type === 'CFZSaveAudio') node.widgets_values_named = { asset_json: node.widgets_values[0] };
    if (node.widgets_values_named && 'seed' in node.widgets_values_named) {
      node.widgets_values_named.seed = seed + node.id;
      node.widgets_values = Object.values(node.widgets_values_named);
    }
  }
  const nodeOffset = workflow.last_node_id, linkOffset = workflow.last_link_id;
  for (const node of audio.nodes) {
    node.id += nodeOffset;
    for (const input of node.inputs || []) if (input.link !== null) input.link += linkOffset;
    for (const output of node.outputs || []) if (Array.isArray(output.links)) output.links = output.links.map(link => link + linkOffset);
  }
  for (const link of audio.links) { link[0] += linkOffset; link[1] += nodeOffset; link[3] += nodeOffset; }
  workflow.nodes.push(...audio.nodes);
  workflow.links.push(...audio.links);
  workflow.last_node_id = Math.max(...workflow.nodes.map(node => node.id));
  workflow.last_link_id = Math.max(...workflow.links.map(link => link[0]));
  const rootLink = ++workflow.last_link_id;
  project.outputs[0].links.push(rootLink); audioRoot.inputs[0].link = rootLink;
  workflow.links.push([rootLink, project.id, 0, audioRoot.id, 0, 'CFZ_PROJECT']);
  return audioRoot;
}

module.exports = { attachAudioGraph, makeAudioJobs, makeAudioGraph, audioRecord, prepareAudio, INTRO_VOICES };
