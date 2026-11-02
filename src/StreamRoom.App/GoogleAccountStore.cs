using System.IO;
using System.Text.Json;

namespace StreamRoom.App;

// A local profile association, not a persisted Google session. Contains no OAuth tokens.
internal static class GoogleAccountStore
{
    internal static GoogleIdentity? Load(string directory)
    {
        var file = new FileInfo(Path.Combine(directory, "google-profile-v1.dat"));
        if (!file.Exists || file.Length > 16_384) return null;
        try
        {
            var profile = JsonSerializer.Deserialize<GoogleIdentity>(SavedGroupRoom.Transform(File.ReadAllBytes(file.FullName), false));
            if (profile?.Subject is not { Length: >= 1 and <= 255 }) return null;
            StreamRoom.Core.ProfileData.Name(profile.Name); StreamRoom.Core.ProfileData.ValidateAvatar(profile.Avatar); return profile;
        }
        catch (Exception error) when (error is IOException or JsonException or ArgumentException or UnauthorizedAccessException) { return null; }
    }
    internal static async Task SaveAsync(string directory, GoogleIdentity profile)
    {
        Directory.CreateDirectory(directory); var file = Path.Combine(directory, "google-profile-v1.dat");
        await File.WriteAllBytesAsync(file + ".tmp", SavedGroupRoom.Transform(JsonSerializer.SerializeToUtf8Bytes(profile), true));
        File.Move(file + ".tmp", file, true);
    }
    internal static void Remove(string directory) => File.Delete(Path.Combine(directory, "google-profile-v1.dat"));
    internal static object Status(string directory) => Load(directory) is { } profile ? new { linked = true, name = profile.Name } : new { linked = false, name = "" };
}
