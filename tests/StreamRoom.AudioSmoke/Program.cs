using System.Text.Json;
using StreamRoom.App;

// Local device test only: samples are inspected in memory, never recorded, played or transmitted.
var received = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
var sampleCount = 0;
using var capture = new SystemAudioCapture();
try
{
    int sampleRate = capture.Start(bytes =>
    {
        for (int i = 0; i + 4 <= bytes.Length; i += 4)
        {
            float value = BitConverter.ToSingle(bytes, i);
            if (!float.IsFinite(value) || Math.Abs(value) > 1)
            { received.TrySetException(new Exception("Invalid captured PCM value.")); return; }
        }
        int total = Interlocked.Add(ref sampleCount, bytes.Length / sizeof(float));
        if (total >= 2048) received.TrySetResult(total);
    }, error => received.TrySetException(new Exception(error)));
    int count = await received.Task.WaitAsync(TimeSpan.FromSeconds(8));
    Console.WriteLine(JsonSerializer.Serialize(new { passed = true, sampleRate, channels = 2, capturedFrames = count / 2,
        limitation = "Real WASAPI loopback device/PCM test; no recording or transmission, no auditory or A/V sync validation." }));
}
catch (Exception ex)
{
    Console.WriteLine(JsonSerializer.Serialize(new { passed = false, error = ex.Message,
        hint = "Requires a default output device and an active audio engine; silence/device inactivity may produce no packets." }));
    Environment.ExitCode = 1;
}
