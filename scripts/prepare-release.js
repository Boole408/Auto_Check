import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const projectRoot = process.cwd();
const releaseRoot = path.join(projectRoot, ".release");
const appRoot = path.join(releaseRoot, "app");

const requiredPaths = [
  "dist/index.html",
  "server/index.js",
  "deploy/install-ubuntu.sh",
  "deploy/auto-cw.service",
  "deploy/autocw.ccwu.cc.nginx.conf",
  "package.json",
  "package-lock.json"
];

const releaseEntries = [
  "dist",
  "server",
  "deploy",
  "package.json",
  "package-lock.json",
  ".env.example",
  "README.md"
];

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required release file: ${relativePath}`);
  }
}

fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(appRoot, { recursive: true });

for (const entry of releaseEntries) {
  fs.cpSync(path.join(projectRoot, entry), path.join(appRoot, entry), {
    recursive: true,
    force: true
  });
}

let gitCommit = "unknown";
try {
  gitCommit = execSync("git rev-parse --short HEAD", {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
} catch {
  // Git metadata is optional for local release packaging.
}

const releaseInfo = {
  generatedAt: new Date().toISOString(),
  gitCommit
};

fs.writeFileSync(path.join(appRoot, "release.json"), JSON.stringify(releaseInfo, null, 2), "utf8");

console.log(`Release bundle prepared at ${appRoot}`);
