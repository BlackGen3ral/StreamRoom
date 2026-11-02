using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StreamRoom.App;

internal sealed record ClientConfiguration(int Version = 1, string DefaultZeroTierNetworkId = "", string GoogleClientId = "")
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static bool ValidGoogleClientId(string? id) => id is { Length: <= 256 } && Regex.IsMatch(id, "\\A[0-9]+-[a-zA-Z0-9_-]+\\.apps\\.googleusercontent\\.com\\z");
    internal static ClientConfiguration Validate(ClientConfiguration? value) => value?.Version == 1
        ? new(1, ZeroTierPreferences.IsNetworkId(value.DefaultZeroTierNetworkId) ? value.DefaultZeroTierNetworkId : "", ValidGoogleClientId(value.GoogleClientId) ? value.GoogleClientId : "") : new();
    internal static async Task<ClientConfiguration> FetchAsync(string directory)
    {
        var file = Path.Combine(directory, "client-config-v1.json");
        var cached = new ClientConfiguration();
        try { if (File.Exists(file) && new FileInfo(file).Length < 4096) cached = Validate(JsonSerializer.Deserialize<ClientConfiguration>(await File.ReadAllTextAsync(file), Json)); }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { }
        try
        {
            using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(8) };
            using var response = await http.GetAsync("https://streamroom.arthostudio.com/v2/client-config", HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            await response.Content.LoadIntoBufferAsync(4096);
            var value = Validate(JsonSerializer.Deserialize<ClientConfiguration>(await response.Content.ReadAsStringAsync(), Json));
            Directory.CreateDirectory(directory);
            await File.WriteAllTextAsync(file + ".tmp", JsonSerializer.Serialize(value, Json));
            File.Move(file + ".tmp", file, true); return value;
        }
        catch (Exception error) when (error is HttpRequestException or IOException or JsonException or TaskCanceledException or UnauthorizedAccessException) { return cached; }
    }
}
