#!/bin/bash
# Compila NodeCatAgente.exe (.NET Framework 4.5+) con Mono y lo deja donde el servidor lo ofrece para descargar.
set -e
cd "$(dirname "$0")"
mcs -nologo -target:exe -out:../servidor/agente/NodeCatAgente.exe -sdk:4.5 -optimize+ -platform:anycpu -win32icon:nodecat.ico \
  -r:System.Management.dll -r:System.ServiceProcess.dll -r:System.Xml.dll -r:System.Core.dll \
  src/Agente.cs src/Json.cs src/Wts.cs src/Metricas.cs src/Comun.cs src/Sonda.cs src/HyperV.cs src/Procesos.cs
grep -o 'Version = "[0-9.]*"' src/Agente.cs | grep -o '[0-9.]*' > ../servidor/agente/NodeCatAgente.version
ls -la ../servidor/agente/NodeCatAgente.exe | awk '{print $5, $9}'
