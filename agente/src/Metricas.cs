using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Management;
using System.Reflection;
using System.Xml;

namespace NodeCat
{
    public class Disco
    {
        public string Unidad, Etiqueta;
        public double TotalGB, LibreGB;
        public int Pct;
    }

    public class Metricas
    {
        public int? Cpu, RamPct;
        public double? RamTotalGB, RamUsadaGB;
        public string So;
        public DateTime? Arranque;
        public List<Disco> Discos = new List<Disco>();
        public string Via;
    }

    /// <summary>CPU, RAM y discos por WMI (DCOM) y, si no se puede, por WinRM.</summary>
    public static class LectorMetricas
    {
        const string ConsultaSo = "SELECT Caption, TotalVisibleMemorySize, FreePhysicalMemory, LastBootUpTime FROM Win32_OperatingSystem";
        const string ConsultaCpu = "SELECT LoadPercentage FROM Win32_Processor";
        const string ConsultaDiscos = "SELECT DeviceID, VolumeName, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType = 3";

        /// <summary>Prueba primero el método que funcionó la última vez con ese servidor, con un tiempo máximo para cada uno.</summary>
        public static Metricas Leer(string servidor, Control c)
        {
            bool winrmPrimero = c.Via == "WinRM";
            var errores = new List<string>();
            for (int i = 0; i < 2; i++)
            {
                bool usarWinRm = (i == 0) == winrmPrimero;
                try
                {
                    Metricas m = usarWinRm
                        ? Limite.Ejecutar(() => PorWinRm(servidor), 30, "WinRM", c.WinRm, true)
                        : Limite.Ejecutar(() => PorWmi(servidor), 30, "WMI", c.Wmi);
                    if (c.Via != m.Via && c.Via != null) Utiles.Log(servidor + ": las métricas se leen ahora por " + m.Via + ".");
                    c.Via = m.Via;
                    return m;
                }
                catch (Exception ex) { errores.Add((usarWinRm ? "WinRM: " : "WMI: ") + Limpio(ex)); }
            }
            throw new Exception(string.Join(" / ", errores));
        }

        static string Limpio(Exception e)
        {
            while (e is TargetInvocationException && e.InnerException != null) e = e.InnerException;
            return (e.Message ?? "").Trim().TrimEnd('.');
        }

        static bool EsLocal(string s)
        {
            s = (s ?? "").ToLowerInvariant();
            return s == "localhost" || s == "127.0.0.1" || s == "." || s == Environment.MachineName.ToLowerInvariant();
        }

        static Metricas Armar(Dictionary<string, string> so, List<string> cargas, List<Dictionary<string, string>> discos, string via)
        {
            var m = new Metricas { Via = via };
            var cs = cargas.Select(x => { int v; return int.TryParse(x, out v) ? (int?)v : null; }).Where(x => x.HasValue).Select(x => x.Value).ToList();
            if (cs.Count > 0) m.Cpu = (int)Math.Round(cs.Average());
            double tot, lib;
            if (double.TryParse(Valor(so, "TotalVisibleMemorySize"), NumberStyles.Any, CultureInfo.InvariantCulture, out tot) &&
                double.TryParse(Valor(so, "FreePhysicalMemory"), NumberStyles.Any, CultureInfo.InvariantCulture, out lib) && tot > 0)
            {
                m.RamTotalGB = Math.Round(tot / 1048576.0, 1);
                m.RamUsadaGB = Math.Round((tot - lib) / 1048576.0, 1);
                m.RamPct = (int)Math.Round((tot - lib) * 100 / tot);
            }
            m.So = Valor(so, "Caption").Trim();
            m.Arranque = Fecha(Valor(so, "LastBootUpTime"));
            foreach (var d in discos)
            {
                double size, free;
                double.TryParse(Valor(d, "Size"), NumberStyles.Any, CultureInfo.InvariantCulture, out size);
                double.TryParse(Valor(d, "FreeSpace"), NumberStyles.Any, CultureInfo.InvariantCulture, out free);
                if (size <= 0) continue;
                m.Discos.Add(new Disco
                {
                    Unidad = Valor(d, "DeviceID"),
                    Etiqueta = Valor(d, "VolumeName"),
                    TotalGB = Math.Round(size / 1073741824.0, 1),
                    LibreGB = Math.Round(free / 1073741824.0, 1),
                    Pct = (int)Math.Round((size - free) * 100 / size)
                });
            }
            return m;
        }

        static string Valor(Dictionary<string, string> d, string k) { string v; return d != null && d.TryGetValue(k, out v) && v != null ? v : ""; }

        static DateTime? Fecha(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            try { if (s.Length >= 21 && s[14] == '.') return ManagementDateTimeConverter.ToDateTime(s); } catch { }
            DateTime d;
            if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out d)) return d;
            return null;
        }

        // ---------------------------------------------------------------- WMI (DCOM)
        static Metricas PorWmi(string servidor)
        {
            var opc = new ConnectionOptions
            {
                Timeout = TimeSpan.FromSeconds(10),
                Impersonation = ImpersonationLevel.Impersonate,
                Authentication = AuthenticationLevel.PacketPrivacy,
                EnablePrivileges = true
            };
            string ruta = EsLocal(servidor) ? @"\\.\root\cimv2" : @"\\" + servidor + @"\root\cimv2";
            var scope = new ManagementScope(ruta, EsLocal(servidor) ? null : opc);
            scope.Connect();
            var so = Consultar(scope, ConsultaSo).FirstOrDefault();
            var cpu = Consultar(scope, ConsultaCpu).Select(x => Valor(x, "LoadPercentage")).ToList();
            var dis = Consultar(scope, ConsultaDiscos);
            return Armar(so, cpu, dis, "WMI");
        }

        static List<Dictionary<string, string>> Consultar(ManagementScope scope, string wql)
        {
            var r = new List<Dictionary<string, string>>();
            var eo = new EnumerationOptions { Timeout = TimeSpan.FromSeconds(15), ReturnImmediately = false, Rewindable = false };
            using (var s = new ManagementObjectSearcher(scope, new ObjectQuery(wql), eo))
            using (var col = s.Get())
            {
                foreach (ManagementBaseObject o in col)
                {
                    var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var p in o.Properties) d[p.Name] = p.Value == null ? null : Convert.ToString(p.Value, CultureInfo.InvariantCulture);
                    r.Add(d);
                    o.Dispose();
                }
            }
            return r;
        }

        // ---------------------------------------------------------------- WinRM (WS-Management)
        static object Llamar(object o, string metodo, params object[] args)
        {
            return o.GetType().InvokeMember(metodo, BindingFlags.InvokeMethod, null, o, args);
        }
        static object Prop(object o, string nombre) { return o.GetType().InvokeMember(nombre, BindingFlags.GetProperty, null, o, null); }

        static Metricas PorWinRm(string servidor)
        {
            var tipo = Type.GetTypeFromProgID("WSMan.Automation");
            if (tipo == null) throw new Exception("WS-Management no está disponible en este equipo");
            object wsman = Activator.CreateInstance(tipo);
            object opc = Llamar(wsman, "CreateConnectionOptions");
            string destino = EsLocal(servidor) ? "localhost" : servidor;
            object sesion = Llamar(wsman, "CreateSession", "http://" + destino + ":5985/wsman", 0, opc);
            try { sesion.GetType().InvokeMember("Timeout", BindingFlags.SetProperty, null, sesion, new object[] { 15000 }); } catch { }
            Func<string, List<Dictionary<string, string>>> q = wql => EnumerarWsman(sesion, wql);
            var so = q(ConsultaSo).FirstOrDefault();
            var cpu = q(ConsultaCpu).Select(x => Valor(x, "LoadPercentage")).ToList();
            var dis = q(ConsultaDiscos);
            return Armar(so, cpu, dis, "WinRM");
        }

        static List<Dictionary<string, string>> EnumerarWsman(object sesion, string wql)
        {
            var r = new List<Dictionary<string, string>>();
            object e = Llamar(sesion, "Enumerate", "http://schemas.microsoft.com/wbem/wsman/1/wmi/root/cimv2/*", wql, "http://schemas.microsoft.com/wbem/wsman/1/WQL", 0);
            int vueltas = 0;
            while (!(bool)Prop(e, "AtEndOfStream") && vueltas++ < 200)
            {
                string xml = (string)Llamar(e, "ReadItem");
                if (string.IsNullOrEmpty(xml)) continue;
                var doc = new XmlDocument();
                doc.LoadXml(xml);
                var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (XmlNode n in doc.DocumentElement.ChildNodes)
                {
                    if (n.NodeType != XmlNodeType.Element) continue;
                    var nil = n.Attributes != null ? n.Attributes["nil", "http://www.w3.org/2001/XMLSchema-instance"] : null;
                    d[n.LocalName] = nil != null && nil.Value == "true" ? null : n.InnerText;
                }
                r.Add(d);
            }
            return r;
        }
    }
}
