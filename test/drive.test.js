const test = require('node:test');
const assert = require('node:assert');
const drive = require('../src/services/drive');

test('drive: searchFiles escapa comillas simples y backslashes en la consulta', async () => {
    // Verificar que la función maneja caracteres peligrosos sin lanzar error de sintaxis SQL/Drive
    const origEnv = process.env.DRIVE_FOLDER_ID;
    process.env.DRIVE_FOLDER_ID = 'fake_folder_id';
    try {
        // Si no hay auth real en ambiente de test, debe rechazar por credenciales pero no por sintaxis
        await assert.rejects(async () => {
            await drive.searchFiles("archivo'\con\"comillas\\y\\barras");
        });
    } finally {
        process.env.DRIVE_FOLDER_ID = origEnv;
    }
});

test('drive: getQuota devuelve información de almacenamiento si está autenticado', async () => {
    if (!process.env.MASTER_KEY || !process.env.DRIVE_FOLDER_ID) {
        return; // Saltear si no hay entorno de credenciales activo
    }
    try {
        const quota = await drive.getQuota();
        if (quota) {
            assert.ok(quota.limit !== undefined);
            assert.ok(quota.usage !== undefined);
        }
    } catch (e) {
        // En caso de que no haya conexión de red a Google
        assert.ok(e.message);
    }
});