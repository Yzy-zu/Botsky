'use strict';

const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

/**
 * Encripta un texto usando AES-256-GCM con derivación de clave scrypt y salt aleatorio.
 * @param {string} text - El texto plano a encriptar.
 * @param {string} masterKey - La llave maestra.
 * @returns {string} - Cadena con formato salt:iv:tag:encryptedData
 */
function encrypt(text, masterKey) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(masterKey, salt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Desencripta un texto usando AES-256-GCM.
 * Soporta formato moderno (salt:iv:tag:data) y formato legado (iv:tag:data con salt estático).
 * @param {string} encryptedString - Cadena cifrada.
 * @param {string} masterKey - Llave maestra.
 * @returns {string} - Texto plano desencriptado.
 */
function decrypt(encryptedString, masterKey) {
    const parts = encryptedString.split(':');
    let salt, iv, authTag, encryptedText;

    if (parts.length === 4) {
        salt = Buffer.from(parts[0], 'hex');
        iv = Buffer.from(parts[1], 'hex');
        authTag = Buffer.from(parts[2], 'hex');
        encryptedText = parts[3];
    } else if (parts.length === 3) {
        // Compatibilidad con tokens previos cifrados con salt fijo
        salt = 'salt';
        iv = Buffer.from(parts[0], 'hex');
        authTag = Buffer.from(parts[1], 'hex');
        encryptedText = parts[2];
    } else {
        throw new Error('El texto cifrado no tiene el formato correcto (salt:iv:tag:data o iv:tag:data).');
    }

    const key = crypto.scryptSync(masterKey, salt, 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

module.exports = {
    encrypt,
    decrypt,
};
