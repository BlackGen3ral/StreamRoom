using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace StreamRoom.App;

internal sealed class BackgroundNotice : Window
{
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(3.5) };
    private BackgroundNotice()
    {
        Width = 330; Height = 100; WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true; Background = Brushes.Transparent; ShowActivated = false;
        ShowInTaskbar = false; Topmost = true; Focusable = false; IsHitTestVisible = false;
        var area = SystemParameters.WorkArea; Left = area.Right - Width - 16; Top = area.Bottom - Height - 16;
        var content = new StackPanel { Margin = new Thickness(18, 14, 18, 14) };
        content.Children.Add(new TextBlock { Text = "StreamRoom continua na bandeja", FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White });
        content.Children.Add(new TextBlock { Text = "Sua sala continua ativa. Use o ícone da bandeja para voltar.", FontSize = 12, TextWrapping = TextWrapping.Wrap, Foreground = new SolidColorBrush(Color.FromRgb(174, 183, 202)), Margin = new Thickness(0, 8, 0, 0) });
        Content = new Border { Child = content, CornerRadius = new CornerRadius(12), BorderThickness = new Thickness(1), BorderBrush = new SolidColorBrush(Color.FromRgb(76, 68, 99)), Background = new SolidColorBrush(Color.FromRgb(29, 30, 40)) };
        SourceInitialized += (_, _) =>
        {
            var handle = new WindowInteropHelper(this).Handle;
            var style = GetWindowLongPtr(handle, -20);
            _ = SetWindowLongPtr(handle, -20, (nint)((long)style | 0x08000000 | 0x20 | 0x80)); // No activation, click-through, tool window.
        };
        Loaded += (_, _) => { if (SystemParameters.ClientAreaAnimation) BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(150))); _timer.Start(); };
        _timer.Tick += (_, _) => Close();
        Closed += (_, _) => _timer.Stop();
    }
    public static BackgroundNotice? ShowBriefly()
    {
        // Honor fullscreen, presentation and Windows notification suppression.
        if (SHQueryUserNotificationState(out var state) != 0 || state != 5) return null; // QUNS_ACCEPTS_NOTIFICATIONS
        var notice = new BackgroundNotice(); notice.Show(); return notice;
    }
    internal bool IsPassive
    {
        get
        {
            var handle = new WindowInteropHelper(this).Handle;
            return ((long)GetWindowLongPtr(handle, -20) & 0x08000020) == 0x08000020 && GetForegroundWindow() != handle;
        }
    }
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern nint SetWindowLongPtr(nint window, int index, nint value);
}
