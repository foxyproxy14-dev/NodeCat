using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace NodeCat
{
    /// <summary>CPU y memoria por sesión: se recorren los procesos una vez por informe y la CPU se calcula
    /// por diferencia con el informe anterior (no hay muestreo continuo, así casi no consume).</summary>
    public static class ProcesosSesion
    {
        public class Uso { public double? Cpu; public long Ram; public int Procesos; public List<object> Top = new List<object>(); }

        static readonly object cerrojo = new object();
        static Dictionary<int, TimeSpan> previo = new Dictionary<int, TimeSpan>();
        static DateTime previoT = DateTime.MinValue;

        public static Dictionary<int, Uso> Medir()
        {
            lock (cerrojo)
            {
                var ahora = DateTime.UtcNow;
                double ms = previoT == DateTime.MinValue ? 0 : (ahora - previoT).TotalMilliseconds;
                bool hayAnterior = ms > 1000 && ms < 30 * 60 * 1000;
                int nucleos = Math.Max(1, Environment.ProcessorCount);
                var nuevos = new Dictionary<int, TimeSpan>();
                var porSesion = new Dictionary<int, Uso>();
                var lista = new Dictionary<int, List<Tuple<string, double, long>>>();
                Process[] procesos;
                try { procesos = Process.GetProcesses(); } catch { return porSesion; }
                foreach (var p in procesos)
                {
                    try
                    {
                        int sid = p.SessionId;
                        if (sid == 0) continue;   // servicios del sistema: no son de ninguna persona
                        long ram = 0; try { ram = p.WorkingSet64; } catch { }
                        double cpu = 0;
                        try
                        {
                            var t = p.TotalProcessorTime;
                            nuevos[p.Id] = t;
                            TimeSpan antes;
                            if (hayAnterior && previo.TryGetValue(p.Id, out antes) && t >= antes)
                                cpu = (t - antes).TotalMilliseconds / ms / nucleos * 100.0;
                        }
                        catch { }
                        Uso u;
                        if (!porSesion.TryGetValue(sid, out u)) { u = new Uso { Cpu = hayAnterior ? (double?)0 : null }; porSesion[sid] = u; lista[sid] = new List<Tuple<string, double, long>>(); }
                        u.Ram += ram; u.Procesos++;
                        if (hayAnterior) u.Cpu += cpu;
                        lista[sid].Add(Tuple.Create(p.ProcessName, cpu, ram));
                    }
                    catch { }
                    finally { p.Dispose(); }
                }
                previo = nuevos; previoT = ahora;
                foreach (var kv in porSesion)
                {
                    var u = kv.Value;
                    if (u.Cpu.HasValue) u.Cpu = Math.Round(Math.Min(100, u.Cpu.Value), 1);
                    // Los 3 programas que más consumen en esa sesión (agrupados por nombre, p. ej. todos los chrome juntos)
                    u.Top = lista[kv.Key].GroupBy(x => x.Item1, StringComparer.OrdinalIgnoreCase)
                        .Select(g => new { n = g.Key, c = g.Sum(x => x.Item2), r = g.Sum(x => x.Item3), k = g.Count() })
                        .OrderByDescending(x => hayAnterior ? x.c : 0).ThenByDescending(x => x.r).Take(3)
                        .Select(x => (object)new Dictionary<string, object> { { "nombre", x.n }, { "cpu", hayAnterior ? (object)Math.Round(x.c, 1) : null }, { "ram", x.r }, { "cantidad", x.k } }).ToList();
                }
                return porSesion;
            }
        }
    }
}
