import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = process.cwd();
const nodeModulesDir = path.join(projectRoot, "node_modules");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const preferredApiPort = Number(process.env.PORT || 3000);
const preferredWebPort = Number(process.env.VITE_PORT || 5183);
const preferredWebHost = process.env.VITE_HOST || "127.0.0.1";
const managedChildren = [];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} was interrupted by ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
}

function checkPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

async function findAvailablePort(startPort, host = "127.0.0.1") {
  let port = startPort;

  while (!(await checkPortAvailable(port, host))) {
    port += 1;
  }

  return port;
}

function spawnManaged(name, args, env) {
  const child = spawn(npmCommand, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env
  });

  child.on("error", (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (signal) {
      console.error(`${name} exited with signal ${signal}`);
      shutdown(1);
      return;
    }

    if (code !== 0) {
      console.error(`${name} exited with code ${code}`);
      shutdown(code || 1);
    }
  });

  managedChildren.push(child);
  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of managedChildren) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    process.exit(code);
  }, 150);
}

async function main() {
  if (!fs.existsSync(nodeModulesDir)) {
    console.log("node_modules not found, installing dependencies...");
    await run(npmCommand, ["install"]);
  }

  const apiPort = await findAvailablePort(preferredApiPort);
  const webPort = await findAvailablePort(preferredWebPort, preferredWebHost);
  const sharedEnv = {
    ...process.env,
    PORT: String(apiPort),
    VITE_PORT: String(webPort),
    VITE_HOST: preferredWebHost,
    VITE_API_BASE_URL: `http://localhost:${apiPort}`
  };

  console.log(`Starting CW-Ops on frontend http://localhost:${webPort}/quota-monitor`);
  console.log(`Backend health check: http://localhost:${apiPort}/api/health`);

  spawnManaged("API", ["run", "server"], sharedEnv);
  spawnManaged("Web", ["run", "client"], sharedEnv);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
