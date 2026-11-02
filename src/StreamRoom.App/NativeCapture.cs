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
    private bool _disposed;
    private Windows.Storage.Streams.Buffer? _readback;
    private byte[]? _pixels;
    public Func<bool>? CanDeliver { get; set; }
    public event Action<byte[], int, int>? Frame;
    public event Action<string>? Ended;
    public static bool Supported => GraphicsCaptureSession.IsSupported();
    public void Start(CaptureSource source, int fps)
    {
        if (!Supported) throw new NotSupportedException("O Windows não oferece captura WGC neste dispositivo.");
        _interval = Stopwatch.Frequency / Math.Clamp(fps, 15, 60);
        _item = CreateItem(source);
        _device = CreateDevice();
        _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, _item.Size);
        _pool.FrameArrived += OnFrame;
        _item.Closed += OnClosed;
        _session = _pool.CreateCaptureSession(_item);
        // Keep Windows capture borders and cursor. No borderless capture permissions are requested.
        _session.StartCapture();
    }
    private void OnClosed(GraphicsCaptureItem sender, object args) => Ended?.Invoke("A fonte compartilhada foi fechada.");
    private async void OnFrame(Direct3D11CaptureFramePool pool, object args)
    {
        if (_disposed || Interlocked.CompareExchange(ref _processing, 1, 0) != 0) return;
        try
        {
            using var frame = pool.TryGetNextFrame();
            if (frame is null) return;
            long now = Stopwatch.GetTimestamp();
            // A monotonic deadline tolerates frame-arrival jitter without halving 60 FPS capture.
            if (now + Stopwatch.Frequency / 500 < _nextFrame || CanDeliver?.Invoke() == false) return;
            _nextFrame = Math.Max(_nextFrame + _interval, now);
            int width = frame.ContentSize.Width, height = frame.ContentSize.Height;
            if (width < 1 || height < 1 || (long)width * height > 34_000_000) return;
            using var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface);
            if (_disposed) return;
            // CopyToBuffer packs BGRA pixels. IPC uses shared memory, never base64-encoded video.
            int size = checked(bitmap.PixelWidth * bitmap.PixelHeight * 4);
            if (_pixels?.Length != size) { _pixels = new byte[size]; _readback = new Windows.Storage.Streams.Buffer((uint)size); }
            bitmap.CopyToBuffer(_readback!);
            using var reader = DataReader.FromBuffer(_readback!);
            reader.ReadBytes(_pixels);
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
    private static IDirect3DDevice CreateDevice()
    {
        nint device = 0, context = 0, dxgi = 0, inspectable = 0;
        try
        {
            // D3D_DRIVER_TYPE_HARDWARE; fail explicitly instead of silently using software capture.
            Marshal.ThrowExceptionForHR(D3D11CreateDevice(0, 1, 0, 0x20, 0, 0, 7, out device, out _, out context));
            Guid iid = new("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, in iid, out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out inspectable));
            return WinRT.MarshalInterface<IDirect3DDevice>.FromAbi(inspectable);
        }
        finally { if (inspectable != 0) Marshal.Release(inspectable); if (dxgi != 0) Marshal.Release(dxgi); if (context != 0) Marshal.Release(context); if (device != 0) Marshal.Release(device); }
    }
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
