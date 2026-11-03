import {test} from 'node:test';import assert from 'node:assert/strict';import {CameraShare} from '../../src/StreamRoom.App/Web/camera-share.mjs';
function setup(getUserMedia){const calls=[],track={kind:'video',readyState:'live',stop(){this.readyState='ended';}},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const room={localStream:{id:'screen'},run:1,peers:new Map(),participants:[],native:async t=>calls.push(t),event:(type,detail)=>calls.push({type,detail}),notice:()=>{},validPeer:()=>true,configureSender:async()=>{},signal:async(p,s)=>calls.push(s)};
 const camera=new CameraShare(room);const descriptor=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:getUserMedia??(async options=>{assert.equal(options.audio,false);return stream;})},configurable:true});
 return {room,camera,calls,track,stream,restore(){if(descriptor)Object.defineProperty(navigator,'mediaDevices',descriptor);else delete navigator.mediaDevices;}};
}
test('camera start and stop retain the screen and use no microphone',async()=>{
 const s=setup(),screen=s.room.localStream,replaced=[];s.room.peers.set('out',{direction:'send',sent:true,cameraSender:{async replaceTrack(t){replaced.push(t);}}});
 try{await s.camera.start();assert.equal(s.camera.stream,s.stream);assert.equal(s.room.localStream,screen);await s.camera.stop();assert.equal(s.track.readyState,'ended');assert.equal(s.camera.stream,null);assert.deepEqual(replaced,[s.track,null]);assert.ok(s.calls.includes('cameraPermissionEnd'));assert.equal(s.room.localStream,screen);}finally{s.restore();}
});
test('stopping a camera request before it resolves releases the resulting device',async()=>{
 let release;const s=setup(()=>new Promise(r=>release=r));
 try{const request=s.camera.start();await Promise.resolve();await Promise.resolve();await s.camera.stop();release(s.stream);await request;assert.equal(s.camera.stream,null);assert.equal(s.track.readyState,'ended');}finally{s.restore();}
});
test('old viewers do not receive an extra video slot',async()=>{
 const s=setup();try{await s.camera.reserve({id:'old',pc:{addTransceiver(){throw Error('Old client must not receive camera');}}});}finally{s.restore();}
});
