using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StreamRoom.App;

internal sealed record ZeroTierPreferences(string NetworkId = "", bool Enabled = false)
{
    private static string FilePath => App.UiPreviewOutput is not null ? App.UiPreviewOutput + ".zerotier.json" : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StreamRoom", "zerotier.json");
    public static ZeroTierPreferences Load()
    {
        try
        {
            var path = App.ZeroTierProof ? Path.Combine(AppContext.BaseDirectory, "zerotier-proof.json") : FilePath;
            var value = JsonSerializer.Deserialize<ZeroTierPreferences>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new();
            return new(IsNetworkId(value.NetworkId) ? value.NetworkId : "", App.ZeroTierProof || value.Enabled && IsNetworkId(value.NetworkId));
        }
        catch (Exception ex) when (ex is IOException or JsonException) { return new("", App.ZeroTierProof); }
    }
    public static bool IsNetworkId(string? value) => value is not null && Regex.IsMatch(value, "\\A[0-9a-f]{16}\\z");
    public static async Task SaveAsync(string networkId, bool enabled)
    {
        if (!IsNetworkId(networkId) && (enabled || networkId.Length > 0)) throw new ArgumentException("Informe o identificador de 16 caracteres da rede ZeroTier.");
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        var temporary = FilePath + ".tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(new ZeroTierPreferences(networkId, enabled), new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        File.Move(temporary, FilePath, true);
    }
}
