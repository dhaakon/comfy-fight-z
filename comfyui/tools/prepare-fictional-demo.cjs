// Prepare fictional text-only references and a separate game bundle. Never submit jobs.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {makeFactoryGraph, makeSheetTemplate, factoryCounts} = require('./prepare-factory-workflows.cjs');
const {makeAudioJobs, makeAudioGraph} = require('./prepare-audio-workflows.cjs');
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_RUN = 'output/test-runs/comfy-fictional-demo-20261103';
const RATES = {image1K:0.048048, image2K:0.072072, musicSecond:0.0025, effectMinute:0.14, speechThousandCharacters:0.1144};
const read = file => JSON.parse(fs.readFileSync(path.resolve(ROOT,file),'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n'); };

function referenceJobs(config) {
  if(config.demoSource!=='fictional-text-only'||config.fighters.length!==6||config.stages.length!==3) throw new Error('Expected six fictional fighters and three fictional environments.');
  return [...config.fighters.map(item=>({...item,category:'character',aspect:'2:3',resolution:'1K'})),
    ...config.stages.map(item=>({...item,category:'environment',aspect:'16:9',resolution:'2K'}))].map((item,index)=>{
      if(!/^[a-z0-9_-]+$/.test(item.id)||!item.referencePrompt?.trim()||!item.sourceImage.startsWith('comfyui/ref/demo/')||item.sourceInput!==`cfz-demo-${item.id}.png`) throw new Error('Invalid fictional reference definition.');
      return {id:item.id,name:item.name,category:item.category,prompt:item.referencePrompt,aspect:item.aspect,resolution:item.resolution,
        seed:112600+index,filenamePrefix:`comfy-fighter-z/demo-references/${item.id}`,sourceImage:item.sourceImage,sourceInput:item.sourceInput,
        estimatedUSD:item.resolution==='1K'?RATES.image1K:RATES.image2K};
    });
}

function makeReferencesGraph(config) {
  const jobs=referenceJobs(config), nodes=[], links=[];
  let nextId=0;
  jobs.forEach((job,index)=>{
    const x=(index%3)*980,y=Math.floor(index/3)*700;
    const named={prompt:job.prompt,model:config.model,'model.aspect_ratio':job.aspect,'model.resolution':job.resolution,
      'model.thinking_level':'MINIMAL',seed:job.seed,control_after_generate:'fixed',response_modalities:'IMAGE',
      system_prompt:'Generate exactly one original fictional game reference from the text. No real person, photograph, recognizable real venue, copied character, or image reference is supplied or requested.',temperature:1,top_p:.95};
    const generate={id:++nextId,type:'GeminiNanoBanana2V2',title:`Invent ${job.name} | text only`,pos:[x,y],size:[450,590],flags:{},order:nodes.length,mode:0,
      inputs:[],outputs:[{name:'IMAGE',type:'IMAGE',links:[]},{name:'STRING',type:'STRING',links:null},{name:'thought_image',type:'IMAGE',links:null}],
      properties:{'Node name for S&R':'GeminiNanoBanana2V2'},widgets_values:Object.values(named),widgets_values_named:named};
    const save={id:++nextId,type:'SaveImage',title:`Save fictional reference | ${job.id}`,pos:[x+480,y],size:[430,590],flags:{},order:nodes.length+1,mode:0,
      inputs:[{name:'images',type:'IMAGE',link:index+1}],outputs:[],properties:{'Node name for S&R':'SaveImage'},
      widgets_values:[job.filenamePrefix],widgets_values_named:{filename_prefix:job.filenamePrefix}};
    generate.outputs[0].links=[index+1];links.push([index+1,generate.id,0,save.id,0,'IMAGE']);nodes.push(generate,save);
  });
  nodes.push({id:++nextId,type:'MarkdownNote',title:'Fictional demo references',pos:[0,-330],size:[2860,250],flags:{},order:nodes.length,mode:0,inputs:[],outputs:[],properties:{},
    widgets_values:['# Invented demo cast and places\n\nNine text-only CLOUD image calls: six adult anime parent heroes and three fictional environments. No photographs or image inputs are connected. These outputs become the sample upload references. Review the nine images, copy them to the comfyui/ref/demo/ paths in plan.json, and upload each under its cfz-demo-<id>.png name before validating/running the separate game-art factory.\n\nOnly The Yard is enabled in the default game. The other two sample environments are available for later uploads; their main-template slots remain empty and disabled. Preparing this graph spends nothing. Running requires spending authorization.']});
  const hash=createHash('sha256').update('Comfy Fighter Z fictional text-only demo references').digest('hex');
  return {id:`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`,revision:0,last_node_id:nextId,last_link_id:links.length,
    nodes,links,groups:[],config:{},extra:{ds:{scale:.42,offset:[80,390]}},version:.4};
}

function configsForRun(config,runRoot) {
  const factory=structuredClone(config);factory.assetRoot=path.join(runRoot,'bundle');
  factory.fighters=factory.fighters.map(fighter=>({...fighter,sourceMode:'Upload reference'}));
  factory.stages=factory.stages.map((stage,index)=>index===0?{...stage,sourceMode:'Upload reference',enabled:true}:{...stage,sourceMode:'Upload reference',enabled:false,sourceImage:'',sourceInput:'',sampleSourceImage:stage.sourceImage,sampleSourceInput:stage.sourceInput});
  const game={...structuredClone(config),assetRoot:path.join(runRoot,'bundle'),stages:config.stages.filter((stage,index)=>index===0)};
  return {factory,game};
}

function fictionalAudioJobs(config) {
  return makeAudioJobs(config);
}

async function priceBadges() {
  const names=['GeminiNanoBanana2V2','SoniloTextToMusic','ElevenLabsTextToSoundEffects','ElevenLabsTextToSpeech'];
  const badges={};
  for(const name of names){
    const response=await fetch(`http://127.0.0.1:8188/object_info/${name}`);
    if(!response.ok)throw new Error(`Cannot verify installed price badge for ${name}.`);
    badges[name]=(await response.json())[name]?.price_badge;
    if(!badges[name])throw new Error(`No installed price badge for ${name}.`);
  }
  const expr=Object.values(badges).map(b=>b.expr).join('\n');
  for(const price of Object.values(RATES))if(!expr.includes(String(price)))throw new Error(`Installed price badge changed for ${price}; review the cost estimate before preparing a paid batch.`);
  return {checkedAt:new Date().toISOString(),source:'Live local ComfyUI object_info price_badge; these are estimates, not billing guarantees.',rates:RATES,badges};
}

async function prepare({configPath='comfyui/config/fictional-demo.json',out=DEFAULT_RUN}={}) {
  const config=read(configPath),runRoot=path.resolve(ROOT,out);
  if(!runRoot.startsWith(ROOT+path.sep))throw new Error('Use a run directory inside this project.');
  const prices=await priceBadges(),references=referenceJobs(config),{factory,game}=configsForRun(config,runRoot);
  const refGraph=makeReferencesGraph(config),factoryGraph=makeFactoryGraph(factory,{media:false}),audioJobs=fictionalAudioJobs(game);
  const templates={music:read('comfyui/workflows/templates/cloud-music.json'),sfx:read('comfyui/workflows/templates/cloud-sfx.json'),voice:read('comfyui/workflows/templates/cloud-voice.json')};
  const audioGraph=makeAudioGraph(audioJobs,game,templates,{rootDirectory:path.join(runRoot,'bundle'),title:'Comfy Fighter Z: fictional demo audio'});
  for(const node of audioGraph.nodes)if(node.type==='MarkdownNote')node.widgets_values=node.widgets_values.map(text=>text.replace('it does not imitate the photographed person','it does not imitate any real person'));
  const referenceCost=references.reduce((sum,job)=>sum+job.estimatedUSD,0),art=factoryCounts(factory);
  const audioCost=audioJobs.reduce((sum,job)=>sum+(job.category==='music'?RATES.musicSecond*job.duration:job.category==='sfx'?RATES.effectMinute*job.duration/60:RATES.speechThousandCharacters*job.prompt.length/1000),0);
  const plan={schema:'comfy-fighter-fictional-demo/v1',cloudOnly:true,paid:true,automaticSubmission:false,requiresSpendingAuthorization:true,
    config:configPath,runRoot,bundle:path.join(runRoot,'bundle'),referenceInputPolicy:'Text only; no real photographs or image references. Main art uses only the newly generated fictional sources.',
    phases:[{id:'references',workflow:'workflows/references.json',paidImages:references.length,estimatedUSD:referenceCost},
      {id:'game-art',workflow:'workflows/game-art.json',paidImages:art.paidImages,sourceSaves:art.sourceSaves,mappedImages:art.mappedAssets,estimatedUSD:art.estimatedUSD,requires:'Review and upload the generated fictional reference files first.'},
      {id:'audio',workflow:'workflows/audio.json',paidClips:audioJobs.length,estimatedUSD:audioCost}],
    total:{paidImages:references.length+art.paidImages,paidAudioClips:audioJobs.length,estimatedUSD:Number((referenceCost+art.estimatedUSD+audioCost).toFixed(6)),automaticPaidRetries:0},
    optionalRepairs:{maximumPaidCalls:4,requires:'Only after visual checks identify a defective sprite sheet and spending authorization explicitly includes bounded repairs.',model:config.model,resolution:'2K',estimatedUSD:4*RATES.image2K,
      maximumTotalUSD:Number((referenceCost+art.estimatedUSD+audioCost+4*RATES.image2K).toFixed(6)),acceptedIdentityUploadPattern:'cfz-demo-<fighter-id>-identity.png',workflowPattern:'workflows/repairs/<fighter-id>_<sheet>.json'},
    references,audioJobs,openingFilm:'Existing real-person film is not reused. No video generation is part of this batch.'};
  write(path.join(runRoot,'config-factory.json'),factory);write(path.join(runRoot,'config-game.json'),game);
  write(path.join(runRoot,'workflows/references.json'),refGraph);write(path.join(runRoot,'workflows/game-art.json'),factoryGraph);write(path.join(runRoot,'workflows/audio.json'),audioGraph);
  for(const fighter of config.fighters)for(const sheet of Object.keys(config.sheets)){
    const repairConfig={...factory,fighters:[{...fighter,acceptedReferenceInput:`cfz-demo-${fighter.id}-identity.png`}],assetRoot:path.join(runRoot,'repairs',`${fighter.id}_${sheet}`)};
    const repair=makeSheetTemplate(repairConfig);
    const settings=repair.nodes.find(node=>node.type==='CFZProjectSettings');
    settings.widgets_values_named.root_directory=repairConfig.assetRoot;
    settings.widgets_values=Object.values(settings.widgets_values_named);
    const sheetNode=repair.nodes.find(node=>node.type==='CFZSpriteSheet');sheetNode.widgets_values_named.sheet=sheet;sheetNode.widgets_values=[sheet];
    write(path.join(runRoot,'workflows/repairs',`${fighter.id}_${sheet}.json`),repair);
  }
  write(path.join(runRoot,'price-badges.json'),prices);write(path.join(runRoot,'plan.json'),plan);
  write(path.join(ROOT,'comfyui/workflows/demo/fictional-references.json'),refGraph);
  console.log(JSON.stringify({runRoot,plan:'plan.json',...plan.total,submitted:false}));
  return plan;
}
if(require.main===module){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){if(!['--config','--out'].includes(args[i])||!args[i+1])throw new Error('Usage: node comfyui/tools/prepare-fictional-demo.cjs [--config <json>] [--out <run folder>]');options[args[i]==='--config'?'configPath':'out']=args[++i];}
  prepare(options).catch(error=>{console.error(error.message);process.exitCode=1});
}
module.exports={referenceJobs,makeReferencesGraph,configsForRun,fictionalAudioJobs,prepare,RATES};
