# Monitor capture regression and performance

The original window-only, single-process bridge test did not cover monitor-sized GPU transfers, two application instances or a minimized sender. `scripts/test-monitor-media.ps1` adds that scenario using the production RtcRoom, signaling server, WGC source selection and direct P2P connections.

## Changes

- Use the DXGI adapter that owns the selected monitor (or the monitor containing the selected window), avoiding a capture through the other adapter on hybrid systems.
- When the source exceeds the selected quality, resize BGRA frames with the D3D11 video processor before CPU readback and WebView2 shared-memory transfer. Preserve aspect ratio; do not upscale. For a 1920x1080 monitor sent at 1280x720, transferred pixel bytes fall from 8,294,400 to 3,686,400 per frame.
- Reuse output/staging textures and pixel storage. Rebuild on source/quality size changes. Keep multithread protection on the shared immediate D3D11 context.
- Feed VideoFrame objects directly into a generated MediaStreamTrack when supported. This removes the canvas capture presentation clock from the normal path. Older runtimes retain the canvas path. The shared-memory ACK is sent only after the frame is copied/written; the one-frame limit still bounds latency.
- Native capture owns size/FPS limits. Do not apply browser capture constraints to generated tracks, which can reject them. The compatible capture path still applies its constraints.
- Disable background renderer/timer/occlusion throttling for this media app. The native Windows capture border is preserved. Audio capture, receiver subscriptions and STUN-only routing are unchanged.
- If the GPU video processor is unavailable, keep the existing software-readback path rather than stopping capture. This fallback can remain expensive for large monitors.

## Measured locally

Monitor source: 1920x1080, moving WPF scene, two separate app instances in a private room, real monitor WGC capture and real WebRTC encoding/decoding. The sender is closed to the tray for eight seconds between two visible phases (earlier measurements used minimization). This invokes the real Close handler and verifies that the native connection remains alive. Both processes use the same test WebView2 profile, independent of the normal user profile. The scene stays visible on the captured monitor throughout the test.

| Scenario | Previous build | Updated build |
| --- | --- | --- |
| 720p, 60 FPS requested | About 32-36 received FPS after warm-up | About 52-55 received FPS after warm-up |
| 1080p, 60 FPS requested | Not measured in this comparison | About 39-48 received FPS |
| Window WGC -> WebRTC | Existing regression | Passed; 297 frames decoded; 51 FPS reported in the final sample |
| GPU resize pixel check | No native resize | Passed; actual green pixels verified at 764x480 |

These are short local measurements on one Windows PC with AMD/NVIDIA adapters. They do not certify 1080p60, 4K source performance, audio synchronization, long sessions, five simultaneous media senders or internet performance. Low FPS on a static monitor is not itself a freeze; the moving test scene is necessary for this check. The test fails if samples after warm-up drop below 20 FPS.

## Run

An interactive Windows desktop with WebView2 and hardware WGC support is required. A moving test window will appear because the test must capture changing, visible screen pixels. The test creates a temporary private room through the configured production signaling endpoint. Media stays P2P between the two local instances; no relay is configured.

```powershell
./scripts/test-monitor-media.ps1 -Height 720
./scripts/test-monitor-media.ps1 -Height 1080
```

Use `-Dotnet <path-to-dotnet.exe>` if the SDK is installed outside PATH. JSON results and the temporary invitation are written under the per-run temp folder printed by the script. Do not publish the invitation file. Test-only native commands are enabled only with the explicit `--media-room-test` launch argument.

## Life is Strange monitor regression (0.4.14)

A 1920x1080 monitor at 1080p previously bypassed the native D3D readback path entirely: the GPU resize path only ran when the source exceeded the requested size. Equal-size frames now copy directly to a reusable staging texture, without the SoftwareBitmap and DataReader intermediate copies. Resized frames retain the existing video processor path; failure still falls back to SoftwareBitmap. Windows capture borders remain enabled and the picker explains their purpose.

Short live-game comparison on the same PC with two test instances, the game active and the sender closed to tray during part of the run:

- Published 0.4.13: 27-31 received FPS.
- Direct staging copy: 41-50 received FPS after warm-up (39-57 including startup).

These runs were sequential during live gameplay, not identical replay scenes or GPU saturation benchmarks; they do not guarantee 60 FPS. The user's 14 FPS case was not exactly reproduced. Audio was disabled for this comparison. No changes to P2P, audio or receiver subscriptions.

To test an existing game's monitor without covering it with the synthetic moving scene, set `STREAMROOM_TEST_MONITOR_WINDOW` to that currently observed window handle before running the media script. This override is consumed only inside explicit media-test commands. Bring the game back to the foreground after test processes start; repeat for each comparison build. Do not commit local window handles or invitation secrets.
