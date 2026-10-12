# Usamos Node.js 20 LTS como base
FROM node:20-bullseye

# Instalar dependencias completas del sistema para todas las funciones del bot:
# - ffmpeg / webp: Multimedia, conversión, stickers y efectos de audio
# - tesseract-ocr (-spa): Reconocimiento de texto en imágenes (OCR)
# - qrencode / zbar-tools: Generación y lectura de códigos QR
# - ghostscript: Compresión y optimización de documentos PDF
# - libreoffice: Conversión de formatos Office (Word, Excel) a PDF
# - poppler-utils: Extracción de páginas PDF a imágenes (pdftoppm)
# - python3 / pip: Entorno para faster-whisper y yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    webp \
    python3 \
    python3-pip \
    tesseract-ocr \
    tesseract-ocr-spa \
    qrencode \
    zbar-tools \
    ghostscript \
    libreoffice \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Instalar Whisper (faster-whisper) y yt-dlp
RUN pip3 install --no-cache-dir faster-whisper yt-dlp

# Crear directorio de trabajo
WORKDIR /app

# Copiar dependencias de Node.js e instalar
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el código del proyecto
COPY . .

# Exponer el puerto del webhook
EXPOSE 3000

# Comando para arrancar el bot
CMD ["node", "src/core/server.js"]
