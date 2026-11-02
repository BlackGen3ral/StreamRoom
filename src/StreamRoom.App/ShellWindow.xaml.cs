using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using StreamRoom.Core;
using Velopack;
using Velopack.Sources;

namespace StreamRoom.App;

public partial class ShellWindow : Window
{
    private const string Origin = "https://streamroom.local";
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _commands = new(1, 1);
    private readonly SystemAudioCapture _audio = new();
    private readonly UpdateManager _updates = new(new GithubSource("https://github.com/BlackGen3ral/StreamRoom", null, false));
    private readonly CaptureSources _captureSources = new();
    private NativeCapture? _nativeCapture;
    private CoreWebView2SharedBuffer? _nativeBuffer;
    private string? _nativeSession;
    private int _nativePending;
    private readonly object _nativeGate = new();
    private long _nativeSequence;
    private readonly System.Windows.Threading.DispatcherTimer _nativeWatchdog = new() { Interval = TimeSpan.FromSeconds(3) };
    private DateTime _nativeSentAt;
    private UpdateInfo? _availableUpdate;
    private bool _updateDownloaded;
    private readonly SemaphoreSlim _updateCommands = new(1, 1);
    private SignalingClient? _connection;
    private bool _closing;
    private bool _ready;
    private int _pendingAudio;
    private readonly Dictionary<string, SignalingClient> _testClients = new();
    private WindowState _previousState;
    private CaptureTestScene? _mediaTestScene;
    private readonly System.Windows.Threading.DispatcherTimer _updateTimer = new() { Interval = TimeSpan.FromMinutes(30) };
    private static string DataDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StreamRoom");

    public ShellWindow()
    {
        InitializeComponent();
        Loaded += InitializeAsync;
        _nativeWatchdog.Tick += (_, _) =>
        {
            if (_nativePending == 0 || DateTime.UtcNow - _nativeSentAt < TimeSpan.FromSeconds(3)) return;
            var session = _nativeSession; StopNativeCapture();
            Emit(new { type = "nativeCaptureEnded", session, message = "A ponte de vídeo parou de responder. Tente novamente ou use o modo compatível." });
        };
        Closing += CloseAsync;
    }
    private async void InitializeAsync(object sender, RoutedEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            var browserOptions = new CoreWebView2EnvironmentOptions { Language = "pt-BR", AdditionalBrowserArguments = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows" };
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(App.MediaTestDirectory ?? DataDirectory, "WebView2"), browserOptions);
            await Browser.EnsureCoreWebView2Async(environment);
            var core = Browser.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping("streamroom.local", Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, args) => { if (!Trusted(args.Uri)) args.Cancel = true; };
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.DownloadStarting += (_, args) => args.Cancel = true;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.ScreenCaptureStarting += (_, args) => args.Cancel = !Trusted(core.Source);
            core.WebMessageReceived += MessageAsync;
            core.ContainsFullScreenElementChanged += (_, _) =>
            {
                if (core.ContainsFullScreenElement) { _previousState = WindowState; WindowStyle = WindowStyle.None; WindowState = WindowState.Maximized; }
                else { WindowStyle = WindowStyle.SingleBorderWindow; WindowState = _previousState; }
            };
            core.ProcessFailed += async (_, _) =>
            {
                await DisconnectAsync();
                MessageBox.Show("O motor de mídia foi interrompido. A sala e a captura de áudio foram encerradas. Feche e reabra o StreamRoom.", "StreamRoom");
            };
            core.Navigate(Origin + (App.MediaTestRole is not null ? "/media-room-test.html" : App.CaptureTestOutput is not null ? "/capture-test.html" : App.NetworkTestOutput is null ? "/index.html" : "/network-test.html"));
            _updateTimer.Tick += async (_, _) =>
            {
                if (!await _updateCommands.WaitAsync(0)) return;
                try { await CheckUpdatesAsync(); } finally { _updateCommands.Release(); }
            };
            _updateTimer.Start();
        }
        catch (WebView2RuntimeNotFoundException)
        { MessageBox.Show("Instale o Microsoft Edge WebView2 Evergreen Runtime oficial e abra o StreamRoom novamente. O instalador do StreamRoom também pode instalar esse requisito.", "WebView2 necessário"); Close(); }
        catch (Exception ex) { MessageBox.Show("Não foi possível abrir o StreamRoom: " + ex.Message, "StreamRoom"); Close(); }
    }
    private static bool Trusted(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.Host == "streamroom.local" && uri.Port == 443;

    private void Emit(object value, bool allowClosing = false)
    {
        if (!_ready || _closing && !allowClosing) return;
        if (Dispatcher.CheckAccess()) Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(value, _json));
        else Dispatcher.BeginInvoke(() => Emit(value, allowClosing));
    }
    private async void MessageAsync(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Trusted(e.Source) || e.WebMessageAsJson.Length > 128 * 1024) return;
        string? id = null;
        SemaphoreSlim? commandGate = null;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var message = document.RootElement;
            var type = message.GetProperty("type").GetString();
            if (type == "nativeFrameAck" && !message.TryGetProperty("id", out _))
            {
                var ack = message.GetProperty("payload");
                if (_nativeSession == ack.GetProperty("session").GetString() && _nativeSequence == ack.GetProperty("frame").GetInt64())
                    Volatile.Write(ref _nativePending, 0);
                return;
            }
            id = message.GetProperty("id").GetString();
            commandGate = type is "checkUpdates" or "downloadUpdate" or "installUpdate" ? _updateCommands : _commands;
            await commandGate.WaitAsync();
            var p = message.GetProperty("payload");
            object? result = null;
            switch (type)
            {
                case "testCreate" when App.NetworkTestOutput is not null:
                    result = await CreateNetworkTestAsync();
                    break;
                case "testSignal" when App.NetworkTestOutput is not null:
                    await _testClients[p.GetProperty("side").GetString()!].SendSignalAsync(p.GetProperty("to").GetString()!, p.GetProperty("payload").Clone());
                    break;
                case "testStream" when App.NetworkTestOutput is not null:
                    await _testClients[p.GetProperty("side").GetString()!].SetStreamingAsync(p.GetProperty("active").GetBoolean(), p.GetProperty("streamId").GetString()!); break;
                case "testWatch" when App.NetworkTestOutput is not null:
                    await _testClients[p.GetProperty("side").GetString()!].SetWatchingAsync(p.GetProperty("publisherId").GetString()!, p.GetProperty("streamId").GetString()!, p.GetProperty("subscriptionId").GetString()!, p.GetProperty("active").GetBoolean()); break;
                case "testResult" when App.NetworkTestOutput is not null:
                    await File.WriteAllTextAsync(App.NetworkTestOutput, p.GetRawText());
                    foreach (var client in _testClients.Values) await client.DisposeAsync();
                    _testClients.Clear();
                    _ = Dispatcher.BeginInvoke(Close);
                    break;
                case "ready":
                    _ready = true;
                    JsonElement? settings = null;
                    var file = Path.Combine(DataDirectory, "settings-v2.json");
                    if (File.Exists(file))
                    {
                        try { using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(file)); settings = doc.RootElement.Clone(); }
                        catch (JsonException) { }
                    }
                    result = new { settings, version = typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.4.0-beta.1", runtime = Browser.CoreWebView2.Environment.BrowserVersionString, installed = _updates.IsInstalled, capturePreview = App.PickerPreviewOutput is not null };
                    break;
                case "settings":
                    Invitations.ValidateServer(p.GetProperty("server").GetString()!);
                    if (p.GetRawText().Length > 4096) throw new ArgumentException("Configurações inválidas.");
                    await File.WriteAllTextAsync(Path.Combine(DataDirectory, "settings-v2.json"), p.GetRawText());
                    break;
                case "connect": result = await ConnectAsync(p); break;
                case "leave": await DisconnectAsync(); break;
                case "signal":
                    await (_connection ?? throw new SignalingException("Você está desconectado.")).SendSignalAsync(p.GetProperty("to").GetString()!, p.GetProperty("payload").Clone());
                    break;
                case "stream": await (_connection ?? throw new SignalingException("Você está desconectado.")).SetStreamingAsync(p.GetProperty("active").GetBoolean(), p.GetProperty("streamId").GetString()!); break;
                case "watch":
                    await (_connection ?? throw new SignalingException("Você está desconectado.")).SetWatchingAsync(p.GetProperty("publisherId").GetString()!, p.GetProperty("streamId").GetString()!, p.GetProperty("subscriptionId").GetString()!, p.GetProperty("active").GetBoolean(), p.GetProperty("height").GetInt32(), p.GetProperty("fps").GetInt32()); break;
                case "ice": result = await (_connection ?? throw new SignalingException("Você está desconectado.")).GetIceConfigurationAsync(); break;
                case "copy": Clipboard.SetText(p.GetProperty("text").GetString()!); break;
                case "paste": result = Clipboard.ContainsText() ? Clipboard.GetText() : ""; break;
                case "captureTestSource" when App.CaptureTestOutput is not null:
                    result = new { id = _captureSources.AddTestWindow(new System.Windows.Interop.WindowInteropHelper(this).Handle) };
                    break;
                case "capturePreview" when App.PickerPreviewOutput is not null:
                    using (var preview = File.Create(App.PickerPreviewOutput)) await Browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
                    _ = Dispatcher.BeginInvoke(Close);
                    break;
                case "captureTestLog" when App.CaptureTestOutput is not null:
                    await File.AppendAllTextAsync(App.CaptureTestOutput + ".log", p.GetRawText() + "\n");
                    break;
                case "captureTestResult" when App.CaptureTestOutput is not null:
                    await File.WriteAllTextAsync(App.CaptureTestOutput, p.GetRawText());
                    _ = Dispatcher.BeginInvoke(Close);
                    break;
                case "mediaTestSetup" when App.MediaTestRole is not null:
                    if (App.MediaTestRole == "host") { _mediaTestScene = new CaptureTestScene(); _mediaTestScene.Show(); }
                    else { MinWidth = 400; MinHeight = 300; Width = 500; Height = 350; Left = SystemParameters.PrimaryScreenWidth - 510; Top = 0; }
                    result = new { role = App.MediaTestRole, server = "https://streamroom.arthostudio.com", quality = App.MediaTestHeight, fps = 60 };
                    break;
                case "mediaTestInvite" when App.MediaTestRole is not null:
                    var invitationPath = Path.Combine(App.MediaTestDirectory!, "invitation.txt");
                    if (App.MediaTestRole == "host") await File.WriteAllTextAsync(invitationPath, p.GetProperty("invitation").GetString());
                    result = File.Exists(invitationPath) ? await File.ReadAllTextAsync(invitationPath) : "";
                    break;
                case "mediaTestMonitor" when App.MediaTestRole == "host":
                    result = new { id = _captureSources.AddTestMonitor(new System.Windows.Interop.WindowInteropHelper(_mediaTestScene!).Handle) };
                    break;
                case "mediaTestState" when App.MediaTestRole == "host":
                    WindowState = p.GetProperty("minimized").GetBoolean() ? WindowState.Minimized : WindowState.Normal;
                    result = new { mode = _nativeCapture?.TransferMode, failure = _nativeCapture?.ScaleFailure, frames = _nativeCapture?.FrameCount, sourceWidth = _nativeCapture?.SourceWidth, sourceHeight = _nativeCapture?.SourceHeight, arrivals = _nativeCapture?.Arrivals, busy = _nativeCapture?.BusyDrops, backpressure = _nativeCapture?.BackpressureDrops, copyMs = _nativeCapture?.LastCopyMs, ticks = _mediaTestScene?.Ticks };
                    break;
                case "mediaTestResult" when App.MediaTestRole is not null:
                    await File.WriteAllTextAsync(Path.Combine(App.MediaTestDirectory!, App.MediaTestRole + ".json"), p.GetRawText());
                    _ = Dispatcher.BeginInvoke(Close);
                    break;
                case "captureSources":
                    result = new { supported = NativeCapture.Supported, sources = await Task.Run(() => _captureSources.List()) };
                    break;
                case "nativeCaptureStart":
                    if (_connection?.IsConnected != true && App.CaptureTestOutput is null) throw new InvalidOperationException("Entre em uma sala primeiro.");
                    StopNativeCapture();
                    var captureSource = _captureSources.Resolve(p.GetProperty("sourceId").GetString()!);
                    var nativeSession = Guid.NewGuid().ToString("N");
                    lock (_nativeGate) _nativeSession = nativeSession;
                    var capture = new NativeCapture();
                    _nativeCapture = capture;
                    capture.CanDeliver = () => Volatile.Read(ref _nativePending) == 0;
                    capture.Frame += (pixels, width, height) => SendNativeFrame(nativeSession, pixels, width, height);
                    capture.Ended += reason => Dispatcher.BeginInvoke(() =>
                    {
                        if (_nativeSession != nativeSession) return;
                        StopNativeCapture(); Emit(new { type = "nativeCaptureEnded", session = nativeSession, message = reason });
                    });
                    try { capture.Start(captureSource, p.GetProperty("fps").GetInt32(), p.TryGetProperty("quality", out var quality) ? quality.GetInt32() : 720); }
                    catch { StopNativeCapture(); throw; }
                    result = new { session = nativeSession, name = captureSource.Name };
                    break;
                case "nativeFrameAck":
                    if (_nativeSession == p.GetProperty("session").GetString() && _nativeSequence == p.GetProperty("frame").GetInt64())
                    { Volatile.Write(ref _nativePending, 0); }
                    break;
                case "nativeCaptureStop":
                    if (_nativeSession == p.GetProperty("session").GetString()) StopNativeCapture();
                    break;
                case "audioStart":
                    if (_connection?.IsConnected != true) throw new SignalingException("Entre em uma sala primeiro.");
                    int rate = _audio.Start(bytes =>
                    {
                        if (Interlocked.Increment(ref _pendingAudio) > 4) { Interlocked.Decrement(ref _pendingAudio); return; }
                        Dispatcher.BeginInvoke(() =>
                        {
                            try { Emit(new { type = "pcm", data = Convert.ToBase64String(bytes) }); }
                            finally { Interlocked.Decrement(ref _pendingAudio); }
                        });
                    }, error => Emit(new { type = "audioError", message = error }));
                    result = new { sampleRate = rate, channels = 2 };
                    break;
                case "audioStop": _audio.Dispose(); break;
                case "checkUpdates": result = await CheckUpdatesAsync(); break;
                case "downloadUpdate":
                    if (_availableUpdate is null) throw new InvalidOperationException("Consulte as atualizações primeiro.");
                    if (!_updateDownloaded)
                    {
                        await _updates.DownloadUpdatesAsync(_availableUpdate, progress => Emit(new { type = "updateProgress", progress }));
                        _updateDownloaded = true;
                    }
                    result = new { downloaded = true };
                    break;
                case "installUpdate":
                    if (_connection?.IsConnected == true) throw new InvalidOperationException("Saia da sala antes de atualizar.");
                    if (_availableUpdate is null) throw new InvalidOperationException("Nenhuma atualização aprovada disponível.");
                    if (!_updateDownloaded) throw new InvalidOperationException("Aguarde o download da atualização.");
                    _updates.ApplyUpdatesAndRestart(_availableUpdate);
                    break;
                default: throw new ArgumentException("Comando desconhecido.");
            }
            Emit(new { type = "reply", id, ok = true, result }, true);
        }
        catch (Exception ex)
        {
            // Never include native message payloads, invitations, SDP or credentials in logs.
            Emit(new { type = "reply", id, ok = false, error = ex is OperationCanceledException or TimeoutException ? "Tempo de resposta esgotado. Tente novamente." : ex.Message }, true);
        }
        finally { commandGate?.Release(); }
    }
    private async Task<object> ConnectAsync(JsonElement p)
    {
        var server = Invitations.ValidateServer(p.GetProperty("server").GetString()!);
        var name = p.GetProperty("name").GetString()!.Trim();
        if (name.Length is < 1 or > 32 || name.Any(char.IsControl)) throw new ArgumentException("Use um nome de 1 a 32 caracteres.");
        await DisconnectAsync();
        string roomId, token, invitation;
        if (p.GetProperty("mode").GetString() == "create")
        {
            var room = await SignalingClient.CreateRoomAsync(server);
            roomId = room.RoomId; token = room.HostToken;
            invitation = Invitations.Create(server, room.RoomId, room.InviteToken);
        }
        else
        {
            invitation = p.GetProperty("invite").GetString()!;
            (roomId, token) = Invitations.Parse(server, invitation);
        }
        var client = new SignalingClient(); _connection = client;
        client.RoomStateChanged += state => { if (_connection == client) Emit(new { type = "roomState", state }); };
        client.RoomRenewed += expiresAt => { if (_connection == client) Emit(new { type = "roomRenewed", expiresAt }); };
        client.SignalReceived += (from, payload) => { if (_connection == client) Emit(new { type = "signal", from, payload }); };
        client.ServerError += message => { if (_connection == client) Emit(new { type = "serverError", message }); };
        client.Disconnected += message =>
        {
            if (_connection == client) { Dispatcher.BeginInvoke(() => _audio.Dispose()); Emit(new { type = "disconnected", message }); }
        };
        try
        {
            var welcome = await client.ConnectAsync(server, roomId, token, name);
            Title = "StreamRoom · " + name;
            return new { welcome, invitation };
        }
        catch { _connection = null; await client.DisposeAsync(); throw; }
    }
    private async Task DisconnectAsync()
    {
        StopNativeCapture();
        Title = "StreamRoom";
        _audio.Dispose();
        var previous = _connection; _connection = null;
        if (previous is not null) await previous.DisposeAsync();
    }
    private void SendNativeFrame(string session, byte[] pixels, int width, int height)
    {
        lock (_nativeGate)
        { if (_nativeSession != session || _nativePending != 0) return; _nativePending = 1; }
        Dispatcher.BeginInvoke(() =>
        {
            if (_nativeSession != session || _closing) return;
            try
            {
                if (_nativeBuffer is null || _nativeBuffer.Size != (ulong)pixels.Length)
                { _nativeBuffer?.Dispose(); _nativeBuffer = Browser.CoreWebView2.Environment.CreateSharedBuffer((ulong)pixels.Length); }
                using (var stream = _nativeBuffer.OpenStream()) stream.Write(pixels);
                _nativeSentAt = DateTime.UtcNow;
                Browser.CoreWebView2.PostSharedBufferToScript(_nativeBuffer, CoreWebView2SharedBufferAccess.ReadOnly,
                    JsonSerializer.Serialize(new { type = "wgcFrame", session, frame = ++_nativeSequence, width, height }));
                _nativeWatchdog.Start();
            }
            catch (Exception e)
            { StopNativeCapture(); Emit(new { type = "nativeCaptureEnded", session, message = e.Message }); }
        });
    }
    private void StopNativeCapture()
    {
        lock (_nativeGate) { _nativeSession = null; Volatile.Write(ref _nativePending, 0); }
        _nativeCapture?.Dispose(); _nativeCapture = null;
        _nativeBuffer?.Dispose(); _nativeBuffer = null;
        Volatile.Write(ref _nativePending, 0);
        _nativeWatchdog.Stop();
    }
    private async Task<object> CheckUpdatesAsync()
    {
        if (!_updates.IsInstalled) return new { available = false, message = "Atualizações automáticas funcionam na versão instalada." };
        try
        {
            if (!_updateDownloaded) _availableUpdate = await _updates.CheckForUpdatesAsync();
            var result = new { available = _availableUpdate is not null, version = _availableUpdate?.TargetFullRelease.Version.ToString(), downloaded = _updateDownloaded, message = _availableUpdate is null ? "Você está na versão oficial mais recente." : "Nova versão oficial disponível." };
            Emit(new { type = "update", result });
            return result;
        }
        catch { return new { available = false, message = "Não foi possível consultar releases oficiais. Pode não haver uma versão publicada ainda." }; }
    }
    private async Task<object> CreateNetworkTestAsync()
    {
        var server = Invitations.ValidateServer(Environment.GetEnvironmentVariable("STREAMROOM_TEST_URL") ?? "https://streamroom.arthostudio.com");
        var room = await SignalingClient.CreateRoomAsync(server);
        var clients = new List<object>();
        for (int i = 0; i < 5; i++)
        {
            var side = i == 0 ? "host" : "viewer" + i;
            var client = new SignalingClient();
            _testClients.Add(side, client);
            client.SignalReceived += (from, payload) => Emit(new { type = "testSignal", side, from, payload });
            client.RoomStateChanged += state => Emit(new { type = "testRoomState", side, state });
            var welcome = await client.ConnectAsync(server, room.RoomId, i == 0 ? room.HostToken : room.InviteToken, "Network test " + side);
            clients.Add(new { side, id = welcome.ParticipantId });
        }
        var ice = await _testClients["host"].GetIceConfigurationAsync();
        return new { clients, ice, runtime = Browser.CoreWebView2.Environment.BrowserVersionString };
    }
    private async void CloseAsync(object? sender, CancelEventArgs e)
    {
        if (_closing) return;
        e.Cancel = true;
        _closing = true; _updateTimer.Stop(); StopNativeCapture();
        _mediaTestScene?.Close();
        try { if (_ready) await Browser.ExecuteScriptAsync("window.streamroom?.shutdown()").WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        await DisconnectAsync();
        foreach (var client in _testClients.Values) await client.DisposeAsync();
        _testClients.Clear();
        Browser.Dispose(); Close();
    }
}
