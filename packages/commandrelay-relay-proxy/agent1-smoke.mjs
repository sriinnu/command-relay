import { createRelayProxyServer } from "./dist/index.js";
import { WebSocket, WebSocketServer } from "ws";
import { request } from "node:http";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetStatus(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function waitForWs(url, options = {}, sendPayload) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    let settled = false;
    let timer;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
      socket.terminate();
    };
    timer = setTimeout(() => reject(new Error("timeout")), 3000);

    socket.once("open", () => {
      if (sendPayload === undefined) {
        done("open");
        return;
      }
      socket.once("message", (msg) => done(msg.toString()));
      socket.send(sendPayload);
    });
    socket.once("error", (error) => done(`error:${error.message}`));
    socket.once("close", (code, reason) => {
      const resolvedReason = reason ? reason.toString() : "";
      done(`close:${code}:${resolvedReason}`);
    });
  });
}

async function run() {
  const upstreamPort = 19190;
  const relayBase = 19191;

  const upstream = new WebSocketServer({ host: "127.0.0.1", port: upstreamPort, path: "/ws" });
  upstream.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data}`));
  });

  const base = await createRelayProxyServer({
    listenHost: "127.0.0.1",
    listenPort: relayBase,
    relayPath: "/ws",
    healthPath: "/health",
    upstreamUrl: `ws://127.0.0.1:${upstreamPort}/ws`,
    upstreamSubprotocols: [],
    allowedOrigins: [],
    requiredToken: "",
    maxConnections: 4,
    idleTimeoutMs: 2_000,
    shutdownTimeoutMs: 2_000
  });
  await base.started;

  const p1 = await httpGetStatus(`http://127.0.0.1:${relayBase}/health`);
  const p2 = await waitForWs(`ws://127.0.0.1:${relayBase}/ws`, {}, "ping");
  await base.close();

  const tokenPort = 19193;
  const tokenSrv = await createRelayProxyServer({
    listenHost: "127.0.0.1",
    listenPort: tokenPort,
    relayPath: "/ws",
    healthPath: "/health",
    upstreamUrl: `ws://127.0.0.1:${upstreamPort}/ws`,
    upstreamSubprotocols: [],
    allowedOrigins: [],
    requiredToken: "shared-secret",
    maxConnections: 4,
    idleTimeoutMs: 2_000,
    shutdownTimeoutMs: 2_000
  });
  await tokenSrv.started;
  const p3 = await waitForWs(`ws://127.0.0.1:${tokenPort}/ws`);
  const p4 = await waitForWs(`ws://127.0.0.1:${tokenPort}/ws`, {
    headers: { Authorization: "Bearer shared-secret" }
  }, "ping");
  await tokenSrv.close();

  const originPort = 19195;
  const originSrv = await createRelayProxyServer({
    listenHost: "127.0.0.1",
    listenPort: originPort,
    relayPath: "/ws",
    healthPath: "/health",
    upstreamUrl: `ws://127.0.0.1:${upstreamPort}/ws`,
    upstreamSubprotocols: [],
    allowedOrigins: ["https://trusted.example"],
    requiredToken: "",
    maxConnections: 4,
    idleTimeoutMs: 2_000,
    shutdownTimeoutMs: 2_000
  });
  await originSrv.started;
  const p5 = await waitForWs(`ws://127.0.0.1:${originPort}/ws`, {
    headers: { Origin: "https://trusted.example" }
  }, "ping");
  const p6 = await waitForWs(`ws://127.0.0.1:${originPort}/ws`, {
    headers: { Origin: "https://evil.example" }
  });
  await originSrv.close();
  upstream.close();
  await sleep(300);

  const expected = {
    p1: p1.status === 200,
    p2: p2 === "echo:ping",
    p3: /^close:/.test(p3) || p3.startsWith("error:"),
    p4: p4 === "echo:ping",
    p5: p5 === "echo:ping",
    p6: /^close:/.test(p6) || p6.startsWith("error:")
  };

  console.log("AGENT1", JSON.stringify(expected));
  if (Object.values(expected).some((value) => !value)) process.exitCode = 1;
}

await run();
