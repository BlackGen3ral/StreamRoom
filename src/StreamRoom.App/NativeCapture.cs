using System.Runtime.InteropServices;
using System.Diagnostics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace StreamRoom.App;

internal sealed class NativeCapture : IDisposable
{
    private IDirect3DDevice? _device;
    private Direct3D11CaptureFramePool? _pool;
    private GraphicsCaptureSession? _session;
    private GraphicsCaptureItem? _item;
    private int _processing;
    private long _nextFrame;
    private long _interval;
    private volatile bool _disposed;
    public bool BorderlessPreferenceApplied { get; private set; }
    public long Arrivals;
    public long BackpressureDrops;
    public long BusyDrops;
    public double LastCopyMs;
    private Windows.Storage.Streams.Buffer? _readback;
    private byte[]? _pixels;
    private readonly object _lifetimeGate = new();
    private CaptureScaler? _scaler;
    private int _maxHeight;
    private bool _scaleUnavailable;
    public long FrameCount { get; private set; }
    public int SourceWidth { get; private set; }
    public int SourceHeight { get; private set; }
    public string? ScaleFailure { get; private set; }
    public string TransferMode { get; private set; } = "software-readback";
    public Func<bool>? CanDeliver { get; set; }
    public event Action<byte[], int, int>? Frame;
    public event Action<string>? Ended;
    public static bool Supported => GraphicsCaptureSession.IsSupported();
    public void Start(CaptureSource source, int fps, int maxHeight = 1080)
    {
        if (!Supported) throw new NotSupportedException("O Windows não oferece captura WGC neste dispositivo.");
        _maxHeight = maxHeight is 480 or 720 or 1080 ? maxHeight : 720;
        _interval = Stopwatch.Frequency / Math.Clamp(fps, 15, 60);
        _item = CreateItem(source);
        _device = CreateDevice(source);
        _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, _item.Size);
        _pool.FrameArrived += OnFrame;
        _item.Closed += OnClosed;
        _session = _pool.CreateCaptureSession(_item);
        // Windows enforces its own consent/policy even when this preference is false.
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348))
        {
            try { _session.IsBorderRequired = false; BorderlessPreferenceApplied = !_session.IsBorderRequired; }
            catch (Exception e) when (e is COMException or NotSupportedException) { Debug.WriteLine("Borderless capture unavailable: " + e.Message); }
        }
        _session.StartCapture();
    }
    public static async Task RequestBorderlessAccessAsync()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348)) return;
        try
        {
            // Packaged apps may show the Windows consent dialog. Unpackaged desktop
            // apps can report NotDeclared; setting IsBorderRequired remains safe and
            // Windows decides whether the preference is honored.
            _ = await GraphicsCaptureAccess.RequestAccessAsync(GraphicsCaptureAccessKind.Borderless);
        }
        catch (Exception e) when (e is COMException or NotSupportedException)
        { Debug.WriteLine("Borderless access request unavailable: " + e.Message); }
    }
    private void OnClosed(GraphicsCaptureItem sender, object args) => Ended?.Invoke("A fonte compartilhada foi fechada.");
    private async void OnFrame(Direct3D11CaptureFramePool pool, object args)
    {
        Interlocked.Increment(ref Arrivals);
        if (_disposed || Interlocked.CompareExchange(ref _processing, 1, 0) != 0) { Interlocked.Increment(ref BusyDrops); return; }
        try
        {
            using var frame = pool.TryGetNextFrame();
            if (frame is null) return;
            long now = Stopwatch.GetTimestamp();
            // A monotonic deadline tolerates frame-arrival jitter without halving 60 FPS capture.
            if (CanDeliver?.Invoke() == false) { Interlocked.Increment(ref BackpressureDrops); return; }
            if (now + Stopwatch.Frequency / 500 < _nextFrame) return;
            _nextFrame = Math.Max(_nextFrame + _interval, now);
            int width = frame.ContentSize.Width, height = frame.ContentSize.Height;
            SourceWidth = width; SourceHeight = height;
            if (width < 1 || height < 1 || (long)width * height > 34_000_000) return;
            var surfaceSize = frame.Surface.Description;
            if (width != surfaceSize.Width || height != surfaceSize.Height)
            {
                frame.Dispose();
                if (!_disposed) pool.Recreate(_device!, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, new Windows.Graphics.SizeInt32 { Width = width, Height = height });
                return;
            }
            if (!_scaleUnavailable)
            {
                try
                {
                    lock (_lifetimeGate)
                    {
                        if (_disposed) return;
                        _scaler ??= new CaptureScaler();
                        long copyStart = Stopwatch.GetTimestamp();
                        var pixels = _scaler.Read(frame.Surface, width, height, _maxHeight, out int outputWidth, out int outputHeight);
                        LastCopyMs = Stopwatch.GetElapsedTime(copyStart).TotalMilliseconds;
                        TransferMode = width == outputWidth && height == outputHeight ? "gpu-copy" : "gpu-scale";
                        FrameCount++;
                        Frame?.Invoke(pixels, outputWidth, outputHeight);
                    }
                    return;
                }
                catch (Exception scaleError) { ScaleFailure = scaleError.ToString(); lock (_lifetimeGate) { _scaler?.Dispose(); _scaler = null; _scaleUnavailable = true; TransferMode = "software-readback"; } }
            }
            using var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface);
            if (_disposed) return;
            // CopyToBuffer packs BGRA pixels. IPC uses shared memory, never base64-encoded video.
            int size = checked(bitmap.PixelWidth * bitmap.PixelHeight * 4);
            if (_pixels?.Length != size) { _pixels = new byte[size]; _readback = new Windows.Storage.Streams.Buffer((uint)size); }
            bitmap.CopyToBuffer(_readback!);
            using var reader = DataReader.FromBuffer(_readback!);
            reader.ReadBytes(_pixels);
            FrameCount++;
            Frame?.Invoke(_pixels, bitmap.PixelWidth, bitmap.PixelHeight);
            if (!_disposed && (width != bitmap.PixelWidth || height != bitmap.PixelHeight))
            {
                frame.Dispose();
                pool.Recreate(_device!, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, new Windows.Graphics.SizeInt32 { Width = width, Height = height });
            }
        }
        catch (Exception e) { if (!_disposed) Ended?.Invoke("A captura nativa foi interrompida: " + e.Message); }
        finally { Volatile.Write(ref _processing, 0); }
    }
    public void Dispose()
    {
        _disposed = true;
        if (_item is not null) _item.Closed -= OnClosed;
        if (_pool is not null) _pool.FrameArrived -= OnFrame;
        lock (_lifetimeGate) { _scaler?.Dispose(); _scaler = null; }
        _session?.Dispose(); _pool?.Dispose(); _device?.Dispose();
        _session = null; _pool = null; _device = null; _item = null;
    }
    private static GraphicsCaptureItem CreateItem(CaptureSource source)
    {
        Marshal.ThrowExceptionForHR(WindowsCreateString("Windows.Graphics.Capture.GraphicsCaptureItem", 44, out var name));
        nint factory = 0, item = 0;
        try
        {
            Guid interopId = new("3628e81b-3cac-4c60-b7f4-23ce0e0c3356");
            Marshal.ThrowExceptionForHR(RoGetActivationFactory(name, ref interopId, out factory));
            var interop = (ICaptureInterop)Marshal.GetObjectForIUnknown(factory);
            Guid itemId = new("79c3f95b-31f7-4ec2-a464-632ef5d30760");
            if (source.Kind == "window") interop.CreateForWindow(source.Handle, ref itemId, out item);
            else interop.CreateForMonitor(source.Handle, ref itemId, out item);
            try { return WinRT.MarshalInterface<GraphicsCaptureItem>.FromAbi(item); }
            finally { Marshal.ReleaseComObject(interop); }
        }
        finally { if (item != 0) Marshal.Release(item); if (factory != 0) Marshal.Release(factory); WindowsDeleteString(name); }
    }
    private static IDirect3DDevice CreateDevice(CaptureSource source)
    {
        nint device = 0, context = 0, dxgi = 0, inspectable = 0;
        try
        {
            // D3D_DRIVER_TYPE_HARDWARE; fail explicitly instead of silently using software capture.
            using var adapter = FindAdapter(source);
            Marshal.ThrowExceptionForHR(D3D11CreateDevice(adapter?.NativePointer ?? 0, adapter is null ? 1u : 0u, 0, 0x20, 0, 0, 7, out device, out _, out context));
            Guid iid = new("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, in iid, out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out inspectable));
            return WinRT.MarshalInterface<IDirect3DDevice>.FromAbi(inspectable);
        }
        finally { if (inspectable != 0) Marshal.Release(inspectable); if (dxgi != 0) Marshal.Release(dxgi); if (context != 0) Marshal.Release(context); if (device != 0) Marshal.Release(device); }
    }
    // Match the display adapter to avoid copying a monitor through the other GPU on hybrid PCs.
    private static Vortice.DXGI.IDXGIAdapter1? FindAdapter(CaptureSource source)
    {
        nint monitor = source.Kind == "monitor" ? source.Handle : MonitorFromWindow(source.Handle, 2);
        using var factory = Vortice.DXGI.DXGI.CreateDXGIFactory1<Vortice.DXGI.IDXGIFactory1>();
        for (uint index = 0; factory.EnumAdapters1(index, out var adapter).Success; index++)
        {
            for (uint outputIndex = 0; adapter.EnumOutputs(outputIndex, out var output).Success; outputIndex++)
            {
                using (output) { if (output.Description.Monitor == monitor) return adapter; }
            }
            adapter.Dispose();
        }
        return null;
    }
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint hwnd, uint flags);
    [ComImport, Guid("3628e81b-3cac-4c60-b7f4-23ce0e0c3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICaptureInterop
    {
        void CreateForWindow(nint hwnd, ref Guid iid, out nint item);
        void CreateForMonitor(nint monitor, ref Guid iid, out nint item);
    }
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] private static extern int WindowsCreateString(string text, int length, out nint value);
    [DllImport("combase.dll")] private static extern int WindowsDeleteString(nint value);
    [DllImport("combase.dll")] private static extern int RoGetActivationFactory(nint name, ref Guid iid, out nint value);
    [DllImport("d3d11.dll")] private static extern int D3D11CreateDevice(nint adapter, uint type, nint software, uint flags, nint levels, uint count, uint sdk, out nint device, out uint featureLevel, out nint context);
    [DllImport("d3d11.dll")] private static extern int CreateDirect3D11DeviceFromDXGIDevice(nint dxgi, out nint device);
}
