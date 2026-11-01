using System.Collections.Concurrent;
using StreamRoom.Core;

static void Check(bool value, string description)
{
    if (!value) throw new Exception(description);
    Console.WriteLine("PASS " + description);
}
var server = Invitations.ValidateServer(args.FirstOrDefault() ?? "http://127.0.0.1:8787");
try { Invitations.ValidateServer("http://example.com"); throw new Exception("Insecure URL accepted"); } catch (ArgumentException) { }
Check(true, "HTTP remoto recusado");
var credentials = await SignalingClient.CreateRoomAsync(server);
var invitation = Invitations.Create(server, credentials.RoomId, credentials.InviteToken);
var parsed = Invitations.Parse(server, invitation);
Check(parsed.RoomId == credentials.RoomId && parsed.Token == credentials.InviteToken, "Convite preserva sala e segredo");
try { Invitations.Parse(new Uri("https://example.com"), invitation); throw new Exception("Foreign invite accepted"); } catch (ArgumentException) { }
Check(true, "Convite de outro servidor recusado");
await using var host = new SignalingClient();
await using var viewer = new SignalingClient();
var peersSeen = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
host.ParticipantsChanged += peers => { if (peers.Count == 2) peersSeen.TrySetResult(true); };
var welcome = await host.ConnectAsync(server, credentials.RoomId, credentials.HostToken, "Criador C#");
Check(welcome.Role == "host", "Autenticação do criador via ClientWebSocket");
Check(welcome.ExpiresAt - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > 86_300_000, "Sala aceita duração inicial de 24h");
var guestWelcome = await viewer.ConnectAsync(server, credentials.RoomId, credentials.InviteToken, "Amigo C#");
Check(guestWelcome.Role == "viewer", "Autenticação do convidado via ClientWebSocket");
await peersSeen.Task.WaitAsync(TimeSpan.FromSeconds(5));
Check(true, "Lista real de participantes sincronizada");
var ice = await viewer.GetIceConfigurationAsync();
Check(ice.GetProperty("turnAvailable").ValueKind == System.Text.Json.JsonValueKind.False
    && ice.GetProperty("iceServers").EnumerateArray().All(s => !s.TryGetProperty("credential", out _) && s.GetProperty("urls").EnumerateArray().All(url => url.GetString()!.StartsWith("stun:", StringComparison.Ordinal))), "Configuração ICE contém somente STUN sem credenciais");
// Two application heartbeats must succeed through the runtime auto-response path.
await Task.Delay(TimeSpan.FromSeconds(42));
Check(host.IsConnected && viewer.IsConnected, "Dois ciclos de heartbeat mantêm os clientes conectados");
var received = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
viewer.SignalReceived += (from, payload) => received.TrySetResult(from == welcome.ParticipantId && payload.GetProperty("sdp").GetString() == "contract-test");
await host.SendSignalAsync(guestWelcome.ParticipantId, new { kind = "offer", sdp = "contract-test" });
Check(await received.Task.WaitAsync(TimeSpan.FromSeconds(5)), "Contrato de sinalização C# ↔ Worker (sem transmissão de mídia)");
var closed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
viewer.Disconnected += _ => closed.TrySetResult(true);
await host.DisposeAsync();
await closed.Task.WaitAsync(TimeSpan.FromSeconds(5));
Check(true, "Encerrar criador desconecta o convidado");
