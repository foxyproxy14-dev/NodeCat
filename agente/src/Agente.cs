using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;

[assembly: AssemblyTitle("Atalaya Agente")]
[assembly: AssemblyDescription("Agente de Atalaya: envía las sesiones, la CPU, la memoria y los discos de este servidor a Atalaya.")]
[assembly: AssemblyProduct("Atalaya")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

namespace Atalaya
{
    public static class Utiles
    {
        static readonly DateTime Epoca = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        public static long Ms(DateTime d) { return (long)(d.ToUniversalTime() - Epoca).TotalMilliseconds; }
        public static DateTime DeMs(long ms) { return Epoca.AddMilliseconds(ms); }
        public static readonly Encoding Utf8 = new UTF8Encoding(false);
        static readonly object bloqueo = new object();

        public static string CarpetaDatos
        {
            get
            {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Atalaya Agente");
                try { Directory.CreateDirectory(d); } catch { }
                return d;
            }
        }

        public static void Log(string texto, ConsoleColor color = ConsoleColor.Gray)
        {
            string linea = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + texto;
            lock (bloqueo)
            {
                if (!Agente.ComoServicio) { try { Console.ForegroundColor = color; Console.WriteLine("  " + texto); Console.ResetColor(); } catch { } }
                try
                {
                    string f = Path.Combine(CarpetaDatos, "agente.log");
                    if (File.Exists(f) && new FileInfo(f).Length > 2 * 1024 * 1024) { File.Delete(f + ".1"); File.Move(f, f + ".1"); }
                    File.AppendAllText(f, linea + Environment.NewLine, Utf8);
                }
                catch { }
            }
        }
    }

    public static class Agente
    {
        public const string Version = "1.1.0";
        const string NombreServicio = "AtalayaAgente";
        public static bool ComoServicio;
        static string servidor, clave, proxy;
        static int intervalo = 15;
        static readonly Control control = new Control();
        static readonly Queue<string> pendientes = new Queue<string>();
        static readonly AutoResetEvent despertar = new AutoResetEvent(false);
        static volatile bool detener;
        static volatile string motivo = "inicio";
        static bool conectado = true;

        static string Exe { get { return Assembly.GetExecutingAssembly().Location; } }
        static string CarpetaExe { get { return Path.GetDirectoryName(Exe); } }
        static string CarpetaInstalacion { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Atalaya Agente"); } }

        static int Main(string[] args)
        {
            try { Console.OutputEncoding = new UTF8Encoding(false); } catch { }
            // Atalaya suele estar detrás de HTTPS (Cloudflare Tunnel, proxy inverso): .NET 4.5 no activa TLS 1.2 por defecto
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }
            string cmd = args.Length > 0 ? args[0].ToLowerInvariant().TrimStart('-', '/') : "";
            bool silencioso = args.Any(a => a.TrimStart('-', '/').ToLowerInvariant() == "silencioso");
            try
            {
                switch (cmd)
                {
                    case "servicio": ComoServicio = true; ServiceBase.Run(new ServicioAgente()); return 0;
                    case "instalar": return Instalar(silencioso);
                    case "desinstalar": return Desinstalar(silencioso);
                    case "probar": return Probar();
                    default: Ayuda(); Pausa(silencioso); return 0;
                }
            }
            catch (Exception ex)
            {
                Utiles.Log("Error: " + ex.Message, ConsoleColor.Red);
                Pausa(silencioso);
                return 1;
            }
        }

        static void Ayuda()
        {
            Console.WriteLine();
            Console.WriteLine("  Agente de Atalaya " + Version);
            Console.WriteLine("  Envía a Atalaya las sesiones, la CPU, la memoria y los discos de este servidor.");
            Console.WriteLine();
            Console.WriteLine("  AtalayaAgente.exe instalar [/silencioso]    Lo instala como servicio (usa agente.json de esta carpeta).");
            Console.WriteLine("  AtalayaAgente.exe desinstalar               Lo quita de este servidor.");
            Console.WriteLine("  AtalayaAgente.exe probar                    Comprueba que puede leer los datos y hablar con Atalaya.");
            Console.WriteLine();
        }

        static void Pausa(bool silencioso)
        {
            if (silencioso || ComoServicio || Console.IsInputRedirected) return;
            Console.WriteLine();
            Console.Write("  Pulsa una tecla para cerrar...");
            try { Console.ReadKey(true); } catch { }
        }

        // ------------------------------------------------------------ configuración
        static void CargarConfig(string carpeta)
        {
            string f = Path.Combine(carpeta, "agente.json");
            if (!File.Exists(f)) throw new Exception("No se encuentra agente.json en " + carpeta + ". Descarga el agente de este cliente desde Atalaya (menú con tu nombre > Clientes y agentes).");
            var o = Json.LeerObjeto(File.ReadAllText(f, Encoding.UTF8).TrimStart('﻿'));
            servidor = Json.Txt(o, "servidor").Trim().TrimEnd('/');
            clave = Json.Txt(o, "clave").Trim();
            proxy = Json.Txt(o, "proxy").Trim();   // opcional: "http://proxy.cliente.local:8080" si el servidor solo sale a Internet por un proxy
            if (!servidor.StartsWith("http://") && !servidor.StartsWith("https://")) throw new Exception("En agente.json, \"servidor\" debe ser la dirección de Atalaya, por ejemplo https://atalaya.miempresa.com");
            if (clave.Length < 16) throw new Exception("En agente.json falta la clave de los agentes.");
        }

        // ------------------------------------------------------------ recogida y envío
        static string NombreEquipo()
        {
            return Environment.MachineName;
        }

        static Dictionary<string, object> Recolectar(string porQue)
        {
            var o = new Dictionary<string, object>
            {
                { "nombre", NombreEquipo() }, { "version", Version }, { "intervalo", intervalo }, { "evento", porQue }, { "hora", Utiles.Ms(DateTime.UtcNow) }
            };
            try
            {
                var ses = Limite.Ejecutar(() => Wts.Listar("localhost", control.Equipos), 20, "Lectura de sesiones", control.Wts);
                o["sesiones"] = ses.Select(s => (object)new Dictionary<string, object> {
                    { "usuario", s.Usuario }, { "dominio", s.Dominio }, { "id", s.Id }, { "estado", s.Estado }, { "estadoTexto", s.EstadoTexto },
                    { "equipo", s.Equipo }, { "inicio", s.Inicio.HasValue ? (object)Utiles.Ms(s.Inicio.Value) : null }, { "inactivo", s.InactivoMin } }).ToList();
            }
            catch (Exception ex) { o["errorSesiones"] = ex.Message; o["sesiones"] = new List<object>(); }
            try
            {
                var m = LectorMetricas.Leer("localhost", control);
                o["cpu"] = m.Cpu; o["ramPct"] = m.RamPct; o["ramTotal"] = m.RamTotalGB; o["ramUsada"] = m.RamUsadaGB; o["so"] = m.So;
                o["arranque"] = m.Arranque.HasValue ? (object)Utiles.Ms(m.Arranque.Value) : null;
                o["discos"] = m.Discos.Select(d => (object)new Dictionary<string, object> {
                    { "unidad", d.Unidad }, { "etiqueta", d.Etiqueta }, { "total", d.TotalGB }, { "libre", d.LibreGB }, { "pct", d.Pct } }).ToList();
            }
            catch (Exception ex) { o["errorMetricas"] = ex.Message; }
            return o;
        }

        static bool Enviar(string json, out string error)
        {
            error = null;
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(servidor + "/api/agente/informe");
                req.Method = "POST";
                req.ContentType = "application/json; charset=utf-8";
                req.Headers["X-Atalaya-Agente"] = clave;
                req.Timeout = 10000;
                req.ReadWriteTimeout = 10000;
                req.KeepAlive = false;
                req.Proxy = string.IsNullOrEmpty(proxy) ? null : new WebProxy(proxy, true);
                var bytes = Encoding.UTF8.GetBytes(json);
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    var o = Json.LeerObjeto(r.ReadToEnd());
                    int i = Json.Num(o, "intervalo", intervalo);
                    if (i >= 5 && i <= 600) intervalo = i;
                }
                return true;
            }
            catch (WebException ex)
            {
                var res = ex.Response as HttpWebResponse;
                if (res != null)
                {
                    string cuerpo = "";
                    try { using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) cuerpo = Json.Txt(Json.LeerObjeto(r.ReadToEnd()), "error"); } catch { }
                    error = "Atalaya respondió " + (int)res.StatusCode + (cuerpo.Length > 0 ? ": " + cuerpo : "");
                    if ((int)res.StatusCode == 403) error += " Revisa la clave en agente.json.";
                }
                else error = "No se pudo conectar con " + servidor + ": " + ex.Message;
                return false;
            }
            catch (Exception ex) { error = ex.Message; return false; }
        }

        static void Ciclo(string porQue)
        {
            string json = Json.Escribir(Recolectar(porQue));
            lock (pendientes)
            {
                pendientes.Enqueue(json);
                while (pendientes.Count > 240) pendientes.Dequeue();   // como mucho una hora guardada si Atalaya no está disponible
                while (pendientes.Count > 0)
                {
                    string error;
                    if (Enviar(pendientes.Peek(), out error))
                    {
                        pendientes.Dequeue();
                        if (!conectado) { conectado = true; Utiles.Log("Conectado de nuevo con Atalaya (" + servidor + ").", ConsoleColor.Green); }
                    }
                    else
                    {
                        if (conectado) { conectado = false; Utiles.Log(error + " Se reintentará; los datos se guardan mientras tanto.", ConsoleColor.Yellow); }
                        break;
                    }
                }
            }
        }

        public static void Despertar(string porQue)
        {
            motivo = porQue;
            // Windows tarda un instante en tener lista la información de una sesión nueva
            ThreadPool.QueueUserWorkItem(_ => { Thread.Sleep(1500); despertar.Set(); });
        }

        public static void Bucle()
        {
            CargarConfig(CarpetaExe);
            Utiles.Log("Agente " + Version + " iniciado. Enviando a " + servidor + " cada " + intervalo + " s.");
            while (!detener)
            {
                string m = motivo;
                motivo = "periodico";
                try { Ciclo(m); }
                catch (Exception ex) { Utiles.Log("Error al recoger los datos: " + ex.Message, ConsoleColor.Red); }
                despertar.WaitOne(TimeSpan.FromSeconds(intervalo));
            }
        }

        public static void Parar() { detener = true; despertar.Set(); }

        // ------------------------------------------------------------ probar
        static int Probar()
        {
            string carpeta = File.Exists(Path.Combine(CarpetaExe, "agente.json")) ? CarpetaExe : CarpetaInstalacion;
            CargarConfig(carpeta);
            Console.WriteLine();
            Console.WriteLine("  Leyendo los datos de este servidor...");
            var o = Recolectar("prueba");
            int ses = ((List<object>)o["sesiones"]).Count;
            Console.WriteLine("    Sesiones: " + (o.ContainsKey("errorSesiones") ? "error: " + o["errorSesiones"] : ses.ToString()));
            Console.WriteLine("    CPU y memoria: " + (o.ContainsKey("errorMetricas") ? "error: " + o["errorMetricas"] : o["cpu"] + " %, " + o["ramPct"] + " %"));
            Console.WriteLine("  Enviando a " + servidor + "...");
            string error;
            bool ok = Enviar(Json.Escribir(o), out error);
            Console.ForegroundColor = ok ? ConsoleColor.Green : ConsoleColor.Red;
            Console.WriteLine("  " + (ok ? "Correcto: Atalaya recibió los datos." : error));
            Console.ResetColor();
            Pausa(false);
            return ok ? 0 : 1;
        }

        // ------------------------------------------------------------ instalar / desinstalar
        static bool EsAdmin()
        {
            try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); } catch { return false; }
        }

        static bool Elevar(string args)
        {
            if (EsAdmin()) return false;
            Console.WriteLine("  Hacen falta permisos de administrador. Windows te pedirá confirmación.");
            try { Process.Start(new ProcessStartInfo(Exe, args) { UseShellExecute = true, Verb = "runas", WorkingDirectory = CarpetaExe }); }
            catch { Console.WriteLine("  No se concedieron los permisos."); }
            return true;
        }

        static int Ejecutar(string exe, string args)
        {
            try
            {
                var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true });
                p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd();
                p.WaitForExit(30000);
                return p.ExitCode;
            }
            catch { return -1; }
        }

        static bool ServicioExiste()
        {
            try { return ServiceController.GetServices().Any(s => s.ServiceName.Equals(NombreServicio, StringComparison.OrdinalIgnoreCase)); } catch { return false; }
        }

        static void QuitarServicio()
        {
            if (!ServicioExiste()) return;
            try
            {
                using (var sc = new ServiceController(NombreServicio))
                    if (sc.Status != ServiceControllerStatus.Stopped) { sc.Stop(); sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20)); }
            }
            catch { }
            Ejecutar("sc.exe", "delete " + NombreServicio);
            Thread.Sleep(1500);
        }

        static int Instalar(bool silencioso)
        {
            if (Elevar("instalar" + (silencioso ? " /silencioso" : ""))) return 0;
            Console.WriteLine();
            Console.WriteLine("  Instalando el agente de Atalaya " + Version);
            CargarConfig(CarpetaExe);

            Console.WriteLine("  > Comprobando la conexión con " + servidor);
            string error;
            if (!Enviar(Json.Escribir(Recolectar("prueba")), out error))
            {
                Utiles.Log("No se pudo enviar la prueba: " + error, ConsoleColor.Yellow);
                if (!silencioso)
                {
                    Console.Write("  ¿Instalar de todas formas? El agente seguirá intentándolo. (s/N): ");
                    if (!(Console.ReadLine() ?? "").Trim().ToLowerInvariant().StartsWith("s")) return 1;
                }
            }

            Console.WriteLine("  > Copiando a " + CarpetaInstalacion);
            QuitarServicio();
            Directory.CreateDirectory(CarpetaInstalacion);
            string destino = Path.Combine(CarpetaInstalacion, "AtalayaAgente.exe");
            if (!Exe.Equals(destino, StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(Exe, destino, true);
                File.Copy(Path.Combine(CarpetaExe, "agente.json"), Path.Combine(CarpetaInstalacion, "agente.json"), true);
            }

            Console.WriteLine("  > Creando el servicio");
            int r = Ejecutar("sc.exe", "create " + NombreServicio + " binPath= \"\\\"" + destino + "\\\" servicio\" start= auto DisplayName= \"Atalaya Agente\"");
            if (r != 0) throw new Exception("No se pudo crear el servicio (código " + r + ").");
            Ejecutar("sc.exe", "description " + NombreServicio + " \"Envía a Atalaya las sesiones, la CPU, la memoria y los discos de este servidor.\"");
            Ejecutar("sc.exe", "failure " + NombreServicio + " reset= 86400 actions= restart/30000/restart/60000/restart/300000");
            using (var sc = new ServiceController(NombreServicio))
            {
                sc.Start();
                sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
            }
            Utiles.Log("Agente instalado y en marcha. Envía los datos a " + servidor + ".", ConsoleColor.Green);
            Console.WriteLine("  En unos segundos este servidor aparecerá en Atalaya con sus datos.");
            Console.WriteLine("  Registro: " + Path.Combine(Utiles.CarpetaDatos, "agente.log"));
            Pausa(silencioso);
            return 0;
        }

        static int Desinstalar(bool silencioso)
        {
            if (Elevar("desinstalar" + (silencioso ? " /silencioso" : ""))) return 0;
            Console.WriteLine();
            Console.WriteLine("  > Quitando el servicio del agente");
            QuitarServicio();
            // la carpeta se borra cuando este programa termine
            if (Directory.Exists(CarpetaInstalacion))
            {
                try
                {
                    Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + CarpetaInstalacion + "\"")
                    { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
                }
                catch { }
            }
            Utiles.Log("Agente desinstalado.", ConsoleColor.Green);
            Console.WriteLine("  Si quieres quitarlo también de la lista, hazlo en Atalaya (página del servidor > Editar).");
            Pausa(silencioso);
            return 0;
        }
    }

    public class ServicioAgente : ServiceBase
    {
        Thread hilo;

        public ServicioAgente()
        {
            ServiceName = "AtalayaAgente";
            CanStop = true;
            CanShutdown = true;
            CanHandleSessionChangeEvent = true;
        }

        protected override void OnStart(string[] args)
        {
            hilo = new Thread(() =>
            {
                try { Agente.Bucle(); }
                catch (Exception ex) { Utiles.Log("No se pudo iniciar el agente: " + ex.Message, ConsoleColor.Red); Stop(); }
            }) { IsBackground = true, Name = "AtalayaAgente" };
            hilo.Start();
        }

        // Inicio, cierre, desconexión o reconexión de una sesión: se avisa a Atalaya al momento
        protected override void OnSessionChange(SessionChangeDescription cambio)
        {
            Agente.Despertar("sesion");
        }

        protected override void OnStop() { Agente.Parar(); }
        protected override void OnShutdown() { Agente.Parar(); }
    }
}
