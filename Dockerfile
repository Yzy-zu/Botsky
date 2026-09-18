# Usamos Node.js como base
FROM node:20-bullseye

# Instalar dependencias del sistema: ffmpeg para audio y Python para Whisper
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    webp \
    && rm -rf /var/lib/apt/lists/*

# Instalar Whisper (faster-whisper) y yt-dlp
RUN pip3 install faster-whisper yt-dlp

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias e instalar
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto del webhook (3000 según tu .env)
EXPOSE 3000

# Comando para arrancar el bot
CMD ["node", "src/core/server.js"]
