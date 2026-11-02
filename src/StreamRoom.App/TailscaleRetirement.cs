using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Win32;

namespace StreamRoom.App;

internal static class TailscaleRetirement
{
    private static string? Product()
    {
        var products = new HashSet<string>();
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            using var root = machine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");
            foreach (var name in root?.GetSubKeyNames() ?? [])
            {
                if (!Guid.TryParseExact(name, "B", out var id)) continue;
                using var key = root!.OpenSubKey(name);
                if (key?.GetValue("DisplayName") is string title && title == "Tailscale"
                    && key.GetValue("Publisher") is string publisher && publisher.TrimEnd('.') == "Tailscale Inc"
                    && key.GetValue("WindowsInstaller") is int msi && msi == 1)
                    products.Add(id.ToString("B"));
            }
        }
        if (products.Count > 1) throw new IOException("Mais de uma instalação do Tailscale encontrada. Remova pelo Windows para escolher a correta.");
        return products.SingleOrDefault();
    }
    public static async Task<string?> RunAsync(Window owner, string directory)
    {
        var marker = Path.Combine(directory, "tailscale-retirement-v1.txt");
        if (File.Exists(marker)) return null;
        var product = Product();
        if (product is null)
        {
            await File.WriteAllTextAsync(marker, "not-managed");
            return "A integração Tailscale foi retirada do StreamRoom. Nenhum pacote MSI compatível foi encontrado para desinstalar.";
        }
        if (!AppPrompt.Confirm(owner, "Remover Tailscale?", "O StreamRoom não utiliza mais o Tailscale. A desinstalação também afeta outros aplicativos que o utilizem. O Windows poderá pedir autorização.", "Desinstalar"))
        {
            await File.WriteAllTextAsync(marker, "kept");
            return "Integração Tailscale retirada. O programa foi mantido neste PC por sua escolha.";
        }
        // Only a validated MSI product GUID is accepted, never a registry command string.
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "msiexec.exe"))
        { UseShellExecute = true, Verb = "runas", Arguments = $"/x {product} /passive /norestart" };
        using var process = Process.Start(start) ?? throw new IOException("Não foi possível iniciar a desinstalação do Tailscale.");
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromMinutes(10));
        if (process.ExitCode is 3010 or 1641)
        {
            await File.WriteAllTextAsync(marker, "restart-required");
            return "A desinstalação do Tailscale solicitou reiniciar o Windows. Reinicie para concluir a remoção.";
        }
        if (process.ExitCode != 0 || Product() is not null)
            throw new IOException("A remoção do Tailscale não foi confirmada. Você pode tentar pelo menu Aplicativos do Windows.");
        await File.WriteAllTextAsync(marker, "removed");
        return "Tailscale desinstalado deste PC. O StreamRoom continua usando ZeroTier como opção de rede privada.";
    }
}
