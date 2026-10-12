# Voz conversacional de Botsky

El clasificador devuelve intención y parámetros, con `message` vacío. El dispatcher escribe la charla mediante `chatWithBotsky`; los resultados del agente universal pasan por esa misma función, con resultados reales de herramientas como contexto. Las aclaraciones conservan su pregunta y detienen el turno. Una acción ya confirmada en el chat no necesita otra confirmación.

La voz compartida en `src/services/conversationStyle.js` mantiene español mexicano coloquial, humor y confianza según la relación. Elimina las listas de insultos, los porcentajes de longitudes y la obligación de usar apodos, saludos, emojis o carrilla en cada respuesta. Conserva datos de afinidad, sin heredar las órdenes de insultar del proveedor legado.

El tamaño depende de la petición: intercambio social, brevedad explícita, explicación o respuesta normal. Los presupuestos son máximos; no son cuotas de palabras ni frases. Las últimas respuestas disponibles del mismo chat proporcionan aperturas y muletillas recientes que conviene dejar descansar. No se comparte memoria de estilo entre chats.

Si Gemini devuelve un párrafo casual exactamente igual a uno reciente, se permite una sola reformulación con un plazo de seis segundos. No afecta saludos/datos cortos, resultados de herramientas, telemetría o imágenes. Si falla, conserva la respuesta válida. No vuelve a ejecutar acciones.

## Configuración

`src/services/generationSettings.js` separa perfiles: clasificador a 0.2, planificación de herramientas a 0.35 y conversación a 0.85. Gemini y Groq usan los mismos perfiles y la misma voz. La temperatura global antigua sigue funcionando para llamadas sin perfil, pero ya no anula estos tres perfiles.

Se pueden personalizar sin editar código mediante `generationProfiles` en la configuración de IA:

```json
{
  "generationProfiles": {
    "router": { "temperature": 0.2, "maxOutputTokens": 600 },
    "tools": { "temperature": 0.35, "maxOutputTokens": 1200 },
    "conversation": { "temperature": 0.85, "maxOutputTokens": 1200 }
  }
}
```

Los límites configurados son techos: una petición social conserva su presupuesto pequeño. `customPrompt` añade preferencias a la voz común y también llega al respaldo de Groq. No se cambió el modelo ni la configuración existente del VPS.

La charla que antes salía del JSON del clasificador ahora necesita una llamada adicional para redactar. El agente también separa su planificación del texto final. Esto permite usar ajustes y contexto de estilo apropiados para cada fase.

## Verificación y activación

83 pruebas aisladas aprobadas: 19 de voz y generación más las 64 regresiones anteriores. Verifican las solicitudes HTTP simuladas, las rutas del dispatcher, respaldo de Groq, perfiles, contexto, duplicados, límites de reintentos y resultados de herramientas sin reenviar acciones.

```sh
node --test test/conversationStyle.test.js test/naturalUxIntegration.test.js test/reminderNotesUx.test.js test/contactos_naturales.test.js test/multimedia_drive_estado_ux.test.js test/school_natural.test.js test/parser.test.js
```

No se usaron conversaciones, credenciales ni APIs reales para las pruebas. Estas verificaciones comprueban el pipeline y sus restricciones; la naturalidad de las respuestas del modelo debe observarse en uso después de activar los cambios. Conviene revisar aperturas repetidas, proporción de muletillas y tamaño de respuestas para distintos tipos de petición, sin exigir tamaños distintos cuando la misma respuesta corta sea adecuada.

Los cambios están cargados en el proceso de Botsky tras la activación de la mejora de adjuntos y WhatsApp del 9 de octubre de 2026; véase `adjuntos-whatsapp.md`. Las intervenciones espontáneas y el agente de terminal dedicado mantienen sus rutas propias; esta mejora cubre la charla solicitada y el agente universal.
