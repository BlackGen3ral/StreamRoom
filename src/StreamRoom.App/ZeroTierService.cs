using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StreamRoom.App;

// No account API or secret files: the official CLI owns local authentication.
internal sealed class ZeroTierService
{
    public string DetectedNetworkId { get; private set; } = "";
    public static async Task JoinAsync(string networkId)
    {
        if (!Regex.IsMatch(networkId, "\\A[0-9a-f]{16}\\z")) throw new ArgumentException("Rede inválida.");
        foreach (var arguments in new[] { new[] { "join", networkId }, new[] { "set", networkId, "allowDefault=false" }, new[] { "set", networkId, "allowGlobal=false" }, new[] { "set", networkId, "allowDNS=false" }, new[] { "set", networkId, "allowManaged=true" } })
        {
            var start = new ProcessStartInfo(Executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add("-q"); foreach (var argument in arguments) start.ArgumentList.Add(argument);
            using var process = Process.Start(start) ?? throw new IOException("Serviço indisponível.");
            var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
            try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
            catch (TimeoutException) { process.Kill(); throw new IOException("O serviço não respondeu."); }
            await output; await error;
            if (process.ExitCode != 0) throw new IOException("Não foi possível configurar a rede privada.");
        }
    }
    public static async Task RequestJoinAsync()
    {
        var network = NetworkId();
        var executable = Environment.ProcessPath ?? throw new IOException("Aplicativo indisponível.");
        var prefix = Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase) ? "\"" + Path.Combine(AppContext.BaseDirectory, "StreamRoom.dll") + "\" " : "";
        var start = new ProcessStartInfo(executable) { UseShellExecute = true, Verb = "runas", Arguments = prefix + "--zerotier-join " + network };
        using var helper = Process.Start(start) ?? throw new IOException("Autorização cancelada.");
        await helper.WaitForExitAsync().WaitAsync(TimeSpan.FromMinutes(2));
        if (helper.ExitCode != 0) throw new IOException("Conexão à rede não concluída. Atualize o estado e tente novamente.");
    }
    private static string Executable => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ZeroTier", "One", "zerotier-one_x64.exe");
    internal static string NetworkId()
    {
        var id = ZeroTierPreferences.Load().NetworkId;
        if (!ZeroTierPreferences.IsNetworkId(id)) throw new IOException("Informe a rede privada no StreamRoom antes de conectar.");
        return id;
    }
    private static async Task<JsonDocument> ReadAsync(string command)
    {
        var start = new ProcessStartInfo(Executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("-q"); start.ArgumentList.Add("-j"); start.ArgumentList.Add(command);
        using var process = Process.Start(start) ?? throw new IOException("Serviço indisponível.");
        var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8)); }
        catch (TimeoutException) { process.Kill(); throw new IOException("O serviço não respondeu."); }
        await errors;
        if (process.ExitCode != 0) throw new IOException("Sem acesso ao estado do serviço.");
        var json = await output;
        if (json.Length > 2 * 1024 * 1024) throw new IOException("Resposta inválida.");
        return JsonDocument.Parse(json);
    }
    public async Task<object> StatusAsync()
    {
        if (!File.Exists(Executable)) return new { installed = false, connected = false, state = "missing", addresses = Array.Empty<string>(), deviceId = "" };
        try
        {
            using var info = await ReadAsync("info"); using var networks = await ReadAsync("listnetworks");
            var networkId = ZeroTierPreferences.Load().NetworkId;
            if (networkId.Length == 0)
            {
                var privateNetworks = networks.RootElement.EnumerateArray().Where(n => n.TryGetProperty("type", out var type) && type.GetString() == "PRIVATE").ToArray();
                if (privateNetworks.Length == 1) networkId = privateNetworks[0].GetProperty("id").GetString() ?? "";
            }
            DetectedNetworkId = networkId;
            var node = info.RootElement.GetProperty("address").GetString();
            foreach (var network in networks.RootElement.EnumerateArray())
            {
                if (!network.TryGetProperty("id", out var id) || id.GetString() != networkId) continue;
                var state = network.GetProperty("status").GetString();
                var privateNetwork = network.GetProperty("type").GetString() == "PRIVATE";
                var addresses = network.GetProperty("assignedAddresses").EnumerateArray().Select(a => (a.GetString() ?? "").Split('/')[0]).Where(a => a.Length > 0).ToArray();
                // Refuse an overlay that changes Internet routing or DNS.
                var safe = !network.GetProperty("allowDefault").GetBoolean() && !network.GetProperty("allowGlobal").GetBoolean() && !network.GetProperty("allowDNS").GetBoolean();
                return new { installed = true, connected = state == "OK" && privateNetwork && safe && addresses.Length > 0, state = !privateNetwork || !safe ? "unsafe_configuration" : state, addresses = safe && privateNetwork ? addresses : [], deviceId = node };
            }
            return new { installed = true, connected = false, state = "not_joined", addresses = Array.Empty<string>(), deviceId = node };
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException or KeyNotFoundException or System.ComponentModel.Win32Exception)
        { return new { installed = true, connected = false, state = "unavailable_or_unconfigured", addresses = Array.Empty<string>(), deviceId = "" }; }
    }
}
