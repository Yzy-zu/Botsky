# Guía de Rotación y Gestión Segura de Credenciales - Botsky

Este documento describe la política y el procedimiento operativo para la rotación de claves de API y credenciales criptográficas del bot.

---

## 1. Rotación de Google Gemini API Key (`GEMINI_API_KEY`)
- **Frecuencia recomendada:** Cada 90 días o ante sospecha de compromiso.
- **Procedimiento:**
  1. Ingresar a Google AI Studio: [https://aistudio.google.com/](https://aistudio.google.com/).
  2. Ir a **Get API key** en el panel lateral.
  3. Crear una nueva clave API o revocar la anterior.
  4. Actualizar `GEMINI_API_KEY` en el archivo `/home/petrov/botsky/.env`.
  5. Recargar el proceso con PM2: `pm2 reload wasa`.
  6. Una vez verificado el funcionamiento en WhatsApp, eliminar la clave antigua en Google AI Studio.

---

## 2. Rotación de Groq API Key (`GROQ_API_KEY`) (Respaldo)
- **Frecuencia recomendada:** Cada 90 días o ante sospecha de compromiso.
- **Procedimiento:**
  1. Ingresar a la consola de Groq: [https://console.groq.com/keys](https://console.groq.com/keys).
  2. Generar una nueva API Key (`gsk_...`).
  3. Actualizar `GROQ_API_KEY` en el archivo `.env`.
  4. Recargar el proceso con PM2: `pm2 reload wasa`.
  5. Una vez verificado el funcionamiento, eliminar la clave anterior de la consola de Groq.

---

## 3. Rotación de Spotify API (`SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`)
- **Frecuencia recomendada:** Cada 180 días.
- **Procedimiento:**
  1. Ingresar al Dashboard de Spotify Developers: [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
  2. Seleccionar la aplicación del bot y hacer clic en **Settings**.
  3. Hacer clic en **Rotate Client Secret**.
  4. Actualizar `SPOTIFY_CLIENT_SECRET` en `.env`.
  5. Recargar el bot con `pm2 reload wasa`.

---

## 4. Rotación de Llave Maestra (`MASTER_KEY`) y Token de Drive
- **Función:** `MASTER_KEY` cifra el token OAuth2 de Google Drive en `data/token.json` usando `AES-256-GCM` y `scrypt` con salt aleatorio.
- **Procedimiento de Re-encriptación:**
  1. Para generar una nueva `MASTER_KEY` segura:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
  2. Para migrar el token existente a la nueva llave sin perder la sesión:
     ```bash
     node -e "
     const fs = require('fs');
     const { decrypt, encrypt } = require('./src/utils/crypto');
     const oldKey = 'LLAVE_ANTERIOR';
     const newKey = 'NUEVA_LLAVE';
     const tokenRaw = decrypt(fs.readFileSync('data/token.json', 'utf8').trim(), oldKey);
     fs.writeFileSync('data/token.json', encrypt(tokenRaw, newKey));
     console.log('Token re-encriptado con la nueva MASTER_KEY');
     "
     ```
  3. Actualizar `MASTER_KEY` en `.env`.
  4. Recargar el proceso con `pm2 reload wasa`.

---

## 5. Rotación de Evolution API (`EVOLUTION_API_KEY`)
- **Procedimiento:**
  1. Actualizar el API Key en el contenedor o instancia de Evolution API (`AUTHENTICATION_API_KEY`).
  2. Actualizar `EVOLUTION_API_KEY` en el `.env` de Botsky.
  3. Recargar el bot con `pm2 reload wasa`.

---

## 6. Permisos de Archivos Sensibles
Asegurar que los archivos de configuración y datos mantengan permisos restrictivos en el servidor:
```bash
chmod 600 /home/petrov/botsky/.env
chmod 600 /home/petrov/botsky/data/token.json
chmod 600 /home/petrov/botsky/data/*.json
```
