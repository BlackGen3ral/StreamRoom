using StreamRoom.Core;
using System.Text.Json;
static void Check(bool value, string description) { if (!value) throw new Exception(description); Console.WriteLine("PASS " + description); }
var server = Invitations.ValidateServer(args.FirstOrDefault() ?? "http://127.0.0.1:8787");
try { Invitations.ValidateServer("http://example.com"); throw new Exception("Insecure URL accepted"); } catch (ArgumentException) { }
Check(true, "HTTP remoto recusado");
var inviteServer = Invitations.ValidateServer("https://streamroom.arthostudio.com");
var sampleInvite = Invitations.Create(inviteServer, Guid.NewGuid().ToString(), new string('a', 64));
Check(Invitations.ServerFromInvitation("  " + sampleInvite + "  ") == inviteServer, "Servidor identificado pelo convite completo");
var otherServer = Invitations.ValidateServer("https://example.org");
try { Invitations.Parse(otherServer, sampleInvite); throw new Exception("Mismatched server accepted"); } catch (ArgumentException) { }
Check(true, "Parser continua recusando servidor divergente");
foreach (var invalid in new[] {
    sampleInvite.Replace("https://", "http://"), sampleInvite.Replace("https://", "https://user:secret@"),
    sampleInvite.Replace("#", "?q=1#"), sampleInvite.Split('#')[0], sampleInvite.Replace("/invite/", "/other/") })
{
    try { Invitations.ServerFromInvitation(invalid); throw new Exception("Invalid invite accepted"); } catch (ArgumentException) { }
}
Check(true, "Convites inseguros, incompletos e com caminho inválido recusados antes da conexão");
var credentials = await SignalingClient.CreateRoomAsync(server);
var invite = Invitations.Create(server, credentials.RoomId, credentials.InviteToken);
Check(Invitations.Parse(server, invite).Token == credentials.InviteToken, "Convite mantém segredo");
await using var host = new SignalingClient();
await using var friend = new SignalingClient();
JsonElement hostState = default, friendState = default;
host.RoomStateChanged += state => hostState = state;
friend.RoomStateChanged += state => friendState = state;
var a = await host.ConnectAsync(server, credentials.RoomId, credentials.HostToken, "Criador C#");
var b = await friend.ConnectAsync(server, credentials.RoomId, credentials.InviteToken, "Amigo C#");
Check(a.Protocol == 2 && b.Role == "viewer", "Ambos autenticados no protocolo 2");
Check(a.ExpiresAt - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > 86_300_000, "Sala inicial de 24h");
async Task Wait(Func<bool> predicate) { using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8)); while (!predicate()) await Task.Delay(20, timeout.Token); }
string streamA=Guid.NewGuid().ToString(), streamB=Guid.NewGuid().ToString(), subAB=Guid.NewGuid().ToString(), subBA=Guid.NewGuid().ToString();
await host.SetStreamingAsync(true, streamA); await friend.SetStreamingAsync(true, streamB);
await Wait(() => hostState.ValueKind == JsonValueKind.Object && hostState.GetProperty("participants").EnumerateArray().Count(p => p.GetProperty("streaming").GetBoolean()) == 2);
Check(true, "Criador e amigo publicam independentemente");
await host.SetWatchingAsync(b.ParticipantId, streamB, subAB, true);
await friend.SetWatchingAsync(a.ParticipantId, streamA, subBA, true);
await Wait(() => hostState.GetProperty("subscriptions").GetArrayLength() == 1 && hostState.GetProperty("subscribers").GetArrayLength() == 1);
Check(true, "Assinaturas cruzadas no mesmo par de participantes");
if (a.Profiles)
{
    var avatar = (await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "fixtures", "avatar.txt"))).Trim();
    await friend.UpdateProfileAsync("Perfil atualizado", avatar);
    await Wait(() => hostState.GetProperty("participants").EnumerateArray().Any(p => p.GetProperty("name").GetString() == "Perfil atualizado" && p.GetProperty("avatar").GetString() == avatar));
    Check(hostState.GetProperty("subscriptions").GetArrayLength() == 1 && hostState.GetProperty("subscribers").GetArrayLength() == 1, "Perfil confirmado chega ao amigo sem modificar assinaturas");
}
var received = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
host.SignalReceived += (from,p) => received.TrySetResult(from == b.ParticipantId && p.GetProperty("subscriptionId").GetString() == subAB);
await friend.SendSignalAsync(a.ParticipantId, new { kind="offer", sdp="contract-test", streamId=streamB, subscriptionId=subAB, session=Guid.NewGuid().ToString() });
Check(await received.Task.WaitAsync(TimeSpan.FromSeconds(8)), "Oferta de amigo chega ao criador por assinatura");
await friend.SetStreamingAsync(false, streamB);
await Wait(() => hostState.GetProperty("subscriptions").GetArrayLength() == 0);
Check(hostState.GetProperty("subscribers").GetArrayLength() == 1, "Parar um envio preserva recepção de outro");
var ice = await host.GetIceConfigurationAsync();
Check(!ice.GetProperty("turnAvailable").GetBoolean() && ice.GetProperty("iceServers").EnumerateArray().All(s => !s.TryGetProperty("credential", out _) && s.GetProperty("urls").EnumerateArray().All(u => u.GetString()!.StartsWith("stun:", StringComparison.Ordinal))), "STUN exclusivo, sem relay");
await Task.Delay(TimeSpan.FromSeconds(42));
Check(host.IsConnected && friend.IsConnected, "Dois ciclos de heartbeat mantêm as sessões");
var closed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
friend.Disconnected += _ => closed.TrySetResult(true);
await host.DisposeAsync(); await closed.Task.WaitAsync(TimeSpan.FromSeconds(8));
Check(true, "Criador ainda encerra a sala");

var fixedRoom = await SignalingClient.CreateRoomAsync(server, persistent: true);
Check(fixedRoom.Persistent, "Servidor confirma sala fixa");
await using (var firstOwner = new SignalingClient())
{
    var welcome = await firstOwner.ConnectAsync(server, fixedRoom.RoomId, fixedRoom.HostToken, "Dono fixo");
    Check(welcome.Persistent, "Welcome mantém sinalizador de persistência");
}
await using var returningMember = new SignalingClient();
await returningMember.ConnectAsync(server, fixedRoom.RoomId, fixedRoom.InviteToken, "Amigo salvo");
await using var returningOwner = new SignalingClient();
Check((await returningOwner.ConnectAsync(server, fixedRoom.RoomId, fixedRoom.HostToken, "Dono salvo")).Role == "host", "Reentrada conserva controle do criador");
var revoked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
returningMember.Disconnected += _ => revoked.TrySetResult();
await returningOwner.DestroyGroupRoomAsync();
await revoked.Task.WaitAsync(TimeSpan.FromSeconds(8));
Check(true, "Exclusão confirmada pelo servidor desconecta os amigos");
