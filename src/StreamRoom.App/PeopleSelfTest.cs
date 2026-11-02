using System.IO;using System.Text.Json;
namespace StreamRoom.App;
internal static class PeopleSelfTest
{
    internal static async Task Run(string output,Uri server)
    {
        string directory=Path.Combine(Path.GetTempPath(),"StreamRoom-People-Test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);bool published=false;
        try{
            string name="Prova "+Guid.NewGuid().ToString("N")[..12];await ProfileStore.SaveAsync(directory,name,null);
            var profile=await PeopleService.PublishAsync(directory,true,false,server);published=true;
            var found=await PeopleService.SearchAsync(name,server);
            if(found.Length!=1||found[0].Id!=profile.Id)throw new Exception("Native signed profile was not found.");
            await PeopleService.PublishAsync(directory,false,false,server);published=false;
            if((await PeopleService.SearchAsync(name,server)).Length!=0)throw new Exception("Profile stayed public after opt-out.");
            await File.WriteAllTextAsync(output,JsonSerializer.Serialize(new{success=true,nativeSignature=true,searchOutsideRoom=true,optOut=true}));
        }catch(Exception error){Environment.ExitCode=1;await File.WriteAllTextAsync(output,JsonSerializer.Serialize(new{success=false,error=error.ToString()}));}
        finally{if(published)try{await PeopleService.PublishAsync(directory,false,false,server);}catch{}}
    }
}
