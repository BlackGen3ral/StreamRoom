using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using StreamRoom.Core;

namespace StreamRoom.App;

internal static class ProfileStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static UserProfile? Load(string directory)
    {
        try
        {
            var file = new FileInfo(Path.Combine(directory, "profile-v1.json"));
            if (!file.Exists || file.Length > 65_536) return null;
            var profile = JsonSerializer.Deserialize<UserProfile>(File.ReadAllText(file.FullName), Json);
            if (profile is null) return null;
            ProfileData.Name(profile.Name); ProfileData.ValidateAvatar(profile.Avatar); return profile;
        }
        catch (Exception error) when (error is IOException or JsonException or ArgumentException or UnauthorizedAccessException) { return null; }
    }
    internal static async Task<UserProfile> SaveAsync(string directory, string name, string? avatar, bool sounds = true, string? identity = null)
    {
        name = ProfileData.Name(name); ProfileData.ValidateAvatar(avatar);
        var previous = Load(directory);
        var profile = new UserProfile(name, avatar, sounds, ProfileData.ValidId(identity)?identity:ProfileData.ValidId(previous?.Id) ? previous!.Id : Guid.NewGuid().ToString("D"));
        var file = Path.Combine(directory, "profile-v1.json");
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(file + ".tmp", JsonSerializer.Serialize(profile, Json));
        File.Move(file + ".tmp", file, true); return profile;
    }
    internal static async Task<string?> ChoosePhotoAsync(Window owner)
    {
        var picker = new OpenFileDialog { Title = "Escolher foto ou GIF do perfil", Filter = "Imagens (*.png;*.jpg;*.jpeg;*.gif)|*.png;*.jpg;*.jpeg;*.gif", Multiselect = false, CheckFileExists = true };
        if (picker.ShowDialog(owner) != true) return null;
        var selectedPath=picker.FileName;
        var completion=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker=new Thread(()=>{try{completion.TrySetResult(EncodePhoto(selectedPath));}catch(Exception error){completion.TrySetException(error);}}){IsBackground=true};
        worker.SetApartmentState(ApartmentState.STA);worker.Start();return await completion.Task;
    }
    internal static string EncodePhoto(string path)
    {
        using var file = File.OpenRead(path);
        return EncodePhoto(file);
    }
    internal static string EncodePhoto(Stream file)
    {
        if (file.Length > 10 * 1024 * 1024) throw new IOException("Escolha uma imagem de até 10 MB.");
        if(file.Length>=13){var signature=new byte[6];file.ReadExactly(signature);file.Position=0;if(System.Text.Encoding.ASCII.GetString(signature) is "GIF87a" or "GIF89a")return AnimatedProfile.Encode(file);}
        var decoder = BitmapDecoder.Create(file, BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
        var frame = decoder.Frames[0];
        if ((long)frame.PixelWidth * frame.PixelHeight > 40_000_000) throw new IOException("Escolha uma imagem de até 40 megapixels.");
        file.Position = 0;
        var image = new BitmapImage(); image.BeginInit(); image.CacheOption = BitmapCacheOption.OnLoad; image.StreamSource = file;
        if (frame.PixelWidth >= frame.PixelHeight) image.DecodePixelWidth = 256; else image.DecodePixelHeight = 256;
        image.EndInit(); image.Freeze();
        const int size = 96;
        var visual = new DrawingVisual();
        using (var drawing = visual.RenderOpen())
        {
            drawing.DrawRectangle(Brushes.White, null, new Rect(0, 0, size, size));
            double scale = (double)size / Math.Min(image.PixelWidth, image.PixelHeight);
            double width = image.PixelWidth * scale, height = image.PixelHeight * scale;
            drawing.PushClip(new RectangleGeometry(new Rect(0, 0, size, size)));
            drawing.DrawImage(image, new Rect((size - width) / 2, (size - height) / 2, width, height)); drawing.Pop();
        }
        var bitmap = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32); bitmap.Render(visual);
        foreach (int quality in new[] { 82, 65, 45, 25 })
        {
            var encoder = new JpegBitmapEncoder { QualityLevel = quality }; encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using var output = new MemoryStream(); encoder.Save(output);
            var avatar = "data:image/jpeg;base64," + Convert.ToBase64String(output.ToArray());
            if (avatar.Length <= 8192) { ProfileData.ValidateAvatar(avatar); return avatar; }
        }
        throw new IOException("Não foi possível reduzir essa foto. Escolha outra imagem.");
    }
}
