# Instalador del agente de NodeCat para Windows (cliente: __CLIENTE__)
# Uso, en PowerShell como administrador:  irm __URL_SCRIPT__ | iex
# Muestra cada paso y el progreso. Solo instala el agente de monitoreo (solo lectura).

function Instalar-NodeCat {
  $ErrorActionPreference = 'Stop'
  $servidor  = '__SERVIDOR__'
  $urlExe    = '__URL_EXE__'
  $urlScript = '__URL_SCRIPT__'
  $cliente   = '__CLIENTE__'
  $pausa     = $env:NODECAT_PAUSA -eq '1'
  try { $Host.UI.RawUI.WindowTitle = 'NodeCat - instalando el agente' } catch { }

  function Linea([string]$t = '', [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }
  function Paso([int]$n, [string]$t) { Write-Host ''; Write-Host ("  [{0}/5] " -f $n) -ForegroundColor DarkCyan -NoNewline; Write-Host $t -ForegroundColor White }
  function Bien([string]$t) { Write-Host '        OK  ' -ForegroundColor Green -NoNewline; Write-Host $t -ForegroundColor Gray }
  function Nota([string]$t) { Write-Host '        ..  ' -ForegroundColor DarkGray -NoNewline; Write-Host $t -ForegroundColor DarkGray }
  function Fallo([string]$t) {
    Write-Host ''
    Write-Host '  ------------------------------------------------------------' -ForegroundColor Red
    Write-Host '   No se pudo instalar el agente' -ForegroundColor Red
    Write-Host ('   ' + $t) -ForegroundColor Yellow
    Write-Host '  ------------------------------------------------------------' -ForegroundColor Red
    Write-Host ''
    if ($pausa) { Read-Host '  Pulsa Enter para cerrar' | Out-Null }
  }
  function Barra([int]$p, [long]$leido, [long]$total) {
    $llenos = [int][math]::Floor($p / 4)
    $txt = '        [' + ('#' * $llenos) + ('.' * (25 - $llenos)) + '] ' + ('{0,3}%' -f $p)
    if ($total -gt 0) { $txt += ('   {0:N1} de {1:N1} MB' -f ($leido / 1MB), ($total / 1MB)) }
    Write-Host ("`r" + $txt) -NoNewline -ForegroundColor Cyan
  }

  Clear-Host
  Linea ''
  Linea '      /\_/\     _   _           _       ____      _' 'DarkYellow'
  Linea '     ( o.o )   | \ | | ___   __| | ___ / ___|__ _| |_' 'DarkYellow'
  Linea '      > ^ <    |  \| |/ _ \ / _` |/ _ \ |   / _` | __|' 'DarkYellow'
  Linea '     /|   |\   | |\  | (_) | (_| |  __/ |__| (_| | |_' 'DarkYellow'
  Linea '    (_|   |_)  |_| \_|\___/ \__,_|\___|\____\__,_|\__|' 'DarkYellow'
  Linea ''
  Linea '    Instalador del agente para Windows' 'White'
  Linea ('    Cliente: ' + $cliente + '    Servidor: ' + $servidor) 'DarkGray'

  # 1. Permisos de administrador (si no, se abre una ventana nueva con permisos)
  Paso 1 'Comprobando los permisos'
  $yo = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $yo.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Nota 'Hace falta ejecutarlo como administrador. Abriendo una ventana con permisos...'
    try {
      $cmd = "`$env:NODECAT_PAUSA='1'; irm '$urlScript' | iex"
      Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd) | Out-Null
      Bien 'Sigue la instalación en la ventana nueva.'
    } catch { Fallo 'Windows no dio permisos de administrador. Abre PowerShell con clic derecho, "Ejecutar como administrador", y pega el comando otra vez.' }
    return
  }
  Bien ('Administrador: ' + [Environment]::UserName + ' en ' + $env:COMPUTERNAME)

  # 2. Requisitos del sistema
  Paso 2 'Revisando el sistema'
  $so = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue)
  if ($so) { Bien ($so.Caption.Trim() + ' (' + $so.OSArchitecture + ')') }
  $net = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue).Release
  if (-not $net -or $net -lt 378389) { Fallo 'Hace falta .NET Framework 4.5 o más nuevo. Instálalo desde Windows Update y vuelve a intentarlo.'; return }
  Bien '.NET Framework 4.5 o más nuevo'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  $viejo = Get-Service -Name 'NodeCatAgente' -ErrorAction SilentlyContinue
  if ($viejo) { Nota 'Ya hay un agente instalado: se va a actualizar.' }

  # 3. Descarga con barra de progreso
  Paso 3 'Descargando el agente'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('NodeCatAgente-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.exe')
  try {
    $req = [Net.HttpWebRequest]::Create($urlExe)
    $req.UserAgent = 'NodeCat-Instalador'
    $req.Timeout = 30000
    $resp = $req.GetResponse()
    $total = $resp.ContentLength
    $entrada = $resp.GetResponseStream()
    $salida = [IO.File]::Create($tmp)
    $buf = New-Object byte[] 32768
    $leido = 0; $ultimo = -1
    Barra 0 0 $total
    while (($n = $entrada.Read($buf, 0, $buf.Length)) -gt 0) {
      $salida.Write($buf, 0, $n); $leido += $n
      if ($total -gt 0) { $p = [int](100 * $leido / $total); if ($p -ne $ultimo) { Barra $p $leido $total; $ultimo = $p } }
    }
    $salida.Close(); $entrada.Close(); $resp.Close()
    Barra 100 $leido $total; Write-Host ''
    Bien ('Descargado (' + ('{0:N0}' -f ($leido / 1KB)) + ' KB)')
  } catch {
    if ($salida) { $salida.Close() }
    Write-Host ''
    $m = $_.Exception.Message
    if ($m -match '404') { $m = 'Este comando ya no es válido (quizá se generó una clave nueva). Cópialo otra vez desde NodeCat.' }
    elseif ($m -match '429') { $m = 'Demasiados intentos con una clave errónea. Espera unos minutos.' }
    else { $m = 'No se pudo llegar a ' + $servidor + '. Revisa la conexión a Internet de este servidor. (' + $m + ')' }
    Fallo $m; return
  }

  # 4. Instalación (el propio agente muestra lo que hace)
  Paso 4 'Instalando el servicio'
  Write-Host ''
  & $tmp instalar /silencioso
  $codigo = $LASTEXITCODE
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  if ($codigo -ne 0) { Fallo ('El instalador terminó con el código ' + $codigo + '. Revisa los mensajes de arriba.'); return }

  # 5. Verificación
  Paso 5 'Comprobando que quedó funcionando'
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    $s = Get-Service -Name 'NodeCatAgente' -ErrorAction SilentlyContinue
    if ($s -and $s.Status -eq 'Running') { $ok = $true; break }
    Write-Host ("`r        Esperando el servicio" + ('.' * (($i % 3) + 1)) + '   ') -NoNewline -ForegroundColor DarkGray
    Start-Sleep -Seconds 1
  }
  Write-Host ("`r" + (' ' * 40) + "`r") -NoNewline
  if (-not $ok) { Fallo 'El servicio NodeCat Agente no arrancó. Revisa el Visor de eventos o vuelve a ejecutar el comando.'; return }
  Bien 'El servicio NodeCat Agente está en marcha'

  Write-Host ''
  Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
  Write-Host '   Listo. En unos segundos este servidor aparece en NodeCat.' -ForegroundColor Green
  Write-Host '   Para quitarlo: Panel de control > Programas > NodeCat Agente.' -ForegroundColor Gray
  Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
  Write-Host ''
  if ($pausa) { Read-Host '  Pulsa Enter para cerrar' | Out-Null }
}
Instalar-NodeCat
