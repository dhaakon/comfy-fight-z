const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../output/game');
if(!fs.existsSync(path.join(root,'index.html'))) throw new Error('Run npm run build first.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.flac':'audio/flac','.svg':'image/svg+xml','.mp4':'video/mp4'};
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  let pathname; try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  const file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);return res.end('Not found');}
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
    let start=0,end=stat.size-1,status=200;
    if(req.headers.range){
      const range=/^bytes=([0-9]*)-([0-9]*)$/.exec(req.headers.range);
      let valid=!!range && !!(range[1]||range[2]) && stat.size>0;
      if(valid){
        if(range[1]){start=Number(range[1]);end=range[2]?Number(range[2]):end;valid=Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<stat.size&&end>=start;end=Math.min(end,stat.size-1);}
        else{const suffix=Number(range[2]);valid=Number.isSafeInteger(suffix)&&suffix>0;start=Math.max(0,stat.size-suffix);}
      }
      if(!valid){res.writeHead(416,{...headers,'Content-Length':0,'Content-Range':'bytes */'+stat.size});return res.end();}
      status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size;headers['Content-Length']=end-start+1;
    }
    res.writeHead(status,headers);
    if(req.method==='HEAD'||stat.size===0)return res.end();
    fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
  });
});
const port=Number(process.env.PORT||8080);
server.listen(port,'127.0.0.1',()=>console.log(`Comfy Fighter Z: http://127.0.0.1:${port}`));
