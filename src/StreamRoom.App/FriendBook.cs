using System.IO;
using System.Text.Json;
using StreamRoom.Core;

namespace StreamRoom.App;

internal sealed record SavedFriend(string ProfileId, string Name, string? Avatar, long AddedAt);
internal static class FriendBook
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static IReadOnlyList<SavedFriend> Load(string directory)
    {
        var file = new FileInfo(Path.Combine(directory, "friends-v1.json"));
        if (!file.Exists) return [];
        try
        {
            if (file.Length > 2_097_152) throw new IOException("A lista de amigos salva é muito grande.");
            var friends = JsonSerializer.Deserialize<SavedFriend[]>(File.ReadAllText(file.FullName), Json) ?? [];
            if (friends.Length > 100) throw new IOException("Lista de amigos inválida.");
            foreach (var friend in friends)
            {
                if (friend is null || !ProfileData.ValidId(friend.ProfileId)) throw new ArgumentException();
                ProfileData.Name(friend.Name); ProfileData.ValidateAvatar(friend.Avatar);
            }
            return friends.DistinctBy(f => f.ProfileId).ToArray();
        }
        catch (Exception error) when (error is JsonException or ArgumentException)
        { throw new IOException("Não foi possível ler a lista de amigos salva neste PC."); }
    }
    internal static async Task<IReadOnlyList<SavedFriend>> SavePeerAsync(string directory, Participant peer)
    {
        if (!ProfileData.ValidId(peer.ProfileId)) throw new IOException("Seu amigo precisa atualizar o StreamRoom para ser salvo na lista.");
        ProfileData.Name(peer.Name); ProfileData.ValidateAvatar(peer.Avatar);
        var friends = Load(directory).ToList();
        var previous = friends.Find(f => f.ProfileId == peer.ProfileId);
        if (previous is null && friends.Count >= 100) throw new IOException("Você pode salvar até 100 amigos neste PC.");
        friends.RemoveAll(f => f.ProfileId == peer.ProfileId);
        friends.Add(new(peer.ProfileId!, peer.Name, peer.Avatar, previous?.AddedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        return await WriteAsync(directory, friends);
    }
    internal static Task<IReadOnlyList<SavedFriend>> RemoveAsync(string directory, string profileId) =>
        WriteAsync(directory, Load(directory).Where(f => f.ProfileId != profileId).ToArray());
    private static async Task<IReadOnlyList<SavedFriend>> WriteAsync(string directory, IReadOnlyList<SavedFriend> friends)
    {
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, "friends-v1.json");
        await File.WriteAllTextAsync(file + ".tmp", JsonSerializer.Serialize(friends, Json));
        File.Move(file + ".tmp", file, true); return friends;
    }
}
