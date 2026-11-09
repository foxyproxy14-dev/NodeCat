# Cambios

## 0.4.0 (noviembre de 2026)

- Atalaya pasa a llamarse **NodeCat**. La base de datos se renombra sola al actualizar y los agentes ya instalados siguen funcionando (Atalaya Agente); los nuevos se instalan como NodeCat Agente.
- La primera vez, actualiza con `docker compose up -d --build --remove-orphans` (cambia el nombre del contenedor).

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

- Nuevo logo y mascota: el gato de Atalaya. Repara el servidor, corre al cargar, programa en las listas vacías, se impacienta si algo tarda y se avergüenza con los errores.
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
- Agente Atalaya 1.1.0: HTTPS con TLS 1.2, proxy opcional, informes atrasados que completan el historial.
- Docker y docker-compose, con Cloudflare Tunnel opcional. Modo demo.
