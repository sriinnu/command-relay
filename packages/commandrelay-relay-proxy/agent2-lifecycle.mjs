import { createRelayProxyServer } from "./dist/index.js";
import { WebSocket, WebSocketServer } from "ws";
import { request } from "node:http";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestStatus(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on("error", reject);
    req.end();
  });
}

function openSocket(url) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      resolve({ socket, status: "timeout" });
    }, 1200);

    socket.once("open", () => {
      clearTimeout(timer);
      resolve({ socket, status: "open" });
    });

    socket.once("close", () => {
      clearTimeout(timer);
      resolve({ socket, status: "close" });
    });

    socket.once("error", () => {
      clearTimeout(timer);
      resolve({ socket, status: "error" });
    });
  });
}

async function closeSocket(socket) {
  if (!socket) return;
  if (socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState !== WebSocket.OPEN) {
    socket.terminate();
    return;
  }
  socket.close();
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      resolve();
    }, 500);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitClosedIfOpen(socket, timeoutMs) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners("close");
      resolve(false);
    }, timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function run() {
  const upstreamPort = 19210;
  const relayPort = 19211;

  const upstream = new WebSocketServer({ host: "127.0.0.1", port: upstreamPort, path: "/ws" });
  upstream.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data}`));
  });

  const handle = await createRelayProxyServer({
    listenHost: "127.0.0.1",
    listenPort: relayPort,
    relayPath: "/ws",
    healthPath: "/health",
    upstreamUrl: `ws://127.0.0.1:${upstreamPort}/ws`,
    upstreamSubprotocols: [],
    allowedOrigins: [],
    requiredToken: "",
    maxConnections: 1,
    idleTimeoutMs: 500,
    shutdownTimeoutMs: 1500
  });
  await handle.started;

  const pass1 = (await requestStatus(`http://127.0.0.1:${relayPort}/health`)).status === 200;
  const pass2 = (await requestStatus(`http://127.0.0.1:${relayPort}/health`, "POST")).status === 405;
  const pass3 = (await requestStatus(`http://127.0.0.1:${relayPort}/bad`)).status === 404;

  const first = await openSocket(`ws://127.0.0.1:${relayPort}/ws`);
  const second = await openSocket(`ws://127.0.0.1:${relayPort}/ws`);
  const pass4 = first.status === "open" && second.status !== "open";

  await closeSocket(first.socket);
  await sleep(120);

  const third = await openSocket(`ws://127.0.0.1:${relayPort}/ws`);
  let pass5 = false;
  if (third.status === "open") {
    await sleep(1_300);
    pass5 = await waitClosedIfOpen(third.socket, 600);
  }

  const fourth = await openSocket(`ws://127.0.0.1:${relayPort}/ws`);
  const beforeShutdown = fourth.status === "open";
  await handle.close();
  const pass6 = beforeShutdown && (await waitClosedIfOpen(fourth.socket, 800));

  await closeSocket(third.socket);
  await closeSocket(fourth.socket);
  await closeSocket(first.socket);
  await closeSocket(second.socket);

  for (const upstreamSocket of upstream.clients) {
    upstreamSocket.terminate();
  }
  await Promise.race([
    new Promise((resolve) => {
      upstream.close(() => {
        resolve();
      });
    }),
    new Promise((resolve) => setTimeout(resolve, 300))
  ]);

  const pass = pass1 && pass2 && pass3 && pass4 && pass5 && pass6;
  console.log("AGENT2", JSON.stringify({ pass1, pass2, pass3, pass4, pass5, pass6 }));
  process.exit(pass ? 0 : 1);
}

await run();
