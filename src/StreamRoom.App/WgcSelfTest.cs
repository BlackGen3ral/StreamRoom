using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
namespace StreamRoom.App;
internal static class WgcSelfTest
{
    public static void Run(Application app, string output)
    {
        var panel = new Grid { Background = Brushes.DarkSlateBlue };
        panel.Children.Add(new TextBlock { Text = "StreamRoom · teste de captura WGC", FontSize = 30, Foreground = Brushes.White, Margin = new Thickness(30) });
        var marker = new Border { Background = Brushes.LimeGreen, Width = 120, Height = 120, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        panel.Children.Add(marker);
        var window = new Window { Title = "StreamRoom · teste WGC", Width = 800, Height = 500, Content = panel };
        window.Loaded += async (_, _) =>
        {
            int frames = 0, width = 0, height = 0; bool greenPixel = false; string? error = null;
            var capture = new NativeCapture();
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
            bool move = false;
            timer.Tick += (_, _) => { move = !move; marker.Margin = new Thickness(move ? 20 : 0, 0, 0, 0); };
            capture.Frame += (pixels, w, h) =>
            {
                Interlocked.Increment(ref frames); width = w; height = h;
                int center = ((h / 2) * w + w / 2) * 4;
                if (center + 2 < pixels.Length && pixels[center + 1] > pixels[center] + 30 && pixels[center + 1] > pixels[center + 2] + 30) greenPixel = true;
            };
            capture.Ended += message => error = message;
            try
            {
                await Task.Delay(400);
                var source = new CaptureSource("self-test", "window", window.Title, null, new WindowInteropHelper(window).Handle, (uint)Environment.ProcessId);
                capture.Start(source, 60, 480); timer.Start();
                await Task.Delay(5000);
                if (frames < 10 || !greenPixel) throw new InvalidOperationException("Frames ou pixels da janela de teste não foram capturados corretamente.");
            }
            catch (Exception e) { error = e.ToString(); }
            finally
            {
                timer.Stop(); capture.Dispose(); window.Close();
                await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = error is null, frames, width, height, greenPixel, transferMode = capture.TransferMode, scaleFailure = capture.ScaleFailure, error }));
                app.Shutdown(error is null ? 0 : 1);
            }
        };
        app.Run(window);
    }
}
