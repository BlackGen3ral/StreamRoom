using System.IO;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using StreamRoom.Core;

namespace StreamRoom.App;
internal static class ProfileSelfTest
{
    internal static async Task Run(string output)
    {
        try
        {
            var directory = Path.Combine(Path.GetTempPath(), "StreamRoom-Profile-Test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            var image = new RenderTargetBitmap(360, 180, 96, 96, PixelFormats.Pbgra32);
            var visual = new DrawingVisual();
            using (var drawing = visual.RenderOpen()) drawing.DrawRectangle(Brushes.MediumPurple, null, new System.Windows.Rect(0, 0, 360, 180));
            image.Render(visual);
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
            var photo = Path.Combine(directory, "test-photo.png");
            using (var file = File.Create(photo)) encoder.Save(file);
            var avatar = ProfileStore.EncodePhoto(photo);
            var animation=new GifBitmapEncoder();
            foreach(var color in new[]{Brushes.Red,Brushes.Blue,Brushes.Lime})
            {
                var scene=new DrawingVisual();using(var draw=scene.RenderOpen()){draw.DrawRectangle(color,null,new System.Windows.Rect(0,0,256,256));}
                var picture=new RenderTargetBitmap(256,256,96,96,PixelFormats.Pbgra32);picture.Render(scene);animation.Frames.Add(BitmapFrame.Create(picture));
            }
            var gifPath=Path.Combine(directory,"animation.gif");using(var gif=File.Create(gifPath))animation.Save(gif);
            var animated=ProfileStore.EncodePhoto(gifPath);ProfileData.ValidateAvatar(animated);
            if(!animated.StartsWith("data:image/gif;base64,")||animated.Length>GifAvatar.MaxDataLength)throw new Exception("Animated avatar was flattened or unbounded.");
            using(var bytes=new MemoryStream(Convert.FromBase64String(animated[22..])))
            {
                var decoded=new GifBitmapDecoder(bytes,BitmapCreateOptions.None,BitmapCacheOption.OnLoad);
                if(decoded.Frames.Count!=3||decoded.Frames[0].PixelWidth!=64)throw new Exception("Animation frames were not preserved.");
            }
            await ProfileStore.SaveAsync(directory,"GIF",animated);
            if(ProfileStore.Load(directory)?.Avatar!=animated)throw new Exception("GIF profile did not persist.");
            await File.WriteAllTextAsync(output+".gif.txt",animated);
            await File.WriteAllTextAsync(Path.Combine(directory, "avatar.txt"), avatar);
            using var pixels = new MemoryStream(Convert.FromBase64String(avatar[(avatar.IndexOf(',') + 1)..]));
            var frame = BitmapDecoder.Create(pixels, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0];
            frame.Freeze();
            if (frame.PixelWidth != 96 || frame.PixelHeight != 96 || avatar.Length > 8192) throw new Exception("Thumbnail dimensions/size invalid.");
            var saved = await ProfileStore.SaveAsync(directory, " Jogador ", avatar);
            if (ProfileStore.Load(directory) != saved || saved.Name != "Jogador") throw new Exception("Profile did not persist.");
            await ProfileStore.SaveAsync(directory, "Outro nome", null, sounds: false);
            if (ProfileStore.Load(directory) is not { Avatar: null, Sounds: false }) throw new Exception("Avatar removal/sound preference did not persist.");
            foreach (var invalid in new[] { "https://example.com/photo.jpg", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/jpeg;base64," + new string('A', 9000) })
            {
                try { ProfileData.ValidateAvatar(invalid); throw new Exception("Unsafe image accepted."); } catch (ArgumentException) { }
            }
            await File.WriteAllTextAsync(Path.Combine(directory, "profile-v1.json"), "{}");
            if (ProfileStore.Load(directory) is not null) throw new Exception("Malformed profile accepted.");
            await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = true, width = frame.PixelWidth, height = frame.PixelHeight, avatarBytes = avatar.Length, persistence = true, removal = true, invalidImagesRejected = true }));
        }
        catch (Exception error) { Environment.ExitCode = 1; await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = false, error = error.ToString() })); }
    }
}
