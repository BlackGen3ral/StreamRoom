using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows.Media.Imaging;

namespace StreamRoom.App;

internal static class CapturePreviewSelfTest
{
    // Explicit developer diagnostic. Capture only local previews, never save pixels or identifiers.
    internal static async Task Run(string output)
    {
        var errors = new List<string>();
        try
        {
            var sources = new CaptureSources(message => { lock (errors) errors.Add(message); });
            var clock = Stopwatch.StartNew();
            var list = JsonSerializer.SerializeToElement(sources.List());
            var listMs = clock.ElapsedMilliseconds;
            // Simulate unresponsive third-party windows occupying every window slot.
            var slots = (SemaphoreSlim)typeof(CaptureSources).GetField("WindowSlots", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
            await slots.WaitAsync(); await slots.WaitAsync();
            var checks = new List<object>();
            try
            {
                foreach (var item in list.EnumerateArray().Where(s => s.GetProperty("Kind").GetString() == "monitor"))
                {
                    clock.Restart();
                    var data = await sources.ThumbnailAsync(item.GetProperty("Id").GetString()!);
                    if (data is null) throw new InvalidOperationException("Monitor preview unavailable with window slots occupied.");
                    using var stream = new MemoryStream(Convert.FromBase64String(data[(data.IndexOf(',') + 1)..]));
                    var image = BitmapDecoder.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0];
                    if (image.PixelWidth > 960 || image.PixelHeight > 540) throw new InvalidOperationException("Preview exceeds dimensions.");
                    checks.Add(new { width = image.PixelWidth, height = image.PixelHeight, bytes = stream.Length, elapsedMs = clock.ElapsedMilliseconds });
                }
            }
            finally { slots.Release(2); }
            if (checks.Count == 0) throw new InvalidOperationException("No monitors available for this interactive test.");
            await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = true, listMs, monitors = checks }));
        }
        catch (Exception error) { await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = false, error = error.Message, diagnostics = errors })); Environment.ExitCode = 1; }
    }
}
