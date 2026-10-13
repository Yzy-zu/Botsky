# Fase3 — núcleo y observación

Estado: verificación local verde; Gate3 abierto hasta24h reales de sombra y revisión de diffs. No canario ni migración de negocio.

## Resultado local

- npm run verify:219pass0fail; tipo estricto, lint, arquitectura69módulos0violaciones,94env documentadas.
- Pipeline8etapas y5políticas:100%líneas cada módulo. EscenariosS01–S09,S12–S16:16 archivos verdes (incluyendo a/b). Featureshelp/system-info100%líneas; permisos, salida canónica, naturalintents y CLI compatibles.
- Telemetría/refactor/hooks:52pass0fail. Legacy auditcerrada814/814; no repetirla como proveedorlive ni retirar trazabilidad.
- RateLimiter60admisiones por minuto porchat+usuario, cooldown3s despuésde respuesta (opciones inyectables), ráfaga3mensajes conserva1despacho. Identidadúnica domain/jid normaliza c.us/device/521 dentro namespace sin privilegios porsubstring.
- Revisiones WO031–036 y rootcorrecciones: selecciónsesión sólo gramática actual y cita/mención correctas; prefijos /! /@; schemas de manifiestos; exceptionscontext yobservación no duplican envíos; IDsde respuesta enlazan hilo.

## Activación preparada

El operador manage-phase3-shadow.cjs copia exclusivamente módulos nuevosv2/runtime y preload. No reemplaza server/dispatcher/commands ni bot.db productivos. PM2 conservaenv y Nodeargs, flags sólo sombra; guarda recuperaciónprivada0600. Comprueba checkpoint realoperationalClock antes de declarar arranque; si falla revierte modo y argumentos.

Preloadobserva después de HTTP200 y captura ramas reales mediante módulos originales. No se adivina silencio desde ausencia de respuesta: se marcaunknown. Diffs sólo vocabulario cerrado sintexto/IDs/argumentos. NullMessenger falla ante IO accidental; decideOnly no ejecuta Executor/Composer/passivos/jobs. Replay usa decisionesv1 conocidas, sinllamadasAI adicionales.

## Revisión arquitectónica y límites

La revisión independiente autoriza iniciar **sombra parcial** trasverify yguardas corregidas; no acreditaGate3/canario/24h. Historial/sesionesv1 no se importan: la comparación inicial tieneunknown, pendientes y categorías explicadas. El rate factory ya está integrado y probado despuésde la observación de revisión inicial; someter evidencia/diffs a revisión final antescerrar.

La observación real debe continuar24h sin reinicios, excepciones ni IOnegocio. Un checkpoint stale/reinicio/FakeClock fallaelgate. El reporte porcategorías requiere revisión humana/técnica antescerrar. Si se pausa esta tarea, recordar si usuario pidió detener también observación; guardarstatus real, no declararhoras no transcurridas.

## Retomar

Consultar PROGRESS y estado privado /tmp/botsky-phase3-shadow-state.json mediante comando status (noimprimecredenciales). Leer archivo privado de diffs sólo para agregar categorías; no copiarlogs/DB/env alrepositorio. Actualizarphase3-evidence.json desdecheckpoint vivo+PM2 mismoPID, revisarunknown/v2-more yconfirmar24h. npmrunverify:phase3 se mantiene abierto hasta todaevidencia.

## Observación activada

Inicio real:2026-10-13T03:02:40.938Z; mismo proceso PM2wasa2916445, health200. Primertráfico real cuatrodiffs, sinexcepciones/sinkErrors/drops. Ayuda eligióhelp enambas versiones porwake-word; etiqueta changed corresponde command→intent, no función diferente. Tresreplysinplan quedanunknown explícito. Másdatos/duración/revisiónpendientes; earliest24h2026-10-14T03:02:40.938Z.

El reporte usa checkpoint.enabled/PM2samePID/heartbeat para active; checkpoint.active es busyworker. No interpretar falseidle como apagado. Evidencia porrun se congela trasreinicio/stop y no acumula tiempo ficticio.
