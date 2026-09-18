'use strict';

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'data', 'oauth-credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'data', 'token.json');
const { decrypt } = require('../utils/crypto');

async function authenticate() {
    try {
        if (!fs.existsSync(CREDENTIALS_PATH) || !fs.existsSync(TOKEN_PATH)) {
            throw new Error('Faltan los archivos de credenciales OAuth2 o el token.');
        }
        
        const masterKey = process.env.MASTER_KEY;
        if (!masterKey) {
            throw new Error('MASTER_KEY no encontrada en .env');
        }

        const content = fs.readFileSync(CREDENTIALS_PATH);
        const credentials = JSON.parse(content);
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0] || 'http://localhost');
        
        const encryptedToken = fs.readFileSync(TOKEN_PATH, 'utf8');
        const decryptedToken = decrypt(encryptedToken, masterKey);
        
        oAuth2Client.setCredentials(JSON.parse(decryptedToken));
        
        return oAuth2Client;
    } catch (error) {
        logger.error('Error autenticando con Google Drive (OAuth2):', error);
        throw error;
    }
}

async function getOrCreateFolder(drive, folderName, parentFolderId) {
    try {
        const q = `'${parentFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const response = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        if (response.data.files && response.data.files.length > 0) {
            return response.data.files[0].id;
        }

        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        };

        const folder = await drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });

        return folder.data.id;
    } catch (error) {
        logger.error(`Error buscando/creando carpeta ${folderName}:`, error);
        throw error;
    }
}

async function uploadFile(filePath, mimeType, originalName) {
    try {
        const authClient = await authenticate();
        const drive = google.drive({ version: 'v3', auth: authClient });

        const folderId = process.env.DRIVE_FOLDER_ID;
        if (!folderId) {
            throw new Error('DRIVE_FOLDER_ID no configurado en el archivo .env');
        }

        // Obtener año y mes actual
        const date = new Date();
        const yearStr = date.getFullYear().toString();
        
        // Array de meses para que el nombre de la carpeta sea más descriptivo (opcional, p.ej: "08 - Agosto")
        const months = ['01 - Enero', '02 - Febrero', '03 - Marzo', '04 - Abril', '05 - Mayo', '06 - Junio', '07 - Julio', '08 - Agosto', '09 - Septiembre', '10 - Octubre', '11 - Noviembre', '12 - Diciembre'];
        const monthStr = months[date.getMonth()];

        // Obtener o crear carpeta del Año
        const yearFolderId = await getOrCreateFolder(drive, yearStr, folderId);
        
        // Obtener o crear carpeta del Mes dentro del Año
        const monthFolderId = await getOrCreateFolder(drive, monthStr, yearFolderId);

        const fileMetadata = {
            name: originalName,
            parents: [monthFolderId],
        };

        const media = {
            mimeType: mimeType,
            body: fs.createReadStream(filePath),
        };

        logger.info(`Subiendo archivo a Drive: ${originalName}...`);
        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
        });

        logger.success(`Archivo subido exitosamente: ${response.data.id}`);
        return response.data;
    } catch (error) {
        logger.error('Error subiendo archivo a Google Drive:', error);
        throw error;
    }
}

async function searchFiles(query) {
    try {
        const authClient = await authenticate();
        const drive = google.drive({ version: 'v3', auth: authClient });
        
        const folderId = process.env.DRIVE_FOLDER_ID;
        if (!folderId) throw new Error('DRIVE_FOLDER_ID no configurado.');

        // Buscamos dentro de la carpeta y que el nombre contenga la query, limitamos a 5
        const q = `'${folderId}' in parents and name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
        
        const response = await drive.files.list({
            q,
            fields: 'files(id, name, mimeType)',
            orderBy: 'createdTime desc',
            pageSize: 5
        });

        return response.data.files || [];
    } catch (error) {
        logger.error('Error buscando archivos en Drive:', error);
        throw error;
    }
}

// Mapeo de mimeTypes de Google Workspace a formatos exportables
const GWORKSPACE_EXPORT = {
    'application/vnd.google-apps.document':     { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
    'application/vnd.google-apps.spreadsheet':  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
    'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
    'application/vnd.google-apps.drawing':      { mime: 'application/pdf', ext: '.pdf' },
};

async function downloadFile(fileId, fileName, mimeType = '') {
    try {
        const authClient = await authenticate();
        const drive = google.drive({ version: 'v3', auth: authClient });

        const tmpDir = process.env.TMP_DIR || '/tmp/whatsapp-bot';
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const isWorkspace = mimeType.startsWith('application/vnd.google-apps.');
        const exportConfig = GWORKSPACE_EXPORT[mimeType];

        // Ajustar nombre y mimetype de salida si es un archivo de Google Workspace
        let outputName = fileName;
        let downloadResponse;

        if (isWorkspace && exportConfig) {
            // Archivo de Google (Doc, Sheet, Slides...) → exportar en formato Office
            if (!outputName.endsWith(exportConfig.ext)) outputName += exportConfig.ext;
            logger.info(`[Drive] Archivo Google Workspace detectado (${mimeType}). Exportando como ${exportConfig.ext}...`);
            downloadResponse = await drive.files.export(
                { fileId, mimeType: exportConfig.mime },
                { responseType: 'stream' }
            );
        } else if (isWorkspace) {
            // Google Workspace desconocido → intentar exportar como PDF
            if (!outputName.endsWith('.pdf')) outputName += '.pdf';
            logger.warn(`[Drive] Tipo Google Workspace sin mapeo (${mimeType}). Exportando como PDF...`);
            downloadResponse = await drive.files.export(
                { fileId, mimeType: 'application/pdf' },
                { responseType: 'stream' }
            );
        } else {
            // Archivo normal (foto, PDF, video, etc.) → descarga directa
            downloadResponse = await drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'stream' }
            );
        }

        const safeName = outputName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(tmpDir, `drivedl_${Date.now()}_${safeName}`);
        const dest = fs.createWriteStream(filePath);

        return new Promise((resolve, reject) => {
            downloadResponse.data
                .on('error', err => reject(err))
                .pipe(dest);
            dest.on('finish', () => resolve({ filePath, outputName }));
            dest.on('error', err => reject(err));
        });
    } catch (error) {
        logger.error('Error descargando archivo de Drive:', error);
        throw error;
    }
}

async function getQuota() {
    try {
        const authClient = await authenticate();
        const drive = google.drive({ version: 'v3', auth: authClient });
        
        const response = await drive.about.get({ fields: 'storageQuota' });
        return response.data.storageQuota;
    } catch (error) {
        logger.error('Error obteniendo espacio de Drive:', error);
        throw error;
    }
}

module.exports = {
    uploadFile,
    searchFiles,
    downloadFile,
    getQuota
};
