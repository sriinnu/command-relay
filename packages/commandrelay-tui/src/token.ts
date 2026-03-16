import { readFileSync } from "node:fs";
import process from "node:process";
import readline from "node:readline";

const AUTH_TOKEN_ENV = ["CRC_TOKEN", "COMMANDRELAY_TOKEN"] as const;
const AUTH_TOKEN_FILE_ENV = ["CRC_TOKEN_FILE", "COMMANDRELAY_TOKEN_FILE"] as const;

/**
 * Resolve an auth token from environment variables or files.
 */
export function resolveStoredAuthToken(): string | null {
  for (const tokenFileEnv of AUTH_TOKEN_FILE_ENV) {
    const tokenFile = process.env[tokenFileEnv];
    if (!tokenFile) continue;
    try {
      const value = readFileSync(tokenFile, "utf8").trim();
      if (value) return value;
    } catch {
      // ignore missing/invalid token files
    }
  }
  for (const tokenEnv of AUTH_TOKEN_ENV) {
    const token = process.env[tokenEnv]?.trim();
    if (token) return token;
  }
  return null;
}

/**
 * Prompt for an auth token using masked terminal input.
 */
export function promptToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = process.stdin;
    const output = process.stdout;
    if (!stream.isTTY) {
      const rl = readline.createInterface({ input: stream, output });
      rl.question("Auth token: ", (answer) => {
        rl.close();
        resolve(answer.trim() || null);
      });
      return;
    }

    output.write("Auth token: ");
    let restoreRawMode = false;
    const chars: string[] = [];
    let resolved = false;

    const finish = (value: string | null): void => {
      if (resolved) return;
      resolved = true;
      stream.off("data", onData);
      if (restoreRawMode && typeof stream.setRawMode === "function") {
        stream.setRawMode(false);
      }
      output.write("\n");
      resolve((value ?? "").trim() || null);
    };

    const onData = (chunk: Buffer): void => {
      const data = chunk.toString("utf8");
      for (const char of data) {
        if (char === "\r" || char === "\n") {
          finish(chars.join(""));
          return;
        }
        if (char === "\u0003") {
          finish("");
          return;
        }
        if (char === "\u0004") {
          finish("");
          return;
        }
        if (char === "\b" || char === "\u007f") {
          if (chars.length > 0) {
            chars.pop();
            output.write("\b \b");
          }
          continue;
        }
        if (char.codePointAt(0) !== undefined && char.codePointAt(0)! >= 32) {
          chars.push(char);
          output.write("*");
        }
      }
    };

    stream.resume();
    if (typeof stream.setRawMode === "function") {
      stream.setRawMode(true);
      restoreRawMode = true;
    }
    stream.on("data", onData);
  });
}
