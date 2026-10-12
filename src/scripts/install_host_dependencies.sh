#!/usr/bin/env bash
# Script de instalación de dependencias del sistema para Botsky (Debian / Ubuntu)
set -e

echo "📦 Instalando paquetes del sistema para Botsky..."
sudo apt-get update
sudo apt-get install -y \
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
    poppler-utils

echo "🐍 Instalando dependencias de Python (faster-whisper, yt-dlp, spotdl)..."
pip3 install --upgrade faster-whisper yt-dlp spotdl

echo "✅ Todas las dependencias del host han sido instaladas correctamente."
