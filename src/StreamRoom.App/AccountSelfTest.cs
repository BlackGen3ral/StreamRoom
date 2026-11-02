using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using StreamRoom.Core;

namespace StreamRoom.App;
internal static class AccountSelfTest
{
    internal static async Task Run(string output)
    {
        try
        {
            var directory = Path.Combine(Path.GetTempPath(), "StreamRoom-Accounts-Test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            static void Check(bool value, string message) { if (!value) throw new Exception(message); }
            Check(FirstRunStore.ShouldPresent(directory),"First launch did not present optional entry.");
            await FirstRunStore.CompleteAsync(directory);
            Check(!FirstRunStore.ShouldPresent(directory)&&ProfileStore.Load(directory) is null,"Guest entry was not remembered or created an unwanted profile.");
            File.Delete(Path.Combine(directory,"welcome-v1.json"));
            await File.WriteAllTextAsync(Path.Combine(directory, "profile-v1.json"), "{\"name\":\"Legacy\",\"sounds\":false}");
            Check(!FirstRunStore.ShouldPresent(directory),"Existing profile was interrupted by onboarding on update.");
            var profile = await ProfileStore.SaveAsync(directory, "Amigo", null, false);
            var renamed = await ProfileStore.SaveAsync(directory, "Outro nome", null, false);
            Check(ProfileData.ValidId(profile.Id) && renamed.Id == profile.Id, "Profile identity changed after editing.");
            string peerId = Guid.NewGuid().ToString("D");
            var peer = new Participant("session-one", "Amigo", "viewer", ProfileId: peerId);
            await FriendBook.SavePeerAsync(directory, peer);
            await FriendBook.SavePeerAsync(directory, peer with { Id = "session-two", Name = "Novo nome" });
            var friends = FriendBook.Load(directory);
            Check(friends.Count == 1 && friends[0].Name == "Novo nome" && friends[0].ProfileId == peerId, "Friend was duplicated across sessions.");
            Check((await FriendBook.RemoveAsync(directory, peerId)).Count == 0 && FriendBook.Load(directory).Count == 0, "Friend removal did not persist.");
            try { await FriendBook.SavePeerAsync(directory, peer with { ProfileId = null }); throw new Exception("Legacy peer was accepted."); } catch (IOException) { }
            Check(GoogleLogin.Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "RFC 7636 challenge failed.");
            Check(GoogleLogin.ExchangeError("{\"error\":\"invalid_request\",\"error_description\":\"client_secret is missing.\"}",400).Contains("servidor"), "Missing client credential was misdiagnosed.");
            Check(!GoogleLogin.ExchangeError("{\"error\":\"unknown\",\"error_description\":\"sensitive-token\"}",400).Contains("sensitive-token"), "Provider details leaked.");
            using var callback = new GoogleLoopback();
            string authority = new Uri(callback.RedirectUri).Authority;
            string Request(string query, string? host = null) => $"GET /oauth2/callback?{query} HTTP/1.1\r\nHost: {host ?? authority}\r\n\r\n";
            Check(GoogleLoopback.ParseRequest(Request("state=expected&code=ok"), callback.RedirectUri, "expected")?["code"] == "ok", "Valid callback rejected.");
            foreach (var request in new[] { Request("state=wrong&code=ok"), Request("state=expected&state=expected&code=ok"), Request("state=expected&code=ok", "malicious.example"), Request("state=expected&code=ok").Replace("GET ", "POST "), new string('a', 9000) })
                Check(GoogleLoopback.ParseRequest(request, callback.RedirectUri, "expected") is null, "Forged callback accepted.");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var received = callback.ReceiveAsync("expected", timeout.Token);
            using var http = new HttpClient();
            using var invalid = await http.GetAsync(callback.RedirectUri + "?state=wrong&code=bad", timeout.Token);
            Check((int)invalid.StatusCode == 400 && !received.IsCompleted, "Invalid state consumed the login attempt.");
            using var valid = await http.GetAsync(callback.RedirectUri + "?state=expected&code=temporary-test-code", timeout.Token);
            Check((await received) == "temporary-test-code" && !(await valid.Content.ReadAsStringAsync()).Contains("temporary-test-code"), "Loopback callback did not isolate authorization code.");
            var claims = GoogleLogin.Base64Url(Encoding.UTF8.GetBytes("{\"nonce\":\"expected\"}"));
            GoogleLogin.ValidateNonce("header." + claims + ".signature", "expected");
            try { GoogleLogin.ValidateNonce("header." + claims + ".signature", "different"); throw new Exception("Wrong nonce accepted."); } catch (IOException) { }
            var account = new GoogleIdentity("synthetic-subject", "Teste Google", null, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await GoogleAccountStore.SaveAsync(directory, account);
            Check(GoogleAccountStore.Load(directory) == account, "Google association did not persist.");
            Check(!Encoding.UTF8.GetString(await File.ReadAllBytesAsync(Path.Combine(directory, "google-profile-v1.dat"))).Contains("synthetic-subject"), "Google association was not protected by Windows.");
            GoogleAccountStore.Remove(directory);
            Check(GoogleAccountStore.Load(directory) is null && ProfileStore.Load(directory)?.Id == profile.Id, "Unlink changed local identity.");
            Check(ClientConfiguration.Validate(new(1, "invalid", "invalid")).GoogleClientId == "", "Invalid runtime config accepted.");
            await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = true, stableProfile = true, friendPersistence = true, pkce = true, loopback = true, stateAndNonce = true, windowsProtection = true, realGoogleLogin = "requires user consent" }));
        }
        catch (Exception error) { Environment.ExitCode = 1; await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = false, error = error.ToString() })); }
    }
}
