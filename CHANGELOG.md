# Cambios

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
