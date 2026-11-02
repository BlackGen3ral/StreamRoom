using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace StreamRoom.App;

internal sealed record CaptureSource(string Id, string Kind, string Name, string? Thumbnail, nint Handle, uint ProcessId);
internal sealed class CaptureSources
{
    private readonly Dictionary<string, CaptureSource> _sources = new();
    public string AddTestWindow(nint handle)
    { var id = Guid.NewGuid().ToString("N"); _sources.Add(id, new(id, "window", "Teste WGC", null, handle, (uint)Environment.ProcessId)); return id; }
    public CaptureSource Resolve(string id)
    {
        if (!_sources.TryGetValue(id, out var source)) throw new InvalidOperationException("Atualize a lista e selecione a fonte novamente.");
        if (source.Kind == "window")
        {
            GetWindowThreadProcessId(source.Handle, out var pid);
            if (!IsWindowVisible(source.Handle) || IsIconic(source.Handle) || pid != source.ProcessId || Protected(source.Handle))
                throw new InvalidOperationException("A janela foi fechada, minimizada ou protegida. Selecione outra fonte.");
        }
        else if (!GetMonitorInfo(source.Handle, new MonitorInfo())) throw new InvalidOperationException("Monitor desconectado.");
        return source;
    }
    public object[] List()
    {
        _sources.Clear();
        EnumWindows((hwnd, _) =>
        {
            if (_sources.Count >= 48 || !IsWindowVisible(hwnd) || IsIconic(hwnd) || Protected(hwnd)) return true;
            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == Environment.ProcessId) return true;
            var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
            if (title.Length == 0 || !GetWindowRect(hwnd, out var rect) || rect.Right - rect.Left < 80 || rect.Bottom - rect.Top < 60) return true;
            DwmGetWindowAttribute(hwnd, 14, out int cloaked, sizeof(int));
            if (cloaked != 0) return true;
            Add("window", title.ToString(), hwnd, pid, rect);
            return true;
        }, 0);
        int number = 0;
        EnumDisplayMonitors(0, 0, (nint monitor, nint dc, ref Rect rect, nint data) =>
        { Add("monitor", "Monitor " + ++number + " · " + (rect.Right - rect.Left) + " × " + (rect.Bottom - rect.Top), monitor, 0, rect); return true; }, 0);
        return _sources.Values.Select(s => (object)new { s.Id, s.Kind, s.Name, s.Thumbnail }).ToArray();
    }
    private static bool Protected(nint hwnd) => GetWindowDisplayAffinity(hwnd, out var affinity) && affinity != 0;
    private void Add(string kind, string name, nint handle, uint pid, Rect rect)
    {
        string id = Guid.NewGuid().ToString("N");
        _sources.Add(id, new(id, kind, name, Thumbnail(kind, handle, rect), handle, pid));
    }
    private static readonly SemaphoreSlim ThumbnailSlots = new(4, 4);
    private static string? Thumbnail(string kind, nint handle, Rect rect)
    {
        if (!ThumbnailSlots.Wait(0)) return null;
        var task = Task.Run(() => { try { return ThumbnailNative(kind, handle, rect); } finally { ThumbnailSlots.Release(); } });
        // A hung third-party window retains only its own worker/resources; never release an HDC in use.
        return task.Wait(TimeSpan.FromMilliseconds(250)) ? task.GetAwaiter().GetResult() : null;
    }
    private static string? ThumbnailNative(string kind, nint handle, Rect rect)
    {
        nint screen = GetDC(0), target = 0, bitmap = 0, previous = 0;
        try
        {
            int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0 || (long)width * height > 34_000_000) return null;
            target = CreateCompatibleDC(screen);
            bitmap = CreateCompatibleBitmap(screen, kind == "monitor" ? 320 : width, kind == "monitor" ? 180 : height);
            if (target == 0 || bitmap == 0) return null;
            previous = SelectObject(target, bitmap);
            PatBlt(target, 0, 0, kind == "monitor" ? 320 : width, kind == "monitor" ? 180 : height, 0x00000042);
            if (kind == "monitor")
            {
                if (!StretchBlt(target, 0, 0, 320, 180, screen, rect.Left, rect.Top, width, height, 0x00CC0020)) return null;
            }
            else
            {
                // PW_RENDERFULLCONTENT supports composited applications. Caller bounds worker concurrency/time.
                if (!PrintWindow(handle, target, 2)) return null;
            }
            var image = Imaging.CreateBitmapSourceFromHBitmap(bitmap, 0, Int32Rect.Empty, BitmapSizeOptions.FromWidthAndHeight(320, 180));
            var rgb = new FormatConvertedBitmap(image, PixelFormats.Bgr24, null, 0);
            var sample = new byte[rgb.PixelWidth * rgb.PixelHeight * 3]; rgb.CopyPixels(sample, rgb.PixelWidth * 3, 0);
            if (!sample.Where((_, i) => i % 97 == 0).Any(value => value > 12)) return null;
            var encoder = new JpegBitmapEncoder { QualityLevel = 65 }; encoder.Frames.Add(BitmapFrame.Create(image));
            using var output = new MemoryStream(); encoder.Save(output);
            return "data:image/jpeg;base64," + Convert.ToBase64String(output.ToArray());
        }
        catch { return null; }
        finally { if (previous != 0) SelectObject(target, previous); if (bitmap != 0) DeleteObject(bitmap); if (target != 0) DeleteDC(target); if (screen != 0) ReleaseDC(0, screen); }
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private sealed class MonitorInfo { public int Size = Marshal.SizeOf<MonitorInfo>(); public Rect Monitor, Work; public uint Flags; }
    private delegate bool WindowCallback(nint handle, nint data);
    private delegate bool MonitorCallback(nint monitor, nint dc, ref Rect rect, nint data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, nint data);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(nint dc, nint clip, MonitorCallback callback, nint data);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(nint monitor, [In, Out] MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint handle);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint handle);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint handle, out Rect rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint handle, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint handle, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetWindowDisplayAffinity(nint handle, out uint affinity);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint handle, int attribute, out int value, int size);
    [DllImport("user32.dll")] private static extern nint GetDC(nint hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(nint hwnd, nint dc);
    [DllImport("gdi32.dll")] private static extern bool PatBlt(nint dc, int x, int y, int width, int height, uint operation);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleBitmap(nint dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern nint SelectObject(nint dc, nint value);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(nint dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(nint value);
    [DllImport("gdi32.dll")] private static extern bool StretchBlt(nint dst, int x, int y, int w, int h, nint src, int sx, int sy, int sw, int sh, uint rop);
    [DllImport("user32.dll")] private static extern bool PrintWindow(nint hwnd, nint dc, uint flags);
}
