import { createRelayProxyServer } from "./dist/index.js";
import { WebSocket, WebSocketServer } from "ws";

const upstreamPort = 19990;
const relayPort = 19991;

const upstream = new WebSocketServer({ host: "127.0.0.1", port: upstreamPort, path: "/ws" });
upstream.on("connection", (socket) => {
  console.log("upstream conn");
  socket.on("message", (data) => {
    console.log("upstream got", data.toString());
    socket.send(`echo:${data}`);
  });
  socket.on("close", (code, reason) => {
    console.log("upstream close", code, reason?.toString());
  });
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
  maxConnections: 4,
  idleTimeoutMs: 2000,
  shutdownTimeoutMs: 2000
});

await handle.started;
console.log("relay started", relayPort);

await new Promise((r) => setTimeout(r, 300));

const socket = new WebSocket(`ws://127.0.0.1:${relayPort}/ws`);
socket.on("open", () => {
  console.log("relay ws open");
  socket.send("ping");
});
socket.on("message", (msg) => {
  console.log("relay msg", msg.toString());
  setTimeout(async () => {
    await handle.close();
    upstream.close();
    process.exit(0);
  }, 200);
});
socket.on("error", (error) => {
  console.error("relay err", error.message);
});
socket.on("close", (code, reason) => {
  console.log("relay close", code, reason?.toString());
});

setTimeout(async () => {
  console.log("timeout exit");
  await handle.close();
  upstream.close();
}, 5000);
