using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using StreamRoom.Core;
namespace StreamRoom.App;
internal static class AnimatedProfile
{
    internal static string Encode(Stream file)
    {
        var header=new byte[13];file.ReadExactly(header);file.Position=0;
        int width=header[6]|header[7]<<8,height=header[8]|header[9]<<8;
        if(width is <1 or >1024||height is <1 or >1024)throw new IOException("Escolha um GIF de até 1024 × 1024 pixels.");
        var decoder=new GifBitmapDecoder(file,BitmapCreateOptions.PreservePixelFormat,BitmapCacheOption.OnDemand);
        int count=decoder.Frames.Count;
        if(count>120||(long)width*height*count>24_000_000)throw new IOException("Escolha um GIF menor ou mais curto, com até 120 quadros.");
        var snapshots=new List<BitmapSource>();var delays=new List<int>();BitmapSource? canvas=null;
        static int Query(BitmapMetadata? m,string key,int fallback=0){try{return m?.GetQuery(key) is {} value?Convert.ToInt32(value):fallback;}catch{return fallback;}}
        for(int i=0;i<count;i++)
        {
            var frame=decoder.Frames[i];var metadata=frame.Metadata as BitmapMetadata;
            int x=Query(metadata,"/imgdesc/Left"),y=Query(metadata,"/imgdesc/Top");
            if(x+frame.PixelWidth>width||y+frame.PixelHeight>height)throw new IOException("Quadro GIF inválido.");
            var before=canvas;var visual=new DrawingVisual();
            using(var d=visual.RenderOpen()){d.DrawRectangle(Brushes.Black,null,new Rect(0,0,width,height));if(canvas is not null)d.DrawImage(canvas,new Rect(0,0,width,height));d.DrawImage(frame,new Rect(x,y,frame.PixelWidth,frame.PixelHeight));}
            var composed=new RenderTargetBitmap(width,height,96,96,PixelFormats.Pbgra32);composed.Render(visual);composed.Freeze();canvas=composed;
            snapshots.Add(Thumbnail(composed,64));delays.Add(Math.Max(2,Query(metadata,"/grctlext/Delay",10)));
            int disposal=Query(metadata,"/grctlext/Disposal");
            if(disposal==3)canvas=before;
            else if(disposal==2){var clear=new DrawingVisual();using(var d=clear.RenderOpen()){d.DrawImage(canvas,new Rect(0,0,width,height));d.DrawRectangle(Brushes.Black,null,new Rect(x,y,frame.PixelWidth,frame.PixelHeight));}var result=new RenderTargetBitmap(width,height,96,96,PixelFormats.Pbgra32);result.Render(clear);result.Freeze();canvas=result;}
        }
        foreach(var (size,maximum) in new[]{(64,12),(48,12),(48,8),(32,8),(32,4),(32,2)})
        {
            int n=Math.Min(maximum,count);using var output=new MemoryStream();using var writer=new BinaryWriter(output);
            writer.Write(Encoding.ASCII.GetBytes("GIF89a"));writer.Write((ushort)size);writer.Write((ushort)size);writer.Write(new byte[]{0,0,0,33,255,11});writer.Write(Encoding.ASCII.GetBytes("NETSCAPE2.0"));writer.Write(new byte[]{3,1,0,0,0});
            for(int i=0;i<n;i++)
            {
                int start=i*count/n,end=(i+1)*count/n,delay=Math.Clamp(delays.Skip(start).Take(end-start).Sum(),10,65535);
                var encoder=new GifBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(Thumbnail(snapshots[start],size)));using var encoded=new MemoryStream();encoder.Save(encoded);var b=encoded.ToArray();
                int palette=(b[10]&128)!=0?3*(1<<((b[10]&7)+1)):0,p=13+palette;
                while(p<b.Length&&b[p]!=44){if(b[p++]!=33)throw new IOException("Não foi possível otimizar o GIF.");p++;while(b[p]!=0)p+=b[p]+1;p++;}
                writer.Write(new byte[]{33,249,4,4});writer.Write((ushort)delay);writer.Write(new byte[]{0,0,44});writer.Write(b,p+1,8);
                int flags=b[p+9];writer.Write((byte)((flags&128)!=0?flags:128|(b[10]&7)));if((flags&128)==0)writer.Write(b,13,palette);
                int begin=p+10,finish=begin;if((flags&128)!=0)finish+=3*(1<<((flags&7)+1));finish++;
                while(b[finish]!=0)finish+=b[finish]+1;finish++;writer.Write(b,begin,finish-begin);
            }
            writer.Write((byte)59);writer.Flush();var avatar="data:image/gif;base64,"+Convert.ToBase64String(output.ToArray());
            if(avatar.Length<=GifAvatar.MaxDataLength){ProfileData.ValidateAvatar(avatar);return avatar;}
        }
        throw new IOException("Esse GIF continua muito grande. Escolha uma animação mais simples.");
    }
    private static BitmapSource Thumbnail(BitmapSource image,int size)
    {
        var visual=new DrawingVisual();using(var d=visual.RenderOpen()){double scale=(double)size/Math.Min(image.PixelWidth,image.PixelHeight);d.PushClip(new RectangleGeometry(new Rect(0,0,size,size)));d.DrawImage(image,new Rect((size-image.PixelWidth*scale)/2,(size-image.PixelHeight*scale)/2,image.PixelWidth*scale,image.PixelHeight*scale));d.Pop();}
        var result=new RenderTargetBitmap(size,size,96,96,PixelFormats.Pbgra32);result.Render(visual);result.Freeze();return result;
    }
}
