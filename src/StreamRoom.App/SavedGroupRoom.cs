using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using StreamRoom.Core;

namespace StreamRoom.App;

internal sealed record SavedGroupRoom(string Server, string RoomId, string Token, string Invitation, bool Owner)
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Size; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true)] private static extern bool CryptProtectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true)] private static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    internal static byte[] Transform(byte[] bytes, bool protect)
    {
        var input = new Blob { Size = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) }; Blob output = default;
        try
        {
            Marshal.Copy(bytes, 0, input.Data, bytes.Length);
            var success = protect ? CryptProtectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output) : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!success) throw new IOException("O Windows não conseguiu acessar os dados salvos neste perfil.");
            var result = new byte[output.Size]; Marshal.Copy(output.Data, result, 0, result.Length); return result;
        }
        finally { Marshal.FreeHGlobal(input.Data); if (output.Data != IntPtr.Zero) LocalFree(output.Data); }
    }
    public static SavedGroupRoom? Load(string directory)
    {
        var path = Path.Combine(directory, "group-room.dat");
        if (!File.Exists(path)) return null;
        if (new FileInfo(path).Length is 0 or > 32768) throw new IOException("Arquivo de sala salva inválido. Remova o acesso salvo para entrar novamente.");
        var bytes = File.ReadAllBytes(path);
        var saved = JsonSerializer.Deserialize<SavedGroupRoom>(Transform(bytes, false)) ?? throw new IOException("Sala salva inválida.");
        saved.Validate();
        return saved;
    }
    private void Validate()
    {
        var server = Invitations.ValidateServer(Server);
        var invitation = Invitations.Parse(server, Invitation);
        if (invitation.RoomId != RoomId || Token is not { Length: 64 } || !Token.All(char.IsAsciiHexDigitLower)
            || (!Owner && Token != invitation.Token)) throw new IOException("Sala salva inválida.");
    }
    public async Task SaveAsync(string directory)
    {
        Validate();
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "group-room.dat");
        await File.WriteAllBytesAsync(path + ".tmp", Transform(JsonSerializer.SerializeToUtf8Bytes(this), true));
        File.Move(path + ".tmp", path, true);
    }
    public static void Forget(string directory) => File.Delete(Path.Combine(directory, "group-room.dat"));
}
