using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using StreamRoom.Core;
namespace StreamRoom.App;
internal sealed record DirectoryPerson(string Id,string Name,string? Avatar);
internal sealed record DirectoryIdentity(byte[] PrivateKey,bool Listed);
internal static class PeopleService
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){Encoder=JavaScriptEncoder.UnsafeRelaxedJsonEscaping};
    private static string PathFor(string directory)=>Path.Combine(directory,"public-profile-key.dat");
    internal static DirectoryIdentity? Load(string directory)
    {
        var path=PathFor(directory);if(!File.Exists(path))return null;
        try{if(new FileInfo(path).Length>16384)throw new IOException();return JsonSerializer.Deserialize<DirectoryIdentity>(SavedGroupRoom.Transform(File.ReadAllBytes(path),false),Json)??throw new IOException();}
        catch(Exception error)when(error is IOException or JsonException or CryptographicException){throw new IOException("Não foi possível acessar seu perfil público protegido neste Windows.");}
    }
    internal static string Id(byte[] publicKey)
    {
        string h=Convert.ToHexStringLower(SHA256.HashData(publicKey))[..32];return $"{h[..8]}-{h[8..12]}-{h[12..16]}-{h[16..20]}-{h[20..]}";
    }
    internal static object Status(string directory)
    {
        var identity=Load(directory);return new{listed=identity?.Listed??false};
    }
    private static async Task SaveAsync(string directory,DirectoryIdentity identity)
    {
        Directory.CreateDirectory(directory);string path=PathFor(directory);
        await File.WriteAllBytesAsync(path+".tmp",SavedGroupRoom.Transform(JsonSerializer.SerializeToUtf8Bytes(identity,Json),true));File.Move(path+".tmp",path,true);
    }
    internal static async Task<UserProfile> PublishAsync(string directory,bool listed,bool connected,Uri? server=null)
    {
        var profile=ProfileStore.Load(directory)??throw new IOException("Salve seu nome no perfil antes de ativar a busca pública.");
        var identity=Load(directory);
        if(identity is null){if(!listed)return profile;using var generated=ECDsa.Create(ECCurve.NamedCurves.nistP256);identity=new(generated.ExportPkcs8PrivateKey(),false);await SaveAsync(directory,identity);}
        using var key=ECDsa.Create();key.ImportPkcs8PrivateKey(identity.PrivateKey,out _);var publicKey=key.ExportSubjectPublicKeyInfo();var id=Id(publicKey);
        if(profile.Id!=id&&connected)throw new IOException("Saia da sala uma vez para ativar sua identidade pública. Depois você pode entrar normalmente.");
        long at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var message=string.Join("\n",id,profile.Name,profile.Avatar??"",listed?"1":"0",at.ToString(System.Globalization.CultureInfo.InvariantCulture));
        var signature=key.SignData(Encoding.UTF8.GetBytes(message),HashAlgorithmName.SHA256,DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        using var request=new HttpRequestMessage(HttpMethod.Post,new Uri(Endpoint(server),"v2/people")){Content=new StringContent(JsonSerializer.Serialize(new{id,name=profile.Name,avatar=profile.Avatar,listed,at,publicKey=Convert.ToBase64String(publicKey),signature=Convert.ToBase64String(signature)},Json),Encoding.UTF8,"application/json")};
        using var response=await SendAsync(request,4096);using var result=JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        if(result.RootElement.GetProperty("id").GetString()!=id)throw new IOException("O servidor retornou outra identidade. Nenhum perfil local foi trocado.");
        profile=await ProfileStore.SaveAsync(directory,profile.Name,profile.Avatar,profile.Sounds,id);
        await SaveAsync(directory,identity with{Listed=listed});return profile;
    }
    private static Uri Endpoint(Uri? server)=>Invitations.ValidateServer((server??new Uri("https://streamroom.arthostudio.com")).AbsoluteUri);
    internal static async Task<DirectoryPerson[]> SearchAsync(string query,Uri? server=null)
    {
        query=query.Trim();if(query.Length is <2 or >32||query.Any(char.IsControl))throw new IOException("Digite de 2 a 32 caracteres para buscar.");
        using var request=new HttpRequestMessage(HttpMethod.Get,new Uri(Endpoint(server),"v2/people?q="+Uri.EscapeDataString(query)));
        using var response=await SendAsync(request,262144);using var result=JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var people=result.RootElement.GetProperty("people").Deserialize<DirectoryPerson[]>(Json)??[];
        if(people.Length>20)throw new IOException("Resposta de busca inválida.");
        foreach(var person in people){if(person is null||!ProfileData.ValidId(person.Id))throw new IOException("Perfil público inválido.");ProfileData.Name(person.Name);ProfileData.ValidateAvatar(person.Avatar);}
        return people;
    }
    private static async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,int limit)
    {
        using var http=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(15)};
        var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead);
        try{
            await response.Content.LoadIntoBufferAsync(limit);
            if(!response.IsSuccessStatusCode){string message="Não foi possível acessar a busca de amigos. Tente novamente.";try{using var error=JsonDocument.Parse(await response.Content.ReadAsStringAsync());if(error.RootElement.TryGetProperty("error",out var text)&&text.ValueKind==JsonValueKind.String&&text.GetString() is {Length:<=300} description)message=description;}catch(JsonException){}throw new IOException(message);}
            return response;
        }catch{response.Dispose();throw;}
    }
}
