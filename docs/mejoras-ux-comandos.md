# Corrección de los diez casos de UX

Fecha: 2026-10-09. Implementación coordinada con tres agentes y revisión de integración.

| Caso | Comportamiento corregido |
| --- | --- |
| 1. Recordatorio sin plazo válido | Pregunta cuándo avisar; no guarda ni inventa diez minutos. |
| 2. Destinatario ambiguo | Pregunta número o nombre; conserva recado y anonimato por chat/remitente durante diez minutos. |
| 3. Tarea convertida en nota | Conserva la frase original para Gemini; sólo ataja notas explícitas. |
| 4. Voto estructurado | Conserva la opción de Gemini y acepta número o nombre, con validación de coincidencias. |
| 5. Nota citada | Comando y herramienta usan el mismo extractor de texto/caption citado. |
| 6. Recordatorio citado | Usa el contenido citado y pide lo que falte; elimina el texto genérico inventado. |
| 7. Conversión con velocidad/bitrate | Aplica parámetros en FFmpeg, valida valores y formatos, y convierte enlaces y adjuntos por el mismo camino. |
| 8. Falla de Drive | Conserva lista para reintentar, verifica vencimiento y evita descargas simultáneas de la misma sesión. |
| 9. Daily con espera | Herramienta devuelve cooldown, éxito o error reales; sólo informa XP efectivamente reclamados. |
| 10. Estado del bot | Ruta propia con tiempo activo y trabajos locales de cola; info de videos sigue aparte. |

Los comandos y las herramientas comparten extracción/validación o una API común cuando ejecutan la misma acción. Las aclaraciones publican `needs_clarification`, `question` y los campos pendientes. El agente detiene ese turno y espera nueva entrada, en lugar de intentar completar información desconocida. Las respuestas ya enviadas se identifican con `enviado_al_chat`.

La selección de contactos pendientes tiene prioridad sobre las listas multimedia después de verificar autorización. El normalizador conserva también el contexto de citas cuando desempaqueta un archivo.

## Verificación

64 pruebas aisladas aprobadas. Cubren almacenamiento y transportes simulados, contratos de Gemini, continuación de recados, aislamiento de sesiones, errores, vencimientos, citas, votos, daily y enrutamiento. Se conserva la regresión de tareas naturales y parser. También se verificó sintaxis y se hizo una prueba local de FFmpeg con video sintético con/sin audio.

```sh
node --test test/naturalUxIntegration.test.js test/reminderNotesUx.test.js test/contactos_naturales.test.js test/multimedia_drive_estado_ux.test.js test/school_natural.test.js test/parser.test.js
```

No se ejecutó la suite global porque hay pruebas que cargan el entorno y servicios reales. Las pruebas de esta corrección no usan credenciales, WhatsApp, Gemini ni la base de producción. El comportamiento del modelo en vivo todavía requiere comprobación tras activar los cambios.

Los cambios están guardados en `/home/petrov/botsky`; el proceso en ejecución no se reinició y requiere reinicio para cargarlos.
