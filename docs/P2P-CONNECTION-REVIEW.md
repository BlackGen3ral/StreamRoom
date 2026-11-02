# Direct media connection review

## Evidence from the reported failed attempt

The receiver reported local/public candidates 1/2, three remote candidates including one public candidate, a remote description received, complete gathering, disconnected ICE and at least one STUN error. This demonstrates that signaling and public-candidate discovery were not completely unavailable. It does not establish symmetric NAT, CGNAT, a particular firewall rule or a specific code fault as the cause. One STUN error can coexist with successful discovery through another interface/server.

## Scope

Reviewed the end-to-end room/media path: invitation parsing, C# WebSocket signaling, native bridge command serialization, server subscriptions and signal routing, client offer/answer exchange, local/remote ICE buffering, retry lifetimes, generated capture tracks, quality settings and video presentation. Capture/audio code runs before media advertisement and does not select ICE routes. The server still supplies STUN only; relay is explicitly blocked on both server and client.

## Reproduced defects and fixes

1. **Buffered ICE could be overtaken by new ICE.** The previous flush spliced the buffered list and awaited each native send, while later candidates were sent immediately through another path. Under delayed sends, the observed order was first candidate, end-of-candidates, second candidate. Both paths now use one serialized queue. This preserves the order of discovery, including actual end-of-generation markers.
2. **Concurrent retries spent the retry budget twice.** A timer and a remote restart could call recover while the same peer was awaiting replacement. Both incremented attempts, although the creating guard permitted only one offer. Recovery is now guarded per peer. Timer callbacks also carry their originating peer, so a stale callback cannot restart its replacement.
3. **A null gathering event was synthesized into a global remote end marker.** Null is now ignored for signaling; actual empty-string generation markers retain their media identifiers and go through the ordered queue.

These are client changes compatible with the current signaling protocol and older peers. Tests intentionally reproduce delayed candidate sends and simultaneous recovery calls. No additional servers, costs, network configuration changes or relay credentials are introduced.

## Validation and limits

Unit tests cover ordering, preservation of generation markers, single retry accounting, stale recovery callbacks, isolated subscriptions, stale-session rejection and retained failure summaries. A real two-process WGC-to-WebRTC media test checks the full media path on one Windows computer, with the sender closed to tray during the run. Local success does not certify connectivity between the two reported home networks; the exact user's failure has not been reproduced on those networks.

Protocol reference: https://www.w3.org/TR/webrtc/#event-icecandidate
