const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'data', 'oauth-credentials.json');
const TOKEN_PATH = path.join(__dirname, 'data', 'token.json');

require('dotenv').config();
const crypto = require('crypto');
const { encrypt } = require('./src/utils/crypto');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Generar MASTER_KEY en .env si no existe
let masterKey = process.env.MASTER_KEY;
if (!masterKey) {
    masterKey = crypto.randomBytes(32).toString('hex');
    fs.appendFileSync(path.join(__dirname, '.env'), `\nMASTER_KEY=${masterKey}\n`);
    console.log('🔑 Nueva MASTER_KEY generada y guardada en .env');
}

if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('No se encontró el archivo oauth-credentials.json en la carpeta data/');
    process.exit(1);
}

const content = fs.readFileSync(CREDENTIALS_PATH);
const credentials = JSON.parse(content);
const { client_secret, client_id, redirect_uris } = credentials.installed;
// Google depreció el OOB, así que usamos el primer redirect_uri (http://localhost)
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0] || 'http://localhost');

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
});

console.log('1. Haz clic en este link mágico para autorizar al bot:\n');
console.log(authUrl);
console.log('\n2. Inicia sesión con tu cuenta de Google (donde tienes el espacio de 400GB).');
console.log('3. Te saldrá una advertencia de que la app no está verificada. Dale a "Continuar" o "Avanzado" -> "Ir a...".');
console.log('4. Concede los permisos y dale a Continuar.');
console.log('5. Tu navegador intentará ir a "http://localhost/..." y dará error de "No se puede conectar". ¡ESTO ES NORMAL!');
console.log('6. Mira la BARRA DE DIRECCIONES de tu navegador. Copia todo lo que está después de "code=" y antes de "&scope".');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.question('\n5. Pega el código que copiaste aquí: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
        if (err) return console.error('\nError obteniendo el token. Asegúrate de copiar el código completo.', err);
        oAuth2Client.setCredentials(token);
        
        // Encriptar el token antes de guardarlo
        const encryptedToken = encrypt(JSON.stringify(token), masterKey);
        fs.writeFileSync(TOKEN_PATH, encryptedToken);
        
        console.log('\n✅ ¡Token encriptado y guardado exitosamente en data/token.json!');
        console.log('Ahora el bot subirá los archivos a TU Drive directamente, de forma ultra-segura.');
    });
});
