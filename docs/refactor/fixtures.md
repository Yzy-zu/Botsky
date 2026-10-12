# Fase 0: fixtures de webhook

Estado: **16 fixtures sintéticos validados; captura real anonimizada pendiente**. Gate 0 aún no puede darse por cumplido respecto de la evidencia real solicitada por §11/§12 del plan.

Payloads, manifest, tabla de cobertura y comando de validación: [tests/fixtures/webhooks/README.md](../../tests/fixtures/webhooks/README.md).

Los archivos cubren privado/grupo, texto, mención, cita al bot, cita al humano con el mismo texto, imagen sin texto, audio, PDF, reacción 👍, voto de encuesta, eco propio, LID con `participantAlt`, selección citada/no citada y multimedia citada. Son datos ficticios construidos leyendo `src/core/message_normalizer.js`, `src/core/server.js`, `src/services/attachmentContext.js` y tests de contexto/identidades; no se leyeron logs, variables secretas ni datos de producción.

Validación realizada: `node tests/fixtures/webhooks/verify.cjs` → 16 fixtures válidos. Se comprobaron extracción de texto/tipo legacy, envelope, IDs, par de citas con texto idéntico e identidades distintas, `fromMe`, LID y elecciones. La verificación es aislada; no evalúa autorización, addressing, I/O ni comportamiento integral del bot.

Para cerrar la evidencia pendiente se necesitan capturas de los tipos listados en el plan, anonimización de identidades/contenidos/URLs/metadata de medios y revisión antes de incorporarlas. Deben conservar la distinción entre ID saliente real y cita humana y documentar la versión/formato de Evolution. No se inventará procedencia real para estos sintéticos.
