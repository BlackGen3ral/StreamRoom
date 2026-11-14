using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace StreamRoom.App;

internal sealed record DiscordProtonProfile(string Interface, string Peer, string Routes, string Dns)
{
    public static DiscordProtonProfile Read(string path)
    {
        using var file = File.OpenRead(path);
        if (file.Length is 0 or > 8192) throw InvalidProfile();
        using var reader = new StreamReader(file);
        var sections = new Dictionary<string, Dictionary<string, string>>();
        Dictionary<string, string>? current = null;
        while (reader.ReadLine() is { } raw)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (line is "[Interface]" or "[Peer]")
            {
                current = new(StringComparer.OrdinalIgnoreCase);
                if (!sections.TryAdd(line, current)) throw InvalidProfile();
                continue;
            }
            var pair = line.Split('=', 2, StringSplitOptions.TrimEntries);
            if (current is null || pair.Length != 2 || !current.TryAdd(pair[0], pair[1])) throw InvalidProfile();
        }

        if (!sections.TryGetValue("[Interface]", out var local) || !sections.TryGetValue("[Peer]", out var remote))
            throw InvalidProfile();
        var privateKey = Key(local, "PrivateKey");
        var publicKey = Key(remote, "PublicKey");
        var psk = remote.ContainsKey("PresharedKey") ? $"PresharedKey = {Key(remote, "PresharedKey")}\n" : "";
        var addresses = IpList(local.GetValueOrDefault("Address"), withMask: true);
        var dns = IpList(local.GetValueOrDefault("DNS"), withMask: false);
        var endpoint = remote.GetValueOrDefault("Endpoint") ?? "";
        var match = Regex.Match(endpoint, @"^(?:\[([a-f0-9:]+)\]|([a-z0-9.-]+)):(\d{1,5})$", RegexOptions.IgnoreCase);
        if (!match.Success || !int.TryParse(match.Groups[3].Value, out var port) || port is < 1 or > 65535)
            throw InvalidProfile();
        var routes = IpList(remote.GetValueOrDefault("AllowedIPs"), withMask: true);
        if (!routes.Contains("0.0.0.0/0") || routes.Any(route => route is not ("0.0.0.0/0" or "::/0")))
            throw InvalidProfile();
        if (!int.TryParse(local.GetValueOrDefault("MTU", "1420"), out var mtu) || mtu is < 576 or > 1500)
            throw InvalidProfile();

        return new(
            $"[Interface]\nPrivateKey = {privateKey}\nAddress = {string.Join(", ", addresses)}\nDNS = {string.Join(", ", dns)}\nMTU = {mtu}",
            $"[Peer]\nPublicKey = {publicKey}\n{psk}Endpoint = {endpoint}",
            string.Join(", ", routes),
            string.Join(", ", dns.Select(ip => ip + (ip.Contains(':') ? "/128" : "/32"))));
    }

    // Control ranges used by the StreamFix revision shipped with the experiment.
    public string Build(string application, bool control = false) =>
        $"{Interface}\n\n{Peer}\nAllowedIPs = {(control ? "162.159.128.0/17, 1.1.1.1/32, " + Dns : Routes)}\nPersistentKeepalive = 25\n#@ws:AllowedApps = {application}\n";

    private static string Key(Dictionary<string, string> section, string name)
    {
        var value = section.GetValueOrDefault(name) ?? "";
        if (!Regex.IsMatch(value, @"^[A-Za-z0-9+/]{43}=$")) throw InvalidProfile();
        return value;
    }

    private static string[] IpList(string? value, bool withMask)
    {
        return (value ?? "").Split(',', StringSplitOptions.TrimEntries).Select(item =>
        {
            var parts = item.Split('/');
            if (parts.Length != (withMask ? 2 : 1) || parts[0].Contains('%') || !IPAddress.TryParse(parts[0], out var ip))
                throw InvalidProfile();
            if (!withMask) return ip.ToString();
            if (!int.TryParse(parts[1], out var mask) || mask < 0 || mask > (ip.AddressFamily == AddressFamily.InterNetwork ? 32 : 128))
                throw InvalidProfile();
            return $"{ip}/{mask}";
        }).Distinct().ToArray();
    }

    private static IOException InvalidProfile() => new("Perfil inválido. Baixe um arquivo WireGuard do Proton para Windows com um servidor dos EUA.");
}
