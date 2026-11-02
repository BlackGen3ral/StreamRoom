import test from 'node:test';
import assert from 'node:assert/strict';
import {zeroTierCandidate,zeroTierRoute} from '../../src/StreamRoom.App/Web/zerotier-routing.mjs';
const snapshot={connected:true,addresses:['10.42.1.2']};
test('only actual assigned host addresses may leave the proof sender',()=>{
  assert.equal(zeroTierCandidate({type:'host',address:'10.42.1.2'},snapshot),true);
  for(const candidate of [{type:'srflx',address:'10.42.1.2'},{type:'relay',address:'10.42.1.2'},{type:'host',address:'10.42.1.3'},{type:'host',address:'candidate.local'}]) assert.equal(zeroTierCandidate(candidate,snapshot),false);
  assert.equal(zeroTierCandidate({type:'host',address:'10.42.1.2'},{...snapshot,connected:false}),false);
});
test('selected interface is verified without claiming direct overlay connectivity',()=>{
  const reports=new Map([['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{state:'succeeded',localCandidateId:'local',remoteCandidateId:'remote'}],['local',{candidateType:'host',address:'10.42.1.2',protocol:'udp'}],['remote',{candidateType:'host',address:'10.42.1.3'}]]);
  assert.equal(zeroTierRoute(reports,snapshot).overlayRoute,'unverified');
  assert.equal(zeroTierRoute(reports,snapshot).zeroTier,true);
  reports.get('local').address='192.168.1.2'; assert.equal(zeroTierRoute(reports,snapshot),null);
  reports.get('local').address='10.42.1.2';reports.get('remote').candidateType='relay';assert.equal(zeroTierRoute(reports,snapshot),null);
});
