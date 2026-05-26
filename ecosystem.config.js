// PM2 ecosystem config — AiKlao Mobile API (aiklao_mb)
// Usage:   pm2 start ecosystem.config.js
// Reload:  pm2 reload aiklao_mb
// Restart: pm2 restart aiklao_mb --update-env

module.exports = {
  apps: [
    {
      name: "aiklao_mb",
      script: "server.js",
      cwd: "/var/www/aiklao_mb/demo_app_ai_klao_mb",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",

      // PM2 injects these before dotenv runs; dotenv (override:false) will not overwrite them.
      // PORT must be explicit here — must not collide with aiklao_be:3000.
      env: {
        NODE_ENV: "production",
        PORT: 3002
      },

      // Restart policy — prevents infinite crash loops.
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 3000,

      // Logs
      out_file: "/root/.pm2/logs/aiklao-mb-out.log",
      error_file: "/root/.pm2/logs/aiklao-mb-error.log",
      merge_logs: true,
      time: true
    }
  ]
};
