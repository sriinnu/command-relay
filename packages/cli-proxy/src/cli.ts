#!/usr/bin/env node

import { runCli } from "./cli-runner.js";

try {
  const exitCode = await runCli(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
} catch (error) {
  const message = error instanceof Error
    ? error.stack ?? error.message
    : String(error);
  process.stderr.write(`Unhandled cli-proxy error: ${message}\n`);
  process.exitCode = 1;
}
