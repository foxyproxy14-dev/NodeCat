using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace NodeCat
{
    // Sonda: NodeCat pide a este agente que lea los MikroTik y FortiGate de su red local.
    // El agente mantiene una petición abierta hacia NodeCat, recibe órdenes de solo lectura y devuelve el resultado.
    // NodeCat no necesita llegar a la red del cliente: todo sale del agente hacia NodeCat.
    public static class Sonda
    {
        static volatile bool activa;
        static Thread hilo;
        static readonly object bloqueo = new object();
        static DateTime ultimaVezActiva = DateTime.MinValue;
        static bool avisado;
        public static string Servidor, Clave, Proxy;
        public static Func<string> Nombre = () => Environment.MachineName;

        /// El informe de NodeCat dice si este agente tiene que hacer de sonda.
        public static void Ajustar(bool usar)
        {
            if (usar) ultimaVezActiva = DateTime.UtcNow;
            lock (bloqueo)
            {
                if (usar && (hilo == null || !hilo.IsAlive))
                {
                    activa = true;
                    hilo = new Thread(Bucle) { IsBackground = true, Name = "NodeCatSonda" };
                    hilo.Start();
                    Utiles.Log("Este servidor hace de sonda: lee equipos de red de su red para NodeCat.");
                }
            }
        }

        public static void Parar() { activa = false; }

        public static void Bucle()
        {
            var resultados = new List<object>();
            int fallos = 0;
            while (activa)
            {
                // Si NodeCat deja de pedirlo durante 3 minutos, la sonda se detiene
                if ((DateTime.UtcNow - ultimaVezActiva).TotalMinutes > 3) { Utiles.Log("La sonda se detiene: NodeCat ya no la necesita."); break; }
                try
                {
                    var ordenes = Pedir(resultados);
                    resultados = new List<object>();
                    fallos = 0;
                    if (avisado) { avisado = false; Utiles.Log("Sonda conectada de nuevo con NodeCat.", ConsoleColor.Green); }
                    if (ordenes.Count > 0) { ultimaVezActiva = DateTime.UtcNow; resultados = Ejecutar(ordenes); }
                }
                catch (Exception ex)
                {
                    fallos++;
                    if (!avisado) { avisado = true; Utiles.Log("Sonda: no se pudo hablar con NodeCat (" + ex.Message + "). Se reintentará.", ConsoleColor.Yellow); }
                    resultados = new List<object>();
                    Thread.Sleep(Math.Min(30000, 2000 * fallos));
                }
                Conexiones.CerrarInactivas();
            }
            Conexiones.CerrarTodas();
            lock (bloqueo) hilo = null;
        }

        static List<object> Pedir(List<object> resultados)
        {
            var req = (HttpWebRequest)WebRequest.Create(Servidor + "/api/agente/sonda");
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.Headers["X-NodeCat-Agente"] = Clave;
            req.Timeout = 45000;
            req.ReadWriteTimeout = 45000;
            req.Proxy = string.IsNullOrEmpty(Proxy) ? null : new WebProxy(Proxy, true);
            var bytes = Encoding.UTF8.GetBytes(Json.Escribir(new Dictionary<string, object> { { "nombre", Nombre() }, { "resultados", resultados } }));
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            try
            {
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    return Json.Lista(Json.LeerObjeto(r.ReadToEnd()), "ordenes");
            }
            catch (WebException ex)
            {
                var res = ex.Response as HttpWebResponse;
                if (res == null) throw;
                string cuerpo = "";
                try { using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) cuerpo = Json.Txt(Json.LeerObjeto(r.ReadToEnd()), "error"); } catch { }
                throw new Exception("NodeCat respondió " + (int)res.StatusCode + (cuerpo.Length > 0 ? ": " + cuerpo : ""));
            }
        }

        // Las órdenes de equipos distintos van en paralelo; las del mismo equipo, en orden (cada conexión tiene su candado)
        static List<object> Ejecutar(List<object> ordenes)
        {
            var salida = new object[ordenes.Count];
            var hechos = new CountdownEvent(ordenes.Count);
            for (int i = 0; i < ordenes.Count; i++)
            {
                int k = i;
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    var reloj = System.Diagnostics.Stopwatch.StartNew();
                    try { salida[k] = Una(ordenes[k] as Dictionary<string, object>); }
                    catch (Exception ex) { salida[k] = new Dictionary<string, object> { { "error", ex.Message }, { "tipo", "red" }, { "codigo", "otro" } }; }
                    finally { Diagnostico(ordenes[k] as Dictionary<string, object>, salida[k] as Dictionary<string, object>, reloj.ElapsedMilliseconds); hechos.Signal(); }
                });
            }
            hechos.Wait(TimeSpan.FromSeconds(70));
            var l = new List<object>();
            for (int i = 0; i < ordenes.Count; i++)
            {
                var o = ordenes[i] as Dictionary<string, object>;
                var r = (salida[i] as Dictionary<string, object>) ?? new Dictionary<string, object> { { "error", "La orden no terminó a tiempo." }, { "tipo", "red" }, { "codigo", "tiempo" } };
                r["id"] = o != null && o.ContainsKey("id") ? o["id"] : null;
                l.Add(r);
            }
            return l;
        }

        // En el diagnóstico (NodeCatAgente.exe sonda) se muestra cada orden y su resultado
        public static bool Detallar;
        static void Diagnostico(Dictionary<string, object> o, Dictionary<string, object> r, long ms)
        {
            if (!Detallar || o == null) return;
            try
            {
                var con = o.ContainsKey("con") ? o["con"] as Dictionary<string, object> : null;
                string destino = con == null ? "?" : Json.Txt(con, "host") + ":" + Json.Txt(con, "puerto");
                string que = Json.Txt(o, "tipo") == "https" ? Json.Txt(o, "camino").Split('?')[0] : "API RouterOS";
                string res = r == null ? "sin resultado" : r.ContainsKey("error") ? "ERROR: " + Json.Txt(r, "error") : r.ContainsKey("estado") ? "HTTP " + Json.Txt(r, "estado") : "OK";
                Utiles.Log("Sonda " + destino + " " + que + " -> " + res + " (" + ms + " ms)", r != null && r.ContainsKey("error") ? ConsoleColor.Yellow : ConsoleColor.Gray);
            }
            catch { }
        }

        static Dictionary<string, object> Una(Dictionary<string, object> o)
        {
            if (o == null) throw new Exception("Orden vacía.");
            string tipo = Json.Txt(o, "tipo");
            int tiempo = Math.Max(2000, Math.Min(60000, Json.Num(o, "tiempo", 10000)));
            var con = o.ContainsKey("con") ? o["con"] as Dictionary<string, object> : null;
            if (con == null) throw new Exception("Orden sin equipo.");
            if (tipo == "ros") return RouterOS(con, Json.Lista(o, "palabras").Select(x => Convert.ToString(x, CultureInfo.InvariantCulture)).ToList(), tiempo);
            if (tipo == "https") return Https(con, Json.Txt(o, "camino"), tiempo);
            throw new Exception("Orden desconocida: " + tipo);
        }

        // ------------------------------------------------------------ RouterOS
        static Dictionary<string, object> RouterOS(Dictionary<string, object> con, List<string> palabras, int tiempo)
        {
            // Solo lectura: NodeCat solo envía consultas; aun así se rechaza cualquier comando que cambie algo
            if (palabras.Count == 0 || !EsLectura(palabras[0])) return Error("Comando no permitido para la sonda: " + (palabras.Count > 0 ? palabras[0] : ""), "trap", null);
            var c = Conexiones.Obtener(Json.Txt(con, "host"), Json.Num(con, "puerto", 8728), Json.Txt(con, "ssl") == "True" || Json.Txt(con, "ssl") == "true", Json.Txt(con, "usuario"), Json.Txt(con, "clave"));
            lock (c)
            {
                try
                {
                    c.Abrir(tiempo);
                    var r = c.Ejecutar(palabras, tiempo);
                    var filas = r.Filas.Select(f => (object)f.ToDictionary(x => x.Key, x => (object)x.Value)).ToList();
                    return new Dictionary<string, object> { { "filas", filas }, { "done", r.Done.ToDictionary(x => x.Key, x => (object)x.Value) } };
                }
                catch (ErrorTrap ex) { return Error(ex.Message, "trap", null); }
                catch (ErrorLogin ex) { c.Cerrar(); return Error(ex.Message, "login", null); }
                catch (Exception ex) { c.Cerrar(); return ErrorRed(ex); }
            }
        }

        static bool EsLectura(string cmd)
        {
            string ultimo = cmd.Substring(cmd.LastIndexOf('/') + 1);
            return ultimo == "print" || ultimo == "getall" || ultimo == "monitor" || cmd == "/ping" || cmd == "/tool/traceroute" || cmd == "/tool/ping"
                || cmd.EndsWith("/monitor-traffic") || cmd == "/system/resource/cpu/print";
        }

        // ------------------------------------------------------------ HTTPS (FortiOS)
        static Dictionary<string, object> Https(Dictionary<string, object> con, string camino, int tiempo)
        {
            if (!camino.StartsWith("/api/v2/")) return Error("Ruta no permitida para la sonda.", "red", "otro");
            string host = Json.Txt(con, "host");
            int puerto = Json.Num(con, "puerto", 443);
            bool verificar = Json.Txt(con, "verificar") == "True" || Json.Txt(con, "verificar") == "true";
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("https://" + (host.Contains(":") && !host.StartsWith("[") ? "[" + host + "]" : host) + ":" + puerto + camino);
                req.Method = "GET";   // solo lectura
                req.Accept = "application/json";
                req.Headers["Authorization"] = "Bearer " + Json.Txt(con, "token");
                req.Timeout = tiempo;
                req.ReadWriteTimeout = tiempo;
                req.Proxy = null;
                // Los FortiGate suelen tener certificado propio: solo se verifica si se pide
                if (!verificar) req.ServerCertificateValidationCallback = (a, b, c, d) => true;
                req.ConnectionGroupName = verificar ? "nodecat-verificado" : "nodecat-sin-verificar";   // conexiones separadas: una no hereda la validación de la otra
                HttpWebResponse res;
                try { res = (HttpWebResponse)req.GetResponse(); }
                catch (WebException ex) { res = ex.Response as HttpWebResponse; if (res == null) throw; }
                using (res)
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    return new Dictionary<string, object> { { "estado", (int)res.StatusCode }, { "cuerpo", r.ReadToEnd() } };
            }
            catch (Exception ex) { return ErrorRed(ex); }
        }

        // ------------------------------------------------------------ errores
        static Dictionary<string, object> Error(string mensaje, string tipo, string codigo)
        {
            var d = new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
            if (codigo != null) d["codigo"] = codigo;
            return d;
        }

        static Dictionary<string, object> ErrorRed(Exception ex)
        {
            string codigo = "otro";
            Exception e = ex;
            while (e != null)
            {
                var se = e as SocketException;
                if (se != null)
                {
                    if (se.SocketErrorCode == SocketError.ConnectionRefused) codigo = "rechazo";
                    else if (se.SocketErrorCode == SocketError.TimedOut) codigo = "tiempo";
                    else if (se.SocketErrorCode == SocketError.HostUnreachable || se.SocketErrorCode == SocketError.NetworkUnreachable) codigo = "ruta";
                    else if (se.SocketErrorCode == SocketError.HostNotFound || se.SocketErrorCode == SocketError.NoData) codigo = "nombre";
                    else if (se.SocketErrorCode == SocketError.ConnectionReset) codigo = "cerrada";
                    break;
                }
                var we = e as WebException;
                if (we != null)
                {
                    if (we.Status == WebExceptionStatus.Timeout) { codigo = "tiempo"; break; }
                    if (we.Status == WebExceptionStatus.NameResolutionFailure) { codigo = "nombre"; break; }
                    if (we.Status == WebExceptionStatus.TrustFailure || we.Status == WebExceptionStatus.SecureChannelFailure) { codigo = "cert"; break; }
                    if (we.Status == WebExceptionStatus.ConnectFailure && e.InnerException == null) { codigo = "rechazo"; break; }
                }
                if (e is TimeoutException) { codigo = "tiempo"; break; }
                if (e is IOException && e.InnerException == null) { codigo = "cerrada"; break; }
                e = e.InnerException;
            }
            return Error(ex.Message, "red", codigo);
        }
    }

    public class ErrorTrap : Exception { public ErrorTrap(string m) : base(m) { } }
    public class ErrorLogin : Exception { public ErrorLogin(string m) : base(m) { } }

    public class Respuesta
    {
        public List<Dictionary<string, string>> Filas = new List<Dictionary<string, string>>();
        public Dictionary<string, string> Done = new Dictionary<string, string>();
    }

    // Conexiones abiertas a los routers, reutilizadas entre órdenes
    public static class Conexiones
    {
        static readonly Dictionary<string, ConexionRos> abiertas = new Dictionary<string, ConexionRos>();

        public static ConexionRos Obtener(string host, int puerto, bool ssl, string usuario, string clave)
        {
            string k = host + "|" + puerto + "|" + ssl + "|" + usuario + "|" + Huella(clave);
            lock (abiertas)
            {
                ConexionRos c;
                if (!abiertas.TryGetValue(k, out c)) abiertas[k] = c = new ConexionRos(host, puerto, ssl, usuario, clave);
                c.Uso = DateTime.UtcNow;
                return c;
            }
        }

        static string Huella(string s)
        {
            using (var h = SHA256.Create()) return Convert.ToBase64String(h.ComputeHash(Encoding.UTF8.GetBytes(s ?? "")));
        }

        public static void CerrarInactivas()
        {
            lock (abiertas)
                foreach (var k in abiertas.Where(x => (DateTime.UtcNow - x.Value.Uso).TotalMinutes > 5).Select(x => x.Key).ToList())
                {
                    var c = abiertas[k];
                    if (Monitor.TryEnter(c)) { try { c.Cerrar(); abiertas.Remove(k); } finally { Monitor.Exit(c); } }
                }
        }

        public static void CerrarTodas()
        {
            lock (abiertas) { foreach (var c in abiertas.Values) try { c.Cerrar(); } catch { } abiertas.Clear(); }
        }
    }

    // Cliente de la API de RouterOS (puerto 8728, o 8729 con TLS). RouterOS 6 y 7.
    public class ConexionRos
    {
        readonly string host, usuario, clave;
        readonly int puerto;
        readonly bool ssl;
        TcpClient tcp;
        Stream flujo;
        public DateTime Uso = DateTime.UtcNow;

        public ConexionRos(string host, int puerto, bool ssl, string usuario, string clave)
        {
            this.host = host; this.puerto = puerto; this.ssl = ssl; this.usuario = usuario; this.clave = clave;
        }

        public void Abrir(int tiempo)
        {
            if (flujo != null) return;
            tcp = new TcpClient();
            var ar = tcp.BeginConnect(host, puerto, null, null);
            if (!ar.AsyncWaitHandle.WaitOne(Math.Min(tiempo, 8000))) { try { tcp.Close(); } catch { } tcp = null; throw new TimeoutException("Tiempo agotado al conectar."); }
            try { tcp.EndConnect(ar); } catch { try { tcp.Close(); } catch { } tcp = null; throw; }
            tcp.NoDelay = true;
            Stream s = tcp.GetStream();
            if (ssl)
            {
                // El certificado de API-SSL del router suele ser propio
                var tls = new SslStream(s, false, (a, b, c, d) => true);
                tls.AuthenticateAsClient(host);
                s = tls;
            }
            flujo = s;
            try { Login(tiempo); } catch { Cerrar(); throw; }
        }

        void Login(int tiempo)
        {
            Respuesta r;
            try { r = Ejecutar(new List<string> { "/login", "=name=" + usuario, "=password=" + clave }, tiempo); }
            catch (ErrorTrap) { throw new ErrorLogin("El router rechazó el usuario o la contraseña."); }
            string ret;
            if (r.Done.TryGetValue("ret", out ret) && ret.Length > 0)
            {
                // RouterOS anterior a 6.43: desafío MD5
                var reto = new byte[ret.Length / 2];
                for (int i = 0; i < reto.Length; i++) reto[i] = Convert.ToByte(ret.Substring(i * 2, 2), 16);
                var datos = new List<byte> { 0 };
                datos.AddRange(Encoding.UTF8.GetBytes(clave)); datos.AddRange(reto);
                string md5;
                using (var h = MD5.Create()) md5 = string.Concat(h.ComputeHash(datos.ToArray()).Select(b => b.ToString("x2")));
                try { Ejecutar(new List<string> { "/login", "=name=" + usuario, "=response=00" + md5 }, tiempo); }
                catch (ErrorTrap) { throw new ErrorLogin("El router rechazó el usuario o la contraseña."); }
            }
        }

        public Respuesta Ejecutar(List<string> palabras, int tiempo)
        {
            if (flujo == null) throw new IOException("Sin conexión con el router.");
            tcp.ReceiveTimeout = tiempo; tcp.SendTimeout = tiempo;
            flujo.ReadTimeout = tiempo; flujo.WriteTimeout = tiempo;
            var ms = new MemoryStream();
            foreach (var p in palabras) EscribirPalabra(ms, p);
            ms.WriteByte(0);
            var b = ms.ToArray();
            flujo.Write(b, 0, b.Length); flujo.Flush();

            var r = new Respuesta();
            string trap = null;
            var limite = DateTime.UtcNow.AddMilliseconds(tiempo);
            while (true)
            {
                if (DateTime.UtcNow > limite) throw new TimeoutException("El router tardó demasiado en responder.");
                var frase = LeerFrase();
                if (frase.Count == 0) continue;
                var attr = new Dictionary<string, string>();
                foreach (var w in frase.Skip(1))
                {
                    if (w.Length > 1 && w[0] == '=') { int k = w.IndexOf('=', 1); if (k > 0) attr[w.Substring(1, k - 1)] = w.Substring(k + 1); }
                }
                switch (frase[0])
                {
                    case "!re": r.Filas.Add(attr); break;
                    case "!trap": string m; trap = attr.TryGetValue("message", out m) ? m : "El router devolvió un error."; break;
                    case "!fatal": throw new IOException("El router cerró la sesión: " + (frase.Count > 1 ? frase[1] : ""));
                    case "!done": r.Done = attr; if (trap != null) throw new ErrorTrap(trap); return r;
                }
            }
        }

        static void EscribirPalabra(Stream s, string palabra)
        {
            var b = Encoding.UTF8.GetBytes(palabra);
            long n = b.Length;
            if (n < 0x80) s.WriteByte((byte)n);
            else if (n < 0x4000) { n |= 0x8000; s.WriteByte((byte)(n >> 8)); s.WriteByte((byte)n); }
            else if (n < 0x200000) { n |= 0xC00000; s.WriteByte((byte)(n >> 16)); s.WriteByte((byte)(n >> 8)); s.WriteByte((byte)n); }
            else if (n < 0x10000000) { n |= 0xE0000000; s.WriteByte((byte)(n >> 24)); s.WriteByte((byte)(n >> 16)); s.WriteByte((byte)(n >> 8)); s.WriteByte((byte)n); }
            else { s.WriteByte(0xF0); s.WriteByte((byte)(n >> 24)); s.WriteByte((byte)(n >> 16)); s.WriteByte((byte)(n >> 8)); s.WriteByte((byte)n); }
            s.Write(b, 0, b.Length);
        }

        List<string> LeerFrase()
        {
            var l = new List<string>();
            while (true)
            {
                long n = LeerLongitud();
                if (n == 0) return l;
                if (n > 16 * 1024 * 1024) throw new IOException("Respuesta del router demasiado grande.");
                var b = LeerExacto((int)n);
                l.Add(Encoding.UTF8.GetString(b));
            }
        }

        long LeerLongitud()
        {
            long c = LeerByte();
            if ((c & 0x80) == 0) return c;
            if ((c & 0xC0) == 0x80) return ((c & 0x3F) << 8) | B();
            if ((c & 0xE0) == 0xC0) return ((c & 0x1F) << 16) | (B() << 8) | B();
            if ((c & 0xF0) == 0xE0) return ((c & 0x0F) << 24) | (B() << 16) | (B() << 8) | B();
            return (B() << 24) | (B() << 16) | (B() << 8) | B();
        }

        long B() { return LeerByte(); }

        int LeerByte()
        {
            int c = flujo.ReadByte();
            if (c < 0) throw new IOException("El router cerró la conexión.");
            return c;
        }

        byte[] LeerExacto(int n)
        {
            var b = new byte[n];
            int i = 0;
            while (i < n) { int r = flujo.Read(b, i, n - i); if (r <= 0) throw new IOException("El router cerró la conexión."); i += r; }
            return b;
        }

        public void Cerrar()
        {
            try { if (flujo != null) flujo.Dispose(); } catch { }
            try { if (tcp != null) tcp.Close(); } catch { }
            flujo = null; tcp = null;
        }
    }
}
