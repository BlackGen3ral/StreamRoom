// Control-plane unit tests with test doubles. No media is encoded or called a real capture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RtcRoom } from '../../src/StreamRoom.App/Web/rtc-room.mjs';
class Peer {
  constructor(){this.connectionState='new';this.signalingState='stable';this.senders=[];this.addedIce=[];}
  addTrack(track){const sender={track,parameters:{encodings:[{}]},getParameters(){return structuredClone(this.parameters);},async setParameters(p){this.parameters=p;}};this.senders.push(sender);}
  getSenders(){return this.senders;}getTransceivers(){return [];}async createOffer(){return {type:'offer',sdp:'v=0'};}
  async createAnswer(){return {type:'answer',sdp:'v=0'};}
  async setLocalDescription(d){this.localDescription=d;this.signalingState=d.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(d){this.remoteDescription=d;this.signalingState=d.type==='answer'?'stable':'have-remote-offer';}
  async addIceCandidate(c){this.addedIce.push(c);}async getStats(){return new Map();}close(){this.connectionState='closed';}
}
globalThis.RTCPeerConnection=Peer;globalThis.RTCRtpSender={getCapabilities:()=>({codecs:[]})};
const id=()=>crypto.randomUUID(),ice={iceServers:[{urls:['stun:example.test']}]};
function setup(nativeExtra){
 const calls=[],a=id(),b=id(),c=id(),streamId=id(),incomingId=id(),send=id(),receive=id();
 const room=new RtcRoom(async(type,payload)=>{calls.push({type,payload});return nativeExtra?nativeExtra(type,payload):type==='ice'?ice:undefined;});
 room.enter({participantId:a,role:'viewer'});room.localId=streamId;
 const track={kind:'video',stopped:false,stop(){this.stopped=true;}};
 room.localStream={getTracks:()=>[track]};
 const state={participants:[{id:a,streamId},{id:b,streamId:incomingId},{id:c,streamId:id()}],
   subscriptions:[{publisherId:b,streamId:incomingId,subscriptionId:receive,height:480,fps:30}],
   subscribers:[{viewerId:b,publisherId:a,streamId,subscriptionId:send,height:480,fps:30}]};
 return {room,calls,a,b,c,track,state,streamId,incomingId,send,receive};
}
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('no viewers selected means zero outgoing peer connections',async()=>{
 const s=setup();s.room.updateRoom({...s.state,subscribers:[],subscriptions:[]});await settle();
 assert.equal(s.room.peers.size,0);assert.equal(s.calls.filter(c=>c.type==='signal').length,0);await s.room.shutdown();
});
test('member can send and receive from same person; stopping own capture preserves incoming peer',async()=>{
 const s=setup();s.room.updateRoom(s.state);await settle();
 await s.room.receiveSignal(s.b,{kind:'offer',streamId:s.incomingId,subscriptionId:s.receive,session:id(),sdp:'v=0'});
 assert.equal(s.room.peers.size,2);
 const receiver=s.room.peers.get(s.receive).pc,sender=s.room.peers.get(s.send).pc;
 await s.room.stopCapture();assert.equal(s.track.stopped,true);assert.equal(sender.connectionState,'closed');assert.notEqual(receiver.connectionState,'closed');
 assert.equal(s.room.peers.size,1);
 assert.ok(s.calls.some(c=>c.type==='stream'&&c.payload.active===false&&c.payload.streamId===s.streamId));
 await s.room.shutdown();
});
test('unsubscribing closes only that reception; ongoing publishing is retained',async()=>{
 const s=setup();s.room.updateRoom(s.state);await settle();
 await s.room.receiveSignal(s.b,{kind:'offer',streamId:s.incomingId,subscriptionId:s.receive,session:id(),sdp:'v=0'});
 const sender=s.room.peers.get(s.send).pc,receiver=s.room.peers.get(s.receive).pc;
 s.room.updateRoom({...s.state,subscriptions:[]});assert.equal(receiver.connectionState,'closed');assert.notEqual(sender.connectionState,'closed');
 assert.equal(s.track.stopped,false);await s.room.shutdown();
});
test('unsubscribe while ICE configuration is pending never creates a sending peer',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const s=setup(type=>type==='ice'?pending:undefined);
 s.room.updateRoom({...s.state,subscriptions:[]});s.room.updateRoom({...s.state,subscriptions:[],subscribers:[]});
 resolve(ice);await settle();assert.equal(s.room.peers.size,0);assert.equal(s.calls.some(c=>c.type==='signal'),false);await s.room.shutdown();
});
test('old stream/session ICE is ignored without affecting the other direction',async()=>{
 const s=setup();s.room.updateRoom(s.state);await settle();const session=id();
 await s.room.receiveSignal(s.b,{kind:'offer',streamId:s.incomingId,subscriptionId:s.receive,session,sdp:'v=0'});
 const peer=s.room.peers.get(s.receive),candidate={kind:'ice',streamId:id(),subscriptionId:s.receive,session,candidate:'candidate:test',sdpMid:'0',sdpMLineIndex:0};
 await s.room.receiveSignal(s.b,candidate);assert.equal(peer.pc.addedIce.length,0);
 await s.room.receiveSignal(s.b,{...candidate,streamId:s.incomingId,session:id()});assert.equal(peer.pc.addedIce.length,0);
 await s.room.receiveSignal(s.b,{...candidate,streamId:s.incomingId});assert.equal(peer.pc.addedIce.length,1);
 assert.ok(s.room.peers.has(s.send));await s.room.shutdown();
});

test('stable sender settings avoid encoder reconfiguration and failed changes are retried', async t => {
 const room=new RtcRoom(async()=>{});t.after(()=>room.shutdown());
 room.setOptions({quality:720,fps:60,upload:24,autoQuality:true});
 room.subscribers=[{subscriptionId:'stream',height:720,fps:60}];
 let calls=0,fail=false,last;
 const sender={track:{kind:'video'},getParameters:()=>({encodings:[{}]}),async setParameters(p){calls++;if(fail)throw Error('temporarily unavailable');last=p;}};
 const peer={key:'stream',budget:4_000_000,pc:{getSenders:()=>[sender]}};
 await room.configureSender(peer);await room.configureSender(peer);
 assert.equal(calls,1);
 await room.configureSender(peer,{bitrate:1_000_000,fps:30,scale:2});
 assert.equal(calls,2);assert.equal(last.encodings[0].maxFramerate,30);assert.equal(last.encodings[0].scaleResolutionDownBy,2);
 fail=true;await assert.rejects(room.configureSender(peer),/temporarily unavailable/);
 fail=false;await room.configureSender(peer);
 assert.equal(calls,4);assert.equal(last.encodings[0].maxFramerate,60);
});

test('native tracks keep native size and pacing without unsupported browser constraints',async t=>{
 const room=new RtcRoom(async()=>{});t.after(()=>room.shutdown());
 room.enter({participantId:id()});let stopped=false;
 const track={kind:'video',applyConstraints(){throw Error('Generator constraints are unsupported');},getSettings:()=>({width:1280,height:720}),stop(){stopped=true;}};
 const stream={getTracks:()=>[track],getVideoTracks:()=>[track],getAudioTracks:()=>[]};
 const bridge={name:'Monitor',start:async()=>stream,stop:async()=>{}};
 await room.startCapture({quality:720,fps:60,upload:24,audio:'none',autoQuality:true,nativeSource:{bridge,sourceId:'monitor-test'}});
 assert.equal(room.localStream,stream);assert.equal(track.contentHint,'motion');
 await room.stopCapture();assert.equal(stopped,true);
});

test('manual reconnect replaces only the selected subscription and rejects stale offers', async t => {
 const s=setup();t.after(()=>s.room.shutdown());s.room.updateRoom(s.state);await settle();
 await s.room.receiveSignal(s.b,{kind:'offer',streamId:s.incomingId,subscriptionId:s.receive,session:id(),sdp:'v=0'});
 const outgoing=s.room.peers.get(s.send),incoming=s.room.peers.get(s.receive);
 await s.room.watch(s.b,true,720,60,true);
 const request=s.calls.findLast(c=>c.type==='watch').payload;
 assert.notEqual(request.subscriptionId,s.receive);assert.equal(request.height,720);assert.equal(request.fps,60);
 assert.equal(incoming.pc.connectionState,'closed');assert.equal(s.room.peers.get(s.send),outgoing);assert.equal(s.track.stopped,false);
 s.room.updateRoom({...s.state,subscriptions:[{...s.state.subscriptions[0],subscriptionId:request.subscriptionId}]});await settle();
 await s.room.receiveSignal(s.b,{kind:'offer',streamId:s.incomingId,subscriptionId:s.receive,session:id(),sdp:'old'});
 assert.equal(s.room.peers.has(s.receive),false);
 await s.room.receiveSignal(s.b,{kind:'offer',streamId:s.incomingId,subscriptionId:request.subscriptionId,session:id(),sdp:'new'});
 assert.equal(s.room.peers.get(request.subscriptionId).pc.remoteDescription.sdp,'new');
});

test('failed connection diagnostics survive peer disposal and clear on leave', async t => {
 const s=setup();t.after(()=>s.room.shutdown());s.room.updateRoom(s.state);await settle();
 const peer=s.room.peers.get(s.send);peer.pc.iceConnectionState='failed';peer.pc.iceGatheringState='complete';
 peer.candidates.srflx=2;peer.remoteCandidates=3;peer.remotePublicCandidates=1;
 s.room.attempts.set(s.send,3);let last;
 s.room.addEventListener('stats',e=>last=e.detail);
 await s.room.recover(s.send);assert.equal(s.room.peers.has(s.send),false);
 await s.room.measure();const failure=last.find(r=>r.key===s.send);
 assert.equal(failure.failed,true);assert.equal(failure.candidates.srflx,2);assert.equal(failure.remoteCandidates,3);
 assert.equal(failure.gathering,'complete');assert.equal(failure.iceState,'failed');
 assert.equal('sdp' in failure,false);assert.equal('remoteDescription' in failure,false);
 await s.room.leave();assert.equal(s.room.failedConnections.size,0);assert.deepEqual(last,[]);
});
