using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace StreamRoom.Core;

public sealed class SignalingClient : IAsyncDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly ClientWebSocket _socket = new();
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly TaskCompletionSource<Welcome> _welcome = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Task? _receiver;
    private Task? _heartbeat;
    private bool _disposed;
    public event Action<IReadOnlyList<Participant>>? ParticipantsChanged;
    public event Action<string, JsonElement>? SignalReceived;
    public event Action<string>? Disconnected;
    public event Action<string>? ServerError;
    public bool IsConnected => _socket.State == WebSocketState.Open && _welcome.Task.IsCompletedSuccessfully;

    public static async Task<RoomCredentials> CreateRoomAsync(Uri server, CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        cancellationToken = timeout.Token;
        using var http = new HttpClient { BaseAddress = server, Timeout = TimeSpan.FromSeconds(15) };
        using var request = new HttpRequestMessage(HttpMethod.Post, "v1/rooms");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new SignalingException($"Não foi possível criar sala (HTTP {(int)response.StatusCode}).");
        // Bound responses from a user-configurable endpoint before JSON parsing.
        await response.Content.LoadIntoBufferAsync(16 * 1024, cancellationToken);
        var credentials = await response.Content.ReadFromJsonAsync<RoomCredentials>(Json, cancellationToken)
            ?? throw new SignalingException("Resposta vazia do serviço.");
        if (credentials.Protocol != 1 || !Guid.TryParseExact(credentials.RoomId, "D", out _)
            || !ValidToken(credentials.InviteToken) || !ValidToken(credentials.HostToken))
            throw new SignalingException("O serviço retornou credenciais inválidas.");
        return credentials;
    }
    private static bool ValidToken(string? value) => value is { Length: 64 } && value.All(char.IsAsciiHexDigitLower);

    public async Task<Welcome> ConnectAsync(Uri server, string roomId, string token, string displayName, CancellationToken cancellationToken = default)
    {
        if (_receiver is not null || _disposed) throw new InvalidOperationException("Crie uma nova conexão para entrar novamente.");
        if (!Guid.TryParseExact(roomId, "D", out _) || !ValidToken(token)) throw new ArgumentException("Credenciais inválidas.");
        displayName = displayName.Trim();
        if (displayName.Length is < 1 or > 32 || displayName.Any(char.IsControl)) throw new ArgumentException("Seu nome deve ter entre 1 e 32 caracteres.");
        var socketUri = new UriBuilder(new Uri(server, $"v1/rooms/{roomId}/socket")) { Scheme = server.Scheme == "https" ? "wss" : "ws" };
        _socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        _socket.Options.KeepAliveTimeout = TimeSpan.FromSeconds(20);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            await _socket.ConnectAsync(socketUri.Uri, timeout.Token);
            _receiver = ReceiveAsync();
            await SendAsync(new { type = "join", token, displayName }, timeout.Token);
            var welcome = await _welcome.Task.WaitAsync(timeout.Token);
            _heartbeat = HeartbeatAsync();
            return welcome;
        }
        catch { await DisposeAsync(); throw; }
    }
    public Task SendSignalAsync(string to, object payload, CancellationToken cancellationToken = default)
    {
        if (!IsConnected) throw new InvalidOperationException("Entre em uma sala primeiro.");
        return SendAsync(new { type = "signal", to, payload }, cancellationToken);
    }
    private async Task SendAsync(object value, CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Json);
        if (bytes.Length > 64 * 1024) throw new ArgumentException("Mensagem muito grande.");
        await _sendLock.WaitAsync(cancellationToken);
        try { await _socket.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, cancellationToken); }
        finally { _sendLock.Release(); }
    }
    private async Task HeartbeatAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(20));
        try
        {
            while (await timer.WaitForNextTickAsync(_lifetime.Token))
                await SendAsync(new { type = "ping" }, _lifetime.Token);
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { _socket.Abort(); _lifetime.Cancel(); }
    }
    private async Task ReceiveAsync()
    {
        string reason = "Conexão encerrada. Entre novamente para reconectar.";
        var buffer = new byte[8192];
        try
        {
            while (!_lifetime.IsCancellationRequested)
            {
                using var message = new MemoryStream();
                ValueWebSocketReceiveResult part;
                do
                {
                    part = await _socket.ReceiveAsync(buffer.AsMemory(), _lifetime.Token);
                    if (part.MessageType == WebSocketMessageType.Close) return;
                    if (part.MessageType != WebSocketMessageType.Text || message.Length + part.Count > 64 * 1024)
                        throw new SignalingException("O servidor enviou uma mensagem inválida.");
                    message.Write(buffer, 0, part.Count);
                } while (!part.EndOfMessage);
                using var doc = JsonDocument.Parse(message.ToArray());
                var item = doc.RootElement;
                switch (item.GetProperty("type").GetString())
                {
                    case "welcome":
                        var welcome = item.Deserialize<Welcome>(Json) ?? throw new SignalingException("Sessão inválida.");
                        if (welcome.Protocol != 1) throw new SignalingException("Versão de protocolo incompatível.");
                        _welcome.TrySetResult(welcome);
                        break;
                    case "room":
                        ParticipantsChanged?.Invoke(item.GetProperty("participants").Deserialize<Participant[]>(Json) ?? []);
                        break;
                    case "signal":
                        SignalReceived?.Invoke(item.GetProperty("from").GetString()!, item.GetProperty("payload").Clone());
                        break;
                    case "error":
                        var error = item.GetProperty("message").GetString() ?? "Erro do servidor.";
                        _welcome.TrySetException(new SignalingException(error));
                        ServerError?.Invoke(error);
                        break;
                    case "room_closed": reason = item.GetProperty("message").GetString() ?? reason; return;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) when (ex is WebSocketException or JsonException or SignalingException or InvalidOperationException or KeyNotFoundException)
        { reason = "A conexão foi interrompida: " + ex.Message; }
        finally
        {
            _welcome.TrySetException(new SignalingException(reason));
            _lifetime.Cancel();
            Disconnected?.Invoke(reason);
        }
    }
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            if (_socket.State == WebSocketState.Open)
            {
                await SendAsync(new { type = "leave" }, timeout.Token);
                await _socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "left", timeout.Token);
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or InvalidOperationException) { }
        _lifetime.Cancel();
        _socket.Abort();
        if (_receiver is not null) await _receiver;
        if (_heartbeat is not null) await _heartbeat;
        _socket.Dispose();
        _lifetime.Dispose();
        _sendLock.Dispose();
    }
}
