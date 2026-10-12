# Búsquedas y fallos de IA

La interpretación, la búsqueda y la presentación tienen contratos independientes.
Los ejecutores no vuelven a interpretar la petición con palabras clave.

## Interpretación

`ai.routeWithAIOutcome()` devuelve `{ ok: true, decision, attempts }` o
`{ ok: false, failure, attempts }`. `routeWithAI()` conserva su contrato anterior
de decisión o `null` para otros consumidores.

`aiFailure` clasifica bloqueos explícitos, respuestas vacías o inválidas,
configuración, peticiones rechazadas, límites, red e indisponibilidad. El fallo
contiene solamente campos permitidos del protocolo. Nunca incluye claves,
cabeceras, cuerpos HTTP, solicitudes ni texto generado.

Un bloqueo confirmado termina la interpretación. Una respuesta truncada no se
ejecuta, aunque contenga JSON parseable. Una salida con campos obligatorios
ausentes permite una reparación de esquema; después se valida otra vez.
El respaldo Groq conserva los mismos requisitos de validación.

El dispatcher consume el resultado y presenta el fallo sin ejecutar herramientas
ni convertirlo en conversación. En grupos pasivos mantiene el silencio cuando
ninguna mención o cita técnica acredita que debe responder.

## Búsqueda general de videos

`mediaSearch.searchMedia(query, { limit })` devuelve `status`, `provider`, `items`
y `diagnostic`. Los estados son `success`, `empty`, `unavailable` e `invalid`.

El adaptador YouTube obtiene únicamente metadatos NDJSON mediante `execFile`,
sin shell. Limita tiempo y tamaño de salida. Valida IDs, deduplica resultados y
conserva el orden de relevancia. Una duración desconocida es `null`; no elimina
el video. Los directos se distinguen por metadatos del proveedor.

Una búsqueda nueva borra las opciones anteriores, incluso cuando falla, para que
una selección posterior no descargue un resultado de otra búsqueda.
`searchYoutubeList()` conserva su API histórica de lista; el comando consume
el resultado tipado. La integración especializada anterior permanece separada.

## Mensajes y verificación

`operationFeedback` convierte estados técnicos en mensajes breves para WhatsApp.
Una búsqueda vacía puede sugerir otro nombre; un fallo del servicio pide reintentar
o explica que el bot requiere una corrección. Nunca culpa la ortografía ni impone
un prefijo. El HTTP 400 histórico no tenía evidencia suficiente para atribuir una
causa; ahora se conserva su código y parámetro cuando el protocolo los permite.

Las suites `aiDiagnostics`, `mediaSearch`, `mediaSearchHandler` y
`routingFailureIntegration` usan dependencias simuladas. No cargan `.env`, bases
de datos, conexiones de WhatsApp ni proveedores reales.
