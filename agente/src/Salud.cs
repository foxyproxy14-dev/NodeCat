using System;
using System.Collections.Generic;
using System.Threading;

namespace NodeCat
{
    // Salud de los discos (como CrystalDiskInfo) y licencia de Escritorio remoto (periodo de gracia de 120 días).
    // Solo lectura: Get-PhysicalDisk, Get-StorageReliabilityCounter, atributos SMART por WMI (root\wmi) y Win32_TerminalServiceSetting.
    // Se lee en segundo plano cada 10 minutos y cada informe lleva la última lectura.
    public static class Salud
    {
        const string Script = @"$ErrorActionPreference = 'SilentlyContinue'
function Atr($d, $t) {
  $l = @(); if (-not $d) { return ,$l }
  $u = @{}; if ($t) { for ($i = 2; $i + 11 -lt $t.Length; $i += 12) { if ($t[$i]) { $u[[int]$t[$i]] = [int]$t[$i + 1] } } }
  for ($i = 2; $i + 11 -lt $d.Length; $i += 12) {
    $id = [int]$d[$i]; if (-not $id) { continue }
    $raw = [int64]0; for ($k = 5; $k -ge 0; $k--) { $raw = $raw * 256 + [int64]$d[$i + 5 + $k] }
    $th = $null; if ($u.ContainsKey($id)) { $th = $u[$id] }
    $l += ,@($id, [int]$d[$i + 3], [int]$d[$i + 4], $th, $raw)
  }
  return ,$l
}
function Txt($v) { if ($v -eq $null) { return $null }; $s = ([string]$v).Trim(); if ($s) { return $s }; return $null }
$cs = Get-WmiObject Win32_ComputerSystem
$virtual = ([string]$cs.Manufacturer + ' ' + [string]$cs.Model) -match 'Virtual|VMware|QEMU|KVM|Xen|VirtualBox|Bochs|Parallels|Amazon EC2|Google Compute|OpenStack|Nutanix'
$smart = @{}; $umb = @{}; $pred = @{}
Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictData | ForEach-Object { $smart[($_.InstanceName -replace '_\d+$', '').ToUpper()] = $_.VendorSpecific }
Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictThresholds | ForEach-Object { $umb[($_.InstanceName -replace '_\d+$', '').ToUpper()] = $_.VendorSpecific }
Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictStatus | ForEach-Object { $pred[($_.InstanceName -replace '_\d+$', '').ToUpper()] = [bool]$_.PredictFailure }
$dd = @{}; Get-WmiObject Win32_DiskDrive | ForEach-Object { $dd[[string]$_.Index] = $_ }
$l = @()
$pds = @(); if (Get-Command Get-PhysicalDisk -ErrorAction SilentlyContinue) { $pds = @(Get-PhysicalDisk) }
if ($pds.Count) {
  foreach ($p in $pds) {
    $w = $dd[[string]$p.DeviceId]; $k = ''; if ($w) { $k = ([string]$w.PNPDeviceID).ToUpper() }
    $r = $p | Get-StorageReliabilityCounter
    $vol = @(); if ($p.DeviceId -match '^\d+$') { $vol = @(Get-Partition -DiskNumber ([int]$p.DeviceId) | Where-Object { $_.DriveLetter -and [int]$_.DriveLetter -ne 0 } | ForEach-Object { [string]$_.DriveLetter + ':' }) }
    $l += [pscustomobject][ordered]@{ numero = $p.DeviceId; modelo = (Txt $(if ($p.Model) { $p.Model } else { $p.FriendlyName })); serie = (Txt $p.SerialNumber); firmware = (Txt $p.FirmwareVersion);
      bus = [string]$p.BusType; medio = [string]$p.MediaType; tamano = [int64]$p.Size; salud = [string]$p.HealthStatus; operativo = (@($p.OperationalStatus | ForEach-Object { [string]$_ }) -join ', ');
      temperatura = $r.Temperature; temperaturaMax = $r.TemperatureMax; horas = $r.PowerOnHours; desgaste = $r.Wear; ciclos = $r.StartStopCycleCount;
      erroresLectura = $r.ReadErrorsUncorrected; erroresEscritura = $r.WriteErrorsUncorrected; prediccion = $pred[$k]; volumenes = $vol; atributos = (Atr $smart[$k] $umb[$k]) }
  }
} else {
  foreach ($w in $dd.Values) {
    $k = ([string]$w.PNPDeviceID).ToUpper()
    $l += [pscustomobject][ordered]@{ numero = [string]$w.Index; modelo = (Txt $w.Model); serie = (Txt $w.SerialNumber); firmware = (Txt $w.FirmwareRevision); bus = [string]$w.InterfaceType; medio = ''; tamano = [int64]$w.Size;
      salud = [string]$w.Status; operativo = ''; prediccion = $pred[$k]; volumenes = @(); atributos = (Atr $smart[$k] $umb[$k]) }
  }
}
$rds = $null
$t = Get-WmiObject -Namespace root\cimv2\TerminalServices -Class Win32_TerminalServiceSetting
if ($t) {
  $dias = $null; $srv = @()
  if ($t.TerminalServerMode -eq 1) {
    try { $dias = [int]$t.GetGracePeriodDays().DaysLeft } catch { }
    try { $srv = @($t.GetSpecifiedLicenseServerList().SpecifiedLSList | Where-Object { $_ }) } catch { }
  }
  $rds = [ordered]@{ modo = [int]$t.TerminalServerMode; licencia = [int]$t.LicensingType; dias = $dias; servidores = $srv }
}
@{ discos = $l; virtual = $virtual; rds = $rds } | ConvertTo-Json -Compress -Depth 6";

        static Dictionary<string, object> ultimo;
        static DateTime leida = DateTime.MinValue;
        static int leyendo;

        /// Devuelve la última lectura (null hasta la primera) y, si pasaron 10 minutos, pide otra en segundo plano.
        public static Dictionary<string, object> Leer()
        {
            if ((DateTime.UtcNow - leida).TotalMinutes >= 10 && Interlocked.Exchange(ref leyendo, 1) == 0)
            {
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try { ultimo = Json.LeerObjeto(HyperV.PowerShell(Script, 120000).Trim()); }
                    catch (Exception ex) { ultimo = new Dictionary<string, object> { { "error", ex.Message } }; }
                    finally { leida = DateTime.UtcNow; Interlocked.Exchange(ref leyendo, 0); }
                });
            }
            return ultimo;
        }
    }
}
