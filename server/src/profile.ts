// Small, embedded JPEG thumbnails only. No arbitrary URLs, SVG, original files or metadata stores.
export function validAvatar(value: unknown): value is string | null | undefined {
  if (value === null || value === undefined) return true;
  if(typeof value==='string'&&value.startsWith('data:image/gif;base64,'))return validGif(value);
  const prefix = 'data:image/jpeg;base64,';
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith(prefix)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(prefix.length))) return false;
  let bytes: string;
  try { bytes = atob(value.slice(prefix.length)); } catch { return false; }
  const n = (offset: number) => bytes.charCodeAt(offset);
  if (bytes.length < 4 || n(0) !== 255 || n(1) !== 216 || n(bytes.length - 2) !== 255 || n(bytes.length - 1) !== 217) return false;
  for (let offset = 2; offset + 3 < bytes.length;) {
    if (n(offset++) !== 255) return false;
    while (offset < bytes.length && n(offset) === 255) offset++;
    if (offset + 2 >= bytes.length) return false;
    const marker = n(offset++), length = n(offset) * 256 + n(offset + 1);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker === 192 || marker === 194) {
      if (length < 8) return false;
      const height = n(offset + 3) * 256 + n(offset + 4), width = n(offset + 5) * 256 + n(offset + 6);
      return width >= 1 && width <= 128 && height >= 1 && height <= 128;
    }
    if (marker === 218 || marker === 217) return false;
    offset += length;
  }
  return false;
}
export function validGif(value:string):boolean {
  const encoded=value.slice(22);
  if(value.length>12000||!value.startsWith('data:image/gif;base64,')||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return false;
  let b:string;try{b=atob(encoded);}catch{return false;}
  const n=(p:number)=>b.charCodeAt(p),w=(p:number)=>n(p)|(n(p+1)<<8);
  if(b.length<14||b.slice(0,6)!=='GIF89a')return false;
  const width=w(6),height=w(8);let p=13,frames=0;
  if(width<1||width>128||height<1||height>128)return false;
  if(n(10)&128)p+=3*(1<<((n(10)&7)+1));
  const blocks=()=>{while(p<b.length){const size=n(p++);if(size===0)return true;if(p+size>b.length)return false;p+=size;}return false;};
  while(p<b.length){
    const kind=n(p++);
    if(kind===59)return frames>0&&p===b.length;
    if(kind===33){
      if(p>=b.length)return false;const label=n(p++);
      if(label===249){if(p+6>b.length||n(p)!==4||w(p+2)<10||n(p+5)!==0)return false;p+=6;}
      else if(label===255){if(p+12>b.length||n(p++)!==11||b.slice(p,p+11)!=='NETSCAPE2.0')return false;p+=11;if(!blocks())return false;}
      else return false;
    }else if(kind===44){
      if(p+9>b.length||++frames>12||w(p)!==0||w(p+2)!==0||w(p+4)!==width||w(p+6)!==height)return false;
      const flags=n(p+8);p+=9;if(flags&128)p+=3*(1<<((flags&7)+1));
      if(p>=b.length||n(p)<2||n(p)>8)return false;p++;if(!blocks())return false;
    }else return false;
  }
  return false;
}
export const validName = (value: unknown): value is string => typeof value === 'string'
  && value.trim().length >= 1 && value.trim().length <= 32 && !/[\u0000-\u001f\u007f]/.test(value);
