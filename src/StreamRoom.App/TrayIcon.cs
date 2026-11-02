using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
namespace StreamRoom.App;

internal sealed class TrayIcon : IDisposable
{
    private const uint CallbackMessage = 0x8000 + 41;
    private const uint Id = 1;
    private readonly nint _window;
    private readonly HwndSource _source;
    private readonly Action _open, _exit;
    private readonly uint _taskbarCreated;
    private NotifyIconData _data;
    private bool _disposed;
    public bool IsAvailable { get; private set; }
    public TrayIcon(Window window, Action open, Action exit)
    {
        _window = new WindowInteropHelper(window).Handle;
        _source = HwndSource.FromHwnd(_window) ?? throw new InvalidOperationException("Janela indisponível para bandeja.");
        _open = open; _exit = exit;
        _taskbarCreated = RegisterWindowMessage("TaskbarCreated");
        var icon = SendMessage(_window, 0x007F, 2, 0); // WM_GETICON / ICON_SMALL2, borrowed handle.
        if (icon == 0) icon = LoadIcon(0, 32512);
        _data = new NotifyIconData { Size = (uint)Marshal.SizeOf<NotifyIconData>(), Window = _window, Id = Id,
            Flags = 1 | 2 | 4, CallbackMessage = CallbackMessage, Icon = icon, Tip = "StreamRoom · compartilhar tela", Info = "", InfoTitle = "" };
        _source.AddHook(Hook);
        IsAvailable = ShellNotifyIcon(0, ref _data);
        if (!IsAvailable) { _source.RemoveHook(Hook); throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível criar o ícone na bandeja."); }
    }
    private nint Hook(nint hwnd, int message, nint wparam, nint lparam, ref bool handled)
    {
        if (_disposed) return 0;
        if ((uint)message == _taskbarCreated) { IsAvailable = ShellNotifyIcon(0, ref _data); return 0; }
        if ((uint)message != CallbackMessage) return 0;
        handled = true;
        int action = (int)((long)lparam & 0xffff);
        if (action == 0x0202 || action == 0x0203) _open();
        else if (action == 0x0205 || action == 0x007B)
        {
            var menu = CreatePopupMenu();
            try
            {
                AppendMenu(menu, 0, 1, "Abrir StreamRoom");
                AppendMenu(menu, 0x800, 0, "");
                AppendMenu(menu, 0, 2, "Sair do StreamRoom");
                GetCursorPos(out var point); SetForegroundWindow(_window);
                uint selected = TrackPopupMenu(menu, 0x100 | 0x2, point.X, point.Y, 0, _window, 0);
                PostMessage(_window, 0, 0, 0);
                if (selected == 1) _open(); else if (selected == 2) _exit();
            }
            finally { DestroyMenu(menu); }
        }
        return 0;
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        ShellNotifyIcon(2, ref _data); IsAvailable = false;
        _source.RemoveHook(Hook);
        // The window/system owns Icon; do not destroy a borrowed HICON.
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint Size; public nint Window; public uint Id, Flags, CallbackMessage; public nint Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
        public uint State, StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
        public uint TimeoutOrVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string InfoTitle;
        public uint InfoFlags; public Guid GuidItem; public nint BalloonIcon;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [DllImport("shell32.dll", EntryPoint = "Shell_NotifyIconW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ShellNotifyIcon(uint action, ref NotifyIconData data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string message);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern nint SendMessage(nint hwnd, uint message, nint wparam, nint lparam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool PostMessage(nint hwnd, uint message, nint wparam, nint lparam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern nint LoadIcon(nint instance, nint name);
    [DllImport("user32.dll")] private static extern nint CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(nint menu, uint flags, nuint id, string text);
    [DllImport("user32.dll")] private static extern uint TrackPopupMenu(nint menu, uint flags, int x, int y, int reserved, nint hwnd, nint rect);
    [DllImport("user32.dll")] private static extern bool DestroyMenu(nint menu);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint window);
}
