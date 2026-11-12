# Cambios

## 0.20.0 (noviembre de 2026)

- **Salud de los discos, como CrystalDiskInfo** (agente de Windows 1.7.0). En la página de cada servidor físico, una tarjeta por disco con su estado (**Bueno**, **Precaución** o **Malo**), temperatura, horas y ciclos de encendido, sectores reasignados, pendientes e incorregibles, errores CRC, vida restante de los SSD y la tabla de atributos SMART. Lo lee con lo que trae Windows, sin instalar nada, cada 10 minutos. Las VM muestran que sus discos son virtuales; los discos detrás de una controladora RAID por hardware aparecen sin datos.
- **Avisos de discos** por Telegram y en los dispositivos (tipo nuevo "Salud de los discos"): un disco pasa a Precaución o Malo, empeora (sube a Malo o aumentan los sectores reasignados o pendientes), o pasa más de 10 minutos muy caliente.
- **Licencia de Escritorio remoto (RDS).** En los servidores con el rol de Host de sesión, la ficha muestra los días que quedan del periodo de gracia de 120 días y la fecha en que vence, o "Licenciado" si ya tiene servidor de licencias y modo. En la lista aparece la etiqueta "RDS 9 d" cuando faltan 30 días o menos. Avisos a los 30, 14, 7, 3 y 1 días y al vencer (tipo nuevo "Licencia de Escritorio remoto"), y confirmación cuando queda licenciado.
- **Cuentas con acceso por equipo.** Dentro de cada cliente se puede dejar a una cuenta solo algunos equipos (servidores, VM, MikroTik, FortiGate), por ejemplo a un soportista externo. Lo demás del cliente no lo ve en el panel, en el historial ni en los sucesos, y las notificaciones en sus dispositivos siguen la misma regla.
- Los tipos de notificación nuevos llegan activados también a quien ya había guardado sus preferencias.
- Un administrador limitado a algunos clientes ya no puede editar ni quitar equipos de otros clientes.

## 0.19.1 (noviembre de 2026)

- El aviso de actualización (agente nuevo en servidores, RouterOS/FortiOS nuevo en MikroTik y FortiGate) pasa a ser una **flecha azul en la esquina del ícono**, a la izquierda. Antes iba como etiqueta al final del nombre y, con nombres largos, quedaba oculta. Al pasar el ratón por la flecha se ven la versión actual y la nueva.

## 0.19.0 (noviembre de 2026)

- **Actualizar el agente de Windows desde el panel.** Cuando un servidor tiene un agente más viejo que el que ofrece NodeCat, aparece "⬆ agente" en su fila, el botón **Actualizar a X** en su ficha y, en la página del cliente, **Actualizar N agentes**. Al pulsarlo, en su próximo informe (menos de un minuto) el agente descarga el instalador de su cliente desde NodeCat, comprueba su huella SHA-256 (la da el panel) y se reinstala solo, sin pedir nada en el servidor.
- Funciona desde el agente 1.6.0: los que tienen una versión anterior hay que reinstalarlos una última vez con el comando de PowerShell (el panel lo indica).
- `agente/build.sh` escribe `servidor/agente/NodeCatAgente.version`, que es la versión que NodeCat ofrece.

## 0.18.0 (noviembre de 2026)

- **Hyper-V, pestaña Red** (como la de Proxmox): tarjetas físicas, **conmutadores virtuales** (externo, interno o privado, con la IP del host en cada uno), adaptadores de cada VM con su IP y MAC, puerta de enlace, DNS, dominio, latencia y la topología animada. El agente la lee cada 5 minutos en segundo plano.
- **IP de las VM de Hyper-V** (las que informan los servicios de integración del invitado) en sus tarjetas y en el buscador.
- **Memoria de las VM de Hyper-V:** con memoria fija se muestra la asignada (Hyper-V no sabe cuánta usa por dentro), en vez de una barra al 100 %; con memoria dinámica, lo que pide la VM.
- **IP local de cada servidor** (Windows, Linux y Proxmox) en su ficha y al pasar el mouse por su fila, además de la IP desde la que conecta.
- Agente de Windows 1.5.2 y agente de Linux/Proxmox 1.2.1 (este se actualiza solo).

## 0.17.3 (noviembre de 2026)

- Aviso cuando una **VM o un contenedor LXC** de un hipervisor (Proxmox o Hyper-V) que estaba encendido se apaga, pasado el tiempo elegido (2 min por defecto, para no avisar de un simple reinicio), y otro cuando vuelve a encenderse con cuánto estuvo apagado. Las VM que siempre están apagadas no avisan. Por Telegram y en los dispositivos (tipo "Máquinas virtuales que se apagan"); regla nueva en las notificaciones.

## 0.17.2 (noviembre de 2026)

- Aviso de **equipo nuevo**: por Telegram y en los dispositivos, cuando un agente se instala por primera vez en un cliente, cuando se agrega un MikroTik o FortiGate, o cuando se reinstala un agente que se había quitado. Dice el equipo, el cliente, el sistema y desde qué IP. Se puede apagar (regla nueva en las notificaciones y tipo "Equipos nuevos o reinstalados" en los dispositivos).

## 0.17.1 (noviembre de 2026)

- Los hipervisores llevan una etiqueta (Hyper-V o Proxmox) junto al nombre, y su línea empieza por las VM encendidas.
- El grupo **Hipervisores** aparece también cuando el cliente solo tiene hipervisores (antes solo si además tenía otros servidores).

## 0.17.0 (noviembre de 2026)

- **Notificaciones en el teléfono o la PC** (Web Push), aunque NodeCat esté cerrado. Se activan en el menú de la cuenta → **Notificaciones en este dispositivo**. Al tocarlas se abre el equipo del problema.
- Cada cuenta recibe solo los avisos de los clientes que puede ver (un administrador limitado a ciertos clientes, solo de esos). Además, cada persona elige de qué clientes y de qué tipo: equipos que no responden; CPU, memoria y disco; enlaces WAN; seguridad de FortiGate; versiones nuevas.
- En **Cuentas de acceso**, el administrador decide qué cuentas pueden recibirlas y ve cuántos dispositivos tiene activados cada una.
- Funcionan aunque Telegram esté apagado; usan las mismas reglas y umbrales. En iPhone hace falta instalar NodeCat en la pantalla de inicio (iOS 16.4 o más nuevo). Sin servicios de terceros ni dependencias: cifrado y firma propios (RFC 8291 y 8292).

## 0.16.2 (noviembre de 2026)

- Sonda: el panel espera más a la respuesta (la conexión y la lectura en el agente pueden sumar) y, si no llega, dice si la orden no llegó al agente o si llegó y no hubo resultado. Queda anotado en el registro de NodeCat.
- Agente de Windows 1.5.1: el diagnóstico `NodeCatAgente.exe sonda` muestra cada lectura que hace (equipo, ruta, resultado y cuánto tardó).

## 0.16.1 (noviembre de 2026)

- Sesiones: al pulsar CPU, Memoria o Inactiva se ordena primero de mayor a menor, como en el Administrador de tareas (otro clic invierte el orden).

## 0.16.0 (noviembre de 2026)

- Sesiones por cliente: dentro de un cliente (en su página o en uno de sus equipos), **Sesiones** del menú de arriba muestra solo las de ese cliente, con su número, en `#/c/ID/sesiones`. Desde la pantalla principal sigue mostrando todas. Botón "Ver las de todos los clientes" para salir del filtro.
- En la página del cliente, el texto de sesiones activas y desconectadas lleva a esas sesiones.

## 0.15.1 (noviembre de 2026)

- La tabla de sesiones ya no se corta a la derecha: el servidor y el cliente van en la misma columna, y los programas que más usa cada sesión se acomodan en filas.
- Buscador en las sesiones de cada servidor (persona, dominio, equipo desde el que se conecta o programa). El buscador de la página Sesiones ahora también encuentra por programa.

## 0.15.0 (noviembre de 2026)

- CPU y memoria de cada sesión de Escritorio remoto, con los programas que más usa cada una (agrupados: "chrome ×9"). Columnas nuevas, ordenables, en las sesiones del servidor y en la página Sesiones. El agente lo calcula una vez por informe recorriendo los procesos (la CPU, por diferencia con el informe anterior), así que casi no consume.
- Agente de Windows 1.5.0. Para verlo hay que reinstalar el agente (con el comando de PowerShell es un paso).

## 0.14.0 (noviembre de 2026)

Revisión de consumo de recursos. No cambia ninguna función y todo sigue siendo de solo lectura en los equipos. Medido en modo demo con 21 equipos:

- **Menos tráfico entre el panel y el navegador.** Las respuestas y los archivos de la web van comprimidos con gzip: `/api/estado` pasa de 81 KB a 12 KB y `app.js` de 149 KB a 41 KB. La página de un router ya no pide el estado dos veces ni se repinta dos veces cada 3 s, y la serie en vivo solo trae los puntos nuevos. Resumen: de 972 a 171 KB por minuto; página de un router: de 2,7 MB a 0,3 MB por minuto.
- **Menos escrituras en el disco** (de 1,4 MB a 0,4 MB por minuto). El último informe de cada equipo se guarda en la base como mucho cada minuto, y siempre al detener NodeCat; hasta ahora un router se reescribía en cada lectura (cada 3 a 15 s). Las sesiones solo se actualizan cuando cambian. Sucesos, métricas y tráfico se siguen guardando al momento.
- **Base de datos más pequeña y rápida.** Métricas y tráfico pasan a tablas agrupadas por equipo y hora (un 45 % menos de disco). El mantenimiento de cada hora ya no recorre las tablas enteras: con 3,8 millones de filas de tráfico, de 1,4 s a 5 ms, y los gráficos de 30 días de 38 a 6 ms. La base se compacta sola (`auto_vacuum` incremental) y el WAL no pasa de 32 MB.
- **Logs de FortiGate:** el log original se guarda comprimido (más o menos la mitad de espacio) y en cada lectura ya no se procesan otra vez los registros que ya estaban guardados.
- **Agente de Linux/Proxmox 1.2.0** (se actualiza solo):
  - Lee la configuración de las VM y los CT del archivo de `/etc/pve` en lugar de lanzar `pvesh` por cada una, y las IP de los CT con `lxc-info`. Si algo falla, usa `pvesh` como antes.
  - Pregunta `pveversion` cada hora.
  - Solo envía las partes de Proxmox que cambiaron (apps, copias, nodo, red), y todas cada 15 min.
  - `smartctl` ya no despierta los discos dormidos: mientras duermen, se muestran sus últimos datos.
  - Las IP que da el agente invitado de una VM se preguntan cada 10 min, o enseguida si la VM se reinicia.
- El enlace compartido deja de consultar mientras su pestaña está oculta. Al volver a una pestaña, el panel se pone al día enseguida.
- Demo: el Proxmox de ejemplo vuelve a informar después de reiniciar el contenedor.

**Al actualizar:** el primer arranque reorganiza las tablas de métricas y tráfico y compacta la base, una sola vez. Tarda de unos segundos a un par de minutos según el tamaño (unos 9 s con 3,8 millones de filas) y necesita espacio libre en el disco más o menos igual al tamaño de la base. Si no hay espacio, NodeCat sigue como antes y lo intenta en el siguiente arranque. Haz copia de la carpeta `datos/` antes, como siempre.

## 0.13.2 (noviembre de 2026)

- Instalador de PowerShell: si ya hay un agente, lo detiene, cierra su proceso y borra el servicio antes de instalar, esperando a que Windows lo quite del todo. Si algo lo tiene abierto (Servicios, Visor de eventos, Administrador de tareas), lo cierra. Así ya no aparece "ya existe un servicio con ese nombre" ni hace falta reiniciar.

## 0.13.1 (noviembre de 2026)

- Agente de Windows instalable con un comando de PowerShell (`irm URL/instalar/CLAVE.ps1 | iex`), desde la misma ventana de **Descargar agente → Windows / Hyper-V**. Muestra cada paso: permisos (si no es administrador, se abre solo con permisos), requisitos, descarga con barra de progreso, instalación del servicio y verificación. Como no pasa por el navegador, no aparece el aviso de "archivo sospechoso" de Chrome ni el de SmartScreen.

## 0.13.0 (noviembre de 2026)

- Logs de FortiGate guardados en NodeCat. Al agregar o editar un FortiGate se activa **Guardar los logs**, se elige la retención (1 día a 1 año) y las categorías (Sistema, VPN, Usuarios, Red/SD-WAN/HA, Seguridad y, opcional, Tráfico). Se leen cada 2 minutos por la API (disco o memoria, solo lectura, también vía sonda), sin duplicados, y se borran solos al vencer.
- Nueva sección **Registros** en la página del FortiGate: "Lo importante" (contadores, línea de tiempo con ráfagas agrupadas, IP y usuarios con más accesos fallidos, ataques más frecuentes) y una tabla por categoría con búsqueda, filtros por periodo, nivel y acción, y el detalle completo de cada registro.
- "El soplón": avisos por Telegram y en Últimos sucesos cuando pasa algo importante: 5 o más accesos fallidos en 10 minutos (al FortiGate o a la VPN), un administrador que entra desde una IP nueva, cuentas o administradores creados, cambiados o borrados, cambios de configuración, ataques IPS, virus, túneles caídos, cambios de HA, reinicios o actualizaciones, modo conserve y eventos críticos. Se puede apagar en las notificaciones.

## 0.12.0 (noviembre de 2026)

- Aviso de versiones nuevas de RouterOS y FortiOS. MikroTik: NodeCat consulta cada 6 h el mismo servidor que usan los routers (upgrade.mikrotik.com) según la rama y el canal de cada uno. FortiGate: lo que el equipo sabe por FortiGuard (`monitor/system/firmware`), con la última de su misma rama y la más nueva de todas.
- Se muestra como chip azul informativo (no pone al cliente en amarillo), en la fila del equipo, en un aviso en su página con el enlace a las notas, con el gato en el escritorio y por Telegram (un mensaje por versión, sin recordatorios; y otro cuando el equipo ya está actualizado). Se puede apagar en las notificaciones.
- NodeCat no actualiza nada: solo avisa.

## 0.11.1 (noviembre de 2026)

- NodeCat se puede instalar en el teléfono como app (acceso directo en la pantalla de inicio, a pantalla completa, con su icono). En iPhone aparece una hoja con los pasos de Safari; en Android, el botón Instalar. Se puede posponer o no volver a mostrar, y queda en el menú de la cuenta como "Instalar en este teléfono".

## 0.11.0 (noviembre de 2026)

- Proxmox, pestaña Apps: cada app se puede editar desde el panel (nombre, enlace, categoría y logo), ocultar o agregar a mano. Los logos de apps se suben una vez y sirven para todos los servidores. Nada de esto toca Proxmox.
- Proxmox, pestaña Red nueva: tráfico de 24 h, interfaces activas, estado de la red, latencia a la puerta de enlace, gráfico por interfaz, topología animada (tarjetas → host → puentes → VM y LXC) y fichas de cada interfaz física, puente y de invitado.
- Proxmox, pestaña VM y LXC rediseñada en tarjetas: estado, tipo, etiquetas, IP, CPU, memoria, disco y E/S de disco y red, con buscador y filtro En ejecución / Detenido.
- Proxmox, pestaña Almacenamiento rediseñada: uso total, local y remoto, discos físicos y temperatura, fichas por almacenamiento y estado SMART por disco (temperatura, ciclos, horas encendido, errores CRC).
- En la página del cliente (y en la compartida), los hipervisores van separados de los servidores y VM, igual que las sedes.
- Agente de Linux/Proxmox 1.1.0: se actualiza solo cuando el panel tiene una versión nueva, lee la red del host y SMART, y ya no toma como enlace de una app la página de community-scripts que viene en las notas.

## 0.10.0 (noviembre de 2026)

- Verificación en dos pasos con aplicación de autenticación (código QR) y códigos de recuperación; el administrador puede quitarla a otra cuenta.
- Cada equipo muestra una insignia de su sistema (Proxmox, Windows Server, Hyper-V, Ubuntu, Debian, Rocky, MikroTik, FortiGate…) con el punto de estado en la esquina.

## 0.9.0 (noviembre de 2026)

- Proxmox VE: agente para el host con una línea, al estilo de ProxMenux: General, Apps (qué corre en cada VM/LXC y su dirección), VM y LXC, Almacenamiento (con salud SMART), Backups y Nodo. Solo lectura, con la API local (sin tokens).
- Hyper-V: el agente de Windows 1.4 detecta el rol y muestra las máquinas virtuales.
- Linux: el mismo agente, para cualquier servidor con systemd.
- Botón "Descargar agente" con submenú: Windows, Hyper-V, Linux y Proxmox VE.

## 0.8.0 (noviembre de 2026)

- Sedes dentro de un cliente: campo opcional en cada equipo; la página del cliente los agrupa por sede y permite filtrar. Sin sedes, se ve como antes. La página compartida también los agrupa.
- Horas en formato de 12 horas con segundos y reloj en la barra superior.
- Menú "Enlaces compartidos" con todos los enlaces de todos los clientes.

- Compartir con un cliente: enlace de solo lectura, sin cuenta, con el estado de sus equipos (o de todas las sedes de su grupo). Sin sesiones, IP, configuración ni acceso a los equipos. Con vencimiento, contador de visitas y botón para anularlo.
- "Agregar servidores" dentro de un cliente muestra solo el instalador y la clave de ese cliente; crear clientes y grupos queda en la página principal.

## 0.7.0 (noviembre de 2026)

- Instalador de un solo `.exe` por cliente, con la configuración dentro: doble clic e instalado.
- Agente 1.3.0: aparece en Panel de control > Programas y se desinstala desde ahí sin dejar servicio, proceso ni archivos. Al reinstalar quita bien la versión anterior (y el antiguo Atalaya Agente); se acabó el error "No se pudo crear el servicio".
- Quitar un servidor del panel desinstala su agente en el servidor; ya no vuelve a aparecer solo.
- Mover un servidor a otro cliente o sede: su agente se pasa solo al cliente nuevo.
- Servidores con el agente desinstalado se muestran como tal y no generan avisos de caída.
- Telegram: varios bots, cada uno asignado a clientes o grupos. NodeCat detecta solo los grupos de Telegram donde está cada bot y envía por ahí las alertas y el resumen de esos clientes.

## 0.6.0 (noviembre de 2026)

- Sonda: un servidor del cliente con el agente de NodeCat puede leer sus MikroTik y FortiGate y pasárselos a NodeCat. No hace falta VPN ni abrir puertos en el cliente; todo sale del agente hacia NodeCat.
- Al agregar o editar un MikroTik o un FortiGate se elige cómo llega NodeCat: directo o a través de un servidor del cliente.
- Agente 1.2.0: hace de sonda cuando NodeCat se lo pide, solo con comandos de lectura. Nuevo comando `NodeCatAgente.exe sonda` para verla en primer plano.
- Si la sonda se desconecta, el equipo de red se marca caído en segundos y vuelve en cuanto la sonda se reconecta.

## 0.5.0 (noviembre de 2026)

- FortiGate en solo lectura, por la API REST con un token: CPU, memoria, sesiones, temperatura y tráfico en vivo.
- Menú propio del FortiGate: SD-WAN con la latencia, el jitter y la pérdida de cada SLA, túneles IPsec, SSL-VPN, políticas con sus usos, rutas, DHCP, licencias FortiGuard, alta disponibilidad, usuarios autenticados y registro de eventos.
- Varios enlaces WAN por equipo: cada enlace SD-WAN tiene sus propios sucesos y avisos por Telegram.
- La sección del cliente "Red" junta MikroTik y FortiGate.

## 0.4.0 (noviembre de 2026)

- Nombre y marca definitivos: **NodeCat**, con la luz de estado sobre la "d".
- Al actualizar desde una versión anterior, usa `docker compose up -d --build --remove-orphans`; los datos y los agentes instalados se conservan.

## 0.3.1 (noviembre de 2026)

- Grupos de clientes: junta las sedes de una misma empresa. El resumen las muestra juntas.
- Las cuentas se pueden limitar a grupos: ven todas sus sedes, también las que se agreguen después.

## 0.3.0 (noviembre de 2026)

- Página del router con menú lateral por grupos, como MikroDash, y más de 30 secciones de solo lectura: red, inalámbrico, servicios IP, túneles, tráfico, seguridad, sistema y herramientas.
- Ping y traceroute lanzados desde el router.
- Conexiones agrupadas por destino y por equipo.
- Ancho de banda en vivo de todas las interfaces.
- Caídas y sucesos de cada router, con fecha, hora y duración; se llega desde el resumen.
- Latencia y pérdida de paquetes a Cloudflare, Google, la puerta de enlace y un destino opcional.
- Wi‑Fi agrupado por red. El gato avisa en un bocadillo y dice los errores. Las caídas de router se detectan en segundos.

## 0.2.1 (noviembre de 2026)

- Nuevo logo y mascota: el gato de NodeCat. Repara el servidor, corre al cargar, programa en las listas vacías, se impacienta si algo tarda y se avergüenza con los errores.
- Icono nuevo para la pestaña del navegador y para el agente.
- Los sucesos de enlace WAN caído y recuperado se muestran con su texto.

## 0.2.0 (noviembre de 2026)

Fase 2: routers MikroTik.

- Routers MikroTik por cliente, en solo lectura, por la API de RouterOS (8728, o 8729 con SSL). RouterOS 6 y 7.
- Página del router al estilo MikroDash, siempre en oscuro: tráfico en vivo cada 3 segundos, interfaces, CPU, memoria, temperatura, conexiones, DHCP, Wi‑Fi, WireGuard, PPP e IPsec, firewall y registro.
- Historial de tráfico por interfaz (minuto a minuto 7 días, cada 5 minutos 400 días) y de CPU y memoria.
- Avisos de router caído y de enlace WAN caído; los routers aparecen en el resumen y en la página de cada cliente.
- Contraseñas de los routers cifradas en disco. Detrás de Nginx Proxy Manager o Cloudflare se toma bien la IP real.
- Modo demo con cinco routers simulados.

## 0.1.0 (noviembre de 2026)

Primera versión: fase 1.

- Clientes con su propio agente y su propia clave. Los servidores aparecen solos dentro de su cliente.
- Resumen de todos los clientes, página de cada cliente y de cada servidor, sesiones en vivo e historial exportable a Excel.
- Gráficos de CPU y memoria de 1 hora a 30 días, discos, disponibilidad y caídas.
- Avisos por Telegram con chats adicionales por cliente y resumen diario.
- Cuentas de administrador y de solo lectura, limitables a algunos clientes.
- Primera configuración con un código de un solo uso que aparece en el registro del contenedor.
- Agente NodeCat 1.1.0: HTTPS con TLS 1.2, proxy opcional, informes atrasados que completan el historial.
- Docker y docker-compose, con Cloudflare Tunnel opcional. Modo demo.
