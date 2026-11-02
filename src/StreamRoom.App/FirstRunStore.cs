using System.IO;
using System.Text.Json;

namespace StreamRoom.App;

internal static class FirstRunStore
{
    internal static bool ShouldPresent(string directory)
    {
        // Existing profiles already passed the old entry flow; updates must not interrupt them.
        if (ProfileStore.Load(directory) is not null) return false;
        try
        {
            var file = new FileInfo(Path.Combine(directory,"welcome-v1.json"));
            if (!file.Exists || file.Length > 1024) return true;
            using var document = JsonDocument.Parse(File.ReadAllText(file.FullName));
            if(document.RootElement.ValueKind!=JsonValueKind.Object)return true;
            return !document.RootElement.TryGetProperty("completed",out var completed) || completed.ValueKind != JsonValueKind.True;
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { return true; }
    }
    internal static async Task CompleteAsync(string directory)
    {
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory,"welcome-v1.json");
        await File.WriteAllTextAsync(file+".tmp","{\"completed\":true}");
        File.Move(file+".tmp",file,true);
    }
}
