import { validAvatar, validName } from './profile.ts';
export type PublicProfile={id:string;name:string;avatar:string|null;listed:boolean;at:number;publicKey:string;signature:string};
export const foldedName=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
export const profileMessage=(p:PublicProfile)=>[p.id,p.name,p.avatar??'',p.listed?'1':'0',String(p.at)].join('\n');
export async function verifyProfile(value:unknown,now=Date.now()):Promise<PublicProfile|null>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;const p=value as PublicProfile;
  if(!validName(p.name)||p.name!==p.name.trim()||!validAvatar(p.avatar)||typeof p.listed!=='boolean'||!Number.isSafeInteger(p.at)||Math.abs(p.at-now)>300000
    ||typeof p.publicKey!=='string'||p.publicKey.length>256||typeof p.signature!=='string'||p.signature.length>128)return null;
  try{
    const bytes=Uint8Array.from(atob(p.publicKey),c=>c.charCodeAt(0));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    if(p.id!==id)return null;
    const key=await crypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Uint8Array.from(atob(p.signature),c=>c.charCodeAt(0)),new TextEncoder().encode(profileMessage(p))))return null;
    return {...p,avatar:p.avatar??null};
  }catch{return null;}
}
