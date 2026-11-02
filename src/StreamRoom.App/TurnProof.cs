using System.IO;
using System.Net.Http;
using System.Text.Json;
using StreamRoom.Core;

namespace StreamRoom.App;

internal static class TurnProof
{
    internal sealed record LocalSettings(string Server, string? CreateKey);
    private static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StreamRoom-TurnProof", "turn-proof.local.json");
    public static async Task<LocalSettings?> SettingsAsync()
    {
        if (!App.TurnExperiment || !File.Exists(FilePath)) return null;
        var bytes = await File.ReadAllBytesAsync(FilePath);
        if (bytes.Length > 4096) throw new IOException("Configuração experimental inválida.");
        var settings = JsonSerializer.Deserialize<LocalSettings>(bytes, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new IOException("Configuração experimental vazia.");
        Invitations.ValidateServer(settings.Server);
        return settings;
    }
    public static async Task ValidateServerAsync(Uri server)
    {
        using var handler = new HttpClientHandler { AllowAutoRedirect = false };
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(8) };
        using var response = await http.GetAsync(new Uri(server, "health"), HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode) throw new IOException("Servidor experimental indisponível.");
        await response.Content.LoadIntoBufferAsync(8192);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        if (!root.TryGetProperty("experiment", out var name) || name.GetString() != "turn-relay-proof" || !root.TryGetProperty("active", out var active) || active.ValueKind != JsonValueKind.True)
            throw new IOException("Este servidor não é o teste TURN autorizado ou sua janela está desativada.");
    }
}
