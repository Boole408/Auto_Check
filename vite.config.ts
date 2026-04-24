import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = Number(env.PORT || 3000);
  const webPort = Number(env.VITE_PORT || 5183);
  const webHost = env.VITE_HOST || "127.0.0.1";
  const apiBaseUrl = env.VITE_API_BASE_URL || `http://localhost:${apiPort}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src")
      }
    },
    server: {
      port: webPort,
      strictPort: true,
      host: webHost,
      proxy: {
        "/api": {
          target: apiBaseUrl,
          changeOrigin: true
        }
      }
    },
    preview: {
      port: webPort,
      strictPort: true,
      host: webHost
    }
  };
});
