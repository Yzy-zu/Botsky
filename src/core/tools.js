'use strict';

module.exports = [
    {
        name: 'ayuda',
        description: 'Muestra la lista de comandos y opciones disponibles del bot.',
        category: 'utilidad',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/ayuda.js',
            method: 'handleAyuda',
            invokeArgs: {}
        }
    },
    {
        name: 'descargar',
        description: 'Descarga videos, imágenes o audios de redes sociales (TikTok, Instagram, YouTube, etc).',
        category: 'descarga',
        queueTier: 'heavy',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'command'
        },
        handler: {
            module: '../commands/descargar.js',
            method: 'handleDescargar',
            invokeArgs: {}
        }
    },
    {
        name: 'spotify',
        description: 'Descarga canciones o playlists desde enlaces de Spotify.',
        category: 'descarga',
        queueTier: 'heavy',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'command'
        },
        handler: {
            module: '../commands/spotify.js',
            method: 'handleSpotify',
            invokeArgs: {}
        }
    },
    {
        name: 'transcribir',
        description: 'Convierte un mensaje de voz o audio a texto.',
        category: 'utilidad',
        queueTier: 'heavy',
        media: {
            required: true,
            types: ['audio', 'video'],
            errorMsg: 'Por favor, responde a un audio o video para transcribirlo.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/transcribir.js',
            method: 'handleTranscribir',
            invokeArgs: {}
        }
    },
    {
        name: 'convertir',
        description: 'Convierte archivos multimedia a otros formatos (ej. video a mp3).',
        category: 'conversion',
        queueTier: 'heavy',
        media: {
            required: true,
            types: ['audio', 'video'],
            errorMsg: 'Por favor, adjunta un archivo de audio o video para convertir.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/convertir.js',
            method: 'handleConvertir',
            invokeArgs: {}
        }
    },
    {
        name: 'sticker',
        description: 'Crea un sticker a partir de una imagen, video o GIF.',
        category: 'sticker',
        queueTier: 'light',
        media: {
            required: true,
            types: ['image', 'video', 'gif'],
            errorMsg: 'Por favor, envía una imagen, video o GIF para hacer el sticker.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/sticker.js',
            method: 'handleSticker',
            invokeArgs: {}
        }
    },
    {
        name: 'info',
        description: 'Muestra información detallada y metadatos sobre un archivo multimedia.',
        category: 'utilidad',
        queueTier: 'light',
        media: {
            required: true,
            types: ['any'],
            errorMsg: 'Por favor, adjunta un archivo para ver su información.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/info.js',
            method: 'handleInfo',
            invokeArgs: {}
        }
    },
    {
        name: 'buscar',
        description: 'Busca archivos en Google Drive o internet.',
        category: 'utilidad',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/buscar.js',
            method: 'handleBuscar',
            invokeArgs: {}
        }
    },
    {
        name: 'doc',
        description: 'Convierte imágenes a formato de documento PDF.',
        category: 'archivo',
        queueTier: 'heavy',
        media: {
            required: true,
            types: ['image', 'document'],
            errorMsg: 'Envía un documento o imagen para procesar.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/documentos.js',
            method: 'handleDoc',
            invokeArgs: {}
        }
    },
    {
        name: 'pdf2img',
        description: 'Convierte un archivo PDF en imágenes.',
        category: 'archivo',
        queueTier: 'heavy',
        media: {
            required: true,
            types: ['document'],
            errorMsg: 'Por favor, envía un archivo PDF para convertir a imágenes.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/documentos.js',
            method: 'handlePdf2Img',
            invokeArgs: {}
        }
    },
    {
        name: 'comprimir',
        description: 'Comprime un archivo multimedia o documento para reducir su tamaño.',
        category: 'archivo',
        queueTier: 'light',
        media: {
            required: true,
            types: ['video', 'document', 'audio'],
            errorMsg: 'Adjunta un archivo que desees comprimir.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/documentos.js',
            method: 'handleComprimir',
            invokeArgs: {}
        }
    },
    {
        name: 'unirpdf',
        description: 'Une múltiples archivos PDF en uno solo.',
        category: 'archivo',
        queueTier: 'heavy',
        media: {
            required: true,
            types: ['document'],
            errorMsg: 'Por favor, envía los archivos PDF que deseas unir.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/documentos.js',
            method: 'handleUnirPdf',
            invokeArgs: {}
        }
    },
    {
        name: 'leer',
        description: 'Extrae el texto de una imagen mediante OCR.',
        category: 'utilidad',
        queueTier: 'light',
        media: {
            required: true,
            types: ['image'],
            errorMsg: 'Por favor, envía una imagen que contenga texto.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/ocr.js',
            method: 'handleLeer',
            invokeArgs: {}
        }
    },
    {
        name: 'efecto',
        description: 'Aplica efectos de audio (ardilla, lento, robot) a un mensaje de voz o canción.',
        category: 'conversion',
        queueTier: 'light',
        media: {
            required: true,
            types: ['audio', 'video'],
            errorMsg: 'Envía un audio o video para aplicarle el efecto.'
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/efectos.js',
            method: 'handleEfecto',
            invokeArgs: {}
        }
    },
    {
        name: 'qr',
        description: 'Genera un código QR a partir de texto o lee un QR desde una imagen.',
        category: 'utilidad',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/qr.js',
            method: 'handleQr',
            invokeArgs: {}
        }
    },
    {
        name: 'moderacion',
        description: 'Herramientas para administrar el grupo, como expulsar o silenciar usuarios.',
        category: 'admin',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/moderacion.js',
            method: 'handleModeracion',
            invokeArgs: {}
        }
    },
    {
        name: 'rank',
        description: 'Muestra el rango y la experiencia actual del usuario.',
        category: 'social',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/niveles.js',
            method: 'handleRank',
            invokeArgs: {}
        }
    },
    {
        name: 'nivel',
        description: 'Muestra el nivel actual del usuario.',
        category: 'social',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/niveles.js',
            method: 'handleRank',
            invokeArgs: {}
        }
    },
    {
        name: 'top',
        description: 'Muestra los usuarios con más experiencia y nivel en el grupo.',
        category: 'social',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/niveles.js',
            method: 'handleTop',
            invokeArgs: {}
        }
    },
    {
        name: 'maicra',
        description: 'Controla el servidor de Minecraft (encender, apagar, consola).',
        category: 'admin',
        queueTier: 'heavy',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/maicra.js',
            method: 'handleMaicra',
            invokeArgs: {}
        }
    },
    {
        name: 'drive_upload',
        description: 'Sube un archivo multimedia o documento a Google Drive.',
        category: 'archivo',
        queueTier: 'heavy',
        media: {
            required: true,
            types: ['any'],
            errorMsg: 'Por favor adjunta un archivo para subirlo a Drive.'
        },
        ui: {
            handledBy: 'command'
        },
        handler: {
            module: '../commands/drive.js',
            method: 'handleDrive',
            invokeArgs: { accion: 'upload' }
        }
    },
    {
        name: 'drive_quota',
        description: 'Consulta el espacio disponible y ocupado en Google Drive.',
        category: 'utilidad',
        queueTier: 'heavy',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/drive.js',
            method: 'handleDrive',
            invokeArgs: { accion: 'quota' }
        }
    },
    {
        name: 'apagate',
        description: 'Apaga el bot de forma segura y limpia los procesos.',
        category: 'admin',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../commands/sistema.js',
            method: 'handleApagar',
            invokeArgs: {}
        }
    },
    {
        name: 'chat',
        description: 'Responde a saludos, preguntas casuales o chistes de forma natural.',
        category: 'social',
        queueTier: 'light',
        media: {
            required: false,
            types: [],
            errorMsg: ''
        },
        ui: {
            handledBy: 'dispatcher'
        },
        handler: {
            module: '../services/ai.js',
            method: 'callAI',
            invokeArgs: {}
        }
    }
];
