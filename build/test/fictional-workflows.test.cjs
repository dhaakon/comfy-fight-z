const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {referenceJobs,makeReferencesGraph,configsForRun,fictionalAudioJobs,RATES}=require('../../comfyui/tools/prepare-fictional-demo.cjs');
const {makeFactoryGraph,factoryCounts}=require('../../comfyui/tools/prepare-factory-workflows.cjs');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../../comfyui/config/fictional-demo.json'),'utf8'));

test('fictional references are nine text-only cloud jobs without photograph inputs',()=>{
 const jobs=referenceJobs(config),graph=makeReferencesGraph(config);
 assert.equal(jobs.length,9);assert.equal(jobs.filter(job=>job.resolution==='1K').length,6);
 assert.equal(jobs.filter(job=>job.resolution==='2K').length,3);
 assert.equal(new Set(jobs.map(job=>job.sourceInput)).size,9);
 assert.equal(graph.nodes.filter(node=>node.type==='GeminiNanoBanana2V2').length,9);
 assert.equal(graph.nodes.filter(node=>node.type==='SaveImage').length,9);
 assert.equal(graph.nodes.filter(node=>node.type==='LoadImage').length,0);
 for(const node of graph.nodes.filter(node=>node.type==='GeminiNanoBanana2V2')){
  assert.deepEqual(node.inputs,[]);
  assert.equal(node.widgets_values_named['model.thinking_level'],'MINIMAL');
  assert.deepEqual(node.widgets_values,Object.values(node.widgets_values_named));
  assert.ok(!Object.keys(node.widgets_values_named).some(key=>key.includes('image_')));
 }
 assert.ok(Math.abs(jobs.reduce((sum,job)=>sum+job.estimatedUSD,0)-(6*RATES.image1K+3*RATES.image2K))<1e-9);
});

test('main fictional factory uses six generated references and one stage, keeping optional slots blank',()=>{
 const {factory,game}=configsForRun(config,path.resolve(__dirname,'../../output/test-runs/fixture-only'));
 assert.equal(game.stages.length,1);assert.equal(game.stages[0].id,'yard');
 assert.deepEqual(factory.stages.map(stage=>[stage.enabled,!!stage.sourceInput]),[[true,true],[false,false],[false,false]]);
 assert.equal(factory.stages[1].sampleSourceInput,'cfz-demo-rooftop.png');
 assert.equal(factory.stages[2].sampleSourceInput,'cfz-demo-arcade.png');
 const graph=makeFactoryGraph(factory),counts=factoryCounts(factory);
 assert.equal(graph.nodes.filter(node=>node.type==='CFZCharacterFactory').length,6);
 assert.equal(graph.nodes.filter(node=>node.type==='CFZEnvironmentFactory').length,3);
 assert.equal(counts.paidImages,49);assert.equal(counts.mappedAssets,56);
 for(const node of graph.nodes.filter(node=>node.type==='CFZCharacterFactory'))assert.match(node.widgets_values_named.image,/^cfz-demo-/);
 assert.deepEqual(config.stages.map(stage=>!!stage.sourceInput),[true,true,true],'Preparing run does not erase sample definitions');
});

test('fictional audio follows configured identities, taglines and invented environment',()=>{
 const jobs=fictionalAudioJobs(config);
 assert.equal(jobs.length,22);
 const intros=jobs.filter(job=>job.id.endsWith('_intro'));
 assert.equal(intros.length,6);assert.equal(new Set(intros.map(job=>job.voice)).size,6);
 assert.match(jobs.find(job=>job.id==='yard_music').prompt,/fictional neighborhood backyard/);
 assert.ok(!JSON.stringify(jobs).includes('indoor coworking'));
 for(const fighter of config.fighters){
  assert.ok(jobs.find(job=>job.id===`fighter_${fighter.id}_special`).prompt.includes(fighter.specialMove.name));
  assert.ok(jobs.find(job=>job.id===`fighter_${fighter.id}_intro`).prompt.includes(fighter.introTagline));
 }
});
