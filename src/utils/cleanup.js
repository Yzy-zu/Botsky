'use strict';

const fs = require('fs');

/**
 * Elimina de forma segura uno o más archivos o directorios temporales.
 * @param {...string} paths - Rutas de archivos o carpetas a eliminar
 */
function cleanup(...paths) {
    for (const p of paths) {
        if (!p) continue;
        try {
            if (fs.existsSync(p)) {
                const stat = fs.statSync(p);
                if (stat.isDirectory()) {
                    fs.rmSync(p, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(p);
                }
            }
        } catch {
            // Ignorar errores al limpiar archivos temporales
        }
    }
}

module.exports = { cleanup };
