'use strict';

const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

/**
 * Encripta un texto usando AES-256-GCM.
 * @param {string} text - El texto plano a encriptar.
 * @param {string} masterKey - La llave maestra de 32 bytes en formato hex o base64.
 * @returns {string} - Cadena con formato iv:tag:encryptedData
 */
function encrypt(text, masterKey) {
    // Asegurar que la llave sea de 32 bytes
    const key = crypto.scryptSync(masterKey, 'salt', 32);
    const iv = crypto.randomBytes(12);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Desencripta un texto usando AES-256-GCM.
 * @param {string} encryptedString - Cadena con formato iv:tag:encryptedData
 * @param {string} masterKey - La misma llave maestra usada para encriptar.
 * @returns {string} - El texto plano desencriptado.
 */
function decrypt(encryptedString, masterKey) {
    const key = crypto.scryptSync(masterKey, 'salt', 32);
    const parts = encryptedString.split(':');
    
    if (parts.length !== 3) {
        throw new Error('El texto cifrado no tiene el formato correcto (iv:tag:data).');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
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
