# Discord VPN packet-size recovery

The friend reported the same `VPN-TLS: curl 35` on version 0.5.93 after
switching from US-FREE#77 to US-FREE#33. This does not establish a server-specific
problem or a Windows certificate problem. Cross-house Discord playback remains
unverified on that PC.

## Change

- Do not insert MTU 1420 when the imported provider configuration omits MTU.
- Test both system curl and the same isolated curl executable before starting a
  temporary tunnel. A process-specific failure now stops before VPN activation.
- After an eligible transport failure, disconnect and remove the first test
  profile, then retry once with MTU 1280. Existing explicit MTU values of 1280
  or less are never increased.
- Retain certificate checks, a changed US exit address, and an unchanged direct
  connection requirement. Route, country, certificate, and cleanup failures do
  not trigger packet-size recovery.
- Only use the successfully verified profile for both Discord profiles and the
  encrypted saved configuration. Failed attempts cannot mark setup complete.

WireSock documents that it does not perform path MTU discovery and that smaller
paths can prevent sites from opening. This supports a bounded recovery attempt;
it does not prove the cause of this user's error:
[official connection-profile documentation](https://wiresock.net/documentation/wiresock-secure-connect/connection-profiles.html).

## Validation performed

- Release build: zero warnings and zero errors.
- `tests/StreamRoom.DiscordTests`: 33 checks covering initial success,
  transport recovery, failed recovery, certificate and route rejection,
  cleanup ordering, preflight failure, existing small MTU, and encrypted
  save/load of the verified MTU. Included in GitHub Actions.
- Isolated subprocess harness exercised the actual curl argument construction,
  strict TLS 1.2 retry, certificate rejection, and sanitized Windows error codes.
- Live HTTPS checks compared system curl and a copied curl executable against
  both existing trace endpoints. No VPN was activated by these local checks.

The user's active VPN, Discord installation, and application data were not
changed during these tests.

## Required external validation

On the friend's updated app, reuse the saved US-FREE#33 profile and apply the
Discord configuration. On an eligible HTTPS failure, the assistant should show
the packet-size adjustment and retry automatically. Success means setup passes
the authenticated HTTPS and route checks, then applies Vencord/StreamFix.
Finally, validate a real Discord stream between the two houses. A successful
local build or simulated probe is not evidence that this external test passed.
