using System;
using Microsoft.Win32;
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

[assembly: AssemblyTitle("NodeCat Agente")]
[assembly: AssemblyDescription("Agente de NodeCat: envía las sesiones, la CPU, la memoria y los discos de este servidor a NodeCat.")]
[assembly: AssemblyProduct("NodeCat")]
[assembly: AssemblyVersion("1.4.0.0")]
[assembly: AssemblyFileVersion("1.4.0.0")]

namespace NodeCat
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
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NodeCat Agente");
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
        public const string Version = "1.5.2";
        const string NombreServicio = "NodeCatAgente";
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
        static string CarpetaInstalacion { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NodeCat Agente"); } }

        static int Main(string[] args)
        {
            try { Console.OutputEncoding = new UTF8Encoding(false); } catch { }
            // NodeCat suele estar detrás de HTTPS (Cloudflare Tunnel, proxy inverso): .NET 4.5 no activa TLS 1.2 por defecto
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
                    case "sonda": return SoloSonda();
                    case "":
                    case "silencioso":
                        // Instalador descargado de NodeCat (lleva la configuración dentro): doble clic = instalar
                        if (ConfigIncluida() != null) return Instalar(silencioso);
                        Ayuda(); Pausa(silencioso); return 0;
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
            Console.WriteLine("  Agente de NodeCat " + Version);
            Console.WriteLine("  Envía a NodeCat las sesiones, la CPU, la memoria y los discos de este servidor.");
            Console.WriteLine();
            Console.WriteLine("  NodeCatAgente.exe instalar [/silencioso]    Lo instala como servicio (usa agente.json de esta carpeta).");
            Console.WriteLine("  NodeCatAgente.exe desinstalar               Lo quita de este servidor.");
            Console.WriteLine("  NodeCatAgente.exe probar                    Comprueba que puede leer los datos y hablar con NodeCat.");
            Console.WriteLine("  NodeCatAgente.exe sonda                     Ejecuta la sonda en primer plano para ver qué lee (para el servicio antes).");
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
        static string instalacion = "";

        // El instalador que genera NodeCat lleva agente.json pegado al final del .exe:
        // [json UTF-8][longitud int32][NODECAT1]
        static string ConfigIncluida()
        {
            try
            {
                using (var f = new FileStream(Exe, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (f.Length < 12) return null;
                    var cola = new byte[12];
                    f.Seek(-12, SeekOrigin.End); f.Read(cola, 0, 12);
                    if (Encoding.ASCII.GetString(cola, 4, 8) != "NODECAT1") return null;
                    int n = BitConverter.ToInt32(cola, 0);
                    if (n <= 0 || n > 64 * 1024 || n > f.Length - 12) return null;
                    var b = new byte[n];
                    f.Seek(-12 - n, SeekOrigin.End); f.Read(b, 0, n);
                    return Encoding.UTF8.GetString(b);
                }
            }
            catch { return null; }
        }

        static void CargarConfig(string carpeta)
        {
            string f = Path.Combine(carpeta, "agente.json");
            string texto = File.Exists(f) ? File.ReadAllText(f, Encoding.UTF8) : ConfigIncluida();
            if (texto == null) throw new Exception("No se encuentra agente.json en " + carpeta + ". Descarga el instalador de este cliente desde NodeCat (menú con tu nombre > Clientes y agentes).");
            var o = Json.LeerObjeto(texto.TrimStart('\uFEFF'));
            servidor = Json.Txt(o, "servidor").Trim().TrimEnd('/');
            clave = Json.Txt(o, "clave").Trim();
            proxy = Json.Txt(o, "proxy").Trim();   // opcional: "http://proxy.cliente.local:8080" si el servidor solo sale a Internet por un proxy
            instalacion = Json.Txt(o, "instalacion").Trim();
            if (!servidor.StartsWith("http://") && !servidor.StartsWith("https://")) throw new Exception("En agente.json, \"servidor\" debe ser la dirección de NodeCat, por ejemplo https://nodecat.miempresa.com");
            if (clave.Length < 16) throw new Exception("En agente.json falta la clave de los agentes.");
            Sonda.Servidor = servidor; Sonda.Clave = clave; Sonda.Proxy = proxy;
        }

        static void GuardarConfig(string carpeta)
        {
            var o = new Dictionary<string, object> { { "servidor", servidor }, { "clave", clave } };
            if (!string.IsNullOrEmpty(proxy)) o["proxy"] = proxy;
            if (!string.IsNullOrEmpty(instalacion)) o["instalacion"] = instalacion;
            File.WriteAllText(Path.Combine(carpeta, "agente.json"), Json.Escribir(o), Utiles.Utf8);
        }

        // ------------------------------------------------------------ recogida y envío
        static string NombreEquipo()
        {
            return Environment.MachineName;
        }

        // IPv4 de la red local (tarjetas conectadas, sin loopback, APIPA ni adaptadores de VPN)
        static List<object> IpsLocales()
        {
            var l = new List<object>();
            try
            {
                foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;
                    string d = (ni.Description + " " + ni.Name).ToLowerInvariant();
                    if (d.Contains("tailscale") || d.Contains("wireguard") || d.Contains("zerotier") || d.Contains("openvpn") || d.Contains("tap-windows") || d.Contains("fortinet") || d.Contains("vpn")) continue;
                    foreach (var u in ni.GetIPProperties().UnicastAddresses)
                    {
                        if (u.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                        string ip = u.Address.ToString();
                        if (ip.StartsWith("169.254.") || ip.StartsWith("127.") || l.Contains(ip)) continue;
                        l.Add(ip);
                    }
                }
            }
            catch { }
            return l.Take(6).ToList();
        }

        static Dictionary<string, object> Recolectar(string porQue)
        {
            var o = new Dictionary<string, object>
            {
                { "nombre", NombreEquipo() }, { "version", Version }, { "intervalo", intervalo }, { "evento", porQue }, { "hora", Utiles.Ms(DateTime.UtcNow) }, { "instalacion", instalacion }
            };
            try
            {
                var ses = Limite.Ejecutar(() => Wts.Listar("localhost", control.Equipos), 20, "Lectura de sesiones", control.Wts);
                Dictionary<int, ProcesosSesion.Uso> uso = null;
                try { uso = ProcesosSesion.Medir(); } catch { }
                o["sesiones"] = ses.Select(s => {
                    var d = new Dictionary<string, object> {
                        { "usuario", s.Usuario }, { "dominio", s.Dominio }, { "id", s.Id }, { "estado", s.Estado }, { "estadoTexto", s.EstadoTexto },
                        { "equipo", s.Equipo }, { "inicio", s.Inicio.HasValue ? (object)Utiles.Ms(s.Inicio.Value) : null }, { "inactivo", s.InactivoMin } };
                    ProcesosSesion.Uso u;
                    if (uso != null && uso.TryGetValue(s.Id, out u)) { d["cpu"] = u.Cpu; d["ram"] = u.Ram; d["procesos"] = u.Procesos; d["top"] = u.Top; }
                    return (object)d; }).ToList();
            }
            catch (Exception ex) { o["errorSesiones"] = ex.Message; o["sesiones"] = new List<object>(); }
            try
            {
                var m = LectorMetricas.Leer("localhost", control);
                o["cpu"] = m.Cpu; o["ramPct"] = m.RamPct; o["ramTotal"] = m.RamTotalGB; o["ramUsada"] = m.RamUsadaGB; o["so"] = m.So;
                o["ipsLocales"] = IpsLocales();
                o["arranque"] = m.Arranque.HasValue ? (object)Utiles.Ms(m.Arranque.Value) : null;
                o["discos"] = m.Discos.Select(d => (object)new Dictionary<string, object> {
                    { "unidad", d.Unidad }, { "etiqueta", d.Etiqueta }, { "total", d.TotalGB }, { "libre", d.LibreGB }, { "pct", d.Pct } }).ToList();
            }
            catch (Exception ex) { o["errorMetricas"] = ex.Message; }
            // Hyper-V: sus máquinas virtuales
            if (HyperV.Disponible())
            {
                o["hipervisor"] = "hyperv";
                try { o["vms"] = Limite.Ejecutar(() => HyperV.Listar(), 70, "Lectura de Hyper-V", control.HyperV); }
                catch (Exception ex) { o["errorVms"] = ex.Message; }
                try { var r = HyperV.Red(); if (r != null) o["hvRed"] = r; } catch { }
            }
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
                req.Headers["X-NodeCat-Agente"] = clave;
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
                    // NodeCat pide que este servidor lea equipos de red de su red (sonda)
                    if (ComoServicio || modoSonda) Sonda.Ajustar(Json.Txt(o, "sonda") == "True" || Json.Txt(o, "sonda") == "true");
                    // El servidor se movió a otro cliente en NodeCat: desde ahora usa la clave del cliente nuevo
                    string nueva = Json.Txt(o, "clave").Trim();
                    if (ComoServicio && nueva.Length >= 16 && nueva != clave)
                    {
                        clave = nueva; Sonda.Clave = nueva;
                        try { GuardarConfig(CarpetaExe); } catch (Exception ex) { Utiles.Log("No se pudo guardar la clave nueva: " + ex.Message, ConsoleColor.Yellow); }
                        Utiles.Log("Este servidor ahora pertenece a " + Json.Txt(o, "cliente") + " en NodeCat.", ConsoleColor.Green);
                    }
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
                    error = "NodeCat respondió " + (int)res.StatusCode + (cuerpo.Length > 0 ? ": " + cuerpo : "");
                    if ((int)res.StatusCode == 403) error += " Revisa la clave en agente.json.";
                    // Quitado de NodeCat: el agente se desinstala solo para no quedar funcionando en segundo plano
                    if ((int)res.StatusCode == 410 && ComoServicio) AutoDesinstalar();
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
                while (pendientes.Count > 240) pendientes.Dequeue();   // como mucho una hora guardada si NodeCat no está disponible
                while (pendientes.Count > 0)
                {
                    string error;
                    if (Enviar(pendientes.Peek(), out error))
                    {
                        pendientes.Dequeue();
                        if (!conectado) { conectado = true; Utiles.Log("Conectado de nuevo con NodeCat (" + servidor + ").", ConsoleColor.Green); }
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

        public static void Parar() { detener = true; Sonda.Parar(); despertar.Set(); }

        // ------------------------------------------------------------ sonda en primer plano (diagnóstico)
        static bool modoSonda;
        static int SoloSonda()
        {
            string carpeta = File.Exists(Path.Combine(CarpetaExe, "agente.json")) ? CarpetaExe : CarpetaInstalacion;
            CargarConfig(carpeta);
            modoSonda = true;
            Console.WriteLine();
            Console.WriteLine("  Sonda de NodeCat en primer plano (Ctrl+C para salir). Si el servicio también está en marcha, para el servicio antes.");
            Sonda.Detallar = true;
            Sonda.Ajustar(true);
            while (true) { Thread.Sleep(20000); Sonda.Ajustar(true); }
        }

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
            Console.WriteLine("  " + (ok ? "Correcto: NodeCat recibió los datos." : error));
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

        const string ClaveDesinstalar = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\NodeCatAgente";
        // Nombres anteriores del agente (Atalaya): se limpian al instalar o desinstalar
        static readonly string[] ServiciosViejos = { "AtalayaAgente" };
        static string CarpetaVieja { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Atalaya Agente"); } }

        static bool ServicioExiste(string nombre)
        {
            try { return ServiceController.GetServices().Any(s => s.ServiceName.Equals(nombre, StringComparison.OrdinalIgnoreCase)); } catch { return false; }
        }

        /// Detiene y borra un servicio de verdad: si no se detiene a tiempo, mata su proceso; espera a que Windows lo borre del todo.
        static void QuitarServicio(string nombre, string proceso)
        {
            if (!ServicioExiste(nombre)) return;
            try
            {
                using (var sc = new ServiceController(nombre))
                    if (sc.Status != ServiceControllerStatus.Stopped)
                    {
                        try { sc.Stop(); } catch { }
                        try { sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(15)); } catch { }
                    }
            }
            catch { }
            MatarProcesos(proceso);
            Ejecutar("sc.exe", "delete " + nombre);
            // Hasta que Windows no lo borra, no se puede crear otro con el mismo nombre
            for (int i = 0; i < 30 && ServicioExiste(nombre); i++) { Thread.Sleep(500); if (i == 10) MatarProcesos(proceso); }
        }

        static void MatarProcesos(string nombre)
        {
            int yo = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcessesByName(nombre))
            {
                try { if (p.Id != yo) { p.Kill(); p.WaitForExit(5000); } } catch { }
            }
        }

        static void QuitarTodosLosServicios()
        {
            QuitarServicio(NombreServicio, "NodeCatAgente");
            foreach (var v in ServiciosViejos) QuitarServicio(v, "AtalayaAgente");
        }

        static void RegistrarEnPanelDeControl(string exe)
        {
            using (var k = Registry.LocalMachine.CreateSubKey(ClaveDesinstalar))
            {
                k.SetValue("DisplayName", "NodeCat Agente");
                k.SetValue("DisplayVersion", Version);
                k.SetValue("Publisher", "NodeCat");
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("InstallLocation", CarpetaInstalacion);
                k.SetValue("UninstallString", "\"" + exe + "\" desinstalar");
                k.SetValue("QuietUninstallString", "\"" + exe + "\" desinstalar /silencioso");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", 200, RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("Comments", "Envía a NodeCat las sesiones, la CPU, la memoria y los discos de este servidor.");
            }
        }

        static string Explicar(int codigo)
        {
            switch (codigo)
            {
                case 1072: return "Windows todavía está borrando el servicio anterior. Cierra la consola de Servicios (services.msc) y el Administrador de tareas si están abiertos, y vuelve a ejecutar el instalador.";
                case 1073: return "Ya existe un servicio con ese nombre y no se pudo quitar. Reinicia el servidor y vuelve a ejecutar el instalador.";
                case 5: return "Acceso denegado. Ejecuta el instalador como administrador.";
                default: return "Código " + codigo + ".";
            }
        }

        static int Instalar(bool silencioso)
        {
            if (Elevar("instalar" + (silencioso ? " /silencioso" : ""))) return 0;
            Console.WriteLine();
            Console.WriteLine("  Instalando el agente de NodeCat " + Version);
            CargarConfig(CarpetaExe);
            instalacion = Guid.NewGuid().ToString("N");   // identifica esta instalación (si antes se quitó de NodeCat, vuelve a aparecer)

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

            Console.WriteLine("  > Quitando la versión anterior, si la hay");
            QuitarTodosLosServicios();
            try { if (Directory.Exists(CarpetaVieja)) Directory.Delete(CarpetaVieja, true); } catch { }

            Console.WriteLine("  > Copiando a " + CarpetaInstalacion);
            Directory.CreateDirectory(CarpetaInstalacion);
            string destino = Path.Combine(CarpetaInstalacion, "NodeCatAgente.exe");
            if (!Exe.Equals(destino, StringComparison.OrdinalIgnoreCase)) File.Copy(Exe, destino, true);
            GuardarConfig(CarpetaInstalacion);

            Console.WriteLine("  > Creando el servicio");
            int r = Ejecutar("sc.exe", "create " + NombreServicio + " binPath= \"\\\"" + destino + "\\\" servicio\" start= auto DisplayName= \"NodeCat Agente\"");
            if (r == 1072 || r == 1073) { QuitarServicio(NombreServicio, "NodeCatAgente"); Thread.Sleep(2000); r = Ejecutar("sc.exe", "create " + NombreServicio + " binPath= \"\\\"" + destino + "\\\" servicio\" start= auto DisplayName= \"NodeCat Agente\""); }
            if (r != 0) throw new Exception("No se pudo crear el servicio. " + Explicar(r));
            Ejecutar("sc.exe", "description " + NombreServicio + " \"Envía a NodeCat las sesiones, la CPU, la memoria y los discos de este servidor.\"");
            Ejecutar("sc.exe", "failure " + NombreServicio + " reset= 86400 actions= restart/30000/restart/60000/restart/300000");
            try { RegistrarEnPanelDeControl(destino); } catch (Exception ex) { Utiles.Log("No se pudo registrar en Programas y características: " + ex.Message, ConsoleColor.Yellow); }
            using (var sc = new ServiceController(NombreServicio))
            {
                sc.Start();
                sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
            }
            Utiles.Log("Agente instalado y en marcha. Envía los datos a " + servidor + ".", ConsoleColor.Green);
            Console.WriteLine("  En unos segundos este servidor aparecerá en NodeCat con sus datos.");
            Console.WriteLine("  Para quitarlo: Panel de control > Programas > NodeCat Agente > Desinstalar.");
            Pausa(silencioso);
            return 0;
        }

        static int Desinstalar(bool silencioso)
        {
            if (Elevar("desinstalar" + (silencioso ? " /silencioso" : ""))) return 0;
            Console.WriteLine();
            // Se avisa a NodeCat para que no lo dé por caído
            try
            {
                CargarConfig(File.Exists(Path.Combine(CarpetaInstalacion, "agente.json")) ? CarpetaInstalacion : CarpetaExe);
                Console.WriteLine("  > Avisando a NodeCat");
                string error;
                Enviar(Json.Escribir(new Dictionary<string, object> { { "nombre", NombreEquipo() }, { "version", Version }, { "evento", "desinstalado" }, { "instalacion", instalacion }, { "hora", Utiles.Ms(DateTime.UtcNow) } }), out error);
            }
            catch { }
            Console.WriteLine("  > Deteniendo y quitando el servicio");
            QuitarTodosLosServicios();
            try { Registry.LocalMachine.DeleteSubKeyTree(ClaveDesinstalar, false); } catch { }
            Console.WriteLine("  > Borrando los archivos");
            BorrarArchivos(false);
            Utiles.Log("Agente desinstalado: no queda ningún servicio ni proceso.", ConsoleColor.Green);
            Pausa(silencioso);
            return 0;
        }

        // Las carpetas se borran cuando este programa termina (no se puede borrar el .exe en uso)
        static void BorrarArchivos(bool despuesDeParar)
        {
            string datos = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NodeCat Agente");
            string cmd = "/c ping 127.0.0.1 -n 4 >nul"
                + (despuesDeParar ? " & sc stop " + NombreServicio + " & ping 127.0.0.1 -n 8 >nul & taskkill /f /im NodeCatAgente.exe & sc delete " + NombreServicio + " & reg delete \"HKLM\\" + ClaveDesinstalar + "\" /f" : "")
                + " & rmdir /s /q \"" + CarpetaInstalacion + "\" & rmdir /s /q \"" + datos + "\" & rmdir /s /q \"" + CarpetaVieja + "\"";
            try { Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden }); } catch { }
        }

        static bool autoDesinstalando;
        /// NodeCat respondió que este servidor se quitó del panel: el servicio se quita a sí mismo.
        static void AutoDesinstalar()
        {
            if (autoDesinstalando) return;
            autoDesinstalando = true;
            Utiles.Log("Este servidor se quitó de NodeCat. El agente se desinstala solo.", ConsoleColor.Yellow);
            Sonda.Parar();
            BorrarArchivos(true);
            detener = true; despertar.Set();
        }
    }

    public class ServicioAgente : ServiceBase
    {
        Thread hilo;

        public ServicioAgente()
        {
            ServiceName = "NodeCatAgente";
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
            }) { IsBackground = true, Name = "NodeCatAgente" };
            hilo.Start();
        }

        // Inicio, cierre, desconexión o reconexión de una sesión: se avisa a NodeCat al momento
        protected override void OnSessionChange(SessionChangeDescription cambio)
        {
            Agente.Despertar("sesion");
        }

        protected override void OnStop() { Agente.Parar(); }
        protected override void OnShutdown() { Agente.Parar(); }
    }
}
