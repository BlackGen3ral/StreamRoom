using System.Windows;
using Velopack;
namespace StreamRoom.App;
public partial class App : Application
{
    public static string? PickerPreviewOutput { get; private set; }
    public static string? CaptureTestOutput { get; private set; }
    public static string? NetworkTestOutput { get; private set; }
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().Run();
        int pickerPreview = Array.IndexOf(args, "--picker-preview");
        if (pickerPreview >= 0) PickerPreviewOutput = System.IO.Path.GetFullPath(args.ElementAtOrDefault(pickerPreview + 1) ?? "picker-preview.png");
        int bridgeTest = Array.IndexOf(args, "--wgc-bridge-test");
        if (bridgeTest >= 0) CaptureTestOutput = System.IO.Path.GetFullPath(args.ElementAtOrDefault(bridgeTest + 1) ?? "wgc-bridge-test.json");
        int testFlag = Array.IndexOf(args, "--network-test");
        if (testFlag >= 0) NetworkTestOutput = System.IO.Path.GetFullPath(args.ElementAtOrDefault(testFlag + 1) ?? "streamroom-network-test.json");
        var app = new App();
        app.InitializeComponent();
        int captureTest = Array.IndexOf(args, "--wgc-self-test");
        if (captureTest >= 0) { WgcSelfTest.Run(app, System.IO.Path.GetFullPath(args.ElementAtOrDefault(captureTest + 1) ?? "wgc-self-test.json")); return; }
        app.DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show("O StreamRoom encontrou uma falha. Feche e abra o aplicativo novamente.\n\n" + e.Exception.Message, "StreamRoom");
            e.Handled = true;
        };
        app.Run();
    }
}
