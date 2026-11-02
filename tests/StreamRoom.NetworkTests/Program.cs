using System.Text.Json;
using StreamRoom.App;
using StreamRoom.Core;

static void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }
const string payload = """
{"BackendState":"Running","AuthURL":"https://login.example/SECRET","PrivateKey":"SECRET","User":{"1":{"LoginName":"private@example.test"}},
"Self":{"TailscaleIPs":["100.64.1.2","fd7a:115c:a1e0::2","192.168.1.2"]},
"Peer":{"key1":{"HostName":"friend","Online":true,"Active":true,"CurAddr":"198.51.100.1:4000","Relay":"gru","TailscaleIPs":["100.65.1.3"]}}}
""";
var state = TailscaleSnapshot.Parse(payload);
Check(state.Connected && state.Addresses.Length == 2, "connected status filters actual Tailscale address ranges");
Check(state.Peers.Single().Route == "direct", "DERP home alone never overrides an active direct endpoint");
var safe = JsonSerializer.Serialize(state);
Check(!safe.Contains("SECRET") && !safe.Contains("example.test") && !safe.Contains("198.51.100"), "projection excludes tokens, identities and public endpoints");
Check(TailscaleSnapshot.Parse(payload.Replace("\"Active\":true", "\"Active\":false")).Peers[0].Route == "idle", "online idle peer is not falsely labeled relay");
Check(TailscaleSnapshot.Parse(payload.Replace("198.51.100.1:4000", "")).Peers[0].Route == "relay", "active DERP route is relay");
Check(TailscaleSnapshot.Parse(payload.Replace("\"Relay\":\"gru\"", "\"Relay\":\"gru\",\"PeerRelay\":\"endpoint\"")).Peers[0].Route == "relay", "peer relay is not labeled direct");
Check(!TailscaleSnapshot.Parse(payload.Replace("Running", "Stopped")).Connected, "stopped backend disconnects routes");
Check(TailscaleSnapshot.Parse(payload.Replace("\"Online\":true", "\"Online\":false")).Peers[0].Route == "disconnected", "offline peer is disconnected");
Check(!TailscaleSnapshot.Parse("{\"BackendState\":\"NeedsLogin\",\"AuthURL\":\"SECRET\"}").Connected, "missing Self at login never exposes AuthURL or throws");
Check(!TailscaleSnapshot.IsAddress("100.128.0.1") && !TailscaleSnapshot.IsAddress("1.1.1.1") && !TailscaleSnapshot.IsAddress("fd00::1"), "foreign addresses are rejected");
if (args is ["--verify-installer", var path])
{
    InstallerTrust.Verify(path); Check(true, "official installer has a valid Tailscale signature");
    var copy = Path.Combine(Path.GetTempPath(), "streamroom-tampered-" + Guid.NewGuid().ToString("N") + ".msi");
    try
    {
        File.Copy(path, copy); using (var file = File.Open(copy, FileMode.Open, FileAccess.ReadWrite)) { file.Position = file.Length / 2; var b = file.ReadByte(); file.Position--; file.WriteByte((byte)(b ^ 255)); }
        bool rejected = false; try { InstallerTrust.Verify(copy); } catch (IOException) { rejected = true; }
        Check(rejected, "modified installer is rejected before execution");
    }
    finally { File.Delete(copy); }
}
Console.WriteLine("No software installed and no account credentials used. Cross-network media test still required.");
if (args is ["--verify-zerotier-download", var officialMsi])
{
    var progress = new List<int>();
    await new ZeroTierDownload().DownloadAsync((percent, bytes) => { if (percent.HasValue) progress.Add(percent.Value); });
    Check(progress.Count > 1 && progress[^1] == 100 && progress.SequenceEqual(progress.Order()), "official ZeroTier download reports progress and verifies signature");
    InstallerTrust.Verify(officialMsi, zeroTier: true);
    var modified = Path.Combine(Path.GetTempPath(), "streamroom-zt-tampered-" + Guid.NewGuid().ToString("N") + ".msi");
    try
    {
        File.Copy(officialMsi, modified);
        using (var file = File.Open(modified, FileMode.Open, FileAccess.ReadWrite)) { file.Position = file.Length / 2; var b = file.ReadByte(); file.Position--; file.WriteByte((byte)(b ^ 255)); }
        var rejected = false; try { InstallerTrust.Verify(modified, zeroTier: true); } catch (IOException) { rejected = true; }
        Check(rejected, "modified ZeroTier installer rejected before launch");
    }
    finally { File.Delete(modified); }
}

var groupDirectory = Path.Combine(Path.GetTempPath(), "streamroom-group-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(groupDirectory);
try
{
    var server = Invitations.ValidateServer("https://example.org");
    var roomId = Guid.NewGuid().ToString();
    var invite = Invitations.Create(server, roomId, new string('a', 64));
    var group = new SavedGroupRoom(server.AbsoluteUri, roomId, new string('b', 64), invite, true);
    Check(SavedGroupRoom.Load(groupDirectory) is null, "no saved group on first launch");
    await group.SaveAsync(groupDirectory);
    Check(SavedGroupRoom.Load(groupDirectory) == group, "DPAPI restores saved owner credentials across reads");
    var bytes = File.ReadAllBytes(Path.Combine(groupDirectory, "group-room.dat"));
    Check(!System.Text.Encoding.UTF8.GetString(bytes).Contains(group.Token), "owner secret is encrypted on disk");
    var member = group with { Owner = false, Token = new string('a', 64) };
    await member.SaveAsync(groupDirectory);
    Check(SavedGroupRoom.Load(groupDirectory) == member, "saved member retains invitation access");
    bytes[bytes.Length / 2] ^= 255;
    File.WriteAllBytes(Path.Combine(groupDirectory, "group-room.dat"), bytes);
    var rejected = false;
    try { SavedGroupRoom.Load(groupDirectory); } catch (IOException) { rejected = true; }
    Check(rejected, "corrupted protected group access is rejected");
    SavedGroupRoom.Forget(groupDirectory);
    Check(SavedGroupRoom.Load(groupDirectory) is null, "forget removes local access only");
}
finally { File.Delete(Path.Combine(groupDirectory, "group-room.dat")); File.Delete(Path.Combine(groupDirectory, "group-room.dat.tmp")); Directory.Delete(groupDirectory); }
