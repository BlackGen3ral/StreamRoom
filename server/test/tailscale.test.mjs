import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTailCandidate, tailDescription, tailscaleRoute } from '../../src/StreamRoom.App/Web/tailscale-routing.mjs';
const status={connected:true,addresses:['100.64.0.1'],peers:[{addresses:['100.64.0.2'],online:true,route:'direct'}]};
function reports(local='100.64.0.1',remote='100.64.0.2',state='succeeded',type='host') {
 return new Map([['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{state,localCandidateId:'l',remoteCandidateId:'r'}],['l',{candidateType:'host',address:local,protocol:'udp'}],['r',{candidateType:type,address:remote}]]);
}
test('only real host candidates on the known local Tailscale interface are preferred',()=>{
 assert.equal(localTailCandidate({type:'host',candidate:'candidate:1 1 udp 123 100.64.0.1 7777 typ host'},status),true);
 for(const address of ['100.64.9.9','192.168.1.2','foo.local'])assert.equal(localTailCandidate({type:'host',address},status),false);
 assert.equal(localTailCandidate({type:'srflx',address:'100.64.0.1'},status),false);
});
test('preference uses ordered trickle ICE without substituting addresses, ports or credentials',()=>{
 const sdp='v=0\r\na=ice-ufrag:keep\r\na=ice-pwd:keep-secret\r\na=candidate:1 1 udp 123 100.64.0.1 7777 typ host\r\na=end-of-candidates\r\n';
 assert.equal(tailDescription(sdp,false),sdp);
 assert.equal(tailDescription(sdp,true),'v=0\r\na=ice-ufrag:keep\r\na=ice-pwd:keep-secret\r\n');
});
test('a host/host ICE pair over a relayed Tailscale path is not labeled direct',()=>{
 const direct=tailscaleRoute(reports(),status);assert.equal(direct.confirmed,true);assert.equal(direct.label,'Tailscale · direta');
 const relay=tailscaleRoute(reports(),{...status,peers:[{...status.peers[0],route:'relay'}]});
 assert.equal(relay.confirmed,false);assert.equal(relay.overlayRelay,true);assert.equal(relay.relayed,false);assert.equal(relay.label,'Tailscale · relay');
});
test('foreign CGNAT ranges, unselected paths, missing stats and real TURN never become Tailscale',()=>{
 assert.equal(tailscaleRoute(reports('100.64.9.9'),status),null);
 assert.equal(tailscaleRoute(reports(undefined,'100.64.9.9'),status),null);
 assert.equal(tailscaleRoute(reports(undefined,undefined,'in-progress'),status),null);
 assert.equal(tailscaleRoute(reports(undefined,undefined,undefined,'relay'),status),null);
 assert.equal(tailscaleRoute(new Map(),status),null);
 assert.equal(tailscaleRoute(reports(),{...status,connected:false}).label,'Tailscale · desconectada');
 const unknown=tailscaleRoute(reports(),{...status,connected:false,state:'Unavailable'});
 assert.equal(unknown.label,'Tailscale · verificando rota');assert.equal(unknown.confirmed,false);
});
