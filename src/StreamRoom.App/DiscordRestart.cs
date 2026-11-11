using System.ComponentModel;
using System.Diagnostics;
using System.IO;

namespace StreamRoom.App;

internal static class DiscordRestart
{
    public static bool IsRunning(string root)
    {
        var processes = Process.GetProcessesByName("Discord");
        try { return processes.Any(process => IsInstalledProcess(process, root)); }
        finally { foreach (var process in processes) process.Dispose(); }
    }

    public static async Task CloseAsync(string root)
    {
        var processes = Process.GetProcessesByName("Discord");
        try
        {
            var installed = processes.Where(process => IsInstalledProcess(process, root)).ToArray();
            if (installed.Length == 0) return;

            foreach (var process in installed)
            {
                try { if (!process.HasExited) process.CloseMainWindow(); }
                catch (InvalidOperationException) when (process.HasExited) { }
            }
            if (await WaitAsync(installed, TimeSpan.FromSeconds(2))) return;

            // Discord can minimize to the tray when it receives the normal close request.
            // Only stop processes whose executable belongs to this user's Discord installation.
            foreach (var process in installed)
            {
                try { if (!process.HasExited && IsInstalledProcess(process, root)) process.Kill(); }
                catch (InvalidOperationException) when (process.HasExited) { }
            }
            if (!await WaitAsync(installed, TimeSpan.FromSeconds(5)))
                throw new IOException("O Discord demorou para encerrar. Tente aplicar novamente.");
        }
        finally { foreach (var process in processes) process.Dispose(); }
    }

    private static async Task<bool> WaitAsync(Process[] processes, TimeSpan timeout)
    {
        using var deadline = new CancellationTokenSource(timeout);
        try
        {
            await Task.WhenAll(processes.Select(process => process.WaitForExitAsync(deadline.Token)));
            return true;
        }
        catch (OperationCanceledException) { return false; }
    }

    private static bool IsInstalledProcess(Process process, string root)
    {
        try
        {
            if (process.HasExited || process.MainModule?.FileName is not { } executable) return false;
            var relative = Path.GetRelativePath(root, executable).Split(Path.DirectorySeparatorChar);
            return relative.Length == 2 && relative[0].StartsWith("app-", StringComparison.OrdinalIgnoreCase)
                && Version.TryParse(relative[0][4..], out _)
                && relative[1].Equals("Discord.exe", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException) { return false; }
    }
}
