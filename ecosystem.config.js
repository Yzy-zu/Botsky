module.exports = {
  apps: [
    {
      name: 'wasa',
      script: 'src/core/server.js',
      cwd: '/home/petrov/botsky',              // Directorio raíz donde está el .env
      watch: false,
      autorestart: true,
      env: {
        TZ: 'America/Mexico_City',
      },
      max_restarts: 10,
      restart_delay: 3000,                   // Esperar 3s antes de reintentar
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/petrov/.pm2/logs/wasa-error.log',
      out_file: '/home/petrov/.pm2/logs/wasa-out.log',
      merge_logs: true,
      node_args: '--dns-result-order=ipv4first --expose-gc',
    },
  ],
};
