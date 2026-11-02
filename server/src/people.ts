import { DurableObject } from 'cloudflare:workers';
import { foldedName, verifyProfile } from './people-proof';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export class PeopleDirectory extends DurableObject<Env>{
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL,folded TEXT NOT NULL,avatar TEXT,listed INTEGER NOT NULL,updated INTEGER NOT NULL)');}
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url),sql=this.ctx.storage.sql;
    if(request.method==='GET'){
      const q=(url.searchParams.get('q')??'').trim();if(q.length<2||q.length>32)return reply({error:'Use de 2 a 32 caracteres na busca.'},400);
      const results=sql.exec('SELECT id,name,avatar FROM people WHERE listed=1 AND instr(folded,?)>0 ORDER BY name,id LIMIT 20',foldedName(q)).toArray();
      return reply({people:results});
    }
    if(request.method!=='POST'||request.headers.has('Origin')||!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Requisição inválida.'},400);
    let body:unknown;const reader=request.body?.getReader();if(!reader)return reply({error:'Perfil vazio.'},400);
    try{const chunks:Uint8Array[]=[];let count=0;for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>32768){await reader.cancel();return reply({error:'Perfil muito grande.'},413);}chunks.push(value);}const data=new Uint8Array(count);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}body=JSON.parse(new TextDecoder().decode(data));}catch{return reply({error:'Perfil inválido.'},400);}finally{reader.releaseLock();}
    const p=await verifyProfile(body);if(!p)return reply({error:'Não foi possível confirmar a autoria deste perfil. Confira o relógio do PC e tente novamente.'},401);
    // No awaits between checking the revision and applying the update.
    const previous=sql.exec<{updated:number;listed:number}>('SELECT updated,listed FROM people WHERE id=?',p.id).toArray()[0];
    if(previous&&previous.updated>=p.at)return reply({error:'Esta atualização de perfil já foi usada. Tente novamente.'},409);
    sql.exec('DELETE FROM people WHERE listed=0 AND updated<?',Date.now()-600000);
    if(p.listed&&!previous?.listed&&sql.exec<{count:number}>('SELECT count(*) AS count FROM people WHERE listed=1').one().count>=5000)return reply({error:'O diretório atingiu seu limite. Nenhum serviço pago será ativado.'},503);
    sql.exec('INSERT INTO people(id,name,folded,avatar,listed,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,folded=excluded.folded,avatar=excluded.avatar,listed=excluded.listed,updated=excluded.updated',p.id,p.listed?p.name:'',p.listed?foldedName(p.name):'',p.listed?p.avatar:null,p.listed?1:0,p.at);
    return reply({id:p.id,listed:p.listed});
  }
}
