# Conexión de álbumes Rikolino

Botsky obtiene por defecto las imágenes de los álbumes publicados en Petrovsky. El lector abre `/home/petrov/petrovsky/backend/data/rikolino/library.db` exclusivamente con SQLite `OPEN_READONLY`; no inicializa tablas ni crea datos. `RIKOLINO_DIR` permite indicar otra raíz si el despliegue lo requiere, sin modificar archivos de configuración durante esta entrega.

`createRikolinoReader({rootDir,random}).getImages(category,{count})` abre una conexión nueva, consulta un snapshot consistente, selecciona y cierra siempre la conexión. Retorna `[{path: '/ruta/absoluta/originals/UUID.png', source:'rikolino', isTemporary:false}]`. Los originales pertenecen a Petrovsky: no se borran como temporales, no se copian ni sincronizan con Botsky.

Con categoría, coincide exactamente con el slug o nombre del álbum, ignorando mayúsculas, acentos y espacios repetidos. Si varios nombres normalizados coinciden, reúne esas colecciones. Sin categoría, reúne todos los álbumes publicados y elimina fotos repetidas por UUID. Solo incluye fotos activas; cambios de publicación, asociación, nombre o papelera se ven en la siguiente solicitud. Mantiene la selección aleatoria y respeta la cantidad solicitada por el código existente. Comprueba rutas UUID dentro de `originals/`, extensión/MIME reconocidos y archivos regulares; rechaza rutas manipuladas y enlaces simbólicos.

Ejemplo: un álbum publicado con slug `vacaciones` alimenta `!pack vacaciones`, `!pack --categoria vacaciones` y solicitudes naturales que el dispatcher ya interpreta. Una biblioteca vacía, álbum inexistente o DB inválida no activa descargas de internet. Los helpers locales/web anteriores se conservan: solo `customDir` explícito en `getPackImages` elige ese proveedor legado; el runtime normal usa Rikolino.

Esta conexión cambia exclusivamente el proveedor de imágenes. El precio actual del comando, cantidad, cobro/reembolso, permisos y entrega privada con visualización única permanecen como estaban. Los campos de Rikolino `priceXp`, `photoCount`, `selectionMode` y el estado `available` todavía no gobiernan las reglas de Botsky; el usuario las configurará después. No se añadió catálogo, registro de compras ni cambios económicos.

Verificación segura: `node --test test/rikolinoLibrary.test.js`. Usa la factory Petrovsky contra SQLite temporal y Sharp local, con económico/WhatsApp y red simulados mediante VM. No carga `.env` ni importa la DB real de Botsky. No ejecutar la suite histórica de packs para comprobar esta conexión: usa configuración y DB del entorno.
