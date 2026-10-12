# Webhooks reales anonimizados — Fase 0

Capturas HTTP del bot productivo, sanitizadas mediante allowlist antes de
escribir al disco. El manifest conserva fecha, evento y categorías observadas;
textos, identidades, nombres, IDs y URLs son reemplazos sintéticos. Nunca
se guardaron aquí headers, credenciales, media keys o bytes de medios.

Los aliases del bot tienen validez dentro de cada fixture; sus mapas se
reinician entre capturas. Una cita al bot requiere identidad comprobada o
un ID saliente observado en el mismo chat. Las citas sin esa prueba siguen
desconocidas. La clasificación de cita humana exige alias conocido en el
mismo dominio de identidad.

`mention` prueba el formato real `mentionedJid`, incluso de una persona;
no prueba que el bot fuera mencionado ni el escenario S03. El cliente pide
interacción natural sin exigir @ o prefijos. `fromMe` se observó mediante
`send.message`; su evento se conserva, sin afirmar un eco `messages.upsert`
ni completar S13. Los escenarios se validarán en sus fases correspondientes.

Reimportar: `node scripts/refactor/import-phase0-captures.cjs`.
Validar Gate 0: `node scripts/refactor/verify-phase0.cjs`.
Encuesta nativa diferida por instrucción explícita del cliente: F0-E001 en
`docs/refactor/phase0-exceptions.json`. Revisitaremos antes de migrar polls;
los fixtures sintéticos no sustituyen esa evidencia.
