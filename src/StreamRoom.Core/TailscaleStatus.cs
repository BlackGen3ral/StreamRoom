using System.Net;
using System.Text.Json;

namespace StreamRoom.Core;

public sealed record TailscalePeer(string Name, string[] Addresses, bool Online, string Route);
public sealed record TailscaleSnapshot(bool Installed, bool Connected, string State, string[] Addresses, TailscalePeer[] Peers)
{
    // Only a small projection leaves the native process. Never expose AuthURL,
    // user identities, node keys, public endpoints, or the original CLI document.
    public static TailscaleSnapshot Missing => new(false, false, "NotInstalled", [], []);
    public static bool IsAddress(string value)
    {
        if (!IPAddress.TryParse(value, out var ip)) return false;
        var bytes = ip.GetAddressBytes();
        return bytes.Length == 4 ? bytes[0] == 100 && bytes[1] is >= 64 and <= 127
            : bytes[0] == 0xfd && bytes[1] == 0x7a && bytes[2] == 0x11 && bytes[3] == 0x5c && bytes[4] == 0xa1 && bytes[5] == 0xe0;
    }
    private static string Text(JsonElement value, string key) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    private static bool Flag(JsonElement value, string key) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True;
    private static string[] AddressesOf(JsonElement value) => value.TryGetProperty("TailscaleIPs", out var ips) && ips.ValueKind == JsonValueKind.Array
        ? ips.EnumerateArray().Where(v => v.ValueKind == JsonValueKind.String).Select(v => v.GetString()!).Where(IsAddress).Distinct().ToArray() : [];
    public static TailscaleSnapshot Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new JsonException("Estado Tailscale inválido.");
        var state = Text(root, "BackendState");
        var addresses = root.TryGetProperty("Self", out var self) && self.ValueKind == JsonValueKind.Object ? AddressesOf(self) : AddressesOf(root);
        var connected = state == "Running" && addresses.Length > 0 && !Flag(self, "Expired");
        var peers = new List<TailscalePeer>();
        if (root.TryGetProperty("Peer", out var all) && all.ValueKind == JsonValueKind.Object)
            foreach (var property in all.EnumerateObject())
            {
                var peer = property.Value;
                if (peer.ValueKind != JsonValueKind.Object) continue;
                var ips = AddressesOf(peer);
                if (ips.Length == 0) continue;
                var online = connected && Flag(peer, "Online") && !Flag(peer, "Expired");
                var route = !online ? "disconnected" : !Flag(peer, "Active") ? "idle"
                    : Text(peer, "PeerRelay").Length > 0 ? "relay"
                    : Text(peer, "CurAddr").Length > 0 ? "direct"
                    : Text(peer, "Relay").Length > 0 ? "relay" : "unknown";
                peers.Add(new(Text(peer, "HostName")[..Math.Min(64, Text(peer, "HostName").Length)], ips, online, route));
            }
        return new(true, connected, state is "Running" or "Stopped" or "Starting" or "NeedsLogin" or "NeedsMachineAuth" ? state : "Unavailable", addresses, peers.Take(100).ToArray());
    }
}
