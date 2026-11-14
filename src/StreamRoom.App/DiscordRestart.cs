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
        RequestClose(root, force: false);
        if (await WaitUntilClosedAsync(root, TimeSpan.FromSeconds(2), force: false)) return;

        // Closing the window can leave Discord in the tray. Check again after each
        // pass so a renderer or launcher that starts during shutdown is also stopped.
        if (!await WaitUntilClosedAsync(root, TimeSpan.FromSeconds(8), force: true))
            throw new IOException("O Discord demorou para encerrar. Saia dele pela bandeja do Windows e tente aplicar novamente.");
    }

    private static void RequestClose(string root, bool force)
    {
        var processes = Process.GetProcessesByName("Discord");
        try
        {
            foreach (var process in processes)
            {
                if (!IsInstalledProcess(process, root)) continue;
                try
                {
                    if (force) process.Kill();
                    else process.CloseMainWindow();
                }
                catch (Exception ex) when ((ex is InvalidOperationException or Win32Exception) && process.HasExited) { }
            }
        }
        finally { foreach (var process in processes) process.Dispose(); }
    }

    private static async Task<bool> WaitUntilClosedAsync(string root, TimeSpan timeout, bool force)
    {
        var elapsed = Stopwatch.StartNew();
        var delay = TimeSpan.FromMilliseconds(150);
        TimeSpan? emptySince = null;
        do
        {
            if (IsRunning(root))
            {
                emptySince = null;
                if (force) RequestClose(root, force: true);
            }
            else
            {
                emptySince ??= elapsed.Elapsed;
                if (elapsed.Elapsed - emptySince >= TimeSpan.FromMilliseconds(400)) return true;
            }
            await Task.Delay(delay);
        }
        while (elapsed.Elapsed < timeout);
        return false;
    }

    private static bool IsInstalledProcess(Process process, string root)
    {
        try
        {
            if (process.HasExited || process.MainModule?.FileName is not { } executable) return false;
            var path = Path.GetRelativePath(root, executable);
            if (path.Equals("Discord.exe", StringComparison.OrdinalIgnoreCase)) return true;

            var relative = path.Split(Path.DirectorySeparatorChar);
            return relative.Length == 2 && relative[0].StartsWith("app-", StringComparison.OrdinalIgnoreCase)
                && Version.TryParse(relative[0][4..], out _)
                && relative[1].Equals("Discord.exe", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException) { return false; }
    }
}
