using System.Text;
namespace StreamRoom.Core;
public static class GifAvatar
{
    public const int MaxDataLength=12000;
    public static bool Valid(byte[] b)
    {
        if(b.Length<14||Encoding.ASCII.GetString(b,0,6)!="GIF89a")return false;
        int W(int i)=>b[i]|b[i+1]<<8;
        int width=W(6),height=W(8),p=13,frames=0;
        if(width is <1 or >128||height is <1 or >128)return false;
        if((b[10]&128)!=0)p+=3*(1<<((b[10]&7)+1));
        bool Blocks(){while(p<b.Length){int n=b[p++];if(n==0)return true;if(p+n>b.Length)return false;p+=n;}return false;}
        while(p<b.Length)
        {
            int kind=b[p++];
            if(kind==59)return frames>0&&p==b.Length;
            if(kind==33)
            {
                if(p>=b.Length)return false;int label=b[p++];
                if(label==249){if(p+6>b.Length||b[p]!=4||W(p+2)<10||b[p+5]!=0)return false;p+=6;}
                else if(label==255){if(p+12>b.Length||b[p++]!=11||Encoding.ASCII.GetString(b,p,11)!="NETSCAPE2.0")return false;p+=11;if(!Blocks())return false;}
                else return false;
            }
            else if(kind==44)
            {
                if(p+9>b.Length||++frames>12||W(p)!=0||W(p+2)!=0||W(p+4)!=width||W(p+6)!=height)return false;
                int flags=b[p+8];p+=9;if((flags&128)!=0)p+=3*(1<<((flags&7)+1));
                if(p>=b.Length||b[p] is <2 or >8)return false;p++;if(!Blocks())return false;
            }
            else return false;
        }
        return false;
    }
}
