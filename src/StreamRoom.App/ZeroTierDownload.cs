using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace StreamRoom.App;

internal sealed class ZeroTierDownload
{
    private string? _installer;
    public async Task DownloadAsync(Action<int?, long> progress)
    {
        _installer = null;
        var directory = Path.Combine(Path.GetTempPath(), "StreamRoom-ZeroTier-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "ZeroTier One.msi");
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            using var handler = new HttpClientHandler { AllowAutoRedirect = false };
            using var http = new HttpClient(handler);
            var uri = new Uri("https://download.zerotier.com/dist/ZeroTier%20One.msi");
            HttpResponseMessage? response = null;
            for (int i = 0; i < 5; i++)
            {
                response?.Dispose(); response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if ((int)response.StatusCode is not (301 or 302 or 303 or 307 or 308)) break;
                uri = new Uri(uri, response.Headers.Location ?? throw new IOException("Download oficial indisponível."));
                if (uri.Scheme != "https" || uri.Host != "download.zerotier.com") throw new IOException("Redirecionamento não autorizado.");
            }
            using (response)
            {
                response!.EnsureSuccessStatusCode();
                var total = response.Content.Headers.ContentLength;
                if (total is > 150_000_000) throw new IOException("Instalador excede o tamanho permitido.");
                await using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
                await using (var output = File.Create(path))
                {
                    var buffer = new byte[65536]; long received = 0; int read, last = -1;
                    while ((read = await input.ReadAsync(buffer, timeout.Token)) > 0)
                    {
                        received += read;
                        if (received > 150_000_000) throw new IOException("Instalador excede o tamanho permitido.");
                        await output.WriteAsync(buffer.AsMemory(0, read), timeout.Token);
                        int? percent = total is > 0 ? (int)Math.Min(99, received * 100 / total.Value) : null;
                        int step = percent ?? (int)(received / 262144);
                        if (step != last) { progress(percent, received); last = step; }
                    }
                    if (received == 0 || total.HasValue && received != total.Value) throw new IOException("Download incompleto.");
                }
            }
            InstallerTrust.Verify(path, zeroTier: true);
            _installer = path;
            progress(100, new FileInfo(path).Length);
        }
        catch { File.Delete(path); throw; }
    }
    public void OpenInstaller()
    {
        var path = _installer ?? throw new IOException("Baixe o instalador primeiro.");
        InstallerTrust.Verify(path, zeroTier: true);
        Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "msiexec.exe"))
        { UseShellExecute = true, Arguments = $"/i \"{path}\"" });
    }
}
