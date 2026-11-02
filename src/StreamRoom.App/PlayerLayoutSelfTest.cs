using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace StreamRoom.App;
internal static class PlayerLayoutSelfTest
{
    internal static async Task Run(Window window, CoreWebView2 core, string output)
    {
        try
        {
            var previous = window.WindowState;
            var previousWidth = window.ActualWidth; var previousHeight = window.ActualHeight;
            async Task ClickFullscreen()
                => _ = await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", JsonSerializer.Serialize(new { expression = "document.querySelector('.stream-fullscreen').click()", userGesture = true }));
            async Task Wait(bool full)
            {
                for (int i = 0; i < 60; i++) { if (core.ContainsFullScreenElement == full) { await Task.Delay(500); return; } await Task.Delay(50); }
                throw new Exception("Fullscreen transition timed out.");
            }
            async Task<JsonElement> Probe(string phase)
            {
                using var document = JsonDocument.Parse(await core.ExecuteScriptAsync($"window.playerLayoutProbe('{phase}')"));
                var value = document.RootElement.Clone();
                if (!value.GetProperty("success").GetBoolean()) throw new Exception("Player layout assertion failed: " + value.GetRawText());
                return value;
            }
            await core.ExecuteScriptAsync("window.restorePlayerAutoSize()"); await Task.Delay(400);
            var automatic = await Probe("auto");
            await core.ExecuteScriptAsync("window.togglePlayerFill()"); await Task.Delay(300);
            var filled = await Probe("filled");
            using (var file = File.Create(Path.ChangeExtension(output, ".filled.png"))) await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
            await core.ExecuteScriptAsync("window.togglePlayerFill()"); await Task.Delay(200);
            using (var file = File.Create(Path.ChangeExtension(output, ".automatic.png"))) await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
            await core.ExecuteScriptAsync("window.resetPlayerTestSize()"); await Task.Delay(150);
            var initial = await Probe("restored"); var handle = initial.GetProperty("resizeHandle");
            double x = handle.GetProperty("x").GetDouble(), y = handle.GetProperty("y").GetDouble();
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(new { type = "mousePressed", button = "left", buttons = 1, clickCount = 1, x, y }));
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(new { type = "mouseMoved", buttons = 1, x = x + 30, y = y + 20 }));
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(new { type = "mouseReleased", button = "left", buttons = 0, clickCount = 1, x = x + 30, y = y + 20 }));
            await Task.Delay(200); var dragged = await Probe("dragged");
            await core.ExecuteScriptAsync("window.resetPlayerTestSize()"); await Task.Delay(150);
            var beforeBottom = await Probe("restored"); var bottomHandle = beforeBottom.GetProperty("resizeHandle");
            double bx=bottomHandle.GetProperty("x").GetDouble(), by=bottomHandle.GetProperty("y").GetDouble();
            double dragBottomY=beforeBottom.GetProperty("viewport").GetProperty("height").GetDouble()-8;
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent",JsonSerializer.Serialize(new {type="mousePressed",button="left",buttons=1,clickCount=1,x=bx,y=by}));
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent",JsonSerializer.Serialize(new {type="mouseMoved",buttons=1,x=bx,y=dragBottomY}));
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent",JsonSerializer.Serialize(new {type="mouseReleased",button="left",buttons=0,clickCount=1,x=bx,y=dragBottomY}));
            await Task.Delay(250); var bottomDragged = await Probe("bottom-dragged");
            window.Height=Math.Max(window.MinHeight,previousHeight-80);await Task.Delay(300);var smallerAtBottom=await Probe("bottom-dragged");
            window.Height=previousHeight+60;await Task.Delay(300);var largerAtBottom=await Probe("bottom-dragged");
            window.Height=previousHeight;await Task.Delay(200);
            using(var file=File.Create(Path.ChangeExtension(output,".bottom-dragged.png")))await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,file);
            await core.ExecuteScriptAsync("window.resetPlayerTestSize()"); await Task.Delay(100);
            await ClickFullscreen(); await Wait(true); var full = await Probe("full");
            using (var file = File.Create(Path.ChangeExtension(output, ".fullscreen.png"))) await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
            await ClickFullscreen(); await Wait(false); var restored = await Probe("restored");
            bool restoredWindow = window.WindowState == previous && window.WindowStyle == WindowStyle.SingleBorderWindow
                && Math.Abs(window.ActualWidth-previousWidth)<3 && Math.Abs(window.ActualHeight-previousHeight)<3;
            if (!restoredWindow) throw new Exception("Native window was not restored.");
            using (var file = File.Create(Path.ChangeExtension(output, ".restored.png"))) await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
            await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = true, automatic, filled, dragged, bottomDragged, smallerAtBottom, largerAtBottom, full, restored, restoredWindow }));
        }
        catch (Exception error) { Environment.ExitCode = 1; await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { success = false, error = error.ToString() })); }
    }
}
