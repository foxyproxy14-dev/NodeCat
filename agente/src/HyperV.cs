using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.ServiceProcess;
using System.Text;

namespace NodeCat
{
    // Hyper-V: si el servidor tiene el rol, el agente informa sus máquinas virtuales (solo lectura).
    // Usa el módulo de PowerShell de Hyper-V (Get-VM, Get-VHD), que viene con el rol.
    public static class HyperV
    {
        static DateTime revisado = DateTime.MinValue;
        static bool hay;
        static DateTime ultimaLectura = DateTime.MinValue;
        static List<object> cache;
        static readonly Dictionary<string, object[]> discos = new Dictionary<string, object[]>();
        static DateTime ultimosDiscos = DateTime.MinValue;

        public static bool Disponible()
        {
            if ((DateTime.UtcNow - revisado).TotalMinutes < 10) return hay;
            revisado = DateTime.UtcNow;
            try { hay = ServiceController.GetServices().Any(s => s.ServiceName.Equals("vmms", StringComparison.OrdinalIgnoreCase)); } catch { hay = false; }
            return hay;
        }

        const string Script = @"$ErrorActionPreference = 'Stop'
Import-Module Hyper-V
$conDiscos = $args0
$l = @(Get-VM | ForEach-Object {
  $vm = $_
  $o = [ordered]@{ id = $vm.VMId.ToString(); nombre = $vm.Name; estado = $vm.State.ToString(); cpu = $vm.CPUUsage; cpus = $vm.ProcessorCount;
    ram = $vm.MemoryAssigned; ramMax = $(if ($vm.DynamicMemoryEnabled) { $vm.MemoryMaximum } else { $vm.MemoryStartup }); uptime = [int64]$vm.Uptime.TotalSeconds; generacion = $vm.Generation }
  if ($conDiscos) { try { $d = @(Get-VHD -VMId $vm.VMId -ErrorAction Stop); $o.disco = ($d | Measure-Object FileSize -Sum).Sum; $o.discoMax = ($d | Measure-Object Size -Sum).Sum } catch { } }
  [pscustomobject]$o
})
@{ vms = $l } | ConvertTo-Json -Compress -Depth 3";

        static readonly Dictionary<string, string> Estados = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        { { "Running", "running" }, { "Off", "stopped" }, { "Paused", "paused" }, { "Saved", "saved" }, { "Starting", "starting" }, { "Stopping", "stopping" }, { "Saving", "saved" }, { "Pausing", "paused" }, { "Resuming", "starting" } };

        /// Lista de VM: se pregunta como mucho cada 25 s; los tamaños de disco, cada 10 min (Get-VHD es más lento).
        public static List<object> Listar()
        {
            if (cache != null && (DateTime.UtcNow - ultimaLectura).TotalSeconds < 25) return cache;
            bool conDiscos = (DateTime.UtcNow - ultimosDiscos).TotalMinutes >= 10;
            string salida = PowerShell(Script.Replace("$args0", conDiscos ? "$true" : "$false"), 60000);
            var o = Json.LeerObjeto(salida.Trim());
            var l = new List<object>();
            foreach (var x in Json.Lista(o, "vms"))
            {
                var v = x as Dictionary<string, object>; if (v == null) continue;
                string id = Json.Txt(v, "id");
                string estado; if (!Estados.TryGetValue(Json.Txt(v, "estado"), out estado)) estado = Json.Txt(v, "estado").ToLowerInvariant();
                if (conDiscos && v.ContainsKey("discoMax")) discos[id] = new[] { v.ContainsKey("disco") ? v["disco"] : null, v["discoMax"] };
                object[] d; discos.TryGetValue(id, out d);
                l.Add(new Dictionary<string, object> {
                    { "id", id }, { "nombre", Json.Txt(v, "nombre") }, { "tipo", "hyperv" }, { "estado", estado },
                    { "cpu", v.ContainsKey("cpu") ? v["cpu"] : null }, { "cpus", v.ContainsKey("cpus") ? v["cpus"] : null },
                    { "ram", v.ContainsKey("ram") ? v["ram"] : null }, { "ramMax", v.ContainsKey("ramMax") ? v["ramMax"] : null },
                    { "uptime", v.ContainsKey("uptime") ? v["uptime"] : null },
                    { "disco", d != null ? d[0] : null }, { "discoMax", d != null ? d[1] : null } });
            }
            if (conDiscos) ultimosDiscos = DateTime.UtcNow;
            cache = l; ultimaLectura = DateTime.UtcNow;
            return l;
        }

        static string PowerShell(string script, int ms)
        {
            string cod = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + cod)
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
            using (var p = Process.Start(psi))
            {
                var salida = p.StandardOutput.ReadToEndAsync();
                var error = p.StandardError.ReadToEndAsync();
                if (!p.WaitForExit(ms)) { try { p.Kill(); } catch { } throw new System.TimeoutException("Hyper-V no respondió a tiempo"); }
                if (p.ExitCode != 0) { string e = (error.Result ?? "").Trim(); throw new Exception(e.Length > 0 ? e.Split('\n')[0].Trim() : "No se pudo leer Hyper-V (código " + p.ExitCode + ")"); }
                return salida.Result;
            }
        }
    }
}
