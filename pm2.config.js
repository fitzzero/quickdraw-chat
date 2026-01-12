/**
 * PM2 configuration for quickdraw-chat
 * 
 * Usage:
 *   pm2 start pm2.config.js
 *   pm2 logs
 *   pm2 stop all
 *   pm2 restart all
 * 
 * For production deployment:
 *   pm2 start pm2.config.js --env production
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'quickdraw-api',
      cwd: './apps/api',
      script: 'pnpm',
      args: 'start',
      instances: 1, // Socket.io requires sticky sessions for multiple instances
      exec_mode: 'fork', // Use 'cluster' only if you configure sticky sessions
      env: {
        NODE_ENV: 'development',
        BACKEND_PORT: 4000,
      },
      env_production: {
        NODE_ENV: 'production',
        BACKEND_PORT: 4000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Restart on file changes (development only)
      watch: false,
      // Restart if memory exceeds 500MB
      max_memory_restart: '500M',
      // Auto restart on crash
      autorestart: true,
      // Max restart attempts
      max_restarts: 10,
      // Delay between restarts
      restart_delay: 4000,
    },
    {
      name: 'quickdraw-web',
      cwd: './apps/web',
      script: 'pnpm',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      watch: false,
      max_memory_restart: '500M',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
    },
  ],
};
