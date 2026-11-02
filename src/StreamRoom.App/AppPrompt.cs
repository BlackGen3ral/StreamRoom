using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace StreamRoom.App;

internal static class AppPrompt
{
    public static bool Confirm(Window owner, string title, string message, string action)
        => Create(owner, title, message, action).ShowDialog() == true;
    private static Window Create(Window owner, string title, string message, string action)
    {
        var window = new Window { Owner = owner, Title = title, Width = 460, SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize,
            WindowStyle = WindowStyle.None, ShowInTaskbar = false, Background = Brush("#1B1D26"), Foreground = Brush("#ECEBF4") };
        var panel = new StackPanel { Margin = new Thickness(28) };
        panel.Children.Add(new TextBlock { Text = "STREAMROOM", FontSize = 10, Foreground = Brush("#B5A8DB"), Margin = new Thickness(0, 0, 0, 18) });
        panel.Children.Add(new TextBlock { Text = title, FontSize = 22, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(new TextBlock { Text = message, FontSize = 13, Foreground = Brush("#B6BDCF"), TextWrapping = TextWrapping.Wrap, LineHeight = 22, Margin = new Thickness(0, 16, 0, 26) });
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var cancel = new Button { Content = "Cancelar", IsCancel = true, IsDefault = true, Padding = new Thickness(18, 10, 18, 10), Background = Brush("#2B2E39"), Foreground = Brushes.White, BorderThickness = new Thickness(0) };
        var confirm = new Button { Content = action, Padding = new Thickness(18, 10, 18, 10), Margin = new Thickness(10, 0, 0, 0), Background = Brush("#A7374A"), Foreground = Brushes.White, BorderThickness = new Thickness(0) };
        confirm.Click += (_, _) => window.DialogResult = true;
        actions.Children.Add(cancel); actions.Children.Add(confirm); panel.Children.Add(actions);
        window.Content = new Border { Child = panel, BorderThickness = new Thickness(1), BorderBrush = Brush("#454554"), CornerRadius = new CornerRadius(12) };
        window.Loaded += (_, _) => cancel.Focus();
        window.SourceInitialized += (_, _) => WindowTheme.Apply(window);
        return window;
    }
    internal static void Preview(Window owner, string output)
    {
        var window = Create(owner, "Excluir sala do grupo?", "A sala será excluída para todos. Os convites e acessos salvos deixarão de funcionar. Esta ação não pode ser desfeita.", "Excluir sala");
        window.Loaded += (_, _) => window.Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Render, () =>
        {
            var image = new System.Windows.Media.Imaging.RenderTargetBitmap((int)window.ActualWidth, (int)window.ActualHeight, 96, 96, PixelFormats.Pbgra32);
            image.Render(window);
            var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder(); encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(image));
            using (var file = System.IO.File.Create(output)) encoder.Save(file);
            window.Close();
        });
        window.ShowDialog();
    }
    private static SolidColorBrush Brush(string color) => new((Color)ColorConverter.ConvertFromString(color));
}
