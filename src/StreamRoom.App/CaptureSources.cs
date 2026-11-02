using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace StreamRoom.App;

internal sealed record CaptureSource(string Id, string Kind, string Name, nint Handle, uint ProcessId);
internal sealed class CaptureSources
{
    private readonly Action<string>? _diagnostic;
    public CaptureSources(Action<string>? diagnostic = null) { _diagnostic = diagnostic; }
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, CaptureSource> _sources = new();
    public string AddTestWindow(nint handle)
    { var id = Guid.NewGuid().ToString("N"); _sources[id] = new(id, "window", "Teste WGC", handle, (uint)Environment.ProcessId); return id; }
    public string AddTestMonitor(nint window)
    {
        var monitor = MonitorFromWindow(window, 2);
        var info = new MonitorInfo();
        if (!GetMonitorInfo(monitor, info)) throw new InvalidOperationException("Test monitor unavailable.");
        var id = Guid.NewGuid().ToString("N");
        _sources[id] = new(id, "monitor", "Monitor de teste", monitor, 0);
        return id;
    }
    public CaptureSource Resolve(string id)
    {
        if (!_sources.TryGetValue(id, out var source)) throw new InvalidOperationException("Atualize a lista e selecione a fonte novamente.");
        if (source.Kind == "window")
        {
            GetWindowThreadProcessId(source.Handle, out var pid);
            if (!CanCaptureWindow(source.Handle) || pid != source.ProcessId)
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
            if (_sources.Count >= 48 || !CanCaptureWindow(hwnd)) return true;
            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == Environment.ProcessId) return true;
            var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
            if (title.Length == 0 || !GetWindowRect(hwnd, out var rect) || rect.Right - rect.Left < 80 || rect.Bottom - rect.Top < 60) return true;
            Add("window", title.ToString(), hwnd, pid);
            return true;
        }, 0);
        int number = 0;
        EnumDisplayMonitors(0, 0, (nint monitor, nint dc, ref Rect rect, nint data) =>
        { Add("monitor", "Monitor " + ++number + " · " + (rect.Right - rect.Left) + " × " + (rect.Bottom - rect.Top), monitor, 0); return true; }, 0);
        // Enumerate immediately. Preview images are requested only for visible cards,
        // individually, so hidden windows cannot exhaust a shared message budget.
        return _sources.Values.Select(s => (object)new { s.Id, s.Kind, s.Name })
            .ToArray();
    }
    private static bool Protected(nint hwnd) => GetWindowDisplayAffinity(hwnd, out var affinity) && affinity != 0;
    private static bool CanCaptureWindow(nint hwnd)
    {
        // The desktop shell/child windows are not supported by CreateForWindow.
        // Share the monitor for the desktop, never silently capture a larger area.
        if (hwnd == 0 || hwnd == GetShellWindow() || hwnd == GetDesktopWindow() || GetAncestor(hwnd, 2) != hwnd
            || !IsWindowVisible(hwnd) || IsIconic(hwnd) || Protected(hwnd)) return false;
        DwmGetWindowAttribute(hwnd, 14, out int cloaked, sizeof(int));
        return cloaked == 0;
    }
    private void Add(string kind, string name, nint handle, uint pid)
    {
        string id = Guid.NewGuid().ToString("N");
        _sources[id] = new(id, kind, name, handle, pid);
    }
    private static readonly SemaphoreSlim WindowSlots = new(2, 2);
    private static readonly SemaphoreSlim MonitorSlots = new(2, 2);
    public async Task<string?> ThumbnailAsync(string id)
    {
        CaptureSource source;
        try { source = Resolve(id); } catch (InvalidOperationException) { return null; }
        Rect rect;
        if (source.Kind == "monitor")
        {
            var info = new MonitorInfo();
            if (!GetMonitorInfo(source.Handle, info)) return null;
            rect = info.Monitor;
        }
        else if (!GetWindowRect(source.Handle, out rect)) return null;
        var slots = source.Kind == "monitor" ? MonitorSlots : WindowSlots;
        if (!await slots.WaitAsync(TimeSpan.FromMilliseconds(250))) return null;
        var task = Task.Run(() =>
        {
            try { return ThumbnailNative(source.Kind, source.Handle, rect, _diagnostic); }
            finally { slots.Release(); }
        });
        // PrintWindow may block inside another app. Keep its slot/resources until
        // completion, but never let it prevent monitor previews or block the UI.
        try { return await task.WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (TimeoutException) { return null; }
    }
    private static string? ThumbnailNative(string kind, nint handle, Rect rect, Action<string>? diagnostic)
    {
        nint screen = GetDC(0), target = 0, bitmap = 0, previous = 0;
        try
        {
            if (screen == 0) return null;
            int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0 || (long)width * height > 34_000_000) return null;
            double scale = Math.Min(1, Math.Min(960d / width, 540d / height));
            int previewWidth = Math.Max(1, (int)Math.Round(width * scale)), previewHeight = Math.Max(1, (int)Math.Round(height * scale));
            target = CreateCompatibleDC(screen);
            int bitmapWidth = kind == "monitor" ? previewWidth : width;
            int bitmapHeight = kind == "monitor" ? previewHeight : height;
            var info = new BitmapInfo { Size = 40, Width = bitmapWidth, Height = -bitmapHeight, Planes = 1, BitCount = 32 };
            bitmap = CreateDIBSection(screen, ref info, 0, out var pixels, 0, 0);
            if (target == 0 || bitmap == 0 || pixels == 0) { diagnostic?.Invoke("GDI allocation failed"); return null; }
            previous = SelectObject(target, bitmap);
            if (previous == 0 || previous == -1) { previous = 0; return null; }
            PatBlt(target, 0, 0, kind == "monitor" ? previewWidth : width, kind == "monitor" ? previewHeight : height, 0x00000042);
            if (kind == "monitor")
            {
                SetStretchBltMode(target, 4); // HALFTONE: preserve detail while reducing the monitor image.
                SetBrushOrgEx(target, 0, 0, 0);
                if (!StretchBlt(target, 0, 0, previewWidth, previewHeight, screen, rect.Left, rect.Top, width, height, 0x00CC0020)) { diagnostic?.Invoke("StretchBlt failed"); return null; }
            }
            else
            {
                // PW_RENDERFULLCONTENT supports composited applications. Caller bounds worker concurrency/time.
                if (!PrintWindow(handle, target, 2)) return null;
            }
            GdiFlush();
            SelectObject(target, previous); previous = 0;
            var sample = new byte[bitmapWidth * bitmapHeight * 4];
            Marshal.Copy(pixels, sample, 0, sample.Length);
            bool hasContent = false;
            for (int i = 0; i < sample.Length; i += 388)
                if (sample[i] > 12 || sample[i + 1] > 12 || sample[i + 2] > 12) { hasContent = true; break; }
            if (!hasContent) { diagnostic?.Invoke($"Preview contains only dark pixels ({kind}, {width}x{height})"); return null; }
            // GDI does not populate alpha. Explicitly read opaque BGR pixels.
            BitmapSource image = BitmapSource.Create(bitmapWidth, bitmapHeight, 96, 96, PixelFormats.Bgr32, null, sample, bitmapWidth * 4);
            if (bitmapWidth != previewWidth || bitmapHeight != previewHeight)
                image = new TransformedBitmap(image, new ScaleTransform((double)previewWidth / bitmapWidth, (double)previewHeight / bitmapHeight));
            // Lossless previews keep small text sharp. Bound photos/noise with a high-quality JPEG fallback.
            BitmapEncoder encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
            using var output = new MemoryStream(); encoder.Save(output);
            string mime = "png";
            if (output.Length > 512_000)
            {
                output.SetLength(0); output.Position = 0;
                encoder = new JpegBitmapEncoder { QualityLevel = 92 }; encoder.Frames.Add(BitmapFrame.Create(image)); encoder.Save(output); mime = "jpeg";
            }
            return "data:image/" + mime + ";base64," + Convert.ToBase64String(output.ToArray());
        }
        catch (Exception error) { diagnostic?.Invoke(error.ToString()); return null; }
        finally { if (previous != 0) SelectObject(target, previous); if (bitmap != 0) DeleteObject(bitmap); if (target != 0) DeleteDC(target); if (screen != 0) ReleaseDC(0, screen); }
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapInfo
    {
        public uint Size; public int Width, Height; public ushort Planes, BitCount;
        public uint Compression, ImageSize; public int XPixelsPerMeter, YPixelsPerMeter;
        public uint ColorsUsed, ColorsImportant, Color;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private sealed class MonitorInfo { public int Size = Marshal.SizeOf<MonitorInfo>(); public Rect Monitor, Work; public uint Flags; }
    private delegate bool WindowCallback(nint handle, nint data);
    private delegate bool MonitorCallback(nint monitor, nint dc, ref Rect rect, nint data);
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint hwnd, uint flags);
    [DllImport("user32.dll")] private static extern nint GetShellWindow();
    [DllImport("user32.dll")] private static extern nint GetDesktopWindow();
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hwnd, uint flags);
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
    [DllImport("gdi32.dll")] private static extern int SetStretchBltMode(nint dc, int mode);
    [DllImport("gdi32.dll")] private static extern bool GdiFlush();
    [DllImport("gdi32.dll")] private static extern bool SetBrushOrgEx(nint dc, int x, int y, nint previous);
    [DllImport("user32.dll")] private static extern int ReleaseDC(nint hwnd, nint dc);
    [DllImport("gdi32.dll")] private static extern bool PatBlt(nint dc, int x, int y, int width, int height, uint operation);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] private static extern nint CreateDIBSection(nint dc, ref BitmapInfo info, uint usage, out nint bits, nint section, uint offset);
    [DllImport("gdi32.dll")] private static extern nint SelectObject(nint dc, nint value);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(nint dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(nint value);
    [DllImport("gdi32.dll")] private static extern bool StretchBlt(nint dst, int x, int y, int w, int h, nint src, int sx, int sy, int sw, int sh, uint rop);
    [DllImport("user32.dll")] private static extern bool PrintWindow(nint hwnd, nint dc, uint flags);
}
