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

function makeAudioJobs(config) {
  const announcer = '[excited, powerful arcade announcer, crisp and energetic] ';
  const stage = config.stages?.[0] || {name:'The Yard',description:'An original neighborhood tournament arena.'};
  return [
    { id: 'menu_music', category: 'music', duration: 45, loop: true, prompt: 'Original instrumental anime arcade fighting-game character selection music. Bright electric guitar riffs, punchy bass, energetic drums, heroic synth brass, playful competitive energy, 148 BPM. Confident memorable original melody, no vocals, no speech, no existing game or anime melody. Steady groove, clean loop-friendly ending without a long fade. For Comfy Fighter Z.' },
    { id: 'yard_music', category: 'music', duration: 60, loop: true, prompt: `Original instrumental 1990s battle-anime fighting-game theme for ${stage.name}: ${stage.description || 'An original tournament arena.'} Fast electric guitar, tight breakbeat drums, driving bass, triumphant synth lead and energetic orchestral stabs, 162 BPM. Upbeat, dramatic and playful. No vocals or speech, no existing game or anime melody. Steady full-energy groove with a clean loop-friendly ending.` },
    { id: 'ann_select', category: 'voice', prompt: announcer + 'Choose your fighter!' },
    { id: 'ann_fight', category: 'voice', prompt: announcer + 'Ready? FIGHT!' },
    { id: 'ann_ko', category: 'voice', prompt: announcer + 'K! O!' },
    { id: 'ann_victory', category: 'voice', prompt: announcer + 'Victory!' },
    { id: 'sfx_punch', category: 'sfx', duration: 0.6, prompt: 'One isolated stylized anime fighting-game punch impact: fast airy swoosh then sharp solid thwack and tiny energy snap. Immediate attack, short clean decay, no voice, no music, no ambience.' },
    { id: 'sfx_kick', category: 'sfx', duration: 0.8, prompt: 'One isolated heavy arcade fighting-game kick impact: short fast swish followed by deep punchy slam with a crisp crack. Immediate attack and short clean tail. No voice, no music, no ambience.' },
    { id: 'sfx_block', category: 'sfx', duration: 0.6, prompt: 'One isolated anime fighting-game guard block: tight metallic energy clink with a bass thump and bright brief spark. Immediate and concise. No voices, no music, no ambience.' },
    { id: 'sfx_special', category: 'sfx', duration: 1.2, prompt: 'One isolated anime arcade energy projectile release: quick rising electrical charge followed by a powerful rushing blast and sparkling decay. Immediate start, compact clean tail. No voice, no music, no ambience.' },
    ...config.fighters.map(fighter => ({ id: `fighter_${fighter.id}_special`, category: 'voice', fighter: fighter.id,
      prompt: announcer + (fighter.specialMove?.name || 'Special attack') + '!',
      characterDescription: fighter.description, specialMove: fighter.specialMove })),
    ...config.fighters.flatMap((fighter, index) => fighter.introTagline ? [{ id: `fighter_${fighter.id}_intro`, category: 'voice', fighter: fighter.id,
      prompt: '[confident, energetic anime tournament fighter, crisp delivery] ' + fighter.introTagline,
      voice: fighter.introVoice || INTRO_VOICES[index % INTRO_VOICES.length], introTagline: fighter.introTagline,
      characterDescription: fighter.description, specialMove: fighter.specialMove }] : []),
  ].map(job => ({ ...job, kind: 'audio', model: job.category === 'music' ? 'SoniloTextToMusic' : job.category === 'sfx' ? 'ElevenLabsTextToSoundEffects' : 'ElevenLabsTextToSpeech' }));
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
  const root = node('DFZAssetRoot', 'Shared game asset root (same folder as images)', [-550, 180], [], [{ name: 'root', type: 'DFZ_ROOT', links: [] }],
    [rootDirectory || path.resolve(ROOT, config.assetRoot || 'output/assets/generated/game-pack'), JSON.stringify({ ...config, expectedAudio: jobs.map(job => job.id) }, null, 2)]);
  root.size = [470, 410];
  const exporter = node('DFZExportAudioManifest', 'Export audio.json after every track', [1550, 180], [{ name: 'root', type: 'DFZ_ROOT', link: null }], [{ name: 'manifest_path', type: 'STRING', links: null }]);
  exporter.size = [420, jobs.length * 25 + 130]; connect(root, exporter, 0, 'DFZ_ROOT');
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
      generation.widgets_values_named = { text: job.prompt, model: 'eleven_sfx_v2', 'model.duration': job.duration, 'model.loop': false, 'model.prompt_influence': 0.5, output_format: 'mp3_44100_192' };
    } else {
      generation.widgets_values_named = { text: job.prompt, stability: 0.45, apply_text_normalization: 'auto', model: 'eleven_v4', 'model.similarity_boost': 0.75, language_code: 'en', seed: 42, control_after_generate: 'fixed', output_format: 'mp3_44100_192' };
      connect(voiceFor(job), generation, generation.inputs.findIndex(input => input.name === 'voice'), 'ELEVENLABS_VOICE');
    }
    generation.widgets_values = Object.values(generation.widgets_values_named); nodes.push(generation);
    const save = node('DFZSaveAudio', `Save + map ${job.id}`, [640, 180 + index * 400],
      [{ name: 'audio', type: 'AUDIO', link: null }, { name: 'root', type: 'DFZ_ROOT', link: null }], [{ name: 'audio_asset', type: 'DFZ_AUDIO_ASSET', links: [] }], [JSON.stringify(audioRecord(job), null, 2)]);
    connect(generation, save, 0, 'AUDIO'); connect(root, save, 1, 'DFZ_ROOT');
    exporter.inputs.push({ name: `assets.audio_${index}`, type: 'DFZ_AUDIO_ASSET', link: null }); connect(save, exporter, exporter.inputs.length - 1, 'DFZ_AUDIO_ASSET');
  });
  const note = node('MarkdownNote', title, [-550, -250], [], [], [
    `# ${title}\n\n${jobs.length} paid cloud audio jobs. Music: Sonilo. Effects: ElevenLabs SFX. Announcer, move names and fighter intro taglines: Eleven v4. Each intro uses a distinct stock preset voice for a fictional performance; it does not imitate any real person. No local model weights and no voice cloning.\n\nSet Asset Root to the SAME folder as the image graph. Audio saves are PCM WAVs under raw/. The exporter writes audio.json only after every track finishes; assets.json remains unchanged. Load the full folder in the builder to include both maps.\n\nMusic is requested as loop-friendly; audition the joins before release. Preparing this workflow spends nothing. Running it requires cloud credits and spending authorization.`
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
module.exports = { makeAudioJobs, makeAudioGraph, audioRecord, prepareAudio };
