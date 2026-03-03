/**
 * @file Minimal static preview server for `apps/web` extension action.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

/**
 * Runs a local static preview server for the web app extension.
 *
 * @param extension Extension descriptor with `id` and `rootDir`.
 * @param passthrough CLI args (`--host`, `--port`).
 */
export async function runWebPreview(
  extension: { id: string; rootDir: string },
  passthrough: string[]
): Promise<void> {
  const { host, port } = parsePreviewOptions(passthrough);
  const appRoot = path.resolve(extension.rootDir);

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    await handleWebRequest(appRoot, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  process.stdout.write(`Serving ${extension.id} from ${appRoot} on http://${host}:${port}\n`);
  process.stdout.write("Press Ctrl+C to stop.\n");

  const stop = () => {
    server.close((error) => {
      if (error) {
        process.stderr.write(`preview shutdown error: ${error.message}\n`);
        process.exitCode = 1;
      }
      process.exit();
    });
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function parsePreviewOptions(argv: string[]): { host: string; port: number } {
  let host = "127.0.0.1";
  let port = 4173;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const option = parseOptionToken(token);
    if (option.flag === "--host") {
      host = consumeValue(argv, option.inlineValue, "--host", index);
      if (option.inlineValue === undefined) index += 1;
      continue;
    }
    if (option.flag === "--port") {
      const rawPort = consumeValue(argv, option.inlineValue, "--port", index);
      if (option.inlineValue === undefined) index += 1;
      const parsedPort = Number.parseInt(rawPort, 10);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        throw new Error(`Invalid --port value: ${rawPort}`);
      }
      port = parsedPort;
      continue;
    }
    throw new Error(`Unsupported preview option: ${token}`);
  }

  return { host, port };
}

async function handleWebRequest(
  appRoot: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const requestPath = (request.url ?? "/").split("?")[0];
  const resolvedPath = resolvePublicPath(appRoot, requestPath);
  if (!resolvedPath) {
    response.statusCode = 400;
    response.end("Invalid request path.");
    return;
  }

  try {
    const body = await readFile(resolvedPath);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypeFor(resolvedPath));
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end("Not found.");
  }
}

function resolvePublicPath(appRoot: string, requestPath: string): string | null {
  let normalized = requestPath;
  if (normalized === "/") {
    normalized = "/index.html";
  } else if (normalized.endsWith("/")) {
    normalized = `${normalized}index.html`;
  }

  const safePath = path.posix.normalize(normalized);
  const relativePath = safePath.startsWith("/") ? safePath.slice(1) : safePath;
  const absolutePath = path.resolve(appRoot, relativePath);
  const normalizedRoot = appRoot.endsWith(path.sep) ? appRoot : `${appRoot}${path.sep}`;
  if (absolutePath !== appRoot && !absolutePath.startsWith(normalizedRoot)) {
    return null;
  }

  return absolutePath;
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function parseOptionToken(token: string): { flag: string; inlineValue?: string } {
  const delimiterIndex = token.indexOf("=");
  if (delimiterIndex === -1) {
    return { flag: token };
  }

  return {
    flag: token.slice(0, delimiterIndex),
    inlineValue: token.slice(delimiterIndex + 1)
  };
}

function consumeValue(
  argv: string[],
  inlineValue: string | undefined,
  flag: string,
  index: number
): string {
  if (inlineValue !== undefined) {
    return inlineValue;
  }

  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }
  return next;
}

