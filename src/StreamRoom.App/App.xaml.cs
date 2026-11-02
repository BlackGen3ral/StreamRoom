using System.Windows;
using Velopack;
namespace StreamRoom.App;
public partial class App : Application
{
    public static bool ZeroTierProof { get; private set; }
    public static bool ZeroTierEnabled { get; private set; }
    public static bool ZeroTierContextUnavailable { get; private set; }
    internal static void UseNormalNetworkContext() { ZeroTierEnabled = false; ZeroTierContextUnavailable = true; }
    public static string? UiPreviewOutput { get; private set; }
    public static string? PlayerLayoutTestOutput { get; private set; }
    public static string? TrayTestOutput { get; private set; }
    public static int MediaTestHeight { get; private set; } = 720;
    public static string? MediaTestRole { get; private set; }
    public static string? MediaTestDirectory { get; private set; }
    public static string? PickerPreviewOutput { get; private set; }
    public static string? CaptureTestOutput { get; private set; }
    public static string? NetworkTestOutput { get; private set; }
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().Run();
        int accountTest = Array.IndexOf(args, "--account-self-test");
        if (accountTest >= 0) { AccountSelfTest.Run(System.IO.Path.GetFullPath(args.ElementAtOrDefault(accountTest + 1) ?? "account-self-test.json")).GetAwaiter().GetResult(); return; }
        int profileTest = Array.IndexOf(args, "--profile-self-test");
        if (profileTest >= 0) { ProfileSelfTest.Run(System.IO.Path.GetFullPath(args.ElementAtOrDefault(profileTest + 1) ?? "profile-self-test.json")).GetAwaiter().GetResult(); return; }
        int previewTest = Array.IndexOf(args, "--preview-self-test");
        if (previewTest >= 0)
        {
            CapturePreviewSelfTest.Run(System.IO.Path.GetFullPath(args.ElementAtOrDefault(previewTest + 1) ?? "preview-self-test.json")).GetAwaiter().GetResult();
            return;
        }
        ZeroTierProof = args.Contains("--zerotier-proof", StringComparer.Ordinal);
#if ZEROTIER_PROOF
        ZeroTierProof = true;
#endif
        var zeroTierJoin = Array.IndexOf(args, "--zerotier-join");
        if (zeroTierJoin >= 0)
        {
            try { ZeroTierService.JoinAsync(args.ElementAtOrDefault(zeroTierJoin + 1) ?? "").GetAwaiter().GetResult(); }
            catch { Environment.ExitCode = 1; }
            return;
        }
        int restartParent = Array.IndexOf(args, "--restart-parent");
        if (restartParent >= 0 && int.TryParse(args.ElementAtOrDefault(restartParent + 1), out var parentId) && parentId != Environment.ProcessId)
        {
            try { if (!System.Diagnostics.Process.GetProcessById(parentId).WaitForExit(15000)) return; }
            catch (ArgumentException) { }
        }
        int uiPreview = Array.IndexOf(args, "--ui-preview");
        if (uiPreview >= 0) UiPreviewOutput = System.IO.Path.GetFullPath(args.ElementAtOrDefault(uiPreview + 1) ?? "ui-preview.png");
        int playerTest = Array.IndexOf(args, "--player-layout-test");
        if (playerTest >= 0) { PlayerLayoutTestOutput = System.IO.Path.GetFullPath(args.ElementAtOrDefault(playerTest + 1) ?? "player-layout-test.json"); UiPreviewOutput = PlayerLayoutTestOutput + ".preview.png"; }
        ZeroTierEnabled = ZeroTierProof || ZeroTierPreferences.Load().Enabled;
        int trayTest = Array.IndexOf(args, "--tray-self-test");
        if (trayTest >= 0) TrayTestOutput = System.IO.Path.GetFullPath(args.ElementAtOrDefault(trayTest + 1) ?? "tray-self-test.json");
        int mediaTest = Array.IndexOf(args, "--media-room-test");
        if (mediaTest >= 0)
        {
            MediaTestRole = args.ElementAtOrDefault(mediaTest + 1);
            if (MediaTestRole is not ("host" or "viewer")) throw new ArgumentException("Expected host or viewer.");
            MediaTestDirectory = System.IO.Path.GetFullPath(args.ElementAtOrDefault(mediaTest + 2) ?? "media-room-test");
            System.IO.Directory.CreateDirectory(MediaTestDirectory);
            if (int.TryParse(args.ElementAtOrDefault(mediaTest + 3), out var testHeight) && testHeight is 480 or 720 or 1080) MediaTestHeight = testHeight;
        }
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
