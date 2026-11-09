#!/bin/bash
# Compila AtalayaAgente.exe (.NET Framework 4.5+) con Mono y lo deja donde el servidor lo ofrece para descargar.
set -e
cd "$(dirname "$0")"
mcs -nologo -target:exe -out:../servidor/agente/AtalayaAgente.exe -sdk:4.5 -optimize+ -platform:anycpu -win32icon:atalaya.ico \
  -r:System.Management.dll -r:System.ServiceProcess.dll -r:System.Xml.dll -r:System.Core.dll \
  src/Agente.cs src/Json.cs src/Wts.cs src/Metricas.cs src/Comun.cs
ls -la ../servidor/agente/AtalayaAgente.exe | awk '{print $5, $9}'
