using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Win32;
using StreamRoom.Core;

namespace StreamRoom.App;

internal sealed class TailscaleService
{
    private static string? Executable()
    {
        var standard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tailscale", "tailscale.exe");
        if (File.Exists(standard)) return standard;
        // A custom official installation can be located from the system service,
        // never from PATH, the current directory, or a web-supplied path.
        using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\Tailscale");
        var image = (key?.GetValue("ImagePath") as string)?.Trim();
        if (image is null) return null;
        var end = image.StartsWith('"') ? image.IndexOf('"', 1) + 1 : image.IndexOf(".exe", StringComparison.OrdinalIgnoreCase) + 4;
        if (end < 4) return null;
        var path = Path.Combine(Path.GetDirectoryName(image[..end].Trim('"')) ?? "", "tailscale.exe");
        if (!Path.IsPathFullyQualified(path) || path.StartsWith(@"\\") || !File.Exists(path)) return null;
        try { InstallerTrust.Verify(path); return path; } catch { return null; }
    }
    private static async Task<string> RunAsync(string executable, params string[] arguments)
    {
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in arguments) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new IOException("Não foi possível consultar o Tailscale.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); }
        catch (TimeoutException) { try { process.Kill(); } catch (InvalidOperationException) { } throw new IOException("O Tailscale não respondeu. Abra o aplicativo e tente novamente."); }
        await stderr; // Drain without displaying or logging CLI output (it can contain login URLs).
        if (process.ExitCode != 0) throw new IOException("Abra o Tailscale e confira se está conectado à sua conta.");
        var output = await stdout;
        if (output.Length > 4 * 1024 * 1024) throw new IOException("Resposta do Tailscale muito grande.");
        return output;
    }
    public async Task<TailscaleSnapshot> StatusAsync()
    {
        var executable = Executable();
        if (executable is null) return TailscaleSnapshot.Missing;
        try { return TailscaleSnapshot.Parse(await RunAsync(executable, "status", "--json")); }
        catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        { return new(true, false, "Unavailable", [], []); }
    }
    public async Task<TailscaleSnapshot> ProbeAsync(string address)
    {
        var status = await StatusAsync();
        if (!status.Connected || !status.Peers.Any(p => p.Online && p.Addresses.Contains(address)) || !TailscaleSnapshot.IsAddress(address))
            throw new ArgumentException("Escolha um amigo conectado à sua rede Tailscale.");
        // The CLI itself attempts direct traversal. Its human-readable output is
        // intentionally ignored; route classification comes from status --json.
        try { await RunAsync(Executable()!, "ping", "--c=3", "--timeout=2s", "--until-direct=true", address); } catch (IOException) { }
        return await StatusAsync();
    }
    public void OpenClient()
    {
        var executable = Executable() ?? throw new IOException("Instale o Tailscale primeiro.");
        var gui = Path.Combine(Path.GetDirectoryName(executable)!, "tailscale-ipn.exe");
        if (!File.Exists(gui)) throw new IOException("Abra o Tailscale pelo menu Iniciar do Windows.");
        InstallerTrust.Verify(gui);
        Process.Start(new ProcessStartInfo(gui) { UseShellExecute = true });
    }
    public static void OpenInvitations() => Process.Start(new ProcessStartInfo("https://login.tailscale.com/admin/users") { UseShellExecute = true });

    // Called only after the native confirmation dialog returns Yes.
    public async Task InstallAsync()
    {
        if (Executable() is not null) return;
        var directory = Path.Combine(Path.GetTempPath(), "StreamRoom-Tailscale-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "tailscale.msi");
        var safeToDelete = true;
        try
        {
            using var handler = new HttpClientHandler { AllowAutoRedirect = false };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(5) };
            var uri = new Uri("https://dl.tailscale.com/stable/tailscale-setup-latest-amd64.msi");
            HttpResponseMessage? response = null;
            for (var attempt = 0; attempt < 5; attempt++)
            {
                response?.Dispose(); response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
                if ((int)response.StatusCode is not (301 or 302 or 303 or 307 or 308)) break;
                uri = new Uri(uri, response.Headers.Location ?? throw new IOException("Download oficial indisponível."));
                if (uri.Scheme != "https" || uri.Host is not ("dl.tailscale.com" or "pkgs.tailscale.com")) throw new IOException("Redirecionamento fora do servidor oficial bloqueado.");
            }
            using (response)
            {
                response!.EnsureSuccessStatusCode();
                using var cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(5));
                await using var input = await response.Content.ReadAsStreamAsync(cancellation.Token);
                await using var output = File.Create(path);
                var buffer = new byte[65536]; long total = 0; int length;
                while ((length = await input.ReadAsync(buffer, cancellation.Token)) > 0)
                {
                    if ((total += length) > 150 * 1024 * 1024) throw new IOException("Instalador excedeu o tamanho permitido.");
                    await output.WriteAsync(buffer.AsMemory(0, length), cancellation.Token);
                }
            }
            InstallerTrust.Verify(path);
            var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "msiexec.exe")) { UseShellExecute = true, Verb = "runas", Arguments = $"/i \"{path}\" /passive /norestart" };
            using var installer = Process.Start(start) ?? throw new IOException("Não foi possível iniciar o instalador.");
            safeToDelete = false;
            await installer.WaitForExitAsync().WaitAsync(TimeSpan.FromMinutes(15));
            safeToDelete = true;
            if (installer.ExitCode is not (0 or 3010 or 1641)) throw new IOException("Instalação não concluída. Você pode tentar novamente.");
        }
        finally
        {
            if (safeToDelete) { try { File.Delete(path); Directory.Delete(directory); } catch (IOException) { } }
        }
    }
}

internal static class InstallerTrust
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct FileInfo { public uint Size; public IntPtr Path, Handle, Subject; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct TrustData
    {
        public uint Size; public IntPtr Policy, Sip; public uint Ui, Revocation, Choice; public IntPtr File;
        public uint State; public IntPtr StateData, Url; public uint Flags, Context; public IntPtr SignatureSettings;
    }
    [DllImport("wintrust.dll", ExactSpelling = true)]
    private static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref TrustData data);
    public static void Verify(string path)
    {
        var name = Marshal.StringToCoTaskMemUni(path);
        var info = new FileInfo { Size = (uint)Marshal.SizeOf<FileInfo>(), Path = name };
        var pointer = Marshal.AllocCoTaskMem(Marshal.SizeOf<FileInfo>());
        Marshal.StructureToPtr(info, pointer, false);
        var data = new TrustData { Size = (uint)Marshal.SizeOf<TrustData>(), Ui = 2, Choice = 1, File = pointer, State = 1, Flags = 0x1000 };
        var action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
        try
        {
            if (WinVerifyTrust(new IntPtr(-1), ref action, ref data) != 0) throw new IOException("A assinatura digital do instalador não é válida.");
            // Loader supports certificates, not Authenticode MSI/PE containers.
            // WinVerifyTrust above verifies the file contents and trust chain.
#pragma warning disable SYSLIB0057
            using var cert = X509Certificate.CreateFromSignedFile(path);
#pragma warning restore SYSLIB0057
            if (!cert.Subject.Split(',').Any(part => part.Trim() is "O=Tailscale Inc." or "O=Tailscale Inc"))
                throw new IOException("O arquivo não foi assinado pela Tailscale.");
        }
        finally { data.State = 2; WinVerifyTrust(new IntPtr(-1), ref action, ref data); Marshal.FreeCoTaskMem(pointer); Marshal.FreeCoTaskMem(name); }
    }
}
