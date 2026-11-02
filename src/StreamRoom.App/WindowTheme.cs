using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace StreamRoom.App;

internal static class WindowTheme
{
    public static void Apply(Window window)
    {
        if (SystemParameters.HighContrast) return;
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == 0) return;
        int dark = 1, caption = 0x001F1917, text = 0x00F3EBE8;
        // Unsupported DWM attributes return an HRESULT; keep native window behavior.
        _ = DwmSetWindowAttribute(handle, 20, ref dark, sizeof(int));
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            _ = DwmSetWindowAttribute(handle, 35, ref caption, sizeof(int));
            _ = DwmSetWindowAttribute(handle, 36, ref text, sizeof(int));
        }
    }
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(nint window, int attribute, ref int value, int size);
}
