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
    ram = $(if ($vm.DynamicMemoryEnabled -and $vm.MemoryDemand) { $vm.MemoryDemand } else { $vm.MemoryAssigned }); ramMax = $(if ($vm.DynamicMemoryEnabled) { $vm.MemoryMaximum } else { $vm.MemoryStartup });
    ramFija = -not $vm.DynamicMemoryEnabled; uptime = [int64]$vm.Uptime.TotalSeconds; generacion = $vm.Generation
    ips = @($vm.NetworkAdapters | ForEach-Object { $_.IPAddresses } | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '169.254.*' } | Select-Object -First 4) }
  if ($conDiscos) { try { $d = @(Get-VHD -VMId $vm.VMId -ErrorAction Stop); $o.disco = ($d | Measure-Object FileSize -Sum).Sum; $o.discoMax = ($d | Measure-Object Size -Sum).Sum } catch { } }
  [pscustomobject]$o
})
@{ vms = $l } | ConvertTo-Json -Compress -Depth 3";


        // Red del host Hyper-V: tarjetas físicas, conmutadores virtuales y adaptadores de las VM (como la pestaña Red de Proxmox)
        const string ScriptRed = @"$ErrorActionPreference = 'SilentlyContinue'
Import-Module Hyper-V
$sw = @(Get-VMSwitch)
$fis = @(Get-NetAdapter -Physical)
$est = @{}; Get-NetAdapterStatistics | ForEach-Object { $est[$_.Name] = $_ }
function IpsDe($alias) { return ,@(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $alias | Where-Object { $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress + '/' + $_.PrefixLength }) }
function Mac($m) { if (-not $m) { return $null }; $m = ($m -replace '[-:]', '').ToLower(); return ($m -replace '(..)(?!$)', '$1:') }
$l = @()
foreach ($a in $fis) {
  $s = $sw | Where-Object { $_.NetAdapterInterfaceDescription -eq $a.InterfaceDescription } | Select-Object -First 1
  $st = $est[$a.Name]; $ips = IpsDe $a.Name
  $l += [pscustomobject][ordered]@{ nombre = $a.Name; tipo = 'fisica'; estado = $(if ($a.Status -eq 'Up') { 'up' } else { 'down' }); velocidad = [int64]($a.ReceiveLinkSpeed / 1000000);
    duplex = $(if ($a.FullDuplex) { 'full' } else { $null }); mtu = $a.MtuSize; mac = (Mac $a.MacAddress); ips = $ips; puente = $(if ($s) { $s.Name } else { $null }); descripcion = $a.InterfaceDescription;
    rxTotal = [int64]$st.ReceivedBytes; txTotal = [int64]$st.SentBytes; errores = [int64]($st.ReceivedPacketErrors + $st.OutboundPacketErrors); descartados = [int64]($st.ReceivedDiscardedPackets + $st.OutboundDiscardedPackets) }
}
$vmAd = @(Get-VMNetworkAdapter -All)
foreach ($s in $sw) {
  $v = Get-NetAdapter -Name ('vEthernet (' + $s.Name + ')'); $st = $null; $ips = @(); if ($v) { $st = $est[$v.Name]; $ips = IpsDe $v.Name }
  $puertos = @(@($fis | Where-Object { $_.InterfaceDescription -eq $s.NetAdapterInterfaceDescription } | ForEach-Object { $_.Name }) + @($vmAd | Where-Object { $_.SwitchName -eq $s.Name -and -not $_.IsManagementOs } | ForEach-Object { $_.VMName }))
  $l += [pscustomobject][ordered]@{ nombre = $s.Name; tipo = 'puente'; clase = $s.SwitchType.ToString(); estado = 'up'; mac = $(if ($v) { Mac $v.MacAddress } else { $null }); ips = $ips; puertos = $puertos;
    rxTotal = $(if ($st) { [int64]$st.ReceivedBytes } else { 0 }); txTotal = $(if ($st) { [int64]$st.SentBytes } else { 0 }); errores = 0; descartados = 0 }
}
foreach ($n in @($vmAd | Where-Object { -not $_.IsManagementOs })) {
  $ips = @($n.IPAddresses | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' })
  $l += [pscustomobject][ordered]@{ nombre = ($n.VMName + ' · ' + $n.Name); tipo = 'invitado'; estado = $(if ($n.Connected -or ($n.Status -contains 'Ok')) { 'up' } else { 'down' }); mac = (Mac $n.MacAddress);
    ips = $ips; puente = $n.SwitchName; vmid = $n.VMId.ToString(); puertos = @(); rxTotal = 0; txTotal = 0; errores = 0; descartados = 0 }
}
$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique | Select-Object -First 3)
$lat = $null
if ($gw) {
  $p = @(Test-Connection -ComputerName $gw -Count 3)
  if ($p.Count) { $t = @($p | ForEach-Object { if ($_.ResponseTime -ne $null) { $_.ResponseTime } else { $_.Latency } }); $lat = [ordered]@{ destino = $gw; ms = [math]::Round(($t | Measure-Object -Average).Average, 2); max = ($t | Measure-Object -Maximum).Maximum; perdida = [math]::Round((3 - $p.Count) / 3 * 100) } }
  else { $lat = [ordered]@{ destino = $gw; ms = $null; max = $null; perdida = 100 } }
}
$cs = Get-CimInstance Win32_ComputerSystem
@{ interfaces = $l; puertaEnlace = $gw; dns = $dns; dominio = $(if ($cs.PartOfDomain) { $cs.Domain } else { $null }); host = $env:COMPUTERNAME; latencia = $lat } | ConvertTo-Json -Compress -Depth 4";

        static Dictionary<string, object> red;
        static DateTime redLeida = DateTime.MinValue;
        static int leyendoRed;
        /// La red se lee en segundo plano cada 5 min (los pings tardan unos segundos); se devuelve la última lectura.
        public static Dictionary<string, object> Red()
        {
            if ((DateTime.UtcNow - redLeida).TotalMinutes >= 5 && System.Threading.Interlocked.Exchange(ref leyendoRed, 1) == 0)
            {
                System.Threading.ThreadPool.QueueUserWorkItem(_ =>
                {
                    try { red = Json.LeerObjeto(PowerShell(ScriptRed, 90000).Trim()); }
                    catch (Exception ex) { red = new Dictionary<string, object> { { "error", ex.Message } }; }
                    finally { redLeida = DateTime.UtcNow; System.Threading.Interlocked.Exchange(ref leyendoRed, 0); }
                });
            }
            return red;
        }

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
                    { "ramFija", v.ContainsKey("ramFija") ? v["ramFija"] : null }, { "ips", v.ContainsKey("ips") ? v["ips"] : null },
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
