namespace StreamRoom.Core;

public sealed record UserProfile(string Name, string? Avatar = null, bool Sounds = true);
public static class ProfileData
{
    public static string Name(string? value)
    {
        value = (value ?? "").Trim();
        if (value.Length is < 1 or > 32 || value.Any(char.IsControl)) throw new ArgumentException("Use um nome de 1 a 32 caracteres.");
        return value;
    }
    public static void ValidateAvatar(string? avatar)
    {
        if (avatar is null) return;
        const string prefix = "data:image/jpeg;base64,";
        if (avatar.Length > 8192 || !avatar.StartsWith(prefix, StringComparison.Ordinal)) throw new ArgumentException("Foto de perfil inválida.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(avatar[prefix.Length..]); } catch (FormatException) { throw new ArgumentException("Foto de perfil inválida."); }
        if (bytes.Length < 4 || bytes[0] != 255 || bytes[1] != 216 || bytes[^2] != 255 || bytes[^1] != 217) throw new ArgumentException("Foto de perfil inválida.");
        for (int offset = 2; offset + 3 < bytes.Length;)
        {
            if (bytes[offset++] != 255) break;
            while (offset < bytes.Length && bytes[offset] == 255) offset++;
            if (offset + 2 >= bytes.Length) break;
            int marker = bytes[offset++], length = bytes[offset] * 256 + bytes[offset + 1];
            if (length < 2 || offset + length > bytes.Length) break;
            if (marker is 192 or 194)
            {
                if (length < 8) break;
                int height = bytes[offset + 3] * 256 + bytes[offset + 4], width = bytes[offset + 5] * 256 + bytes[offset + 6];
                if (width is >= 1 and <= 128 && height is >= 1 and <= 128) return;
                break;
            }
            if (marker is 218 or 217) break;
            offset += length;
        }
        throw new ArgumentException("A foto deve ser uma miniatura de até 128 × 128 pixels.");
    }
}
