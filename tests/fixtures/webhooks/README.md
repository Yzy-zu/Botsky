# Fixtures de webhook

Los 16 payloads son **sintéticos**, construidos a partir de los formatos del código y los tests legacy. **No son capturas reales de producción** ni constituyen evidencia de compatibilidad contra una versión desplegada de Evolution. El requisito de capturar y anonimizar webhooks reales de Gate 0 sigue **pendiente**.

Todos los nombres, números, JIDs, IDs, instancia y contenidos son ficticios. Los medios apuntan a `example.invalid`; no contienen archivos, claves de descifrado, miniaturas ni secretos. Nunca deben enviarse a WhatsApp ni utilizarse para descargar medios. No se consultaron logs, `.env` ni servicios de producción.

Cada archivo representa el body recibido por `/webhook`: `event: messages.upsert`, `instance` y `data`. El normalizador legacy recibe **`fixture.data`**, no el body completo. `manifest.json` aporta identidad ficticia del bot, IDs salientes para inicializar un fake de echo/quote guard y expectativas de extracción **legacy**. Esas expectativas no son resultados esperados de addressing ni autorización v2.

| Archivo | Cobertura | Contexto adicional para escenario v2 |
|---|---|---|
| 01 | Texto privado | Sin sesión |
| 02 | Charla humana de grupo | S01: solo efectos pasivos |
| 03 | Mención explícita al bot | S03: configurar `botJid` del manifest |
| 04 | Cita a bot | S04a: registrar `SYNTH-BOT-RESULTS` como saliente |
| 05 | Cita a humano con idéntico texto al bot | S04b: identidad e ID diferentes; no responder |
| 06 | Imagen privada sin texto | S08: acción breve; seguimiento usa el adjunto |
| 07 | Imagen de grupo sin texto | S09: silencio; conservar adjunto acotado |
| 08 | Nota de voz privada | Metadata de audio sin contenido descargable |
| 09 | PDF privado | Metadata de documento sin contenido descargable |
| 10 | Reacción 👍 a la imagen 07 | Precargar 07 para probar reacción a media conocida |
| 11 | Voto de menú Minecraft | Forma legacy con `selectedOptions` ya decodificadas |
| 12 | Eco propio `fromMe` | S13: gate del webhook antes de normalizar |
| 13 | Participante LID con `participantAlt` telefónico | Preservar ambas identidades; no inferir permisos |
| 14 | Selección `2` citando resultados del bot | S07b: fake de sesión activo para ese usuario/chat |
| 15 | Selección `2` sin cita | S07a: mismo fake de sesión; no descargar |
| 16 | Comando `/sticker` citando imagen | S09: multimedia citada de 07 |

04 y 05 contienen deliberadamente la misma respuesta citada. 14 y 15 requieren una sesión de búsqueda y sus resultados simulados: el payload solo no prueba continuación de sesión. `manifest.botOutboundIds` no implica que el mensaje 12 haya sido emitido por el fake; el escenario S13 debe precargar su ID/texto en echo guard.

El fixture 11 representa únicamente el formato de voto aceptado por el normalizador actual. No demuestra que Evolution entregue votos descifrados en producción ni modela `pollCreationMessage`.

Validación aislada desde la raíz del proyecto:

```sh
node tests/fixtures/webhooks/verify.cjs
```

El verificador evalúa solo `extractText` y `detectMessageType` en una VM, sin importar módulos de la aplicación, abrir SQLite, iniciar jobs o acceder a la red. También comprueba estructura, IDs únicos y relaciones clave. No ejecuta la suite ni certifica el pipeline completo.
