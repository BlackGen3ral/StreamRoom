using System.Net.Http;
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
    private string _webOrigin = Origin;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _commands = new(1, 1);
    private readonly SemaphoreSlim _previewCommands = new(4, 4);
    private readonly SemaphoreSlim _profileCommands = new(1, 1);
    private readonly SemaphoreSlim _tailscaleCommands = new(1, 1);
    private readonly SemaphoreSlim _zeroTierStatusCommands = new(1, 1);
    private readonly SemaphoreSlim _discordSetupCommands = new(1, 1);
    private readonly DiscordSetup _discordSetup = new();
    private readonly TailscaleService _tailscale = new();
    private bool _tailscaleWebRtcReady;
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
    private long _nativeSentAt;
    private bool _nativeDelayed;
    private UpdateInfo? _availableUpdate;
    private bool _updateDownloaded;
    private bool _retiringTailscale;
    private BackgroundNotice? _backgroundNotice;
    private readonly ZeroTierDownload _zeroTierDownload = new();
    private readonly SemaphoreSlim _updateCommands = new(1, 1);
    private SignalingClient? _connection;
    private Participant[] _participants = [];
    private DirectoryPerson[] _peopleResults=[];
    private DateTime _peopleSearchAt;
    private long _cameraAllowedUntil;
    private string? _selfParticipantId;
    private Task<ClientConfiguration>? _clientConfiguration;
    private CancellationTokenSource? _googleLogin;
    private (string Token, string Nonce)? _roomSyncCredential;
    private CancellationTokenSource? _roomSync;
    private bool _closing;
    private bool _exitRequested;
    private bool _testCloseToTray;
    private bool _backgroundExplained;
    private TrayIcon? _tray;
    private bool _ready;
    private int _pendingAudio;
    private readonly Dictionary<string, SignalingClient> _testClients = new();
    private WindowState _previousState;
    private bool _browserFullScreen;
    private CaptureTestScene? _mediaTestScene;
    private readonly System.Windows.Threading.DispatcherTimer _updateTimer = new() { Interval = TimeSpan.FromMinutes(30) };
    private static string DataDirectory => App.MediaTestDirectory is { } media
        ? Path.Combine(media, App.MediaTestRole ?? "profile")
        : (App.UiPreviewOutput ?? App.CaptureTestOutput ?? App.NetworkTestOutput ?? App.TrayTestOutput ?? App.PickerPreviewOutput) is { } diagnostic
            ? diagnostic + ".data"
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StreamRoom", App.ZeroTierProof ? "ZeroTierProof" : ".");

    public ShellWindow()
    {
        InitializeComponent();
        SourceInitialized += (_, _) => WindowTheme.Apply(this);
        Activated += (_, _) => WindowTheme.Apply(this);
        Loaded += InitializeAsync;
        _nativeWatchdog.Tick += (_, _) =>
        {
            // Queued frames have not reached the browser yet. A slow consumer is
            // allowed to recover without reusing any unacknowledged shared bytes.
            if (Volatile.Read(ref _nativePending) != 2) return;
            var elapsed = System.Diagnostics.Stopwatch.GetElapsedTime(_nativeSentAt);
            if (elapsed < TimeSpan.FromSeconds(3)) return;
            if (!_nativeDelayed) { _nativeDelayed = true; Emit(new { type = "nativeCaptureDelayed", session = _nativeSession }); }
            if (elapsed < TimeSpan.FromSeconds(20)) return;
            var session = _nativeSession; StopNativeCapture();
            Emit(new { type = "nativeCaptureEnded", session, message = "A ponte de vídeo ficou sem resposta por 20 segundos. Tente novamente ou use o modo compatível." });
        };
        Closing += CloseAsync;
    }
    private async void InitializeAsync(object sender, RoutedEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            _clientConfiguration = App.UiPreviewOutput is not null || App.ZeroTierProof || App.MediaTestRole is not null || App.NetworkTestOutput is not null || App.CaptureTestOutput is not null || App.TrayTestOutput is not null || App.PickerPreviewOutput is not null
                ? Task.FromResult(new ClientConfiguration()) : ClientConfiguration.FetchAsync(DataDirectory);
            try
            {
                using var startupSettings = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(DataDirectory, "settings-v2.json")));
                _tailscaleWebRtcReady = false; // Retired integration; ZeroTier is the supported private network.
            }
            catch (Exception ex) when (ex is IOException or JsonException) { }
            if (App.ZeroTierEnabled) _tailscaleWebRtcReady = false;
            var browserOptions = new CoreWebView2EnvironmentOptions { Language = "pt-BR", AdditionalBrowserArguments = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows" };
            if(App.MediaTestRole is not null&&Environment.GetEnvironmentVariable("STREAMROOM_TEST_CAMERA")=="2")browserOptions.AdditionalBrowserArguments+=" --use-fake-device-for-media-stream";
            browserOptions.AreBrowserExtensionsEnabled = App.ZeroTierEnabled;
            // Opt-in only: expose real host candidates to room participants so ICE
            // can reach the Tailscale adapter. No invented/replaced candidate IPs.
            if (_tailscaleWebRtcReady) browserOptions.AdditionalBrowserArguments += " --force-webrtc-ip-handling-policy=default --disable-features=WebRtcHideLocalIpsWithMdns";
            var browserData = DataDirectory;
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(browserData, App.ZeroTierEnabled ? "WebView2-ZeroTier" : _tailscaleWebRtcReady ? "WebView2-Tailscale" : "WebView2"), browserOptions);
            await Browser.EnsureCoreWebView2Async(environment);
            var core = Browser.CoreWebView2;
            if (App.ZeroTierEnabled)
            {
                try
                {
                    var extension = await core.Profile.AddBrowserExtensionAsync(Path.Combine(AppContext.BaseDirectory, "Web"));
                    _webOrigin = "chrome-extension://" + extension.Id;
                }
                catch (Exception ex) when (!App.ZeroTierProof && ex is (System.Runtime.InteropServices.COMException or NotSupportedException))
                { App.UseNormalNetworkContext(); }
            }
            try { _tray = new TrayIcon(this, OpenFromTray, () => { _exitRequested = true; Close(); }); }
            catch (Win32Exception) { /* Keep normal close behavior if the Windows tray is unavailable. */ }
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping("streamroom.local", Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, args) => { if (!Trusted(args.Uri)) args.Cancel = true; };
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.DownloadStarting += (_, args) => args.Cancel = true;
            core.PermissionRequested += (_, args) => {
                args.SavesInProfile=false;
                bool allow=args.PermissionKind==CoreWebView2PermissionKind.Camera&&Trusted(core.Source)&&Trusted(args.Uri)&&Environment.TickCount64<_cameraAllowedUntil;
                args.State=allow?CoreWebView2PermissionState.Allow:CoreWebView2PermissionState.Deny;
                if(allow)_cameraAllowedUntil=0;
            };
            core.ScreenCaptureStarting += (_, args) => args.Cancel = !Trusted(core.Source);
            core.WebMessageReceived += MessageAsync;
            core.ContainsFullScreenElementChanged += (_, _) =>
            {
                if (core.ContainsFullScreenElement == _browserFullScreen) return;
                _browserFullScreen = core.ContainsFullScreenElement;
                if (_browserFullScreen) { _previousState = WindowState; WindowStyle = WindowStyle.None; WindowState = WindowState.Maximized; }
                else { WindowStyle = WindowStyle.SingleBorderWindow; WindowState = _previousState; }
            };
            core.ProcessFailed += async (_, _) =>
            {
                await DisconnectAsync();
                MessageBox.Show("O motor de mídia foi interrompido. A sala e a captura de áudio foram encerradas. Feche e reabra o StreamRoom.", "StreamRoom");
            };
            core.Navigate(_webOrigin + (App.TrayTestOutput is not null ? "/tray-test.html" : App.MediaTestRole is not null ? "/media-room-test.html" : App.CaptureTestOutput is not null ? "/capture-test.html" : App.NetworkTestOutput is null ? "/index.html" : "/network-test.html"));
            _updateTimer.Tick += async (_, _) =>
            {
                if (!await _updateCommands.WaitAsync(0)) return;
                try { await CheckUpdatesAsync(); } finally { _updateCommands.Release(); }
            };
            if (!App.ZeroTierProof) _updateTimer.Start();
        }
        catch (WebView2RuntimeNotFoundException)
        { MessageBox.Show("Instale o Microsoft Edge WebView2 Evergreen Runtime oficial e abra o StreamRoom novamente. O instalador do StreamRoom também pode instalar esse requisito.", "WebView2 necessário"); Close(); }
        catch (Exception ex) { MessageBox.Show("Não foi possível abrir o StreamRoom: " + ex.Message, "StreamRoom"); Close(); }
    }
    private bool Trusted(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (App.ZeroTierEnabled ? uri.Scheme == "chrome-extension" && uri.Host == new Uri(_webOrigin).Host
            : uri.Scheme == "https" && uri.Host == "streamroom.local" && uri.Port == 443);

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
                {
                    Volatile.Write(ref _nativePending, 0);
                    if (_nativeDelayed) { _nativeDelayed = false; Emit(new { type = "nativeCaptureResumed", session = _nativeSession }); }
                }
                return;
            }
            id = message.GetProperty("id").GetString();
            if (type?.StartsWith("tailscale", StringComparison.Ordinal) == true)
                throw new InvalidOperationException("A integração Tailscale foi retirada. Use a opção ZeroTier em Conexões.");
            if (type == "googleCancel") { _googleLogin?.Cancel(); Emit(new { type = "reply", id, ok = true, result = new { } }); return; }
            var discordCommand = type?.StartsWith("discordSetup", StringComparison.Ordinal) == true;
            if (discordCommand && type != "discordSetupStatus" && !DiscordSetup.Available) throw new InvalidOperationException("Os arquivos do assistente do Discord estão indisponíveis.");
            if (discordCommand && _exitRequested) throw new InvalidOperationException("Aguarde a reinicialização do StreamRoom.");
            commandGate = discordCommand ? _discordSetupCommands : type is "profilePhoto" or "profileSave" or "googleSignIn" or "googleDisconnect" ? _profileCommands : type == "captureThumbnail" ? _previewCommands : type == "zeroTierStatus" ? _zeroTierStatusCommands : type?.StartsWith("tailscale", StringComparison.Ordinal) == true ? _tailscaleCommands : type is "checkUpdates" or "downloadUpdate" or "installUpdate" ? _updateCommands : _commands;
            await commandGate.WaitAsync();
            var p = message.GetProperty("payload");
            object? result = null;
            switch (type)
            {
                case "discordSetupStatus":
                    result = new { available = DiscordSetup.Available, repairAvailable = DiscordSetup.Available && DiscordSetup.RepairAvailable(), prepared = _discordSetup.IsPrepared }; break;
                case "discordSetupProton": DiscordSetup.OpenProton(); break;
                case "discordSetupImport": result = _discordSetup.PickProfile(this); break;
                case "discordSetupPrepare":
                    var repairOnly = p.TryGetProperty("repairOnly", out var repair) && repair.ValueKind == JsonValueKind.True;
                    await _discordSetup.PrepareAsync(repairOnly, (percent, label) => Emit(new { type = "discordSetupProgress", percent, label }));
                    break;
                case "discordSetupRestart":
                    var enableQuality = p.TryGetProperty("quality", out var discordQuality) && discordQuality.ValueKind == JsonValueKind.True;
                    result = await _discordSetup.ApplyAndRestartAsync(enableQuality, (percent, label) => Emit(new { type = "discordSetupProgress", percent, label }));
                    break;
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
                    var configuration = await (_clientConfiguration ?? Task.FromResult(new ClientConfiguration()));
                    result = new { settings, profile = ProfileStore.Load(DataDirectory), firstRun = FirstRunStore.ShouldPresent(DataDirectory), clientConfiguration = configuration, google = GoogleAccountStore.Status(DataDirectory), zeroTierProof = App.ZeroTierProof, zeroTierEnabled = App.ZeroTierEnabled, zeroTierContextUnavailable = App.ZeroTierContextUnavailable, version = typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.4.0-beta.1", runtime = Browser.CoreWebView2.Environment.BrowserVersionString, installed = !App.ZeroTierProof && _updates.IsInstalled, capturePreview = App.PickerPreviewOutput is not null, uiPreview = App.UiPreviewOutput is not null, playerLayoutTest = App.PlayerLayoutTestOutput is not null };
                    break;
                case "welcomeComplete": await FirstRunStore.CompleteAsync(DataDirectory); break;
                case "googleSignIn":
                    if (App.UiPreviewOutput is not null || App.MediaTestRole is not null) throw new IOException("Login indisponível no diagnóstico isolado.");
                    var googleConfig = await (_clientConfiguration ?? Task.FromResult(new ClientConfiguration()));
                    using (var login = new CancellationTokenSource())
                    {
                        _googleLogin = login;
                        try
                        {
                            var identity = await GoogleLogin.SignInAsync(googleConfig.GoogleClientId, login.Token, googleConfig.GoogleTokenExchangeReady, (jwt, nonce) => _roomSyncCredential = (jwt, nonce));
                            await GoogleAccountStore.SaveAsync(DataDirectory, identity);
                            result = new { account = GoogleAccountStore.Status(DataDirectory), name = identity.Name, avatar = identity.Avatar };
                        }
                        finally { _googleLogin = null; }
                    }
                    break;
                case "googleDisconnect":
                    _roomSyncCredential = null; _roomSync?.Cancel();
                    GoogleAccountStore.Remove(DataDirectory); result = GoogleAccountStore.Status(DataDirectory); break;
                case "friendsStatus": result = FriendBook.Load(DataDirectory); break;
                case "peopleStatus": result=PeopleService.Status(DataDirectory);break;
                case "peoplePublish":
                    var publicProfile=await PeopleService.PublishAsync(DataDirectory,p.GetProperty("listed").GetBoolean(),_connection?.IsConnected==true);
                    result=new{profile=publicProfile,status=PeopleService.Status(DataDirectory)};break;
                case "peopleSearch":
                    _peopleResults=await PeopleService.SearchAsync(p.GetProperty("query").GetString()??"");_peopleSearchAt=DateTime.UtcNow;result=_peopleResults;break;
                case "peopleAdd":
                    var person=_peopleResults.FirstOrDefault(item=>item.Id==p.GetProperty("id").GetString());
                    if(person is null||DateTime.UtcNow-_peopleSearchAt>TimeSpan.FromMinutes(2))throw new IOException("Faça a busca novamente antes de adicionar essa pessoa.");
                    if(person.Id==ProfileStore.Load(DataDirectory)?.Id)throw new IOException("Esse é seu próprio perfil.");
                    result=await FriendBook.SavePeerAsync(DataDirectory,new Participant(person.Id,person.Name,"viewer",Avatar:person.Avatar,ProfileId:person.Id));break;
                case "friendSave":
                    if (_connection?.IsConnected != true) throw new IOException("Entre na sala para salvar um amigo que está nela.");
                    var peer = _participants.FirstOrDefault(peer => peer.Id == p.GetProperty("participantId").GetString());
                    if (peer is null || peer.Id == _selfParticipantId || peer.ProfileId == ProfileStore.Load(DataDirectory)?.Id) throw new IOException("Escolha outro participante da sala para salvar como amigo.");
                    result = await FriendBook.SavePeerAsync(DataDirectory, peer); break;
                case "friendRemove": result = await FriendBook.RemoveAsync(DataDirectory, p.GetProperty("profileId").GetString() ?? ""); break;
                case "playerLayoutReady" when App.PlayerLayoutTestOutput is not null:
                    await PlayerLayoutSelfTest.Run(this, Browser.CoreWebView2, App.PlayerLayoutTestOutput);
                    _exitRequested = true; _ = Dispatcher.BeginInvoke(Close); break;
                case "profilePhoto":
                    result = new { avatar = await ProfileStore.ChoosePhotoAsync(this) }; break;
                case "profileSave":
                    var profile = await ProfileStore.SaveAsync(DataDirectory, p.GetProperty("name").GetString() ?? "", p.TryGetProperty("avatar", out var photo) && photo.ValueKind == JsonValueKind.String ? photo.GetString() : null, !p.TryGetProperty("sounds", out var soundPreference) || soundPreference.ValueKind != JsonValueKind.False);
                    string? profileNotice = null;
                    if (_connection?.IsConnected == true)
                    {
                        try { await _connection.UpdateProfileAsync(profile.Name, profile.Avatar); }
                        catch (SignalingException error) { profileNotice = "Perfil salvo neste PC. " + error.Message; }
                        catch (Exception error) when (error is TimeoutException or System.Net.WebSockets.WebSocketException or OperationCanceledException)
                        { profileNotice = "Perfil salvo neste PC. A atualização na sala não foi confirmada; entre novamente para aplicar aos amigos."; }
                    }
                    Title = "StreamRoom · " + profile.Name;
                    result = new { profile, message = profileNotice }; break;
                case "retireTailscale":
                    if (App.UiPreviewOutput is not null || App.ZeroTierProof || !_updates.IsInstalled || _updates.IsPortable) break;
                    if (_connection?.IsConnected == true) throw new IOException("Saia da sala antes de remover o Tailscale.");
                    _retiringTailscale = true;
                    try { result = new { message = await TailscaleRetirement.RunAsync(this, DataDirectory) }; }
                    finally { _retiringTailscale = false; }
                    break;
                case "updateOutcome":
                    var transition = Path.Combine(DataDirectory, "update-transition.json");
                    if (File.Exists(transition))
                    {
                        using var pending = JsonDocument.Parse(await File.ReadAllTextAsync(transition));
                        var target = pending.RootElement.GetProperty("target").GetString();
                        var actual = typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0];
                        result = new { message = actual == target ? $"StreamRoom {actual} atualizado com sucesso." : "A atualização anterior não foi concluída. Verifique as atualizações para tentar novamente." };
                        File.Delete(transition);
                    }
                    break;
                case "zeroTierStatus":
                    var zeroTier = new ZeroTierService(); var zeroTierConfig = ZeroTierPreferences.Load();
                    var defaults = await (_clientConfiguration ?? Task.FromResult(new ClientConfiguration()));
                    var targetNetwork = zeroTierConfig.NetworkId.Length > 0 ? zeroTierConfig.NetworkId : defaults.DefaultZeroTierNetworkId;
                    var zeroTierStatus = await zeroTier.StatusAsync(targetNetwork);
                    result = new { status = zeroTierStatus, networkId = targetNetwork.Length > 0 ? targetNetwork : zeroTier.DetectedNetworkId, defaultNetwork = targetNetwork.Length > 0 && targetNetwork == defaults.DefaultZeroTierNetworkId, enabled = zeroTierConfig.Enabled, active = App.ZeroTierEnabled, proof = App.ZeroTierProof }; break;
                case "zeroTierConfigure":
                    if (App.ZeroTierProof) throw new InvalidOperationException("A configuração do protótipo é definida pelo pacote.");
                    if (_connection?.IsConnected == true) throw new InvalidOperationException("Saia da sala antes de alterar a rede privada.");
                    await ZeroTierPreferences.SaveAsync((p.GetProperty("networkId").GetString() ?? "").Trim().ToLowerInvariant(), p.GetProperty("enabled").GetBoolean()); break;
                case "zeroTierRestart":
                    if (_connection?.IsConnected == true) throw new InvalidOperationException("Saia da sala antes de reiniciar.");
                    var zRestart = new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false };
                    if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase)) zRestart.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "StreamRoom.dll"));
                    zRestart.ArgumentList.Add("--restart-parent"); zRestart.ArgumentList.Add(Environment.ProcessId.ToString());
                    if (App.ZeroTierProof) zRestart.ArgumentList.Add("--zerotier-proof");
                    System.Diagnostics.Process.Start(zRestart); _exitRequested = true; Close(); break;
                case "zeroTierDownload":
                    await _zeroTierDownload.DownloadAsync((percent, bytes) => Emit(new { type = "zeroTierDownloadProgress", percent, bytes }));
                    result = new { ready = true }; break;
                case "zeroTierInstall":
                    if (_connection?.IsConnected == true) throw new IOException("Saia da sala antes de instalar um serviço de rede.");
                    _zeroTierDownload.OpenInstaller(); break;
                case "zeroTierJoin":
                    if (_connection?.IsConnected == true) throw new InvalidOperationException("Saia da sala antes de conectar este PC à rede privada.");
                    if (!AppPrompt.Confirm(this, "Conectar à rede dos amigos?", "O Windows pode pedir autorização. O proprietário deverá autorizar este PC no ZeroTier. Depois, o serviço manterá a conexão automaticamente. Sua rota padrão da internet e o DNS serão preservados.", "Conectar PC"))
                    { result = new { cancelled = true }; break; }
                    await ZeroTierService.RequestJoinAsync();
                    result = new { cancelled = false }; break;
                case "settings":
                    Invitations.ValidateServer(p.GetProperty("server").GetString()!);
                    if (p.GetRawText().Length > 4096) throw new ArgumentException("Configurações inválidas.");
                    await File.WriteAllTextAsync(Path.Combine(DataDirectory, "settings-v2.json"), p.GetRawText());
                    break;
                case "groupRoomStatus":
                    var group = SavedGroupRoom.Load(DataDirectory);
                    result = new { saved = group is not null, owner = group?.Owner ?? false }; break;
                case "groupRoomForget":
                    if (_connection?.IsConnected == true) throw new IOException("Saia da sala antes de remover o acesso salvo.");
                    if (AppPrompt.Confirm(this, "Remover acesso deste PC?", "A sala continuará existindo. Se você é o criador, perderá o controle de exclusão e precisará de um convite para voltar.", "Remover acesso"))
                        SavedGroupRoom.Forget(DataDirectory);
                    break;
                case "groupRoomDestroy":
                    if (AppPrompt.Confirm(this, "Excluir sala do grupo?", "A sala será excluída para todos. Os convites e acessos salvos deixarão de funcionar. Esta ação não pode ser desfeita.", "Excluir sala"))
                    {
                        await (_connection ?? throw new IOException("Entre na sala para excluí-la.")).DestroyGroupRoomAsync();
                        SavedGroupRoom.Forget(DataDirectory);
                        await DisconnectAsync(); result = new { deleted = true };
                    }
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
                case "tailscaleStatus": result = new { status = await _tailscale.StatusAsync(), webRtcReady = _tailscaleWebRtcReady }; break;
                case "tailscaleProbe": result = new { status = await _tailscale.ProbeAsync(p.GetProperty("address").GetString()!), webRtcReady = _tailscaleWebRtcReady }; break;
                case "tailscaleOpen": _tailscale.OpenClient(); break;
                case "tailscaleInvitations": TailscaleService.OpenInvitations(); break;
                case "tailscaleInstall":
                    if (MessageBox.Show(this, "Instalar o Tailscale oficial neste computador?\n\nO download será feito do site da Tailscale, com assinatura digital verificada. O Windows pedirá autorização de administrador. Entre com sua própria conta no Tailscale; o StreamRoom não recebe sua senha nem tokens. Use o plano pessoal gratuito.", "Instalar Tailscale", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes)
                    { result = new { cancelled = true }; break; }
                    await _tailscale.InstallAsync(); result = new { cancelled = false }; break;
                case "tailscaleRestart":
                    if (_connection?.IsConnected == true) throw new InvalidOperationException("Saia da sala antes de reiniciar.");
                    var restart = new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false };
                    restart.ArgumentList.Add("--restart-parent"); restart.ArgumentList.Add(Environment.ProcessId.ToString());
                    System.Diagnostics.Process.Start(restart); _exitRequested = true; Close(); break;
                case "copy": Clipboard.SetText(p.GetProperty("text").GetString()!); break;
                case "paste": result = Clipboard.ContainsText() ? Clipboard.GetText() : ""; break;
                case "captureTestSource" when App.CaptureTestOutput is not null:
                    result = new { id = _captureSources.AddTestWindow(new System.Windows.Interop.WindowInteropHelper(this).Handle) };
                    break;
                case "uiPreview" when App.UiPreviewOutput is not null:
                    if (Path.GetFileName(App.UiPreviewOutput) == "confirm-preview.png") AppPrompt.Preview(this, App.UiPreviewOutput);
                    else using (var preview = File.Create(App.UiPreviewOutput)) await Browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
                    _ = Dispatcher.BeginInvoke(Close);
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
                case "trayTestClose" when App.TrayTestOutput is not null:
                    _testCloseToTray = true;
                    try { Close(); } finally { _testCloseToTray = false; }
                    result = new { hidden = !IsVisible, tray = _tray?.IsAvailable, ready = _ready, closing = _closing, noticePassive = _backgroundNotice is null || _backgroundNotice.IsPassive };
                    break;
                case "trayTestOpen" when App.TrayTestOutput is not null:
                    OpenFromTray(); result = new { visible = IsVisible, tray = _tray?.IsAvailable };
                    break;
                case "trayTestFinish" when App.TrayTestOutput is not null:
                    await File.WriteAllTextAsync(App.TrayTestOutput, p.GetRawText());
                    _exitRequested = true; _ = Dispatcher.BeginInvoke(Close);
                    break;
                case "mediaTestSetup" when App.MediaTestRole is not null:
                    if (App.MediaTestRole == "host") { _mediaTestScene = new CaptureTestScene(); if (Environment.GetEnvironmentVariable("STREAMROOM_TEST_MONITOR_WINDOW") is null) _mediaTestScene.Show(); }
                    else { MinWidth = 400; MinHeight = 300; Width = 500; Height = 350; Left = SystemParameters.PrimaryScreenWidth - 510; Top = 0; }
                    result = new { role = App.MediaTestRole, server = "https://streamroom.arthostudio.com", quality = App.MediaTestHeight, fps = 60, testCamera=Environment.GetEnvironmentVariable("STREAMROOM_TEST_CAMERA") is "1" or "2", fakeCamera=Environment.GetEnvironmentVariable("STREAMROOM_TEST_CAMERA")=="2" };
                    break;
                case "mediaTestInvite" when App.MediaTestRole is not null:
                    var invitationPath = Path.Combine(App.MediaTestDirectory!, "invitation.txt");
                    if (App.MediaTestRole == "host") await File.WriteAllTextAsync(invitationPath, p.GetProperty("invitation").GetString());
                    result = File.Exists(invitationPath) ? await File.ReadAllTextAsync(invitationPath) : "";
                    break;
                case "mediaTestMonitor" when App.MediaTestRole == "host":
                    result = new { id = _captureSources.AddTestMonitor(long.TryParse(Environment.GetEnvironmentVariable("STREAMROOM_TEST_MONITOR_WINDOW"), out var testMonitorWindow) ? (nint)testMonitorWindow : new System.Windows.Interop.WindowInteropHelper(_mediaTestScene!).Handle) };
                    break;
                case "mediaTestState" when App.MediaTestRole == "host":
                    if (p.GetProperty("minimized").GetBoolean())
                    {
                        _testCloseToTray = true;
                        try { Close(); } finally { _testCloseToTray = false; }
                    }
                    else OpenFromTray();
                    result = new { hidden = !IsVisible, connected = _connection?.IsConnected, closing = _closing, tray = _tray?.IsAvailable, mode = _nativeCapture?.TransferMode, failure = _nativeCapture?.ScaleFailure, frames = _nativeCapture?.FrameCount, sourceWidth = _nativeCapture?.SourceWidth, sourceHeight = _nativeCapture?.SourceHeight, arrivals = _nativeCapture?.Arrivals, busy = _nativeCapture?.BusyDrops, backpressure = _nativeCapture?.BackpressureDrops, copyMs = _nativeCapture?.LastCopyMs, ticks = _mediaTestScene?.Ticks };
                    break;
                case "mediaTestResult" when App.MediaTestRole is not null:
                    await File.WriteAllTextAsync(Path.Combine(App.MediaTestDirectory!, App.MediaTestRole + ".json"), p.GetRawText());
                    _ = Dispatcher.BeginInvoke(Close);
                    break;
                case "captureSources":
                    result = new { supported = NativeCapture.Supported, sources = await Task.Run(() => _captureSources.List()) };
                    break;
                case "captureThumbnail":
                    result = new { thumbnail = await _captureSources.ThumbnailAsync(p.GetProperty("sourceId").GetString()!) };
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
                    try
                    {
                        await NativeCapture.RequestBorderlessAccessAsync();
                        capture.Start(captureSource, p.GetProperty("fps").GetInt32(), p.TryGetProperty("quality", out var quality) ? quality.GetInt32() : 720);
                    }
                    catch { StopNativeCapture(); throw; }
                    result = new { session = nativeSession, name = captureSource.Name };
                    break;
                case "nativeFrameAck":
                    if (_nativeSession == p.GetProperty("session").GetString() && _nativeSequence == p.GetProperty("frame").GetInt64())
                    { Volatile.Write(ref _nativePending, 0); }
                    break;
                case "nativeCaptureConfigure":
                    if (_nativeSession != p.GetProperty("session").GetString() || _nativeCapture is null)
                        throw new InvalidOperationException("A fonte de captura mudou. Tente novamente.");
                    _nativeCapture.Configure(p.GetProperty("fps").GetInt32(), p.GetProperty("quality").GetInt32());
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
                case "cameraPermissionBegin":
                    if(_connection?.IsConnected!=true)throw new IOException("Entre na sala e compartilhe sua tela antes de ligar a câmera.");
                    _cameraAllowedUntil=Environment.TickCount64+15000;break;
                case "cameraPermissionEnd": _cameraAllowedUntil=0;break;
                case "audioStop": _audio.Dispose(); break;
                case "checkUpdates": result = await CheckUpdatesAsync(); break;
                case "downloadUpdate":
                    if (App.ZeroTierProof) throw new InvalidOperationException("Atualizações estáveis desativadas neste protótipo.");
                    if (_availableUpdate is null) throw new InvalidOperationException("Consulte as atualizações primeiro.");
                    if (!_updateDownloaded)
                    {
                        await _updates.DownloadUpdatesAsync(_availableUpdate, progress => Emit(new { type = "updateProgress", progress }));
                        _updateDownloaded = true;
                    }
                    result = new { downloaded = true };
                    break;
                case "installUpdate":
                    if (_retiringTailscale) throw new InvalidOperationException("Aguarde a remoção do Tailscale terminar antes de reiniciar.");
                    if (_discordSetupCommands.CurrentCount == 0) throw new InvalidOperationException("Aguarde a configuração do Discord terminar antes de reiniciar.");
                    if (App.ZeroTierProof) throw new InvalidOperationException("Atualizações estáveis desativadas neste protótipo.");
                    if (_connection?.IsConnected == true) throw new InvalidOperationException("Saia da sala antes de atualizar.");
                    if (_availableUpdate is null) throw new InvalidOperationException("Nenhuma atualização aprovada disponível.");
                    if (!_updateDownloaded) throw new InvalidOperationException("Aguarde o download da atualização.");
                    _exitRequested = true;
                    try
                    {
                        await File.WriteAllTextAsync(Path.Combine(DataDirectory, "update-transition.json"), JsonSerializer.Serialize(new { target = _availableUpdate.TargetFullRelease.Version.ToString() }));
                        _updates.WaitExitThenApplyUpdates(_availableUpdate, silent: true, restart: true);
                        _ = Dispatcher.BeginInvoke(Close);
                    }
                    catch { _exitRequested = false; throw; }
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
        var mode = p.GetProperty("mode").GetString();
        bool creating = mode is "create" or "createFixed";
        if (mode is not ("create" or "createFixed" or "saved" or "join")) throw new ArgumentException("Modo de entrada inválido.");
        if (mode == "createFixed" && SavedGroupRoom.Load(DataDirectory) is not null)
            throw new IOException("Já existe uma sala do grupo salva. Entre nela ou remova o acesso salvo antes de criar outra.");
        var saved = mode == "saved" ? SavedGroupRoom.Load(DataDirectory) ?? throw new IOException("Nenhuma sala do grupo salva.") : null;
        var server = saved is not null ? Invitations.ValidateServer(saved.Server) : creating
            ? Invitations.ValidateServer(p.GetProperty("server").GetString()!)
            : Invitations.ServerFromInvitation(p.GetProperty("invite").GetString()!);
        var name = p.GetProperty("name").GetString()!.Trim();
        if (name.Length is < 1 or > 32 || name.Any(char.IsControl)) throw new ArgumentException("Use um nome de 1 a 32 caracteres.");
        var previousProfile = ProfileStore.Load(DataDirectory);
        var localProfile = await ProfileStore.SaveAsync(DataDirectory, name, previousProfile?.Avatar, previousProfile?.Sounds ?? true);
        await DisconnectAsync();
        string roomId, token, invitation;
        if (creating)
        {
            var room = await SignalingClient.CreateRoomAsync(server, persistent: mode == "createFixed");
            if (mode == "createFixed" && !room.Persistent) throw new IOException("O servidor ainda não oferece salas fixas. A atualização do servidor precisa ser concluída.");
            roomId = room.RoomId; token = room.HostToken;
            invitation = Invitations.Create(server, room.RoomId, room.InviteToken);
        }
        else if (saved is not null)
        { roomId = saved.RoomId; token = saved.Token; invitation = saved.Invitation; }
        else
        {
            invitation = p.GetProperty("invite").GetString()!;
            (roomId, token) = Invitations.Parse(server, invitation);
        }
        var client = new SignalingClient(); _connection = client;
        client.ParticipantsChanged += peers => { if (_connection == client) _participants = peers.ToArray(); };
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
            var welcome = await client.ConnectAsync(server, roomId, token, name, avatar: localProfile.Avatar, profileId: localProfile.Id);
            _selfParticipantId = welcome.ParticipantId;
            if (welcome.Persistent)
            {
                var existing = SavedGroupRoom.Load(DataDirectory);
                var sameRoom = existing?.RoomId == roomId && existing.Server == server.AbsoluteUri;
                if (existing is not null && !sameRoom)
                    throw new IOException("Outra sala do grupo já está salva neste PC. Remova o acesso salvo antes de trocar de grupo.");
                if (existing is null || sameRoom && (!existing.Owner || welcome.Role == "host"))
                    await new SavedGroupRoom(server.AbsoluteUri, roomId, token, invitation, welcome.Role == "host").SaveAsync(DataDirectory);
            }
            if (_roomSyncCredential is { } proof && server.AbsoluteUri == "https://streamroom.arthostudio.com/")
            {
                var sync = new CancellationTokenSource();
                _roomSync = sync;
                _ = PublishActiveRoomAsync(client, invitation, roomId, welcome.ParticipantId, proof, sync);
            }
            Title = "StreamRoom · " + name;
            return new { welcome, invitation, server = server.AbsoluteUri.TrimEnd('/') };
        }
        catch
        {
            // Do not leave a permanent room orphaned if Windows cannot save its owner access.
            if (mode == "createFixed" && client.IsConnected)
            {
                try { await client.DestroyGroupRoomAsync(); }
                catch (Exception cleanupError) { System.Diagnostics.Debug.WriteLine("Group creation cleanup failed: " + cleanupError.GetType().Name); }
            }
            _connection = null; await client.DisposeAsync(); throw;
        }
    }
    private async Task PublishActiveRoomAsync(SignalingClient client, string invitation, string roomId,
        string participantId, (string Token, string Nonce) proof, CancellationTokenSource sync)
    {
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(8) };
        var cancellation = sync.Token;
        var body = System.Text.Json.JsonSerializer.Serialize(new
        {
            operation = "publish", credential = proof.Token, nonce = proof.Nonce, roomId,
            participantId, inviteToken = new Uri(invitation).Fragment.TrimStart('#')
        });
        try
        {
            while (!cancellation.IsCancellationRequested && client.IsConnected)
            {
                try
                {
                    using var payload = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
                    using var result = await http.PostAsync("https://streamroom.arthostudio.com/v2/account/active-room", payload, cancellation);
                    if ((int)result.StatusCode is 400 or 401 or 404 or 503) break;
                }
                catch (HttpRequestException) { }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { }
                await Task.Delay(TimeSpan.FromSeconds(30), cancellation);
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        finally
        {
            if (_roomSync == sync) _roomSync = null;
            sync.Dispose();
        }
    }

    private async Task DisconnectAsync()
    {
        _roomSync?.Cancel();
        _cameraAllowedUntil=0;
        StopNativeCapture();
        Title = "StreamRoom";
        _audio.Dispose();
        var previous = _connection; _connection = null;
        _participants = []; _selfParticipantId = null;
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
                _nativeSentAt = System.Diagnostics.Stopwatch.GetTimestamp();
                Volatile.Write(ref _nativePending, 2);
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
        _nativeDelayed = false;
        lock (_nativeGate) { _nativeSession = null; Volatile.Write(ref _nativePending, 0); }
        _nativeCapture?.Dispose(); _nativeCapture = null;
        _nativeBuffer?.Dispose(); _nativeBuffer = null;
        Volatile.Write(ref _nativePending, 0);
        _nativeWatchdog.Stop();
    }
    private async Task<object> CheckUpdatesAsync()
    {
        if (App.ZeroTierProof) return new { available = false, message = "Protótipo experimental isolado." };
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
    private void OpenFromTray()
    {
        if (_closing) return;
        if (_backgroundNotice?.IsVisible == true) _backgroundNotice.Close(); _backgroundNotice = null;
        ShowInTaskbar = true;
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }
    private async void CloseAsync(object? sender, CancelEventArgs e)
    {
        if (_closing) return;
        bool testRun = !_testCloseToTray && (App.MediaTestRole is not null || App.CaptureTestOutput is not null || App.NetworkTestOutput is not null || App.PickerPreviewOutput is not null || App.UiPreviewOutput is not null);
        if (!_exitRequested && !testRun && _ready && _tray?.IsAvailable == true)
        {
            e.Cancel = true;
            Hide(); ShowInTaskbar = false;
            if (!_backgroundExplained) { _backgroundNotice = BackgroundNotice.ShowBriefly(); _backgroundExplained = true; }
            return;
        }
        e.Cancel = true;
        _closing = true; _googleLogin?.Cancel(); _updateTimer.Stop(); StopNativeCapture();
        if (_discordSetupCommands.CurrentCount > 0) _discordSetup.DiscardPreparation();
        if (_backgroundNotice?.IsVisible == true) _backgroundNotice.Close(); _backgroundNotice = null;
        _mediaTestScene?.Close();
        try { if (_ready) await Browser.ExecuteScriptAsync("window.streamroom?.shutdown()").WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        await DisconnectAsync();
        foreach (var client in _testClients.Values) await client.DisposeAsync();
        _testClients.Clear();
        _tray?.Dispose(); _tray = null;
        Browser.Dispose(); Close();
    }
}
