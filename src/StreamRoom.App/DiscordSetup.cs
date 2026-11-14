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
    private static readonly string DiscordRoot = Path.Combine(LocalData, "Discord");
    private static readonly string Vencord = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vencord");
    private static readonly string Patcher = Path.Combine(Vencord, "dist", "patcher.js");
    private static readonly HttpClient Downloads = new() { Timeout = TimeSpan.FromMinutes(2) };
    private DiscordProtonProfile? _profile;
    private string? _preparedDirectory;
    private bool _repairOnly;
    public bool IsPrepared => _preparedDirectory is not null;
    public string? ImportedFileName { get; private set; }

    public static bool Available => File.Exists(Path.Combine(Assets, "patcher.js")) && File.Exists(Path.Combine(Assets, "renderer.js"));

    public static void OpenProton() => Process.Start(new ProcessStartInfo("https://account.protonvpn.com/downloads") { UseShellExecute = true });

    public static bool RepairAvailable()
    {
        try { return CanRepair() && File.Exists(Path.Combine(DiscordResources(), "app.asar")); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
    }

    private static bool CanRepair() => File.Exists(Patcher) &&
        File.ReadAllText(Patcher).Contains("StreamFix", StringComparison.Ordinal) &&
        File.Exists(Path.Combine(Vencord, "dist", "renderer.js")) &&
        File.Exists(Path.Combine(Vencord, "settings", "settings.json"));

    public async Task PrepareAsync(bool repairOnly, Action<int, string> progress)
    {
        DiscardPreparation();
        if (repairOnly && !CanRepair()) throw new IOException("Configure o StreamFix neste PC antes de usar o reparo.");
        if (!repairOnly && _profile is null) throw new IOException("Importe o arquivo .conf primeiro.");
        var resources = DiscordResources();
        if (!IsPatched(Path.Combine(resources, "app.asar"), Patcher)) EnsureUnmodified(resources);
        var scratch = Directory.CreateDirectory(Path.Combine(LocalData, "StreamRoom", "DiscordSetup", Guid.NewGuid().ToString("N"))).FullName;
        try
        {
            if (!repairOnly && !File.Exists(WireSock)) await InstallWireSockAsync(scratch, progress);
            progress(60, "Verificando o instalador oficial do Vencord…");
            await DownloadVencordInstallerAsync(scratch);
            _repairOnly = repairOnly;
            _preparedDirectory = scratch;
        }
        finally
        {
            if (_preparedDirectory != scratch) CleanScratch(scratch);
        }
    }

    public void DiscardPreparation()
    {
        var directory = _preparedDirectory;
        _preparedDirectory = null;
        if (directory is not null) CleanScratch(directory);
    }

    public async Task<object> ApplyAndRestartAsync(bool enableQuality, Action<int, string> progress)
    {
        var scratch = _preparedDirectory ?? throw new IOException("Prepare a configuração primeiro.");
        var repairOnly = _repairOnly;
        var restart = false;
        var exitRefreshed = false;
        if (!repairOnly)
        {
            progress(5, "Verificando a conexão do WireSock…");
            await CheckWireSockAsync(releaseSavedProfile: false);
        }
        try
        {
            var resources = DiscordResources();
            var asar = Path.Combine(resources, "app.asar");
            var installer = Path.Combine(scratch, "VencordInstallerCli.exe");
            await using (var file = File.OpenRead(installer))
                if (Convert.ToHexString(await SHA256.HashDataAsync(file)) != InstallerHash)
                    throw new IOException("O instalador preparado não passou na verificação. Prepare novamente.");
            if (!IsPatched(asar, Patcher)) EnsureUnmodified(resources);
            if (repairOnly && !CanRepair()) throw new IOException("Os arquivos do StreamFix não estão mais disponíveis.");
            var verifiedExit = repairOnly ? await ReadActiveDiscordExitAsync() : null;

            progress(12, "Fechando o Discord para aplicar a configuração…");
            restart = true;
            await DiscordRestart.CloseAsync(DiscordRoot);
            RequireClosedDiscord();
            resources = DiscordResources();
            asar = Path.Combine(resources, "app.asar");
            if (repairOnly)
            {
                progress(65, "Reaplicando o Vencord à versão atual do Discord…");
                if (!IsPatched(asar, Patcher))
                {
                    EnsureUnmodified(resources);
                    await PatchDiscordAsync(installer, asar);
                }
                if (verifiedExit is not null)
                    exitRefreshed = await RefreshSavedDiscordExitAsync(verifiedExit.Value.Profile, verifiedExit.Value.Address);
            }
            else await ConfigureAsync(resources, scratch, installer, enableQuality, progress);
            if (!IsPatched(asar, Patcher))
                throw new IOException("Não consegui confirmar o Vencord na versão atual do Discord.");
        }
        catch (Exception ex) when (restart)
        {
            if (!TryReopenDiscord()) throw new IOException(ex.Message + " Abra o Discord manualmente para voltar.", ex);
            throw;
        }
        finally { DiscardPreparation(); }

        progress(95, "Abrindo o Discord…");
        return new { repairOnly, reopened = TryReopenDiscord(), exitRefreshed };
    }

    private static async Task<(string Profile, string Address)?> ReadActiveDiscordExitAsync()
    {
        if (!File.Exists(WireSock)) return null;
        var settings = Path.Combine(Vencord, "settings", "settings.json");
        var configuration = JsonNode.Parse(await File.ReadAllTextAsync(settings));
        var plugin = configuration?["plugins"]?["StreamFix"] as JsonObject;
        var profile = plugin?["perfilDoTunel"]?.GetValue<string>();
        if (profile is null || !Regex.IsMatch(profile, @"^(?:streamfix-proton|streamroom-discord-[a-f0-9]{32})$"))
            return null;
        string status;
        try { status = await WireSockAsync("status"); }
        catch (IOException) { return null; }
        var active = Regex.Match(status, @"^Connected to server using profile ([a-zA-Z0-9-]+)\r?$", RegexOptions.Multiline);
        var exit = Regex.Match(status, @"^External address: ([0-9.]+), United States(?:,|\r?$)", RegexOptions.Multiline);
        if (!active.Success || active.Groups[1].Value != profile ||
            !IPAddress.TryParse(exit.Groups[1].Value, out var address) || address.AddressFamily != AddressFamily.InterNetwork)
            return null;
        return (profile, address.ToString());
    }

    private static async Task<bool> RefreshSavedDiscordExitAsync(string profile, string address)
    {
        var settings = Path.Combine(Vencord, "settings", "settings.json");
        var configuration = JsonNode.Parse(await File.ReadAllTextAsync(settings));
        var plugin = configuration?["plugins"]?["StreamFix"] as JsonObject;
        if (plugin?["perfilDoTunel"]?.GetValue<string>() != profile ||
            plugin["enderecoDaSaida"]?.GetValue<string>() == address)
            return false;
        plugin["enderecoDaSaida"] = address;
        var pending = settings + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(pending, configuration!.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            RequireClosedDiscord();
            File.Move(pending, settings, overwrite: true);
            return true;
        }
        finally { File.Delete(pending); }
    }

    private static bool TryReopenDiscord()
    {
        try
        {
            if (DiscordRestart.IsRunning(DiscordRoot)) return true;
            var executable = Path.Combine(Path.GetDirectoryName(DiscordResources())!, "Discord.exe");
            using var process = Process.Start(new ProcessStartInfo(executable)
            {
                UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(executable)!
            });
            return process is not null;
        }
        catch (Exception ex) when (ex is Win32Exception or IOException or UnauthorizedAccessException) { return false; }
    }

    public object PickProfile(System.Windows.Window owner)
    {
        var dialog = new OpenFileDialog { Filter = "Perfil WireGuard (*.conf)|*.conf", CheckFileExists = true };
        if (dialog.ShowDialog(owner) != true) return new { imported = false, fileName = "" };
        var profile = DiscordProtonProfile.Read(dialog.FileName);
        DiscardPreparation();
        _profile = profile;
        ImportedFileName = Path.GetFileName(dialog.FileName);
        return new { imported = true, fileName = ImportedFileName };
    }

    private async Task ConfigureAsync(string resources, string scratch, string installer, bool enableQuality, Action<int, string> progress)
    {
        var profile = _profile ?? throw new IOException("Importe o arquivo .conf primeiro.");
        var id = Guid.NewGuid().ToString("N");
        var full = $"streamroom-discord-{id}";
        var control = full + "-controle";
        var imported = new List<string>();
        try
        {
            progress(40, "Testando a saída dos EUA e o filtro por aplicativo…");
            await CheckWireSockAsync(releaseSavedProfile: true);
            var egress = await VerifyProtonAsync(profile, scratch, id);

            progress(65, "Importando os perfis do Discord…");
            foreach (var name in new[] { full, control })
            {
                imported.Add(name);
                await ImportAsync(scratch, name, profile.Build("Discord", name == control));
            }
            progress(80, "Guardando um backup e configurando o StreamFix…");
            await ConfigureVencordAsync(resources, installer, full, egress, enableQuality);
            _profile = null;
            ImportedFileName = null;
        }
        catch
        {
            foreach (var name in imported) await DeleteProfileAsync(name);
            throw;
        }
    }

    private static async Task InstallWireSockAsync(string scratch, Action<int, string> progress)
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

    internal static bool IsWireSockDisconnected(string status) =>
        Regex.IsMatch(status.Trim(), @"^(?:Not\s*connected|Disconnected)\.?$", RegexOptions.IgnoreCase);

    private static async Task CheckWireSockAsync(bool releaseSavedProfile)
    {
        var status = (await WireSockAsync("status")).Trim();
        if (IsWireSockDisconnected(status)) return;
        if (Regex.IsMatch(status, @"^Disconnecting\.?$", RegexOptions.IgnoreCase))
        {
            await WaitForWireSockDisconnectAsync();
            return;
        }
        var settings = Path.Combine(Vencord, "settings", "settings.json");
        var config = File.Exists(settings) ? JsonNode.Parse(await File.ReadAllTextAsync(settings)) : null;
        var profile = config?["plugins"]?["StreamFix"]?["perfilDoTunel"]?.GetValue<string>();
        var active = Regex.Match(status, @"^(?:Connected to server|Establishing connection) using profile ([a-zA-Z0-9-]+)\r?$", RegexOptions.Multiline | RegexOptions.IgnoreCase).Groups[1].Value;
        if (profile is not null && (profile.StartsWith("streamfix-", StringComparison.Ordinal) || profile.StartsWith("streamroom-discord-", StringComparison.Ordinal))
            && (active == profile || active == profile + "-controle"))
        {
            if (!releaseSavedProfile) return;
            await WireSockAsync("disconnect");
            await WaitForWireSockDisconnectAsync();
            return;
        }
        if (active.Length == 0 && !Regex.IsMatch(status, @"^(?:Connected|Connecting)(?:\s|\.|$)", RegexOptions.IgnoreCase))
            throw new IOException("O StreamRoom não conseguiu confirmar o estado do WireSock. Abra o WireSock Secure Connect, confira se está desconectado e tente novamente.");
        throw new IOException("Há uma conexão ativa no WireSock. No WireSock Secure Connect, desligue o botão da VPN, espere aparecer Desconectado e tente aplicar novamente.");
    }

    private static async Task WaitForWireSockDisconnectAsync()
    {
        var timeout = Stopwatch.StartNew();
        do
        {
            if (IsWireSockDisconnected(await WireSockAsync("status"))) return;
            await Task.Delay(300);
        }
        while (timeout.Elapsed < TimeSpan.FromSeconds(4));
        throw new IOException("O WireSock ainda não desconectou. Desligue o botão da VPN, aguarde o estado Desconectado e tente aplicar novamente.");
    }

    private static void CleanScratch(string scratch)
    {
        try { Directory.Delete(scratch, recursive: true); } catch (IOException) { }
    }

    private static string DiscordResources()
    {
        if (!Directory.Exists(DiscordRoot)) throw new IOException("Instale e abra o Discord para Windows uma vez antes de configurar.");
        return Directory.EnumerateDirectories(DiscordRoot, "app-*")
            .Where(app => File.Exists(Path.Combine(app, "Discord.exe")) && File.Exists(Path.Combine(app, "resources", "app.asar")))
            .OrderByDescending(app => Version.TryParse(Path.GetFileName(app)[4..], out var version) ? version : new Version())
            .Select(app => Path.Combine(app, "resources")).FirstOrDefault()
            ?? throw new IOException("Não encontrei uma instalação compatível do Discord estável para Windows.");
    }

    private static void RequireClosedDiscord()
    {
        if (DiscordRestart.IsRunning(DiscordRoot))
            throw new IOException("O Discord voltou a abrir durante a configuração. Saia dele pela bandeja do Windows e tente aplicar novamente.");
    }

    private static async Task ConfigureVencordAsync(string resources, string preparedInstaller, string profile, string egress, bool enableQuality)
    {
        var asar = Path.Combine(resources, "app.asar");
        var settings = Path.Combine(Vencord, "settings", "settings.json");
        var dist = Path.Combine(Vencord, "dist");
        RequireClosedDiscord();
        var installed = IsPatched(asar, Patcher);
        if (!installed) EnsureUnmodified(resources);

        var configuration = File.Exists(settings) ? JsonNode.Parse(await File.ReadAllTextAsync(settings)) as JsonObject : new JsonObject();
        if (configuration is null) throw new IOException("Não foi possível ler as configurações do Vencord.");
        var plugins = configuration["plugins"] as JsonObject ?? new JsonObject();
        if (plugins.Parent is null) configuration["plugins"] = plugins;
        plugins["StreamFix"] = new JsonObject
        {
            ["enabled"] = true, ["perfilDoTunel"] = profile, ["enderecoDaSaida"] = egress,
            ["exigirTunel"] = true, ["tunelCompletoSempre"] = false
        };
        if (enableQuality)
        {
            var fakeNitro = plugins["FakeNitro"] as JsonObject ?? new JsonObject();
            fakeNitro["enabled"] = true;
            fakeNitro["enableStreamQualityBypass"] = true;
            if (fakeNitro.Parent is null) plugins["FakeNitro"] = fakeNitro;
        }
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
        var installer = installed ? null : preparedInstaller;
        RequireClosedDiscord();
        var patched = false;
        try
        {
            Directory.CreateDirectory(dist);
            Directory.CreateDirectory(Path.GetDirectoryName(settings)!);
            foreach (var bundle in bundles) File.Copy(bundle, Path.Combine(dist, Path.GetFileName(bundle)), overwrite: true);
            await File.WriteAllTextAsync(settings, configuration.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            if (installer is not null)
            {
                EnsureUnmodified(resources);
                await PatchDiscordAsync(installer, asar);
                patched = true;
            }
            if (!bundles.All(file => SHA256.HashData(File.ReadAllBytes(file)).SequenceEqual(
                    SHA256.HashData(File.ReadAllBytes(Path.Combine(dist, Path.GetFileName(file)))))))
                throw new IOException("O Vencord substituiu os arquivos do StreamFix durante a configuração.");
        }
        catch
        {
            if (patched) RestoreDiscord(resources, asarBackup);
            foreach (var (file, saved) in copies)
                if (saved is null) File.Delete(file); else File.Copy(saved, file, overwrite: true);
            throw;
        }
    }

    private static async Task<string> DownloadVencordInstallerAsync(string directory)
    {
        var installer = Path.Combine(directory, "VencordInstallerCli.exe");
        await DownloadAsync(InstallerUrl, InstallerHash, installer);
        return installer;
    }

    private static async Task PatchDiscordAsync(string installer, string asar)
    {
        var resources = Path.GetDirectoryName(asar)!;
        if (!DiscordResources().Equals(resources, StringComparison.OrdinalIgnoreCase))
            throw new IOException("O Discord foi atualizado durante a configuração. Clique novamente para usar a versão nova.");
        // Give the official installer exactly one version. It otherwise selects by folder name.
        var target = Path.Combine(Path.GetDirectoryName(installer)!, "Discord");
        var appVersion = Path.GetFileName(Path.GetDirectoryName(resources));
        var stagedResources = Directory.CreateDirectory(Path.Combine(target, appVersion!, "resources")).FullName;
        var stagedAsar = Path.Combine(stagedResources, "app.asar");
        File.Copy(asar, stagedAsar);
        RequireClosedDiscord();
        await RunAsync(installer, ["-install", "-location", target], 45, devInstall: true);
        var stagedOriginal = Path.Combine(stagedResources, "_app.asar");
        if (!IsPatched(stagedAsar, Patcher) || !File.Exists(stagedOriginal))
            throw new IOException("O instalador do Vencord não preparou a versão atual do Discord.");
        RequireClosedDiscord();
        if (!DiscordResources().Equals(resources, StringComparison.OrdinalIgnoreCase))
            throw new IOException("O Discord foi atualizado durante a configuração. Clique novamente para usar a versão nova.");
        var original = Path.Combine(resources, "_app.asar");
        File.Copy(stagedOriginal, original);
        try { File.Move(stagedAsar, asar, overwrite: true); }
        catch { File.Delete(original); throw; }
    }

    private static void EnsureUnmodified(string resources)
    {
        var backup = Path.Combine(resources, "_app.asar");
        if (File.Exists(backup) || Directory.Exists(backup))
            throw new IOException("O Discord já usa outra modificação. Restaure a instalação original antes de continuar.");
    }

    private static void RestoreDiscord(string resources, string backup)
    {
        File.Copy(backup, Path.Combine(resources, "app.asar"), overwrite: true);
        File.Delete(Path.Combine(resources, "_app.asar"));
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
                    await WaitForWireSockDisconnectAsync();
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
