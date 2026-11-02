using System.Runtime.InteropServices;
using Vortice;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Graphics.DirectX.Direct3D11;
using WinRT;
namespace StreamRoom.App;

// Resize on the GPU before readback: a 4K monitor at 720p no longer crosses IPC at 4K.
internal sealed class CaptureScaler : IDisposable
{
    private ID3D11Device? _device;
    private ID3D11VideoDevice? _videoDevice;
    private ID3D11VideoContext? _videoContext;
    private ID3D11VideoProcessorEnumerator? _enumerator;
    private ID3D11VideoProcessor? _processor;
    private ID3D11Texture2D? _target, _staging;
    private ID3D11VideoProcessorOutputView? _output;
    private int _sourceWidth, _sourceHeight, _width, _height;
    private byte[] _pixels = [];
    public byte[] Read(IDirect3DSurface surface, int sourceWidth, int sourceHeight, int maxHeight, out int width, out int height)
    {
        var access = surface.As<ISurfaceAccess>();
        var iid = typeof(ID3D11Texture2D).GUID;
        access.GetInterface(ref iid, out var pointer);
        using var source = new ID3D11Texture2D(pointer);
        double scale = Math.Min(1, Math.Min((double)maxHeight / sourceHeight, maxHeight * 16.0 / 9 / sourceWidth));
        width = Math.Max(2, (int)(sourceWidth * scale) / 2 * 2);
        height = Math.Max(2, (int)(sourceHeight * scale) / 2 * 2);
        if (_processor is null || _sourceWidth != sourceWidth || _sourceHeight != sourceHeight || _width != width || _height != height)
            Initialize(source, sourceWidth, sourceHeight, width, height);
        var inputDescription = new VideoProcessorInputViewDescription { ViewDimension = VideoProcessorInputViewDimension.Texture2D };
        _videoDevice!.CreateVideoProcessorInputView(source, _enumerator!, inputDescription, out var input).CheckError();
        using (input)
        {
            _videoContext!.VideoProcessorBlt(_processor!, _output!, 0, 1, [new VideoProcessorStream { Enable = true, InputSurface = input }]).CheckError();
        }
        using var context = _videoContext!.QueryInterface<ID3D11DeviceContext>();
        context.CopyResource(_staging!, _target!);
        context.Map(_staging!, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None, out var mapped).CheckError();
        try
        {
            int rowBytes = checked(width * 4);
            for (int row = 0; row < height; row++)
                Marshal.Copy(mapped.DataPointer + checked(row * (int)mapped.RowPitch), _pixels, row * rowBytes, rowBytes);
        }
        finally { context.Unmap(_staging!, 0); }
        return _pixels;
    }
    private void Initialize(ID3D11Texture2D source, int sw, int sh, int width, int height)
    {
        Dispose();
        try
        {
            _device = source.Device;
            using var context = _device.ImmediateContext.QueryInterface<ID3D11DeviceContext>();
            _videoDevice = _device.QueryInterface<ID3D11VideoDevice>();
            using (var threading = context.QueryInterface<ID3D11Multithread>()) threading.SetMultithreadProtected(true);
            _videoContext = context.QueryInterface<ID3D11VideoContext>();
            var description = new VideoProcessorContentDescription
            {
                InputFrameFormat = VideoFrameFormat.Progressive, InputWidth = (uint)sw, InputHeight = (uint)sh,
                InputFrameRate = new Rational(60, 1), OutputFrameRate = new Rational(60, 1),
                OutputWidth = (uint)width, OutputHeight = (uint)height, Usage = VideoUsage.PlaybackNormal
            };
            _videoDevice.CreateVideoProcessorEnumerator(ref description, out _enumerator).CheckError();
            _videoDevice.CreateVideoProcessor(_enumerator, 0, out _processor).CheckError();
            var texture = new Texture2DDescription
            {
                Width = (uint)width, Height = (uint)height, MipLevels = 1, ArraySize = 1, Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Default, BindFlags = BindFlags.RenderTarget
            };
            _target = _device.CreateTexture2D(texture);
            texture.Usage = ResourceUsage.Staging; texture.BindFlags = BindFlags.None; texture.CPUAccessFlags = CpuAccessFlags.Read;
            _staging = _device.CreateTexture2D(texture);
            _videoDevice.CreateVideoProcessorOutputView(_target, _enumerator, new VideoProcessorOutputViewDescription { ViewDimension = VideoProcessorOutputViewDimension.Texture2D }, out _output).CheckError();
            _videoContext.VideoProcessorSetStreamFrameFormat(_processor, 0, VideoFrameFormat.Progressive);
            _videoContext.VideoProcessorSetStreamAutoProcessingMode(_processor, 0, false);
            _videoContext.VideoProcessorSetStreamSourceRect(_processor, 0, true, new RawRect(0, 0, sw, sh));
            _videoContext.VideoProcessorSetStreamDestRect(_processor, 0, true, new RawRect(0, 0, width, height));
            _videoContext.VideoProcessorSetOutputTargetRect(_processor, true, new RawRect(0, 0, width, height));
            _sourceWidth = sw; _sourceHeight = sh; _width = width; _height = height;
            _pixels = new byte[checked(width * height * 4)];
        }
        catch { Dispose(); throw; }
    }
    public void Dispose()
    {
        _output?.Dispose(); _output = null; _staging?.Dispose(); _staging = null; _target?.Dispose(); _target = null;
        _processor?.Dispose(); _processor = null; _enumerator?.Dispose(); _enumerator = null;
        _videoContext?.Dispose(); _videoContext = null; _videoDevice?.Dispose(); _videoDevice = null;
        _device?.Dispose(); _device = null;
        _pixels = [];
    }
    [ComImport, Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISurfaceAccess { void GetInterface(ref Guid iid, out nint value); }
}

