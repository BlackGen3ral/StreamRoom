using System.Buffers.Binary;
using NAudio.Wave;

namespace StreamRoom.App;

/// <summary>Explicit system-output WASAPI loopback. It includes other apps; never called by window-audio mode.</summary>
public sealed class SystemAudioCapture : IDisposable
{
    private WasapiLoopbackCapture? _capture;
    public int Start(Action<byte[]> onPcm, Action<string> onError)
    {
        Dispose();
        var capture = new WasapiLoopbackCapture();
        var format = capture.WaveFormat;
        if (format.Channels < 1 || format.BitsPerSample is not (8 or 16 or 24 or 32))
        { capture.Dispose(); throw new NotSupportedException("Formato WASAPI não suportado por este dispositivo."); }
        bool isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat
            || format is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71");
        capture.DataAvailable += (_, e) =>
        {
            var frames = e.BytesRecorded / format.BlockAlign;
            var pcm = new byte[frames * 2 * sizeof(float)];
            var sampleBytes = format.BitsPerSample / 8;
            for (int i = 0; i < frames; i++)
                for (int channel = 0; channel < 2; channel++)
                {
                    int offset = i * format.BlockAlign + Math.Min(channel, format.Channels - 1) * sampleBytes;
                    float sample;
                    if (isFloat && sampleBytes == 4) sample = BitConverter.ToSingle(e.Buffer, offset);
                    else sample = sampleBytes switch
                    {
                        1 => (e.Buffer[offset] - 128) / 128f,
                        2 => BinaryPrimitives.ReadInt16LittleEndian(e.Buffer.AsSpan(offset, 2)) / 32768f,
                        3 => ((e.Buffer[offset] | e.Buffer[offset + 1] << 8 | e.Buffer[offset + 2] << 16) << 8 >> 8) / 8388608f,
                        4 => BinaryPrimitives.ReadInt32LittleEndian(e.Buffer.AsSpan(offset, 4)) / 2147483648f,
                        _ => 0
                    };
                    BinaryPrimitives.WriteSingleLittleEndian(pcm.AsSpan((i * 2 + channel) * 4, 4), float.IsFinite(sample) ? Math.Clamp(sample, -1, 1) : 0);
                }
            onPcm(pcm);
        };
        capture.RecordingStopped += (_, e) => { if (e.Exception is not null) onError("Captura WASAPI interrompida: " + e.Exception.Message); };
        _capture = capture;
        capture.StartRecording();
        return format.SampleRate;
    }
    public void Dispose()
    {
        var previous = _capture; _capture = null;
        if (previous is not null) { previous.StopRecording(); previous.Dispose(); }
    }
}
