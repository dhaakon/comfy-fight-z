const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {makeGraph,makeJobs,makeBundleGraph}=require('../tools/prepare-workflows.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',p),'utf8'));
const config=read('config/game.json'), template=read('workflows/templates/cloud-image.json');
test('every plan asset has an importable name and right-facing 27-pose fighter contract',()=>{
  const jobs=makeJobs(config);
  assert.equal(new Set(jobs.map(j=>j.id)).size,jobs.length);
  for(const fighter of config.fighters) {
    const poses=jobs.filter(j=>j.fighter===fighter.id&&j.kind==='sprites').flatMap(j=>j.poses);
    assert.equal(poses.length,27); assert.equal(new Set(poses).size,27);
    assert.ok(poses.includes('stance2')); assert.ok(poses.includes('idle'));
  }
  for(const job of jobs) assert.equal(job.output,`assets/generated/raw/${job.id}.png`);
});
test('cloud packs wire the actual reference image into every derived asset',()=>{
  const jobs=makeJobs(config).filter(j=>j.fighter===config.fighters[0].id);
  const graph=makeGraph(jobs,config,template);
  const nodes=graph.nodes.filter(n=>n.type==='GeminiNanoBanana2V2');
  assert.equal(nodes.length,7);
  for(const node of nodes.slice(1)) {
    const input=node.inputs.find(i=>i.name==='model.images.image_1');
    const link=graph.links.find(l=>l[0]===input.link);
    assert.equal(link[1],nodes[0].id); assert.equal(link[3],node.id);
  }
  const executable=graph.nodes.filter(n=>n.type!=='MarkdownNote');
  assert.ok(executable.every(n=>['GeminiNanoBanana2V2','SaveImage','LoadImage'].includes(n.type)));
  const loader=graph.nodes.find(n=>n.type==='LoadImage');
  assert.equal(loader.widgets_values[0],config.fighters[0].sourceInput);
  const sourceLink=graph.links.find(l=>l[0]===nodes[0].inputs.find(i=>i.name==='model.images.image_1').link);
  assert.equal(sourceLink[1],loader.id);
});
test('named and positional widgets agree and repeat generation produces the same graph',()=>{
  const jobs=makeJobs(config), graph=makeGraph(jobs,config,template);
  for(const node of graph.nodes.filter(n=>n.type==='GeminiNanoBanana2V2')) assert.deepEqual(node.widgets_values,Object.values(node.widgets_values_named));
  assert.deepEqual(graph,makeGraph(jobs,config,template));
  for(const link of graph.links) {
    const from=graph.nodes.find(n=>n.id===link[1]),to=graph.nodes.find(n=>n.id===link[3]);
    assert.ok(from.outputs[link[2]].links.includes(link[0]));
    assert.equal(to.inputs[link[4]].link,link[0]);
  }
});
test('standalone derived asset requires an uploaded reference rather than regenerating identity',()=>{
  const job=makeJobs(config).find(j=>j.kind==='portrait');
  const graph=makeGraph([job],config,template,{externalReference:true});
  assert.equal(graph.nodes.filter(n=>n.type==='GeminiNanoBanana2V2').length,1);
  const loader=graph.nodes.find(n=>n.type==='LoadImage');
  assert.equal(loader.widgets_values[0],`${job.reference}.png`);
});
test('complete game graph maps all assets under one root and exports only after every save',()=>{
  const jobs=makeJobs(config), graph=makeBundleGraph(jobs,config,template);
  const root=graph.nodes.find(n=>n.type==='DFZAssetRoot');
  const output=graph.nodes.find(n=>n.type==='DFZExportManifest');
  const saves=graph.nodes.filter(n=>n.type==='DFZSaveAsset');
  assert.equal(graph.nodes.filter(n=>n.type==='GeminiNanoBanana2V2').length,jobs.filter(j=>j.kind!=='source').length);
  assert.equal(saves.length,jobs.length);assert.equal(output.inputs.length,jobs.length+1);
  assert.ok(path.isAbsolute(root.widgets_values[0]));
  assert.deepEqual(JSON.parse(root.widgets_values[1]).expectedAssets,jobs.map(j=>j.id));
  for(const [index,save] of saves.entries()) {
    const asset=JSON.parse(save.widgets_values[0]);assert.equal(asset.id,jobs[index].id);
    const rootLink=graph.links.find(l=>l[0]===save.inputs[1].link);assert.equal(rootLink[1],root.id);
    const mapLink=graph.links.find(l=>l[0]===output.inputs[index+1].link);assert.equal(mapLink[1],save.id);
    assert.equal(output.inputs[index+1].name,`assets.asset_${index}`);
    if(asset.kind==='sprites')assert.equal(asset.poses.length,9);
  }
});

test('Comfy Fighter Z preserves six source identities, one source venue and their special-move prompts',()=>{
  const jobs=makeJobs(config), graph=makeBundleGraph(jobs,config,template);
  assert.equal(config.title,'Comfy Fighter Z'); assert.equal(config.fighters.length,6);
  assert.deepEqual(config.stages.map(s=>s.id),['yard']);
  assert.equal(jobs.length,56); assert.equal(jobs.filter(j=>j.kind==='source').length,7);
  assert.equal(graph.nodes.filter(n=>n.type==='GeminiNanoBanana2V2').length,49);
  assert.equal(graph.nodes.filter(n=>n.type==='LoadImage').length,7);
  assert.equal(graph.nodes.filter(n=>n.type!=='MarkdownNote').length,114);
  for (const item of [...config.fighters,...config.stages]) {
    const source=jobs.find(j=>j.id===`${item.id}_source`);
    assert.equal(source.sourceImage,item.sourceImage); assert.equal(source.sourceInput,item.sourceInput);
    assert.equal(source.prompt,undefined); assert.equal(source.key,false);
    const target=jobs.find(j=>j.id===(config.fighters.includes(item)?`${item.id}_reference`:item.id));
    assert.equal(target.reference,source.id);
  }
  for (const fighter of config.fighters) for (const kind of ['reference','sprites','cutin']) {
    const selected=jobs.filter(j=>j.fighter===fighter.id&&j.kind===kind);
    assert.ok(selected.length>0);
    for(const job of selected) {
      assert.ok(job.prompt.includes(fighter.description));
      assert.ok(job.prompt.includes(fighter.specialMove.name));
      assert.ok(job.prompt.includes(fighter.specialMove.description));
    }
  }
  for(const id of ['title','select']) assert.equal(jobs.find(j=>j.id===id).reference,'yard');
});
