using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using StreamRoom.Core;

namespace StreamRoom.App;

public partial class MainWindow : Window
{
    private SignalingClient? _connection;
    private string? _invitation;
    private bool _busy;
    private bool _closing;
    private static readonly string SettingsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StreamRoom", "settings.json");
    public MainWindow()
    {
        InitializeComponent();
        try
        {
            if (File.Exists(SettingsPath))
            {
                var settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText(SettingsPath));
                if (settings is not null) { ServerInput.Text = settings.Server; NameInput.Text = settings.Name; }
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { StatusText.Text = "Não foi possível carregar as configurações locais."; }
        Closing += OnClosing;
    }
    private void SaveSettings()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(new Settings(ServerInput.Text.Trim(), NameInput.Text.Trim())));
    }
    private async Task RunAsync(Func<Task> action)
    {
        if (_busy) return;
        _busy = true; RefreshControls();
        try { await action(); }
        catch (Exception ex) when (ex is HttpRequestException or System.Net.WebSockets.WebSocketException or OperationCanceledException or SignalingException or ArgumentException or IOException or UnauthorizedAccessException or JsonException)
        { StatusText.Text = ex is OperationCanceledException ? "Tempo de conexão esgotado. Verifique o servidor e tente novamente." : ex.Message; }
        finally { _busy = false; RefreshControls(); }
    }
    private void RefreshControls()
    {
        var connected = _connection?.IsConnected == true;
        ConnectionFields.IsEnabled = !_busy && !connected;
        LeaveButton.IsEnabled = !_busy && connected;
        CopyButton.IsEnabled = !_busy && connected && _invitation is not null;
    }
    private async void CheckServer_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
    {
        var server = Invitations.ValidateServer(ServerInput.Text);
        StatusText.Text = "Verificando servidor...";
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(server, "health"));
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        response.EnsureSuccessStatusCode();
        await response.Content.LoadIntoBufferAsync(16 * 1024, timeout.Token);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        if (doc.RootElement.ValueKind != JsonValueKind.Object
            || !doc.RootElement.TryGetProperty("protocol", out var protocol) || protocol.ValueKind != JsonValueKind.Number
            || !protocol.TryGetInt32(out var version) || version != 1)
            throw new SignalingException("Servidor incompatível.");
        SaveSettings();
        StatusText.Text = "Servidor de sinalização disponível.";
    });
    private async void Create_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
    {
        var server = Invitations.ValidateServer(ServerInput.Text);
        ValidateName(); SaveSettings();
        StatusText.Text = "Criando sala...";
        var credentials = await SignalingClient.CreateRoomAsync(server);
        await EnterAsync(server, credentials.RoomId, credentials.HostToken, Invitations.Create(server, credentials.RoomId, credentials.InviteToken));
    });
    private async void Join_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
    {
        var server = Invitations.ValidateServer(ServerInput.Text);
        var invite = Invitations.Parse(server, InviteInput.Text);
        ValidateName(); SaveSettings();
        StatusText.Text = "Entrando na sala...";
        await EnterAsync(server, invite.RoomId, invite.Token, InviteInput.Text.Trim());
    });
    private void ValidateName()
    {
        var name = NameInput.Text.Trim();
        if (name.Length is < 1 or > 32 || name.Any(char.IsControl)) throw new ArgumentException("Informe seu nome (1–32 caracteres).");
    }
    private async Task EnterAsync(Uri server, string roomId, string token, string invite)
    {
        if (_connection is not null) await _connection.DisposeAsync();
        var connection = new SignalingClient();
        _connection = connection;
        connection.ParticipantsChanged += peers => Dispatcher.BeginInvoke(() =>
        {
            if (_connection != connection) return;
            ParticipantsList.ItemsSource = peers;
            RoomTitle.Text = $"Sua sala · {peers.Count}/5";
        });
        connection.ServerError += message => Dispatcher.BeginInvoke(() => { if (_connection == connection) StatusText.Text = message; });
        connection.Disconnected += message => Dispatcher.BeginInvoke(() =>
        {
            if (_connection != connection) return;
            _invitation = null; ParticipantsList.ItemsSource = null;
            RoomTitle.Text = "Sua sala"; RoomInfo.Text = "Você está desconectado.";
            StatusText.Text = message; RefreshControls();
        });
        try
        {
            var welcome = await connection.ConnectAsync(server, roomId, token, NameInput.Text);
            _invitation = invite;
            InviteInput.Clear();
            RoomInfo.Text = $"Sala {roomId[..8]} · expira às {DateTimeOffset.FromUnixTimeMilliseconds(welcome.ExpiresAt).ToLocalTime():HH:mm}";
            LeaveButton.Content = welcome.Role == "host" ? "Encerrar sala" : "Sair da sala";
            StatusText.Text = welcome.Role == "host" ? "Sala criada. Copie o convite e envie aos seus amigos. Sair encerra a sala para todos." : "Você entrou na sala. Participantes sincronizados pelo servidor.";
        }
        catch { await connection.DisposeAsync(); throw; }
    }
    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        if (_invitation is null) return;
        try { Clipboard.SetText(_invitation); StatusText.Text = "Convite copiado. Envie apenas às pessoas que deseja convidar."; }
        catch (System.Runtime.InteropServices.COMException) { StatusText.Text = "Área de transferência ocupada. Tente novamente."; }
    }
    private async void Leave_Click(object sender, RoutedEventArgs e) => await RunAsync(async () =>
    {
        var previous = _connection; _connection = null;
        if (previous is not null) await previous.DisposeAsync();
        _invitation = null; ParticipantsList.ItemsSource = null;
        RoomTitle.Text = "Sua sala"; RoomInfo.Text = "Crie uma sala ou cole um convite para começar.";
        StatusText.Text = "Você saiu da sala.";
    });
    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_closing) return;
        e.Cancel = true;
        if (_busy) { StatusText.Text = "Aguarde a conexão terminar antes de fechar."; return; }
        _closing = true;
        if (_connection is not null) await _connection.DisposeAsync();
        Close();
    }
    private sealed record Settings(string Server, string Name);
}
