// PM2 ecosystem config — AiKlao Backend
// ใช้: pm2 start ecosystem.config.js
// reload: pm2 reload aiklao_be
// restart: pm2 restart aiklao_be --update-env

module.exports = {
  apps: [
    {
      name: "aiklao_be",
      script: "server.js",
      cwd: "/var/www/aiklao_be/demo_app_ai_klao_be",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",

      // env (override .env ไม่ได้ — pm2 inject)
      env: {
        NODE_ENV: "production"
      },

      // restart policy — กัน infinite loop
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 3000,

      // logs
      out_file: "/root/.pm2/logs/aiklao-be-out.log",
      error_file: "/root/.pm2/logs/aiklao-be-error.log",
      merge_logs: true,
      time: true
    }
  ]
};