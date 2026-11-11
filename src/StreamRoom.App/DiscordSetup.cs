using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace StreamRoom.App;

internal sealed class DiscordSetup
{
    private const string WireSockUrl = "https://wiresock.net/_api/download-release.php?platform=windows_x64&product=wiresock-secure-connect&version=3.8.2.1";
    private const string WireSockHash = "BB46770C2BE2AF619AA08BC0F53F430088317AF0E966192B653F91E1E8483504";
    private const string InstallerUrl = "https://github.com/Vencord/Installer/releases/download/v1.4.2/VencordInstallerCli.exe";
    private const string InstallerHash = "15268ABA25625797BF562187DD87DDADF42882E079C7B6192880AD3E83353EF5";
    private static readonly string Assets = Path.Combine(AppContext.BaseDirectory, "DiscordExperiment");
    private static readonly string WireSock = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        "WireSock Secure Connect", "command-line", "wiresock-connect-cli.exe");
    private static readonly string LocalData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private static readonly string Vencord = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vencord");
    private static readonly HttpClient Downloads = new() { Timeout = TimeSpan.FromMinutes(2) };
    private DiscordProtonProfile? _profile;

    public static bool Available => File.Exists(Path.Combine(Assets, "patcher.js")) && File.Exists(Path.Combine(Assets, "renderer.js"));

    public static void OpenProton() => Process.Start(new ProcessStartInfo("https://account.protonvpn.com/downloads") { UseShellExecute = true });

    public object PickProfile(System.Windows.Window owner)
    {
        var dialog = new OpenFileDialog { Filter = "Perfil WireGuard (*.conf)|*.conf", CheckFileExists = true };
        if (dialog.ShowDialog(owner) != true) return new { imported = false, fileName = "" };
        _profile = null;
        _profile = DiscordProtonProfile.Read(dialog.FileName);
        return new { imported = true, fileName = Path.GetFileName(dialog.FileName) };
    }

    public async Task ConfigureAsync(Action<int, string> progress)
    {
        var profile = _profile ?? throw new IOException("Importe o arquivo .conf primeiro.");
        var resources = DiscordResources();
        RequireClosedDiscord();
        var id = Guid.NewGuid().ToString("N");
        var full = $"streamroom-discord-{id}";
        var control = full + "-controle";
        var scratch = Directory.CreateDirectory(Path.Combine(LocalData, "StreamRoom", "DiscordSetup", id)).FullName;
        var imported = new List<string>();
        try
        {
            if (!File.Exists(WireSock))
            {
                progress(10, "Baixando o instalador oficial do WireSock…");
                var setup = Path.Combine(scratch, "WireSockSetup.exe");
                await DownloadAsync(WireSockUrl, WireSockHash, setup);
                InstallerTrust.Verify(setup, publisher: "The Anti-Cloud Corporation");
                progress(25, "Autorize a instalação do WireSock se o Windows perguntar…");
                try
                {
                    var start = new ProcessStartInfo(setup) { UseShellExecute = true, Verb = "runas" };
                    start.ArgumentList.Add("/passive");
                    start.ArgumentList.Add("/norestart");
                    using var installer = Process.Start(start)
                        ?? throw new IOException("Não foi possível abrir o instalador do WireSock.");
                    using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5));
                    await installer.WaitForExitAsync(timeout.Token);
                    if (installer.ExitCode is 1641 or 3010)
                        throw new IOException("O WireSock foi instalado. Reinicie o PC e importe o perfil novamente para continuar.");
                    if (installer.ExitCode != 0)
                        throw new IOException($"O instalador do WireSock retornou o código {installer.ExitCode}.");
                }
                catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
                {
                    throw new IOException("Instalação do WireSock cancelada no Windows.");
                }
                if (!File.Exists(WireSock)) throw new IOException("A instalação do WireSock não foi concluída.");
            }

            progress(40, "Testando a saída dos EUA e o filtro por aplicativo…");
            if (!(await WireSockAsync("status")).Trim().Equals("Not connected", StringComparison.OrdinalIgnoreCase))
                throw new IOException("Desconecte o WireSock antes de configurar o Discord.");
            var egress = await VerifyProtonAsync(profile, scratch, id);

            progress(65, "Importando os perfis do Discord…");
            foreach (var name in new[] { full, control })
            {
                imported.Add(name);
                await ImportAsync(scratch, name, profile.Build("Discord", name == control));
            }
            progress(80, "Guardando um backup e configurando o StreamFix…");
            await ConfigureVencordAsync(resources, scratch, full, egress);
            _profile = null;
            progress(100, "Configuração pronta. Abra o Discord e teste em um canal de voz.");
        }
        catch
        {
            foreach (var name in imported) await DeleteProfileAsync(name);
            throw;
        }
        finally
        {
            foreach (var file in Directory.EnumerateFiles(scratch))
                try { File.Delete(file); } catch (IOException) { }
            try { Directory.Delete(scratch); } catch (IOException) { }
        }
    }

    private static string DiscordResources()
    {
        var discord = Path.Combine(LocalData, "Discord");
        if (!Directory.Exists(discord)) throw new IOException("Instale e abra o Discord para Windows uma vez antes de configurar.");
        return Directory.EnumerateDirectories(discord, "app-*")
            .Where(app => File.Exists(Path.Combine(app, "Discord.exe")) && File.Exists(Path.Combine(app, "resources", "app.asar")))
            .OrderByDescending(app => Version.TryParse(Path.GetFileName(app)[4..], out var version) ? version : new Version())
            .Select(app => Path.Combine(app, "resources")).FirstOrDefault()
            ?? throw new IOException("Não encontrei uma instalação compatível do Discord estável para Windows.");
    }

    private static void RequireClosedDiscord()
    {
        var processes = Process.GetProcessesByName("Discord");
        foreach (var process in processes) process.Dispose();
        if (processes.Length > 0) throw new IOException("Saia do Discord pelo ícone ao lado do relógio e clique em Configurar novamente.");
    }

    private static async Task ConfigureVencordAsync(string resources, string scratch, string profile, string egress)
    {
        var asar = Path.Combine(resources, "app.asar");
        var originalAsar = Path.Combine(resources, "_app.asar");
        var settings = Path.Combine(Vencord, "settings", "settings.json");
        var dist = Path.Combine(Vencord, "dist");
        var patcher = Path.Combine(dist, "patcher.js");
        RequireClosedDiscord();
        var installed = IsPatched(asar, patcher);
        if (!installed && (File.Exists(originalAsar) || Directory.Exists(originalAsar)))
            throw new IOException("O Discord já usa outra modificação. Restaure a instalação original antes de continuar.");

        var configuration = File.Exists(settings) ? JsonNode.Parse(await File.ReadAllTextAsync(settings)) as JsonObject : new JsonObject();
        if (configuration is null) throw new IOException("Não foi possível ler as configurações do Vencord.");
        var plugins = configuration["plugins"] as JsonObject ?? new JsonObject();
        if (plugins.Parent is null) configuration["plugins"] = plugins;
        plugins["StreamFix"] = new JsonObject
        {
            ["enabled"] = true, ["perfilDoTunel"] = profile, ["enderecoDaSaida"] = egress,
            ["exigirTunel"] = true, ["tunelCompletoSempre"] = false
        };
        var bundles = Directory.GetFiles(Assets).Where(file => Path.GetFileName(file) is
            "patcher.js" or "preload.js" or "renderer.js" or "renderer.css" or "patcher.js.LEGAL.txt" or "renderer.js.LEGAL.txt" or
            "patcher.js.map" or "preload.js.map" or "renderer.js.map" or "renderer.css.map").ToArray();
        var backup = Directory.CreateDirectory(Path.Combine(LocalData, "StreamRoom", "DiscordSetup", "backups", profile)).FullName;
        var files = bundles.Select(file => Path.Combine(dist, Path.GetFileName(file))).Append(settings).ToArray();
        var copies = new Dictionary<string, string?>();
        foreach (var file in files)
        {
            var saved = File.Exists(file) ? Path.Combine(backup, Path.GetFileName(file)) : null;
            if (saved is not null) File.Copy(file, saved);
            copies.Add(file, saved);
        }
        var asarBackup = Path.Combine(backup, "app.asar");
        if (!installed) File.Copy(asar, asarBackup);
        var installer = Path.Combine(scratch, "VencordInstallerCli.exe");
        if (!installed) await DownloadAsync(InstallerUrl, InstallerHash, installer);
        RequireClosedDiscord();
        var patched = false;
        try
        {
            Directory.CreateDirectory(dist);
            Directory.CreateDirectory(Path.GetDirectoryName(settings)!);
            foreach (var bundle in bundles) File.Copy(bundle, Path.Combine(dist, Path.GetFileName(bundle)), overwrite: true);
            await File.WriteAllTextAsync(settings, configuration.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            if (!installed)
            {
                patched = true;
                await RunAsync(installer, ["-install", "-branch", "stable"], 45, devInstall: true);
            }
            if (!IsPatched(asar, patcher)) throw new IOException("O Discord não reconheceu o Vencord experimental.");
            if (!bundles.All(file => SHA256.HashData(File.ReadAllBytes(file)).SequenceEqual(
                    SHA256.HashData(File.ReadAllBytes(Path.Combine(dist, Path.GetFileName(file)))))))
                throw new IOException("O Vencord substituiu os arquivos do StreamFix durante a configuração.");
        }
        catch
        {
            if (patched)
            {
                File.Copy(asarBackup, asar, overwrite: true);
                File.Delete(originalAsar);
            }
            foreach (var (file, saved) in copies)
                if (saved is null) File.Delete(file); else File.Copy(saved, file, overwrite: true);
            throw;
        }
    }

    private static bool IsPatched(string asar, string patcher)
    {
        if (!File.Exists(asar) || new FileInfo(asar).Length > 1024 * 1024) return false;
        var content = Encoding.UTF8.GetString(File.ReadAllBytes(asar)).Replace("\\\\", "\\");
        return content.Contains(patcher, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string> VerifyProtonAsync(DiscordProtonProfile profile, string scratch, string id)
    {
        const string host = "www.cloudflare.com";
        var addresses = await Dns.GetHostAddressesAsync(host, AddressFamily.InterNetwork).WaitAsync(TimeSpan.FromSeconds(10));
        var address = addresses.FirstOrDefault() ?? throw new IOException("Não consegui consultar o endereço para testar a VPN.");
        var args = new[] { "-4fsS", "--noproxy", "*", "--max-time", "7", "--resolve", $"{host}:443:{address}", $"https://{host}/cdn-cgi/trace" };
        var curl = Path.Combine(Environment.SystemDirectory, "curl.exe");
        var probe = $"sr-wg-probe-{id}";
        var executable = Path.Combine(scratch, probe + ".exe");
        File.Copy(curl, executable);
        var baseline = ReadTrace(await RunAsync(curl, args, 9));
        var connected = false;
        try
        {
            await ImportAsync(scratch, probe, profile.Build(probe));
            connected = true;
            var log = await RunAsync(WireSock, ["connect", probe, "-log-level", "info", "-exit"], 18);
            if (!Regex.IsMatch(log, $@"AllowedApps\s*=\s*{probe}(?:\.exe)?(?=[""\s])", RegexOptions.IgnoreCase))
                throw new IOException("O WireSock não confirmou o filtro de aplicativos. O túnel foi encerrado.");
            var tunneled = ReadTrace(await RunAsync(executable, args, 9));
            var direct = ReadTrace(await RunAsync(curl, args, 9));
            if (tunneled.Country != "US" || tunneled.Ip.Equals(baseline.Ip) || !direct.Ip.Equals(baseline.Ip))
                throw new IOException("Não consegui confirmar a saída dos EUA só para o aplicativo de teste. Desconecte outras VPNs ou tente outro servidor gratuito dos EUA.");
            return tunneled.Ip.ToString();
        }
        finally
        {
            try
            {
                if (connected)
                {
                    await WireSockAsync("disconnect");
                    if (!(await WireSockAsync("status")).Trim().Equals("Not connected", StringComparison.OrdinalIgnoreCase))
                        throw new IOException("Confirme que o WireSock está desconectado antes de tentar novamente.");
                }
            }
            finally { await DeleteProfileAsync(probe); }
        }
    }

    private static (IPAddress Ip, string Country) ReadTrace(string response)
    {
        var value = Regex.Match(response, @"^ip=(.+)$", RegexOptions.Multiline).Groups[1].Value.Trim();
        if (!IPAddress.TryParse(value, out var ip) || ip.AddressFamily != AddressFamily.InterNetwork)
            throw new IOException("Não consegui verificar o IP de saída da VPN.");
        return (ip, Regex.Match(response, @"^loc=([A-Z]{2})\r?$", RegexOptions.Multiline).Groups[1].Value);
    }

    private static async Task ImportAsync(string directory, string name, string contents)
    {
        var file = Path.Combine(directory, name + ".conf");
        try
        {
            await File.WriteAllTextAsync(file, contents);
            await WireSockAsync("import", file);
            if (!(await WireSockAsync("list")).Split('\n').Any(line => line.Trim() == "- " + name))
                throw new IOException("O WireSock não reconheceu o perfil importado.");
        }
        finally { File.Delete(file); }
    }

    private static async Task DeleteProfileAsync(string name)
    {
        try { await WireSockAsync("delete", name); } catch (IOException) { }
    }

    private static Task<string> WireSockAsync(params string[] args) => RunAsync(WireSock, args, 8);

    private static async Task<string> RunAsync(string file, IEnumerable<string> args, int seconds, bool devInstall = false)
    {
        var start = new ProcessStartInfo(file) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        if (devInstall)
        {
            start.Environment["VENCORD_USER_DATA_DIR"] = Vencord;
            start.Environment["VENCORD_DEV_INSTALL"] = "1";
        }
        using var process = Process.Start(start) ?? throw new IOException("Não foi possível iniciar um componente da configuração.");
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw new IOException("Um componente demorou para responder. Se acabou de instalar o WireSock, reinicie o PC e tente novamente.");
        }
        if (process.ExitCode != 0) throw new IOException($"{Path.GetFileName(file)} encontrou um erro. Confira se o Discord e outras VPNs estão fechados.");
        return (await output) + "\n" + (await errors);
    }

    private static async Task DownloadAsync(string url, string sha256, string destination)
    {
        using var response = await Downloads.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        const int maxBytes = 30 * 1024 * 1024;
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        await using var source = await response.Content.ReadAsStreamAsync(timeout.Token);
        await using var file = new FileStream(destination, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
        var buffer = new byte[64 * 1024];
        int read;
        while ((read = await source.ReadAsync(buffer, timeout.Token)) > 0)
        {
            if (file.Length + read > maxBytes) throw new IOException("O instalador excede o tamanho esperado.");
            await file.WriteAsync(buffer.AsMemory(0, read), timeout.Token);
        }
        file.Position = 0;
        if (!Convert.ToHexString(await SHA256.HashDataAsync(file, timeout.Token)).Equals(sha256, StringComparison.OrdinalIgnoreCase))
            throw new IOException("A verificação de integridade do instalador falhou.");
    }
}
