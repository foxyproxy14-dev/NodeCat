<p align="center">
  <img src="docs/img/gato.png" alt="El gato de NodeCat, asomado a un servidor" width="150">
</p>

<h1 align="center">NodeCat</h1>

<p align="center">
  Todos tus clientes, todos sus servidores, desde un mismo lugar.<br>
  Servidores Windows, routers MikroTik, firewalls FortiGate, sesiones de Escritorio remoto y avisos por Telegram.
</p>

<p align="center">
  <img src="docs/img/clientes.png" alt="NodeCat: resumen de todos los clientes" width="900">
</p>

---

NodeCat es un panel web para quien da soporte a varias empresas. Cada cliente tiene su propio agente: lo instalas en sus servidores y aparecen solos dentro de su cliente, sin VPN y sin abrir puertos en su red. El agente solo necesita salida a Internet hacia NodeCat.

Es la evolución multicliente de [Vigía](https://github.com/foxyproxy14-dev/vigia), con el mismo diseño y el mismo agente.

## Qué hace

- **Resumen por cliente.** De un vistazo, qué clientes necesitan atención, cuántos servidores tienen en línea y cuál está peor de CPU, memoria o disco.
- **Página de cada cliente** con sus servidores, sus problemas y sus últimos sucesos (caídas, vueltas, reinicios).
- **Página de cada servidor** con gráficos de CPU y memoria de 1 hora a 30 días, discos, disponibilidad, caídas y sesiones.
- **Routers MikroTik al estilo MikroDash**, en solo lectura: tráfico en vivo de cada interfaz, enlace WAN, latencia a Cloudflare, Google y la puerta de enlace, CPU, memoria y temperatura, con un menú lateral como el de MikroDash: red (IP, rutas, ARP, DNS, bridges y VLAN, vecinos), inalámbrico (clientes por red, redes, CAPsMAN), servicios IP, túneles y VPN, tráfico (ancho de banda, colas, conexiones con los destinos más usados), seguridad (filtro, NAT, mangle, listas), sistema (registro, paquetes y firmware, servicios, scripts, tareas, NTP, SNMP, archivos, contenedores, usuarios), ping y traceroute desde el router, y el historial de caídas. Funciona con RouterOS 6 y 7.
- **FortiGate**, también en solo lectura y con su propio menú: CPU, memoria, sesiones, temperatura, tráfico en vivo, enlaces SD-WAN con latencia, jitter y pérdida de cada SLA, túneles IPsec y SSL-VPN, políticas con sus usos, rutas, DHCP, licencias FortiGuard (avisa de las que vencen pronto), alta disponibilidad, usuarios autenticados y registro de eventos. Funciona con FortiOS 6.4 y 7.x.
- **Sonda sin VPN:** si NodeCat no llega a un router o a un FortiGate, el agente de un servidor del cliente lo lee desde dentro de su red y se lo pasa a NodeCat, sin abrir puertos.
- **Sesiones de Escritorio remoto** en vivo de todos los clientes, e **historial** de quién entró, cuándo y desde qué equipo, exportable a Excel.
- **Avisos por Telegram** cuando un servidor, un router o un FortiGate deja de responder, se cae un enlace WAN o se queda sin CPU, memoria o disco, y cuando se resuelve. Resumen diario por cliente. Cada cliente puede tener además su propio chat.
- **Grupos** para juntar las sedes de una misma empresa.
- **Cuentas** de administrador o de solo lectura, que se pueden limitar a grupos o a clientes sueltos (por ejemplo, para que un cliente vea solo sus sedes, también las que se agreguen después).

<p align="center"><img src="docs/img/router.png" alt="Router MikroTik en vivo" width="900"></p>

<p align="center"><img src="docs/img/fortigate.png" alt="FortiGate con SD-WAN" width="900"></p>

<table>
  <tr>
    <td><img src="docs/img/fortigate-sdwan.png" alt="Enlaces SD-WAN y SLA del FortiGate"></td>
    <td><img src="docs/img/fortigate-licencias.png" alt="Licencias FortiGuard"></td>
  </tr>
  <tr>
    <td><img src="docs/img/router-wifi.png" alt="Clientes Wi-Fi del router"></td>
    <td><img src="docs/img/router-firewall.png" alt="Reglas del firewall"></td>
  </tr>
  <tr>
    <td><img src="docs/img/cliente.png" alt="Página de un cliente"></td>
    <td><img src="docs/img/servidor.png" alt="Página de un servidor"></td>
  </tr>
  <tr>
    <td><img src="docs/img/agentes.png" alt="Clientes y agentes"></td>
    <td><img src="docs/img/servidor-oscuro.png" alt="Tema oscuro"></td>
  </tr>
</table>

## Actualizar

```bash
git pull && docker compose up -d --build
```

Tus ajustes propios (por ejemplo `CONFIAR_PROXY`) ponlos en un archivo `docker-compose.override.yml` junto a `docker-compose.yml`. Docker lo combina solo y `git pull` no lo toca, así que actualizar nunca choca con tus cambios:

```yaml
services:
  nodecat:
    environment:
      CONFIAR_PROXY: "1"
```

Los datos y los agentes instalados se conservan. Si vienes de una versión anterior a la 0.4, actualiza así la primera vez:

```bash
git remote set-url origin https://github.com/foxyproxy14-dev/nodecat.git
git pull
docker compose up -d --build --remove-orphans
```

## El gato

NodeCat tiene mascota. Repara el servidor cuando todo va bien, corre mientras algo carga, programa cuando una lista está vacía, se impacienta si algo tarda demasiado y se avergüenza cuando hay un error. Si tu sistema tiene activado "reducir movimiento", se queda quieto.

<p align="center"><img src="docs/img/gato-poses.png" alt="Las cinco poses del gato: reparando, corriendo, programando, molesto y avergonzado" width="760"></p>

## Instalar

Necesitas un servidor Linux con Docker.

```bash
git clone https://github.com/foxyproxy14-dev/nodecat.git
cd nodecat
docker compose up -d --build
docker compose logs nodecat      # aquí aparece el código de 6 cifras de la primera vez
```

Abre `http://IP-DEL-SERVIDOR:8080`, escribe el código y crea tu cuenta de administrador.

### Publicarlo en Internet

Los agentes de los clientes sin VPN necesitan llegar a NodeCat por Internet. Lo más sencillo y seguro es **Cloudflare Tunnel**: no abre puertos en tu router y pone HTTPS solo.

1. En Cloudflare Zero Trust > Networks > Tunnels, crea un túnel y copia su token.
2. Agrega un *Public hostname*, por ejemplo `nodecat.tuempresa.com`, que apunte a `http://nodecat:8080`.
3. En `docker-compose.yml`, descomenta el bloque `cloudflared`, pega el token y pon `CONFIAR_PROXY: "1"`.
4. `docker compose up -d`. En NodeCat, en *Clientes y agentes > Dirección de NodeCat para los agentes*, escribe `https://nodecat.tuempresa.com`.

Los clientes que sí tienen VPN pueden usar la IP interna (`http://10.x.x.x:8080`); el agente funciona igual.

## Agregar un cliente y sus servidores

1. Menú con tu nombre > **Clientes y agentes** > escribe el nombre > **Crear cliente**.
2. **Descargar instalador**: es un solo `.exe` ya configurado con la dirección de NodeCat y la clave de ese cliente.
3. Cópialo a cada servidor del cliente y ábrelo con doble clic. Como no está firmado, Windows puede avisar: *Más información* > *Ejecutar de todas formas*.

En unos segundos el servidor aparece dentro de su cliente. Para muchos servidores a la vez (GPO o script): `NodeCat-Agente-CLIENTE.exe /silencioso`, o el **paquete .zip** con `NodeCatAgente.exe instalar /silencioso`.

- **Desinstalar:** Panel de control > Programas y características > **NodeCat Agente**. Quita el servicio, el proceso, los archivos y el registro; en NodeCat el servidor queda como *Agente desinstalado* (sin avisos de caída) hasta que lo quites de la lista.
- **Quitar un servidor del panel:** su agente se desinstala solo en ese servidor y no vuelve a aparecer. Si más adelante lo instalas otra vez, aparece de nuevo.
- **Moverlo a otro cliente o sede:** en la página del servidor > Editar > Cliente. El agente se pasa solo al cliente nuevo en su siguiente informe; no hay que reinstalarlo.
- **Reinstalar encima** sirve para actualizar: el instalador quita antes la versión anterior (y el antiguo *Atalaya Agente*, si lo hay).

El agente funciona en Windows Server 2012 R2 o superior (y Windows 10/11) con .NET Framework 4.5 o superior. Se instala como el servicio *NodeCat Agente*, con la cuenta del sistema, y envía un informe cada 30 segundos y al momento cuando alguien entra o sale. Si se queda sin conexión guarda hasta una hora de informes y los envía al volver. Si el servidor solo sale a Internet por un proxy, añade `"proxy": "http://proxy:8080"` en su `agente.json`.

## Actualizar el agente de Windows

Desde la versión 1.6.0 del agente, si NodeCat tiene una versión más nueva, el servidor muestra "⬆ agente" y en su ficha aparece **Actualizar a X** (o **Actualizar N agentes** en la página del cliente). El agente descarga el instalador de su cliente, comprueba su huella y se reinstala solo. Los agentes anteriores a la 1.6.0 hay que reinstalarlos una vez con el comando de PowerShell.

## Instalar el agente de Windows con PowerShell

En **Descargar agente → Windows** (o Hyper-V) está el comando para pegar en PowerShell como administrador:

```
irm https://TU-NODECAT/instalar/CLAVE.ps1 | iex
```

Muestra los pasos y la barra de descarga e instala el servicio. Es la forma recomendada: el `.exe` sin firmar suele disparar avisos en Chrome y en Windows.

## Notificaciones en el teléfono o la PC

En el menú de tu cuenta → **Notificaciones en este dispositivo** → **Activar**. Llegan aunque NodeCat esté cerrado, solo de los clientes que tu cuenta puede ver, y eliges de cuáles y de qué tipo. El administrador decide en **Cuentas de acceso** qué cuentas pueden recibirlas. Necesita HTTPS y que el servidor de NodeCat tenga salida a Internet (a los servicios de notificaciones de Google, Mozilla, Apple y Microsoft). En iPhone, primero instala NodeCat en la pantalla de inicio.

## En el teléfono

NodeCat se instala como app: en el iPhone, Safari → Compartir → **Añadir a la pantalla de inicio**; en Android, el navegador ofrece **Instalar**. El panel lo sugiere solo la primera vez (y está en el menú de la cuenta). Necesita HTTPS, como cuando lo publicas con Nginx Proxy Manager.

## Salud de los discos y licencia de Escritorio remoto

Desde el agente de Windows 1.7.0, la página de cada servidor físico muestra la **salud de sus discos** como CrystalDiskInfo: estado (bueno, precaución o malo), temperatura, horas y ciclos de encendido, sectores reasignados, pendientes e incorregibles, vida restante de los SSD y la tabla de atributos SMART. Lo lee con lo que trae Windows (`Get-PhysicalDisk`, contadores de fiabilidad y SMART por WMI), sin instalar nada. Las máquinas virtuales no tienen SMART, y los discos detrás de una controladora RAID por hardware no se ven desde Windows.

En los servidores con el rol de Host de sesión de Escritorio remoto muestra los **días que quedan del periodo de gracia** de 120 días, o si ya tiene servidor de licencias y modo configurados. Avisa a los 30, 14, 7, 3 y 1 días, y cuando vence.

## Proxmox VE, Hyper-V y Linux

En la página del cliente, **Descargar agente** tiene cuatro opciones:

- **Windows:** el instalador `.exe` de siempre.
- **Hyper-V:** el mismo agente de Windows. Si el servidor tiene el rol de Hyper-V lo detecta solo y muestra sus **máquinas virtuales** (encendidas o apagadas, CPU, memoria, disco y tiempo encendidas).
- **Linux:** un comando que se pega por SSH como root (`curl -fsSL https://NODECAT/instalar/CLAVE.sh | bash`). Instala un servicio de systemd que solo necesita Python 3. Muestra CPU, memoria, discos, red, temperatura y sesiones SSH.
- **Proxmox VE:** el mismo comando, en el host (no en las VM ni en los LXC). Usa la API local de Proxmox (`pvesh`), sin tokens, y muestra al estilo de ProxMenux:
  - **General:** CPU (usuario, sistema, núcleos, carga), memoria (usada, en caché, total), VM y LXC activos, temperatura, gráficos y red.
  - **Apps:** qué corre en cada VM y contenedor, con su dirección. La app se reconoce por el nombre o las etiquetas del CT (AdGuard, Nginx Proxy Manager, Home Assistant, Jellyfin, MikroDash y muchas más) y la URL se toma de las notas del CT si la escribes allí. Con el lápiz de cada tarjeta cambias el nombre, el enlace, la categoría y el logo, o la ocultas; con **Agregar app** sumas una a mano. Los logos de apps (SVG, PNG o WebP) se guardan en `datos/logos/apps/` y sirven para todos los servidores.
  - **VM y LXC:** tarjetas con estado, tipo, etiquetas, IP, CPU, memoria, disco, E/S de disco y de red, con buscador y filtro.
  - **Red:** tráfico de 24 h, interfaces, latencia a la puerta de enlace, gráfico por interfaz, topología animada y fichas de cada interfaz física, puente y de VM/LXC.
  - **Almacenamiento:** uso total, local y remoto; cada almacenamiento con su uso; y cada disco físico con su estado SMART, temperatura, ciclos, horas encendido y errores CRC (con `smartctl`, que viene con Proxmox).
  - **Backups:** última copia de cada VM y LXC (avisa de las que no tienen o tienen más de 7 días), trabajos programados y resultado de las últimas tareas.
  - **Nodo:** procesador, versión, kernel, carga, swap, actualizaciones pendientes y estado del clúster.

Todo es de solo lectura: el agente no puede encender, apagar ni cambiar nada. Desde la versión 1.1.0 el agente de Linux/Proxmox se actualiza solo cuando NodeCat tiene una versión nueva. Para quitarlo: `sudo nodecat-agente desinstalar`.

El agente consume poco. Lee la configuración de las VM y los CT de los archivos de `/etc/pve` (solo lectura) y usa `pvesh` solo para lo que no está ahí. Las lecturas lentas (apps, copias, nodo y SMART) se hacen en segundo plano cada pocos minutos, y solo envía lo que cambió. `smartctl` no despierta los discos dormidos.

Si el cliente tiene hipervisores y también servidores, la lista los muestra en dos grupos (**Hipervisores** y **Servidores y VM**), igual que las sedes.

## Logs de FortiGate

En **Editar → Logs** de cada FortiGate se activa **Guardar los logs en NodeCat**, con la retención (de 1 día a 1 año) y las categorías. NodeCat los lee cada 2 minutos (del disco del FortiGate o, si no tiene, de su memoria), los guarda sin duplicados y los borra solos al vencer. El perfil del token necesita `loggrp read` (ya viene en los comandos de ejemplo). Tráfico va apagado por defecto porque ocupa mucho.

En la página del FortiGate, **Registros** muestra lo importante y una tabla por categoría con búsqueda y filtros. Además NodeCat avisa por Telegram de lo que importa: ráfagas de accesos fallidos, administradores que entran desde una IP nueva, cuentas creadas o borradas, cambios de configuración, ataques, virus, túneles caídos, HA, reinicios y eventos críticos.

## Versiones nuevas de RouterOS y FortiOS

NodeCat avisa cuando hay una versión nueva para un equipo de red (chip azul, aviso en su página, gato en el escritorio y Telegram). Solo avisa: la actualización la haces tú.

- **MikroTik:** NodeCat pregunta cada 6 h a `upgrade.mikrotik.com` la última versión de la rama (6 o 7) y del canal del router (stable, long-term…). El servidor de NodeCat necesita salida a Internet por HTTPS.
- **FortiGate:** se lee lo que el FortiGate sabe por FortiGuard. Necesita que el equipo esté registrado y que el perfil del token tenga lectura de *System*.

## Agregar un router MikroTik

En la página del cliente: **Agregar router MikroTik**. NodeCat se conecta a la API del router y solo lee; no puede cambiar nada.

1. En la terminal del router, crea un usuario de solo lectura y activa la API (cambia la contraseña y la IP):
   ```
   /user group add name=nodecat policy=read,api,test,!write,!policy,!sensitive,!reboot,!ftp,!ssh,!telnet,!winbox,!web,!sniff,!romon
   /user add name=nodecat group=nodecat password=UNA-CLAVE-LARGA
   /ip service set api disabled=no address=IP-DE-NODECAT/32
   ```
2. **Si llegas al router por VPN o red interna**, usa la API normal (puerto 8728).
   **Si solo tiene IP pública**, usa API‑SSL (puerto 8729) y permite solo la IP pública de NodeCat:
   ```
   /certificate add name=api common-name=api days-valid=3650
   /certificate sign api
   /ip service set api-ssl disabled=no certificate=api address=TU-IP-PUBLICA/32
   ```
3. Escribe la IP, el usuario y la contraseña, pulsa **Probar conexión** y luego **Agregar router**.

Mientras miras la página de un router, NodeCat lo consulta cada 3 segundos; el resto del tiempo, cada 15. Guarda el tráfico de cada interfaz minuto a minuto y la contraseña cifrada en disco.

## Agregar un FortiGate

En la página del cliente: **Agregar FortiGate**. NodeCat usa la API REST con un token de un usuario de solo lectura.

1. En la CLI del FortiGate, crea el perfil y el usuario de API (cambia la IP por la de NodeCat):
   ```
   config system accprofile
       edit "nodecat-lectura"
           set secfabgrp read
           set ftviewgrp read
           set authgrp read
           set sysgrp read
           set netgrp read
           set loggrp read
           set fwgrp read
           set vpngrp read
           set utmgrp read
           set wifi read
       next
   end
   config system api-user
       edit "nodecat"
           set accprofile "nodecat-lectura"
           set vdom "root"
           config trusthost
               edit 1
                   set ipv4-trusthost IP-DE-NODECAT 255.255.255.255
               next
           end
       next
   end
   execute api-user generate-key nodecat
   ```
2. Copia el token que muestra el último comando (solo se ve una vez).
3. **Si llegas por VPN o red interna**, usa la IP interna del FortiGate. **Si solo tiene IP pública**, permite HTTPS de administración en la WAN únicamente desde la IP pública de NodeCat (y pon esa IP en el trusthost).
4. Escribe la IP, el puerto HTTPS (443 o el que uses para administrarlo) y el token, pulsa **Probar conexión** y luego **Agregar FortiGate**. Si el FortiGate usa el certificado de fábrica, deja sin marcar *Verificar el certificado*.

Si usas SD-WAN, NodeCat vigila cada enlace por separado y avisa por Telegram cuando uno cae. La latencia sale de las pruebas de SLA que ya tengas configuradas.

## Leer equipos de red sin VPN (sonda)

Si NodeCat no llega a la red del cliente, cualquier servidor de esa red con el agente de NodeCat (versión 1.2.0 o superior) puede hacer de sonda:

1. Al agregar o editar el MikroTik o el FortiGate, en **Cómo llega NodeCat** elige **Por SERVIDOR**.
2. Escribe la IP **interna** del equipo de red.
3. En el router o el FortiGate, permite la IP interna de ese servidor (en `address=` del servicio API o en el trusthost del usuario de API), en lugar de la de NodeCat.

El agente mantiene una conexión abierta hacia NodeCat, recibe las consultas, las hace en la red local y devuelve el resultado. Solo acepta comandos de lectura. Todo funciona igual que con una conexión directa (secciones, ping, traceroute, avisos); si la sonda se desconecta, el equipo se marca caído en segundos. La contraseña o el token viajan cifrados por HTTPS hasta el agente de ese cliente y no se guardan en el servidor.

## Sedes dentro de un cliente

Si un cliente tiene varias sedes, no hace falta crear un grupo ni subclientes: en **Editar** de cada servidor, MikroTik o FortiGate escribe su **Sede** (la primera vez se crea sola; después se elige de la lista). La página del cliente separa entonces sus equipos por sede y muestra botones para ver una sola sede. Un cliente sin sedes se ve como siempre. Todas las sedes usan el mismo instalador del cliente.

## Logos de los sistemas

Cada equipo muestra una insignia con las iniciales de su sistema. Para usar logos: menú con tu nombre > **Logos de los sistemas**.

- **Subir varios logos a la vez:** elige los archivos y NodeCat reconoce el sistema por el nombre (`Ubuntu-logo.png`, `proxmox_ve.svg`, `windows-server-2022.png`…), los renombra y los asigna solo.
- O en la fila de cada sistema: **Subir logo**, **Cambiar** o **Quitar**. Cada fila dice en cuántos equipos se usa.

Sirven SVG, PNG o WebP de hasta 512 KB. Se guardan en `datos/logos` y los SVG se sirven aislados, sin poder ejecutar código. Los sistemas sin logo siguen con iniciales.

## Verificación en dos pasos

Menú con tu nombre > **Verificación en dos pasos** > **Activar**. Escanea el código QR con cualquier aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy, 2FAS, Bitwarden…) y escribe el código de 6 cifras. NodeCat te da 8 **códigos de recuperación** de un solo uso por si pierdes el teléfono: guárdalos. Desde ese momento, al entrar te pide la contraseña y el código. Si alguien de tu equipo pierde el teléfono, un administrador puede quitarle la verificación en **Cuentas de acceso** para que la vuelva a activar.

## Compartir con un cliente (solo lectura)

En la página del cliente: **Compartir** > **Crear enlace**. El cliente abre el enlace sin cuenta y ve sus equipos: si están en línea, CPU, memoria, disco, tráfico de Internet, latencia, disponibilidad de 24 h y caídas de la última semana. Se actualiza sola.

- **No ve** sesiones ni usuarios, direcciones IP, configuración, DHCP, VPN, firewall, registros ni versiones, y no hay ningún botón que cambie algo ni acceso a los equipos. Esos datos ni siquiera salen del servidor.
- El enlace puede durar 1, 7, 30 o 90 días, o no vencer. Si el cliente es parte de un grupo, puedes incluir todas las sedes del grupo.
- En la misma ventana ves cuántas veces se abrió cada enlace y puedes **anularlo** en cualquier momento.
- El enlace solo se muestra al crearlo (NodeCat guarda una huella, no el enlace).

## Avisos por Telegram

Menú con tu nombre > **Notificaciones por Telegram**. Puedes decidir los umbrales (por ejemplo, CPU por encima del 90 % durante 5 minutos), recibir un resumen diario y recordar los avisos que sigan sin resolverse.

- **Bot general:** recibe todos los avisos, por ejemplo en tu grupo de soporte. Crea un bot con @BotFather, pega el token, escribe algo al bot, pulsa *Buscar chats* y elige el chat.
- **Bots por cliente o grupo:** para que cada cliente reciba solo lo suyo en su propio grupo de Telegram. Crea un bot por cliente (o por grupo de sedes), pulsa **Agregar un bot**, pega el token y marca a quién avisa. Luego añade el bot al grupo de Telegram del cliente: NodeCat lo detecta solo en menos de un minuto, saluda en el chat para confirmarlo y desde ahí envía las alertas y el resumen diario de esos clientes. Si asignas un grupo, las sedes que agregues después también quedan cubiertas. Si sacan al bot de un chat, NodeCat deja de usarlo.

## Probarlo sin servidores reales

```bash
docker run --rm -p 8080:8080 -e NODECAT_DEMO=1 $(docker build -q .)
```

Entra con `demo` / `nodecat-demo` (o `andes` / `nodecat-demo` para ver una cuenta limitada a un cliente). Sin Docker: `cd servidor && NODECAT_DEMO=1 node nodecat.js` con Node.js 22.

## Copias de seguridad

Todo está en la carpeta `datos/` junto a `docker-compose.yml`: la base de datos (`nodecat.db`) y la llave que cifra el token de Telegram, las contraseñas de los routers y los tokens de FortiGate (`secreto.key`). Copia esa carpeta y tendrás todo.

## Ajustes del contenedor

| Variable | Para qué | Por defecto |
|---|---|---|
| `TZ` | Zona horaria del resumen diario y de los avisos | `America/Caracas` |
| `CONFIAR_PROXY` | `1` detrás de Cloudflare Tunnel o un proxy inverso | `0` |
| `PUERTO` | Puerto interno | `8080` |
| `NODECAT_DEMO` | `1` para el modo demo | vacío |

## Cómo está hecho

- **Servidor:** Node.js 22 con SQLite integrado, sin ninguna dependencia de npm. Cliente propio de la API de RouterOS y de la API REST de FortiOS. Historial por minuto durante 7 días y cada 5 minutos durante 400 días.
- **Agente:** C# para .NET Framework 4.5, compilado con Mono (`agente/build.sh`). El ejecutable listo está en `servidor/agente/`.
- **Web:** HTML, CSS y JavaScript sin frameworks, con tema claro y oscuro y diseño adaptado al móvil.
- **Seguridad:** verificación en dos pasos (TOTP) opcional por cuenta, contraseñas con PBKDF2-SHA256, sesiones con cookie HttpOnly y protección CSRF, bloqueo tras 5 intentos fallidos, clave de agente distinta por cliente, y token de Telegram, contraseñas de MikroTik y tokens de FortiGate cifrados en disco.

## Próximas fases

- Informes mensuales por cliente en PDF y Excel.
