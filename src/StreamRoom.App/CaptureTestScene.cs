using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
namespace StreamRoom.App;
// A moving WPF scene keeps the real monitor capture changing while the sending WebView is minimized.
internal sealed class CaptureTestScene : Window
{
    public long Ticks { get; private set; }
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(16) };
    public CaptureTestScene()
    {
        Topmost = true; Title = "StreamRoom · teste de monitor"; Width = 1000; Height = 650; Left = 0; Top = 0;
        var canvas = new Canvas { Background = Brushes.MidnightBlue };
        var marker = new Border { Width = 240, Height = 240, Background = Brushes.LimeGreen };
        canvas.Children.Add(marker); Content = canvas;
        int tick = 0;
        _timer.Tick += (_, _) => { tick++; Ticks++; Canvas.SetLeft(marker, 350 + Math.Sin(tick / 15.0) * 300); Canvas.SetTop(marker, 180); };
        Loaded += (_, _) => _timer.Start(); Closed += (_, _) => _timer.Stop();
    }
}
