using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;

namespace NodeCat
{
    public class Sesion
    {
        public string Usuario, Dominio, Estacion, Estado, EstadoTexto, Equipo;
        public int Id;
        public DateTime? Inicio;
        public int? InactivoMin;
    }

    /// <summary>Sesiones de Escritorio remoto mediante la API nativa de Windows (wtsapi32).</summary>
    public static class Wts
    {
        const int WTSSessionInfo = 24;
        const int WTSClientName = 10;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct WTS_SESSION_INFO
        {
            public int SessionId;
            [MarshalAs(UnmanagedType.LPWStr)] public string WinStationName;
            public int State;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct WTSINFO
        {
            public int State;
            public int SessionId;
            public int IncomingBytes, OutgoingBytes, IncomingFrames, OutgoingFrames, IncomingCompressedBytes, OutgoingCompressedBytes;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string WinStationName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 17)] public string Domain;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] public string UserName;
            public long ConnectTime, DisconnectTime, LastInputTime, LogonTime, CurrentTime;
        }

        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr WTSOpenServerW(string serverName);
        [DllImport("wtsapi32.dll")]
        static extern void WTSCloseServer(IntPtr h);
        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool WTSEnumerateSessionsW(IntPtr h, int reserved, int version, out IntPtr info, out int count);
        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool WTSQuerySessionInformationW(IntPtr h, int sessionId, int infoClass, out IntPtr buffer, out int bytes);
        [DllImport("wtsapi32.dll")]
        static extern void WTSFreeMemory(IntPtr p);
        [DllImport("wtsapi32.dll", SetLastError = true)]
        static extern bool WTSDisconnectSession(IntPtr h, int sessionId, bool wait);
        [DllImport("wtsapi32.dll", SetLastError = true)]
        static extern bool WTSLogoffSession(IntPtr h, int sessionId, bool wait);
        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool WTSSendMessageW(IntPtr h, int sessionId, string title, int titleLength, string message, int messageLength, int style, int timeout, out int response, bool wait);

        static bool EsLocal(string servidor)
        {
            var s = (servidor ?? "").Trim().ToLowerInvariant();
            return s == "localhost" || s == "127.0.0.1" || s == "." || s == Environment.MachineName.ToLowerInvariant();
        }

        static IntPtr Abrir(string servidor)
        {
            if (EsLocal(servidor)) return IntPtr.Zero;   // WTS_CURRENT_SERVER_HANDLE
            var h = WTSOpenServerW(servidor);
            if (h == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            return h;
        }

        static void CerrarH(IntPtr h) { if (h != IntPtr.Zero) WTSCloseServer(h); }

        static string TextoEstado(int s)
        {
            switch (s)
            {
                case 0: return "Activa";
                case 1: return "Conectada";
                case 2: return "Conectando";
                case 3: return "Observada";
                case 4: return "Desconectada";
                case 5: return "En espera";
                case 6: return "Escuchando";
                case 7: return "Reiniciando";
                case 8: return "Caída";
                default: return "Iniciando";
            }
        }

        static DateTime? Fecha(long ft)
        {
            if (ft <= 0) return null;
            try { return DateTime.FromFileTimeUtc(ft); } catch { return null; }
        }

        public static List<Sesion> Listar(string servidor, Dictionary<string, string> equipos)
        {
            var lista = new List<Sesion>();
            var vistas = new HashSet<string>();
            IntPtr h = Abrir(servidor);
            IntPtr info = IntPtr.Zero;
            try
            {
                int n;
                if (!WTSEnumerateSessionsW(h, 0, 1, out info, out n)) throw new Win32Exception(Marshal.GetLastWin32Error());
                int tam = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
                for (int i = 0; i < n; i++)
                {
                    var si = (WTS_SESSION_INFO)Marshal.PtrToStructure(new IntPtr(info.ToInt64() + (long)i * tam), typeof(WTS_SESSION_INFO));
                    IntPtr buf; int bytes;
                    if (!WTSQuerySessionInformationW(h, si.SessionId, WTSSessionInfo, out buf, out bytes)) continue;
                    WTSINFO wi;
                    try { wi = (WTSINFO)Marshal.PtrToStructure(buf, typeof(WTSINFO)); }
                    finally { WTSFreeMemory(buf); }
                    if (string.IsNullOrEmpty(wi.UserName)) continue;   // sesiones del sistema y escuchas

                    var s = new Sesion
                    {
                        Id = si.SessionId,
                        Usuario = wi.UserName,
                        Dominio = wi.Domain,
                        Estacion = si.WinStationName,
                        EstadoTexto = TextoEstado(si.State),
                        Estado = si.State == 0 ? "activa" : si.State == 4 ? "desconectada" : "otro",
                        Inicio = Fecha(wi.LogonTime)
                    };
                    var ahora = Fecha(wi.CurrentTime) ?? DateTime.UtcNow;
                    var desde = si.State == 4 ? (Fecha(wi.DisconnectTime) ?? Fecha(wi.LastInputTime)) : Fecha(wi.LastInputTime);
                    if (desde.HasValue && ahora > desde.Value) s.InactivoMin = (int)(ahora - desde.Value).TotalMinutes;

                    // El equipo de origen solo cambia si la sesión se reconecta: se recuerda mientras id, usuario y estado sean los mismos.
                    string clave = si.SessionId + "|" + s.Usuario + "|" + si.State + "|" + (s.Inicio.HasValue ? s.Inicio.Value.Ticks : 0);
                    string eq;
                    bool conocido;
                    lock (equipos) conocido = equipos.TryGetValue(clave, out eq);
                    if (conocido) s.Equipo = eq;
                    else if (WTSQuerySessionInformationW(h, si.SessionId, WTSClientName, out buf, out bytes))
                    {
                        try { s.Equipo = Marshal.PtrToStringUni(buf); } finally { WTSFreeMemory(buf); }
                        lock (equipos) equipos[clave] = s.Equipo;
                    }
                    vistas.Add(clave);
                    lista.Add(s);
                }
            }
            finally
            {
                if (info != IntPtr.Zero) WTSFreeMemory(info);
                CerrarH(h);
            }
            lock (equipos) foreach (var k in equipos.Keys.Where(k => !vistas.Contains(k)).ToList()) equipos.Remove(k);   // sesiones que ya no existen
            return lista;
        }

        static void Comprobar(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }

        public static void Desconectar(string servidor, int id)
        {
            IntPtr h = Abrir(servidor);
            try { Comprobar(WTSDisconnectSession(h, id, false)); } finally { CerrarH(h); }
        }

        public static void CerrarSesion(string servidor, int id)
        {
            IntPtr h = Abrir(servidor);
            try { Comprobar(WTSLogoffSession(h, id, false)); } finally { CerrarH(h); }
        }

        public static void EnviarMensaje(string servidor, int id, string titulo, string texto)
        {
            IntPtr h = Abrir(servidor);
            try
            {
                int r;
                // MB_OK | MB_ICONINFORMATION | MB_TOPMOST | MB_SETFOREGROUND
                const int estilo = 0x0 | 0x40 | 0x40000 | 0x10000;
                Comprobar(WTSSendMessageW(h, id, titulo, titulo.Length * 2, texto, texto.Length * 2, estilo, 0, out r, false));
            }
            finally { CerrarH(h); }
        }
    }
}
