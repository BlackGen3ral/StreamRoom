using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace StreamRoom.App;

internal sealed record SavedDiscordSetup(string FileName, DiscordProtonProfile Profile, bool EnableQuality, bool Pending)
{
    private const string StoreName = "discord-profile-v1.dat";

    public static SavedDiscordSetup? Load(string directory)
    {
        var file = new FileInfo(Path.Combine(directory, StoreName));
        if (!file.Exists) return null;
        if (file.Length is 0 or > 32768) throw new IOException("Perfil do Discord salvo inválido.");
        var clear = SavedGroupRoom.Transform(File.ReadAllBytes(file.FullName), false);
        try
        {
            var saved = JsonSerializer.Deserialize<SavedDiscordSetup>(clear);
            if (saved?.FileName is not { Length: > 0 } || saved.Profile is null)
                throw new IOException("Perfil do Discord salvo inválido.");
            return saved;
        }
        finally { CryptographicOperations.ZeroMemory(clear); }
    }

    public void Save(string directory)
    {
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, StoreName);
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        var clear = JsonSerializer.SerializeToUtf8Bytes(this);
        try
        {
            File.WriteAllBytes(temporary, SavedGroupRoom.Transform(clear, true));
            File.Move(temporary, file, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(clear);
            File.Delete(temporary);
        }
    }
}
