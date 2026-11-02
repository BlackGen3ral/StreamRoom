import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WgcStream} from '../../src/StreamRoom.App/Web/wgc-stream.mjs';
test('a blocked writer returns native credits immediately, drops new frames and can stop',async()=>{
  const previous=globalThis.window,previousFrame=globalThis.VideoFrame;
  const acks=[],releases=[];let copied=0,complete;
  globalThis.window={chrome:{webview:{addEventListener(){},removeEventListener(){},releaseBuffer(b){releases.push(b);},postMessage(m){acks.push(m);}}}};
  globalThis.VideoFrame=class{constructor(){copied++;}close(){}};
  try{
    const calls=[],bridge=new WgcStream(async(type)=>calls.push(type),()=>assert.fail('capture ended'));
    bridge.active=true;bridge.session='capture';bridge.options={quality:1080};bridge.canvas={width:1920,height:1080};bridge.resolveFirst=()=>{};
    bridge.writer={desiredSize:1,write:()=>new Promise(resolve=>complete=resolve),abort:()=>new Promise(()=>{}),releaseLock(){}};
    bridge.stream={getTracks:()=>[]};
    const event=frame=>({additionalData:{type:'wgcFrame',session:'capture',frame,width:1920,height:1080},getBuffer:()=>new ArrayBuffer(4)});
    const pending=bridge.frame(event(1));await Promise.resolve();
    assert.equal(acks.length,1);assert.equal(releases.length,1);
    await bridge.frame(event(2));assert.equal(acks.length,2);assert.equal(copied,1);
    await bridge.stop();assert.ok(calls.includes('nativeCaptureStop'));assert.equal(bridge.active,false);
    complete();await pending;assert.equal(acks.length,2);
  }finally{globalThis.window=previous;globalThis.VideoFrame=previousFrame;}
});
