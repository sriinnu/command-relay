import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const distIndexPath = resolve(packageRoot, "dist/index.js");
const npmExecPath = process.env.npm_execpath;

function runCommand(command, args = [], options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
    ...options
  });
}

function runNpm(args = [], options = {}) {
  if (typeof npmExecPath === "string" && npmExecPath.length > 0) {
    return runCommand(process.execPath, [npmExecPath, ...args], options);
  }
  const npmBinary = process.platform === "win32" ? "npm.cmd" : "npm";
  return runCommand(npmBinary, args, options);
}

const pass1 = (() => {
  const result = runNpm(["run", "check"], {
    cwd: packageRoot,
    stdio: "pipe"
  });
  if (result.status !== 0) {
    console.log("agent3-pass1-error", result.error?.message, result.status, (result.stderr || "").toString().slice(0, 200));
  }
  return result.status === 0;
})();

const pass2 = (() => {
  const result = runNpm(["run", "build"], {
    cwd: packageRoot,
    stdio: "pipe"
  });
  if (result.status !== 0) {
    console.log("agent3-pass2-error", result.error?.message, result.status, (result.stderr || "").toString().slice(0, 200));
  }
  return result.status === 0 && existsSync(distIndexPath);
})();

const pass3 = (() => {
  const result = runCommand(process.execPath, ["dist/cli.js", "--help"], {
    cwd: packageRoot,
    stdio: "pipe"
  });
  return result.status === 0 && /Usage: commandrelay-relay-proxy/.test(result.stdout + result.stderr);
})();

const pass4 = (() => {
  const result = runCommand(process.execPath, ["dist/cli.js", "--token-from-env", "missing_token"], {
    cwd: packageRoot,
    env: { ...process.env, COMMANDRELAY_RELAY_LISTEN_HOST: "127.0.0.1" },
    stdio: "pipe"
  });
  return result.status !== 0;
})();

console.log("AGENT3", JSON.stringify({ pass1, pass2, pass3, pass4 }));
if (!pass1 || !pass2 || !pass3 || !pass4) {
  process.exitCode = 1;
}
