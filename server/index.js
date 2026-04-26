import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import authRoutes from "./api/auth.js";
import quotaRoutes from "./api/quota.js";
import { assertAuthConfig } from "./utils/auth.js";
import { startAutoCheckinScheduler, stopAutoCheckinScheduler } from "./utils/caowo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, ".env") });
assertAuthConfig();

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const trustProxy = process.env.TRUST_PROXY;

if (trustProxy) {
  const numericTrustProxy = Number(trustProxy);
  app.set("trust proxy", Number.isFinite(numericTrustProxy) ? numericTrustProxy : trustProxy);
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "ok",
    data: {
      service: "cw-ops-quota-monitor",
      time: new Date().toISOString()
    }
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/quota-monitor", quotaRoutes);

const distDir = path.join(projectRoot, "dist");
app.use(express.static(distDir));
app.get(/^\/(?!api).*/, (_req, res, next) => {
  res.sendFile(path.join(distDir, "index.html"), (error) => {
    if (error) next();
  });
});

app.use((error, _req, res, _next) => {
  const status = error.status || error.response?.status || 500;
  const message = status === 429 ? "站点限流，请稍后重试" : error.message || "服务异常";
  res.status(status).json({
    success: false,
    message,
    data: null
  });
});

const server = app.listen(port, host, () => {
  startAutoCheckinScheduler();
  console.log(`CW-Ops API is running at http://${host}:${port}`);
});

function shutdown() {
  stopAutoCheckinScheduler();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
