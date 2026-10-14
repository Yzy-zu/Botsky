# Phase 4 hosted-media extraction design

Estado: **diseño, no implementación ni autorización de activación**. Wave A sigue abierta. Este documento separa el lector web acotado que ya existe de la extracción de medios de sitios que todavía usa `yt-dlp` en legacy. No acredita paridad de esos flujos.

## Inventario de paridad actual

| Flujo legacy | Comportamiento legacy | V2 actual | Brecha restante |
|---|---|---|---|
| `leer URL` | No tiene extracción web comparable. | Lee una respuesta HTML/XHTML/texto; limita bytes, tiempo y redirects, fija la IP pública validada, elimina scripts/estilos y no sigue recursos o enlaces. | No interpreta scripts, páginas que requieren sesión, metadata de video ni audio/video embebido. |
| `convertir URL` | `src/commands/convertir.js` llama `yt-dlp` con `--no-playlist` para audio/video de sitios con extractor; después usa FFmpeg. | Descarga URLs directas con el downloader acotado y procesa el archivo local. | URLs de páginas de sitios, playlists y extractores de `yt-dlp` no están soportadas. |
| `transcribir URL` | `src/commands/transcribir.js` extrae audio con `yt-dlp` y después llama al proveedor de transcripción. | Acepta una URL directa de audio admitida por MIME/tipo. | Extracción de audio desde páginas de sitios no está soportada. |
| `info URL` | `src/commands/info.js` usa `yt-dlp --dump-json --no-playlist`, presenta duración, canal, fecha, vistas, formatos y descripción. | No hay comando v2 `info` ni puerto de metadata de extractores. | Todo el contrato de metadata de sitios está pendiente. |
| `descargar` / búsqueda | `src/commands/descargar.js` ofrece búsqueda, selección persistente, descarga con `yt-dlp`, varios formatos/sitios y rutas adicionales. | No hay feature v2 `descargar`; existe `mediaSearch` legacy separado y no incorporado al canario. | Búsqueda, sesión de selección, descarga desde sitio y los flujos específicos siguen en legacy. |

El acceso directo a un archivo continúa disponible mediante `createUrlDownload`; su DNS público, conexión fijada, redirect limit, deadline, límite de stream y allowlist de MIME son la frontera adecuada para URLs directas. El lector de página `createWebContent` solo cubre texto estático. No se debe describir ninguno de esos dos comportamientos como soporte de `yt-dlp`.

## Por qué `--proxy` no constituye aislamiento

`yt-dlp --proxy` configura el tráfico que controla el propio extractor. No demuestra que todos los sockets de Python, FFmpeg, descargadores HLS/DASH, resoluciones DNS, conexiones de segmentos ni helpers usen ese proxy. La opción tampoco fuerza al proceso a rechazar una conexión directa si un extractor o helper omite la configuración. TLS `CONNECT` deja al proxy sin visibilidad de redirects dentro del túnel; sí puede volver a validar cada nuevo `CONNECT`, siempre que no exista una ruta de salida alternativa.

No usar MITM TLS como atajo: requiere distribuir una CA al contenedor, cambia la confianza TLS y expone credenciales/cookies si se agregan después. El diseño no necesita cookies ni login; su ausencia es una condición del port inicial.

## Arquitectura propuesta

Separar tres operaciones y contratos. La aplicación valida la solicitud y crea una carpeta de trabajo vacía con permisos privados. Un supervisor pasa solo un JSON limitado por stdin y recibe JSON estructurado por stdout; nunca construye un comando de shell ni acepta rutas, opciones o proxies del usuario.

1. **Descarga directa y conversión local** sigue con el downloader SSRF-safe existente. El worker de conversión, si se aísla después, recibe un único archivo de entrada montado como solo lectura y opera con `--network none`. Este es el límite mínimo seguro: procesamiento multimedia de bytes ya obtenidos, sin extracción de sitios.
2. **Metadata de sitio** puede incorporarse primero como operación de red aislada que exige `--skip-download`, `--no-playlist`, una sola URL admitida y una respuesta JSON validada por esquema. No produce audio/video y no basta con reconocer `extractor_key`; la URL y todos los destinos siguen sujetos a política de egreso.
3. **Audio/video de sitio** usa un worker separado, con salida temporal y límites independientes. Solo aceptar extractores y hosts aprobados, `--no-playlist`, una salida, duración/bytes acotados, perfiles de formato cerrados y metadata mínima. El worker no recibe cookies, encabezados del usuario, claves, entorno de la aplicación, configuración de Evolution ni montajes del host.

### Worker

- Imagen de worker mínima, reproducible, fijada por digest y con versiones explícitas de `yt-dlp`, Python, FFmpeg y dependencias. Actualizar el extractor es un cambio revisable con su matriz offline; no descargar o actualizar binarios al iniciar.
- UID no-root dedicado; rootfs solo lectura; `--cap-drop ALL`; `no-new-privileges`; seccomp y AppArmor; PID, CPU, memoria y tiempo limitados; sin socket Docker, home del host, secretos, dispositivos ni mounts generales.
- Montar solo `/input` read-only y un `/output` temporal dedicado. `/output` debe ser tmpfs con tamaño máximo o una carpeta host privada montada con cuota. El template de salida lo fija el supervisor (nombre fijo/ID, sin título del sitio); al terminar, verificar con `lstat`/`realpath`, extensión permitida, MIME/firma, tamaño y cantidad. Rechazar symlinks, auxiliares, playlists, archivos adicionales y rutas fuera del mount. Limpiar todo en éxito, error, abort y timeout.
- El supervisor mata el grupo completo al cancelar o alcanzar deadline; no se permite reintento automático que duplique descarga o entrega. stdout/stderr se limitan y se descartan o reducen a códigos cerrados; no registrar URL completa, query privada, encabezados, rutas temporales ni salida diagnóstica del extractor.

### Dos perfiles de red, sin modo ambiguo

**Perfil offline (`network none`).** Es el perfil recomendado por defecto y el único perfil utilizable sin política de egreso. Sirve para probar el aislamiento y para conversiones de archivos previamente descargados por el downloader público. No puede leer una página ni ejecutar un extractor que requiera internet; un fallo de red se informa como no disponible, nunca se intenta una ruta host alternativa.

**Perfil de extracción con proxy obligatorio (futuro, bloqueado hasta diseño/validación operativa).** Un worker aislado solo comparte una red interna con un proxy dedicado. Un filtro de red en su namespace permite salida únicamente a la IP/puerto del proxy; deniega DNS directo, UDP, gateway/host y cualquier conexión directa a Internet. Una red Docker `bridge` por sí sola no aplica esa regla. La interfaz proxy recibe nombres de host, valida protocolo/puerto, resuelve cada host en cada conexión, rechaza toda respuesta especial/privada/reservada (incluye loopback, link-local, metadata, CGNAT, ULA e IPv4-mapped IPv6), fija el socket a una dirección pública y vuelve a hacer todo esto para cada redirect/conexión.

El proxy solo admite HTTP 80 y HTTPS 443; sin `CONNECT` a puertos arbitrarios, sin credenciales y con lista de dominios por extractor revisada (coincidencia de etiqueta DNS completa, no `endsWith` ingenuo). Un túnel HTTPS conserva validación TLS del cliente. Si un sitio requiere dominios CDN/API nuevos, se agrega explícitamente y se prueba; los fallos por dominio no permitido quedan cerrados. El proxy también limita bytes, sockets, duración, redirects y concurrencia por trabajo. El namespace del worker no puede alcanzar el proxy alternativo, DNS local u otro contenedor. El namespace del proxy no alcanza redes privadas del host ni servicios de metadata; el proxy no se convierte en relay abierto.

Antes de implementar este perfil se necesita demostrar las reglas efectivas de nftables/iptables y el orden de interfaces del Docker daemon, incluida la ruta de forwarding/NAT. La presencia de una red Docker llamada `none` solo confirma aislamiento total sin egress; no demuestra que el perfil de proxy sea obligatorio.

## Límite del port inicial

- Aceptar solo URL HTTP(S) sin usuario/contraseña, con parser/canonicalización central y esquema/host permitido antes de invocar el worker. Rechazar playlists salvo decisión separada; el port inicial conserva `--no-playlist` y máximo un elemento.
- Empezar con una lista pequeña de extractores públicos aprobados por el producto. No habilitar “cualquier extractor soportado por yt-dlp”, sitios con autenticación, búsqueda web, cookies o proveedores con contenido restringido. Sitios adultos y rutas de búsqueda específicas de legacy quedan fuera de esta entrega hasta revisión de producto y política.
- `info`: una respuesta metadata de tamaño acotado y schema cerrada; title/uploader/description recortados, duration numérica finita, formats únicos cerrados. Sin descripción HTML, URL arbitraria de thumbnail ni campos sin validar. No afirmar disponibilidad del media solo porque existe metadata.
- `convertir`/`transcribir`: aceptar el resultado extraído por referencia a un archivo temporal verificado, jamás por URL interna emitida por el extractor. El control de salida debe distinguir audio/video y no permitir playlist o múltiples archivos.
- `descargar`: portar por separado búsqueda y selección (TTL, owner/chat, expiración, consumo una sola vez); la selección debe volver a validar dominio/ID y ejecutar una sola descarga. Mantener la paridad de respuesta/destino y límites del legado identificada en traceabilidad. No abrir sesión compartida entre chats ni usar thumbnails hasta que su descarga use el downloader SSRF-safe.
- Dejar claro al usuario cuándo solo se admiten archivos directos y dar un camino soportado. No fingir éxito, responder con metadata parcial como si fuera archivo ni llamar al legacy como fallback silencioso.

## Pruebas y evidencia que desbloquean implementación

Las pruebas unitarias nunca usan internet ni proveedores reales. Inyectar reloj, resolver, proxy/transport y runner del worker. Verificar:

- esquemas, host exacto/sufijos permitidos, URL credentialed/invalid/IDNA/puerto, redirects en cadena y downgrade;
- DNS rebinding, múltiples respuestas con una IP privada, IPv4/IPv6 especial y mapped IPv4; pin del socket a la dirección resuelta en cada salto;
- worker sin salida directa: conexiones directas TCP/UDP/DNS deben fallar; solo el proxy fake asignado es alcanzable; red `none` no puede resolver ni conectar;
- redirects HTTPS cuyo destino se conoce solo al reabrir el túnel, denegación al siguiente `CONNECT`, y rechazo de CONNECT a IP/puerto no permitido; no basar el control en una bandera `--proxy` o en variables de entorno;
- respuesta MIME engañosa, bytes/chunks mayores al cap, duración y tamaño de metadata, playlists/múltiples archivos, filenames path traversal, symlinks, salida fuera de mount, timeout, abort y limpieza del grupo/workdir;
- JSON/stdout/stderr con URL, credenciales simuladas o rutas no se filtran a logs/respuestas; error produce un único mensaje útil, cero entrega y cero fallback legacy;
- conversiones offline de fixtures sintéticos bajo `network none` y verificación independiente de salida. Para extractor metadata, fixtures con respuestas simuladas versionadas, sin validar un sitio real en CI.

Antes de canary: revisión de imagen/digest y política de red, prueba de firewall en namespace desechable sin salida pública, evidencia de que el worker no puede contactar IP privada/metadata, comparación legacy por caso permitido con fixtures, límites definidos por configuración, observabilidad redacted y rollback a legacy de dueño único. Mantener explícitamente Wave A abierta; esto no autoriza activación.

## Capacidades locales verificadas (solo lectura)

Comprobaciones ejecutadas el 2026-10-14 en el worktree local, sin iniciar contenedores, instalar software ni hacer conexiones externas:

- Docker CLI y daemon disponibles: servidor `29.9.0`, cgroups v2; Docker reporta perfiles AppArmor y seccomp activos. Está el driver Docker `null` (`--network none`) y bridges ordinarios. No se demostró una red con egress exclusivamente proxy ni se inspeccionaron reglas/firewall del host.
- `yt-dlp` `2026.08.19`, FFmpeg `8.0.1`, Bubblewrap `0.11.1`, `unshare`, `nft` e `iptables` están instalados. La prueba de namespace de red/read-only con Bubblewrap terminó correctamente; `unshare -Ur true` falló, por lo que user namespaces sin privilegios no se consideran disponibles.
- La presencia de herramientas no demuestra que la imagen del worker exista, que el daemon tenga `userns-remap`, ni que el proxy/firewall esté configurado. No se listaron imágenes, volúmenes, secretos o reglas. No se intentó levantar el sidecar.

Ruta viable hoy: conservar `createUrlDownload` para obtener archivos directos con DNS pinning y convertir/transcribir bytes locales. Un contenedor `network none` puede hacer la etapa local de FFmpeg si se porta más adelante; no ejecuta extracción de sitios. La vía proxy no está lista para probar ni activar hasta diseñar y verificar el control de egreso descrito arriba.

## Revisión focal del selector canario

Se revisaron y ejecutaron `tests/unit/refactor/phase4CanaryRuntime.test.js`, `tests/unit/v2/pipeline/canary-router-contract.test.js`, `tests/unit/v2/features/phase4-ola-a.test.js`, `tests/unit/v2/adapters/urlDownload.test.js` y `tests/unit/v2/adapters/webContent.test.js`: **25/25 pasan**, sin tráfico externo.

- El contrato del router prueba comandos sin prefijo (`qr hola`) y con `Botsky`/`Botsito`, sin llamar al modelo; también comprueba conservar una frase literal de voz de 20.000 caracteres.
- El selector prueba que un chat privado seleccionado puede ser dueño de `Botsky crea un QR hola`, un chat privado no seleccionado y grupos quedan en legacy, QR leído/citado y media sin caption no se reclaman, errores no se repiten en v1, y el texto `Botsky qr minecraft --to otro-chat` entra al pipeline como QR literal.
- Los límites están en otro nivel: handler/adapter recortan OCR/QR a 8 KiB con aviso y conservan caracteres Unicode. El contrato adicional [canaryLiteralQr.test.js](../../tests/contract/canaryLiteralQr.test.js) ahora atraviesa selector, aplicación, pipeline y composer reales con puertos falsos: conserva íntegros los payloads de `qr hola` y `Botsky qr minecraft --to otro-chat`, entrega únicamente al chat seleccionado y no llama a IA. Otros chats, grupos y `fromMe` no entran al pipeline. Esto cierra la brecha de composición offline; no acredita entrega humana.
- La política general no requiere mención textual en un privado elegido: la dirección se deriva del chat privado configurado. Los grupos se rechazan en la inicialización del canario y nunca entran a esta política. Un `fromMe` lo excluye `createCanaryOwner`. Mantener el contrato de composición y el rechazo de grupos/otros chats/`fromMe` al ampliar el canario.

No se modificaron source del canario, composición, `plan.md` ni configuración de Docker. Este documento es una propuesta revisable, no un cambio de política ya aprobado.
