using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth;

namespace StreamRoom.App;

internal sealed record GoogleIdentity(string Subject, string Name, string? Avatar, long LinkedAt);
internal static class GoogleLogin
{
    internal static string Base64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    internal static string Challenge(string verifier) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
    internal static Uri AuthorizationUrl(string clientId, string redirect, string verifier, string state, string nonce) =>
        new("https://accounts.google.com/o/oauth2/v2/auth?" + string.Join("&", new Dictionary<string, string> {
            ["client_id"] = clientId, ["redirect_uri"] = redirect, ["response_type"] = "code", ["scope"] = "openid profile",
            ["code_challenge"] = Challenge(verifier), ["code_challenge_method"] = "S256", ["state"] = state, ["nonce"] = nonce,
            ["access_type"] = "online", ["prompt"] = "select_account"
        }.Select(p => Uri.EscapeDataString(p.Key) + "=" + Uri.EscapeDataString(p.Value))));

    internal static async Task<GoogleIdentity> SignInAsync(string clientId, CancellationToken cancellationToken)
    {
        if (!ClientConfiguration.ValidGoogleClientId(clientId)) throw new IOException("O login Google ainda não foi configurado pelo proprietário.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
        var ct = timeout.Token;
        using var callback = new GoogleLoopback();
        string verifier = Base64Url(RandomNumberGenerator.GetBytes(32)), state = Base64Url(RandomNumberGenerator.GetBytes(32)), nonce = Base64Url(RandomNumberGenerator.GetBytes(32));
        var url = AuthorizationUrl(clientId, callback.RedirectUri, verifier, state, nonce);
        Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
        var code = await callback.ReceiveAsync(state, ct);
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(20) };
        using var body = new FormUrlEncodedContent(new Dictionary<string, string> {
            ["client_id"] = clientId, ["code"] = code, ["code_verifier"] = verifier, ["redirect_uri"] = callback.RedirectUri, ["grant_type"] = "authorization_code"
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token") { Content = body };
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        await response.Content.LoadIntoBufferAsync(32_768, ct);
        if (!response.IsSuccessStatusCode) throw new IOException("O Google não concluiu o login. Confira o cliente OAuth para computador e os usuários de teste no Google Cloud.");
        using var tokens = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (!tokens.RootElement.TryGetProperty("id_token", out var token) || token.ValueKind != JsonValueKind.String) throw new IOException("O Google não retornou uma identidade válida.");
        string jwt = token.GetString()!;
        GoogleJsonWebSignature.Payload identity;
        try { identity = await GoogleJsonWebSignature.ValidateAsync(jwt, new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] }).WaitAsync(ct); }
        catch (InvalidJwtException) { throw new IOException("Não foi possível verificar a identidade retornada pelo Google."); }
        // Verify nonce after Google's library has verified signature, issuer, audience and lifetime.
        ValidateNonce(jwt, nonce);
        if (identity.Subject is not { Length: >= 1 and <= 255 }) throw new IOException("Identidade Google inválida.");
        var name = new string((identity.Name ?? "Jogador").Where(c => !char.IsControl(c)).Take(32).ToArray()).Trim();
        if (name.Length == 0) name = "Jogador";
        string? avatar = null;
        if (Uri.TryCreate(identity.Picture, UriKind.Absolute, out var picture) && picture.Scheme == "https" && picture.IsDefaultPort && string.IsNullOrEmpty(picture.UserInfo)
            && (picture.Host == "googleusercontent.com" || picture.Host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase)))
        {
            try
            {
                using var photo = await http.GetAsync(picture, HttpCompletionOption.ResponseHeadersRead, ct);
                photo.EnsureSuccessStatusCode(); await photo.Content.LoadIntoBufferAsync(2 * 1024 * 1024, ct);
                using var bytes = new MemoryStream(await photo.Content.ReadAsByteArrayAsync(ct)); avatar = ProfileStore.EncodePhoto(bytes);
            }
            catch (Exception error) when (error is HttpRequestException or IOException or NotSupportedException or ArgumentException or FormatException or System.Runtime.InteropServices.COMException || error is TaskCanceledException && !ct.IsCancellationRequested) { }
        }
        // No access, ID or refresh token is persisted, logged, or sent to the WebView.
        return new(identity.Subject, name, avatar, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
    internal static void ValidateNonce(string jwt, string expected)
    {
        try
        {
            var part = jwt.Split('.')[1].Replace('-', '+').Replace('_', '/');
            using var claims = JsonDocument.Parse(Convert.FromBase64String(part.PadRight((part.Length + 3) / 4 * 4, '=')));
            string? nonce = claims.RootElement.GetProperty("nonce").GetString();
            if (nonce is null || nonce.Length != expected.Length || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(nonce), Encoding.UTF8.GetBytes(expected))) throw new FormatException();
        }
        catch (Exception error) when (error is FormatException or JsonException or IndexOutOfRangeException or KeyNotFoundException or InvalidOperationException)
        { throw new IOException("A resposta Google não pertence a esta tentativa de login."); }
    }
}

internal sealed class GoogleLoopback : IDisposable
{
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    internal string RedirectUri { get; }
    internal GoogleLoopback()
    {
        _listener.ExclusiveAddressUse = true; _listener.Start(4);
        RedirectUri = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/oauth2/callback";
    }
    internal static Dictionary<string, string>? ParseRequest(string request, string redirect, string expectedState)
    {
        if (request.Length > 8192 || !request.EndsWith("\r\n\r\n", StringComparison.Ordinal)) return null;
        var lines = request.Split("\r\n"); var first = lines[0].Split(' '); var target = new Uri(redirect);
        if (first.Length != 3 || first[0] != "GET" || first[2] != "HTTP/1.1" || !first[1].StartsWith("/oauth2/callback?", StringComparison.Ordinal)) return null;
        var hosts = lines.Where(l => l.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (hosts.Length != 1 || hosts[0][5..].Trim() != target.Authority) return null;
        var query = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            foreach (var pair in first[1][(first[1].IndexOf('?') + 1)..].Split('&'))
            {
                var parts = pair.Split('=', 2); if (parts.Length != 2) return null;
                if (!query.TryAdd(Uri.UnescapeDataString(parts[0].Replace('+', ' ')), Uri.UnescapeDataString(parts[1].Replace('+', ' ')))) return null;
            }
        }
        catch (UriFormatException) { return null; }
        if (!query.TryGetValue("state", out var state) || state.Length != expectedState.Length
            || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(state), Encoding.UTF8.GetBytes(expectedState))) return null;
        return query;
    }
    internal async Task<string> ReceiveAsync(string state, CancellationToken ct)
    {
        while (true)
        {
            using var client = await _listener.AcceptTcpClientAsync(ct);
            using var readTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct); readTimeout.CancelAfter(TimeSpan.FromSeconds(8));
            await using var stream = client.GetStream(); var buffer = new byte[8192]; int count = 0;
            try
            {
                while (count < buffer.Length)
                {
                    int read = await stream.ReadAsync(buffer.AsMemory(count), readTimeout.Token); if (read == 0) break; count += read;
                    if (Encoding.ASCII.GetString(buffer, 0, count).Contains("\r\n\r\n", StringComparison.Ordinal)) break;
                }
            }
            catch (Exception error) when (error is IOException || error is OperationCanceledException && !ct.IsCancellationRequested) { continue; }
            var query = ParseRequest(Encoding.ASCII.GetString(buffer, 0, count), RedirectUri, state);
            const string received = "<!doctype html><html lang=pt-BR><meta charset=utf-8><title>StreamRoom</title><body style=\"background:#181a22;color:#eee;font:16px system-ui;padding:48px\"><h1>StreamRoom</h1><p>Resposta recebida. Volte ao aplicativo para concluir o login.</p></body></html>";
            var body = Encoding.UTF8.GetBytes(query is null ? "Resposta invalida. Volte ao StreamRoom." : received);
            var headers = Encoding.ASCII.GetBytes($"HTTP/1.1 {(query is null ? "400 Bad Request" : "200 OK")}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {body.Length}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n");
            try { await stream.WriteAsync(headers, ct); await stream.WriteAsync(body, ct); }
            catch (IOException) { }
            if (query is null) continue;
            if (query.ContainsKey("error")) throw new IOException("Login cancelado ou não autorizado no Google.");
            if (!query.TryGetValue("code", out var code) || code.Length is < 1 or > 4096) throw new IOException("Resposta de login Google incompleta.");
            return code;
        }
    }
    public void Dispose() => _listener.Stop();
}
