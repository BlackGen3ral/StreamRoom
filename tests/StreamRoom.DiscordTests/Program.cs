using System.Net;
using System.Text;
using System.Text.Json;
using StreamRoom.App;

static void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}

static async Task<IOException> FailsAsync(DiscordProtonProfile profile, FakeProbe probe)
{
    try { await DiscordTunnelVerifier.VerifyAsync(profile, probe, _ => { }); }
    catch (IOException error) { return error; }
    throw new Exception("An unverified route was accepted.");
}

static DiscordProtonProfile Profile(int? mtu = 1420) => new(
    "[Interface]\nPrivateKey = " + new string('A', 43) + "=\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1" + (mtu is null ? "" : $"\nMTU = {mtu}"),
    "[Peer]\nPublicKey = " + new string('B', 43) + "=\nEndpoint = 203.0.113.1:51820",
    "0.0.0.0/0", "10.2.0.1/32");

var original = Profile();
var normal = new FakeProbe(Attempt.Success);
var verified = await DiscordTunnelVerifier.VerifyAsync(original, normal, _ => { });
Check(verified.Profile == original && verified.Address == FakeProbe.TunnelAddress, "successful normal tunnel retains the imported profile");
Check(normal.Started.Count == 1 && normal.StopCount == 1 && !normal.Active, "successful test disconnects its temporary tunnel");
Check(normal.Events.TakeWhile(item => !item.StartsWith("start:", StringComparison.Ordinal)).Count(item => item.StartsWith("read:", StringComparison.Ordinal)) >= 4,
    "both ordinary and copied executables are preflighted against both HTTPS endpoints");

var retry = new FakeProbe(Attempt.Tls35, Attempt.Success);
var progress = new List<string>();
var recovered = await DiscordTunnelVerifier.VerifyAsync(original, retry, progress.Add);
Check(retry.Started.Select(profile => profile.Mtu).SequenceEqual(new int?[] { 1420, 1280 }), "TLS transport failure retries once using smaller packets");
Check(retry.Events.IndexOf("stop:1") < retry.Events.IndexOf("start:2") && retry.StopCount == 2 && !retry.Active,
    "first tunnel is cleaned before retry and the recovered test is also disconnected");
Check(recovered.Profile.Mtu == 1280 && recovered.Address == FakeProbe.TunnelAddress && progress.Count > 0,
    "verified result carries the successful packet size and reports progress");
Check(recovered.Profile.Peer == original.Peer && recovered.Profile.Routes == original.Routes && recovered.Profile.Dns == original.Dns &&
      recovered.Profile.Interface.Replace("MTU = 1280", "MTU = 1420", StringComparison.Ordinal) == original.Interface,
    "recovery preserves keys, server, addresses, DNS and routes");
Check(recovered.Profile.Build("Discord").Contains("MTU = 1280", StringComparison.Ordinal) &&
      recovered.Profile.Build("Discord", control: true).Contains("MTU = 1280", StringComparison.Ordinal) &&
      recovered.Profile.Build("Discord").Contains("#@ws:AllowedApps = Discord", StringComparison.Ordinal) &&
      recovered.Profile.Build("Discord", control: true).Contains("#@ws:AllowedApps = Discord", StringComparison.Ordinal),
    "verified packet size applies to both Discord profiles without broadening the application filter");

foreach (var failure in new[] { Attempt.Timeout28, Attempt.Empty52, Attempt.Send55, Attempt.Receive56 })
{
    var probe = new FakeProbe(failure, Attempt.Success);
    var result = await DiscordTunnelVerifier.VerifyAsync(original, probe, _ => { });
    Check(probe.Started.Count == 2 && result.Profile.Mtu == 1280, $"{failure} has one bounded transport recovery");
}

var bothFail = new FakeProbe(Attempt.Tls35, Attempt.Tls35, Attempt.Success);
await FailsAsync(original, bothFail);
Check(bothFail.Started.Count == 2 && bothFail.StopCount == 2 && !bothFail.Active,
    "two failed checks never produce a verified result or a third attempt");

foreach (var failure in new[] { Attempt.SameAddress, Attempt.WrongCountry, Attempt.Certificate60, Attempt.CertificateIdentifier35, Attempt.DirectChanged, Attempt.DirectTransportFailure })
{
    var probe = new FakeProbe(failure, Attempt.Success);
    await FailsAsync(original, probe);
    Check(probe.Started.Count == 1 && probe.StopCount == 1 && !probe.Active,
        $"{failure} fails closed without a packet-size retry");
}

foreach (var isolated in new[] { false, true })
{
    var preflight = new FakeProbe(Attempt.Success) { PreflightFailureForIsolated = isolated };
    await FailsAsync(original, preflight);
    Check(preflight.Started.Count == 0 && preflight.StopCount == 0,
        $"failed {(isolated ? "copied" : "ordinary")} executable preflight never starts a VPN");
}

var mismatchedBaseline = new FakeProbe(Attempt.Success) { PreflightIsolatedAddress = "198.51.100.11" };
await FailsAsync(original, mismatchedBaseline);
Check(mismatchedBaseline.Started.Count == 0, "different preflight routes prevent all VPN changes");

foreach (var mtu in new[] { 1280, 1200 })
{
    var smaller = new FakeProbe(Attempt.Tls35, Attempt.Success);
    await FailsAsync(Profile(mtu), smaller);
    Check(smaller.Started.Count == 1 && Profile(mtu).TrySmallerPackets() is null,
        $"MTU {mtu} is never increased or retried");
}

var cleanup = new FakeProbe(Attempt.Tls35, Attempt.Success) { FailStop = true };
await FailsAsync(original, cleanup);
Check(cleanup.Started.Count == 1 && cleanup.StopCount == 1,
    "unconfirmed cleanup prevents starting another tunnel");

var successfulButUnclean = new FakeProbe(Attempt.Success) { FailStop = true };
await FailsAsync(original, successfulButUnclean);
Check(successfulButUnclean.Started.Count == 1 && successfulButUnclean.StopCount == 1,
    "a successful HTTPS sample is rejected when temporary-tunnel cleanup fails");

var startFailure = new FakeProbe(Attempt.Success) { FailStart = true };
await FailsAsync(original, startFailure);
Check(startFailure.Started.Count == 1 && startFailure.StopCount == 1,
    "failed startup still cleans its temporary tunnel");

var temporary = Path.Combine(Path.GetTempPath(), "streamroom-discord-regression-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temporary);
try
{
    var imported = Path.Combine(temporary, "fixture.conf");
    File.WriteAllText(imported, Profile(null).Build("fixture"));
    var withoutMtu = DiscordProtonProfile.Read(imported);
    Check(withoutMtu.Mtu is null && !withoutMtu.Build("Discord").Contains("MTU", StringComparison.Ordinal),
        "import keeps the provider default when MTU was omitted");
    var defaultSize = new FakeProbe(Attempt.Tls35, Attempt.Success);
    var recoveredDefault = await DiscordTunnelVerifier.VerifyAsync(withoutMtu, defaultSize, _ => { });
    Check(defaultSize.Started[0].Mtu is null && defaultSize.Started[1].Mtu == 1280 && recoveredDefault.Profile.Mtu == 1280,
        "provider-default packet size is retained first and adjusted only after a transport failure");
    File.WriteAllText(imported, original.Build("fixture"));
    Check(DiscordProtonProfile.Read(imported).Mtu == 1420, "explicit imported MTU is preserved");

    var saved = new SavedDiscordSetup("fixture.conf", recovered.Profile, true, false);
    saved.Save(temporary);
    var restored = SavedDiscordSetup.Load(temporary);
    Check(restored == saved && restored.Profile.Mtu == 1280 && !restored.Pending,
        "verified MTU persists through encrypted save and restart-style load");
    var protectedBytes = File.ReadAllBytes(Path.Combine(temporary, "discord-profile-v1.dat"));
    Check(!Encoding.UTF8.GetString(protectedBytes).Contains(new string('A', 43), StringComparison.Ordinal) &&
          !Encoding.UTF8.GetString(protectedBytes).Contains("203.0.113.1", StringComparison.Ordinal),
        "saved tunnel keys and server remain encrypted on disk");
    var fields = JsonSerializer.SerializeToElement(saved.Profile);
    Check(fields.GetProperty("Interface").GetString()!.Contains("MTU = 1280", StringComparison.Ordinal),
        "packet-size recovery remains represented in the existing Interface field");
}
finally
{
    foreach (var file in Directory.EnumerateFiles(temporary)) File.Delete(file);
    Directory.Delete(temporary);
}

Console.WriteLine("Only simulated probe responses and isolated temporary profile data were used; no VPN, Discord or user data was touched.");

enum Attempt { Success, Tls35, Timeout28, Empty52, Send55, Receive56, SameAddress, WrongCountry, Certificate60, CertificateIdentifier35, DirectChanged, DirectTransportFailure }

sealed class FakeProbe(params Attempt[] attempts) : IDiscordTunnelProbe
{
    public const string DirectAddress = "198.51.100.10";
    public const string TunnelAddress = "203.0.113.20";
    public List<DiscordProtonProfile> Started { get; } = [];
    public List<string> Events { get; } = [];
    public bool Active { get; private set; }
    public int StopCount { get; private set; }
    public bool? PreflightFailureForIsolated { get; init; }
    public string? PreflightIsolatedAddress { get; init; }
    public bool FailStop { get; init; }
    public bool FailStart { get; init; }

    public Task<DiscordProbeResult> ReadAsync(bool isolated, string url)
    {
        Events.Add($"read:{(Active ? "tunnel" : "preflight")}:{isolated}:{url}");
        if (!Active)
            return Task.FromResult(PreflightFailureForIsolated == isolated ? Failure(url, "curl 35") :
                Success(url, isolated ? PreflightIsolatedAddress ?? DirectAddress : DirectAddress, "BR"));
        var attempt = attempts[Math.Min(Started.Count - 1, attempts.Length - 1)];
        if (!isolated)
            return Task.FromResult(attempt switch
            {
                Attempt.DirectChanged => Success(url, "198.51.100.11", "BR"),
                Attempt.DirectTransportFailure => Failure(url, "curl 35"),
                _ => Success(url, DirectAddress, "BR")
            });
        return Task.FromResult(attempt switch
        {
            Attempt.Tls35 => Failure(url, "curl 35"),
            Attempt.Timeout28 => Failure(url, "curl 28"),
            Attempt.Empty52 => Failure(url, "curl 52"),
            Attempt.Send55 => Failure(url, "curl 55"),
            Attempt.Receive56 => Failure(url, "curl 56"),
            Attempt.Certificate60 => Failure(url, "curl 60"),
            Attempt.CertificateIdentifier35 => Failure(url, "curl 35 [0X80092013, CRYPT_E_REVOCATION_OFFLINE]"),
            Attempt.SameAddress => Success(url, DirectAddress, "US"),
            Attempt.WrongCountry => Success(url, TunnelAddress, "CA"),
            _ => Success(url, TunnelAddress, "US")
        });
    }

    public Task StartAsync(DiscordProtonProfile profile)
    {
        if (Active) throw new Exception("Attempted a second tunnel before cleaning the first.");
        Started.Add(profile);
        Events.Add($"start:{Started.Count}");
        Active = true;
        return FailStart ? Task.FromException(new IOException("simulated startup failure")) : Task.CompletedTask;
    }

    public Task StopAsync()
    {
        StopCount++;
        Events.Add($"stop:{Started.Count}");
        if (FailStop) return Task.FromException(new IOException("simulated cleanup failure"));
        Active = false;
        return Task.CompletedTask;
    }

    private static DiscordProbeResult Success(string url, string address, string country) => new(url, IPAddress.Parse(address), country, "");
    private static DiscordProbeResult Failure(string url, string error) => new(url, null, "", error);
}
