# Runbook futuro de canario y cutover

**Estado: preparación documental; no autoriza un canario ni un cutover.** Gate 3 está cerrado con excepción explícita F3-E001: el cliente canceló la sombra. Fase 4 ya puede implementar las olas; su activación requiere la evidencia aplicable. La migración completa sigue pendiente: las olas, su traza y sus gates deben terminar antes de cualquier retiro de legacy.

Este documento solo fija las condiciones y el procedimiento que habría que revisar antes de una futura activación. No acredita una prueba en producción ni reemplaza las aprobaciones de cada gate.

## Prerrequisitos verificables

Antes de planear una ventana, el responsable de la migración debe adjuntar al expediente del cambio:

- Gate 3 cerrado con `npm run verify:phase3`, escenarios aplicables verdes, cobertura requerida, la excepción autorizada F3-E001 en lugar de la sombra cancelada. No se afirma observación24h.
- Gate 4 cerrado para cada feature que se pretenda incluir: manifest, handler y repo migrados; traceability completa; pruebas de escenario y port de la ola verdes; imports legacy restantes enumerados como shims con fecha de retiro.
- Revisión arquitectónica y operacional aprobada, inventario de webhooks/jobs y sus efectos, restauración de backup comprobada, health check y consulta de métricas disponibles.
- Un artefacto de release identificado por SHA, configuración/flags guardados, ventana y umbrales escritos, responsable de decisión y operador de rollback localizables. Secretos y datos de usuarios no se copian al expediente.
- Cada webhook y cada job tiene **un solo propietario activo** por entorno. El registro enumera nombre, propietario (`legacy` o `v2`), proceso/instancia, queue o scheduler, lock/idempotency key y efecto externo que puede producir. No se habilita el nuevo propietario mientras el anterior siga aceptando el mismo trabajo. Las tareas que aún no tengan exclusión verificable quedan en legacy y fuera de la ola.

## Secuencia de activación propuesta

1. Congelar el release y registrar SHA, configuración efectiva redactada, estado inicial de procesos, health, colas, jobs habilitados y métricas de referencia. Verificar que se puede restaurar el propietario anterior sin cambiar datos.
2. Para la primera ola ya aprobada, elegir un privado de prueba controlado y habilitar canario con el flag soportado. Confirmar en el registro de ownership que solo un webhook entrega respuestas y que jobs con efecto externo conservan un único propietario. El modo sombra nunca cuenta como entrega ni como canario.
3. Observar salud, errores, latencia, duplicados, entregas, fallos de job y diffs durante el periodo aprobado para ese escalón (el plan propone 72 horas). Comparar con los umbrales concretos escritos antes del inicio. No ampliar audiencia mientras no haya decisión registrada.
4. Si se aprueba el escalón privado, añadir grupos gradualmente, uno por uno, actualizando el registro de propietario y evidencia en cada paso. El salto a `v2` completo requiere los gates de todas las olas; terminar el soak de un escalón no habilita el siguiente automáticamente.
5. Al cerrar cada escalón, guardar el resumen de métricas/diffs redactado, SHA, hora UTC, cambio de flags, responsables y decisión. Mantener el mecanismo de rollback disponible durante todo el soak.

## Rollback

Ante cualquier umbral excedido, respuesta duplicada, excepción no capturada, sink error, health fallido, job duplicado o pérdida de exclusión del propietario:

1. El responsable de decisión detiene la expansión y registra hora UTC, síntoma y alcance observado.
2. El operador devuelve `PIPELINE_MODE` al modo anterior (`shadow` o `legacy`, según el último estado aprobado) y reinicia únicamente el proceso que el procedimiento de operación identifique. Confirma health y SHA/proceso activo. No se reinician ambos propietarios para “probar” cuál atiende.
3. Devuelve el ownership de cada webhook/job afectado al propietario anterior; verifica que el proceso nuevo ya no entrega ni ejecuta esos trabajos. Si hay incertidumbre sobre un efecto, se pausa ese job hasta reconciliarlo con su idempotency key y su estado persistido.
4. Verifica que el servicio anterior responde, que no hay trabajos duplicados pendientes y que las colas/DB mantienen consistencia. Restaurar backup solo ante daño comprobado y con el procedimiento de datos aprobado.
5. Preserva evidencia mínima redactada: release SHA, flags antes/después, PID, health, ownership, métricas, IDs internos seudonimizados, errores por categoría y decisión. No adjunta mensajes, JIDs, secretos, DB ni dumps de entorno. Abre el incidente y no reanuda el canario hasta que causa, corrección, revisión y autorización de gates queden registradas.

Un cambio de flag y reinicio es el rollback operativo previsto por el plan; este runbook todavía no demuestra que se haya ensayado en el entorno destino. El ensayo requiere una ventana posterior a los gates dentro de la autorización operacional vigente del cliente, y se documentará antes de habilitar tráfico de canario.
