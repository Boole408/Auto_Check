module.exports = {
  apps: [
    {
      name: "auto-cw",
      cwd: "/opt/auto-cw/app",
      script: "server/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      merge_logs: true,
      max_memory_restart: "350M",
      out_file: "/opt/auto-cw/logs/out.log",
      error_file: "/opt/auto-cw/logs/error.log"
    }
  ]
};
