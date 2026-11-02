using System.Text.Json;

namespace StreamRoom.Core;

public sealed record RoomCredentials(string RoomId, string InviteToken, string HostToken, long ExpiresAt, int Protocol, bool Persistent = false);
public sealed record Participant(string Id, string Name, string Role, bool Streaming = false, string? StreamId = null)
{
    public string RoleLabel => Role == "host" ? "Criador da sala" : "Amigo";
}
public sealed record Welcome(string ParticipantId, string Role, string RoomId, long ExpiresAt, int Protocol, bool Persistent = false);
public sealed class SignalingException(string message) : Exception(message);

public static class Invitations
{
    public static Uri ValidateServer(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback))
            || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment) || uri.AbsolutePath != "/")
            throw new ArgumentException("Use a URL HTTPS do serviço, sem caminho. HTTP é permitido apenas em localhost.");
        return uri;
    }
    public static string Create(Uri server, string roomId, string inviteToken) =>
        new Uri(server, $"invite/{roomId}").AbsoluteUri + "#" + inviteToken;

    public static Uri ServerFromInvitation(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query))
            throw new ArgumentException("Convite inválido. Cole o link completo da sala.");
        var server = ValidateServer(uri.GetLeftPart(UriPartial.Authority));
        // Validate the entire path and secret before connecting to the invite's server.
        _ = Parse(server, value);
        return server;
    }

    public static (string RoomId, string Token) Parse(Uri server, string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.GetLeftPart(UriPartial.Authority) != server.GetLeftPart(UriPartial.Authority)
            || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query))
            throw new ArgumentException("O convite deve pertencer ao servidor configurado.");
        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var secret = uri.Fragment.TrimStart('#');
        if (segments.Length != 2 || segments[0] != "invite" || !Guid.TryParseExact(segments[1], "D", out _)
            || secret.Length != 64 || secret.Any(c => !char.IsAsciiHexDigitLower(c)))
            throw new ArgumentException("Convite inválido. Cole o link completo, incluindo o trecho após #.");
        return (segments[1], secret);
    }
}
