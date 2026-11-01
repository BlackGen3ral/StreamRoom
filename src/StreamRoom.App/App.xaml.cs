using System.Windows;
using Velopack;
namespace StreamRoom.App;
public partial class App : Application
{
    public static string? NetworkTestOutput { get; private set; }
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().Run();
        int testFlag = Array.IndexOf(args, "--network-test");
        if (testFlag >= 0) NetworkTestOutput = System.IO.Path.GetFullPath(args.ElementAtOrDefault(testFlag + 1) ?? "streamroom-network-test.json");
        var app = new App();
        app.InitializeComponent();
        app.DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show("O StreamRoom encontrou uma falha. Feche e abra o aplicativo novamente.\n\n" + e.Exception.Message, "StreamRoom");
            e.Handled = true;
        };
        app.Run();
    }
}
