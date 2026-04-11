/**
 * @file HTTP tests for trusted-device host gating and remote pairing flow.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import type { BridgeConfig } from "../config.js";
import { handleTrustedDeviceHttpRequest } from "./trusted-device-http.js";
import { TrustedDeviceAuthority } from "./trusted-device-authority.js";

function createSigningPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

function signChallenge(privateKeyPem: string, challenge: string): string {
  return sign("sha256", Buffer.from(challenge, "utf8"), privateKeyPem).toString("base64url");
}

function createRequest(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  headers: Record<string, string> = {},
  remoteAddress = "127.0.0.1"
): IncomingMessage {
  const req = Readable.from(body ? [JSON.stringify(body)] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { host: "relay.example.test", ...headers } as IncomingMessage["headers"];
  req.socket = { encrypted: false, remoteAddress } as unknown as IncomingMessage["socket"];
  return req;
}

function createResponse(): ServerResponse & { statusCodeValue: number; body: string } {
  const response = {
    statusCodeValue: 0,
    body: "",
    writeHead(statusCode: number) {
      this.statusCodeValue = statusCode;
      return this;
    },
    end(body?: string | Buffer | Uint8Array) {
      this.body = typeof body === "string" ? body : body ? Buffer.from(body).toString("utf8") : "";
      return this;
    }
  };
  return response as ServerResponse & { statusCodeValue: number; body: string };
}

async function handle(
  authority: TrustedDeviceAuthority,
  config: BridgeConfig,
  req: IncomingMessage
): Promise<ReturnType<typeof createResponse>> {
  const res = createResponse();
  const handled = await handleTrustedDeviceHttpRequest(req, res, { authority, config });
  assert.equal(handled, true);
  return res;
}

test("pairing session create and status require host auth while claim/prove/confirm stay open", async () => {
  const authority = new TrustedDeviceAuthority();
  const config = {
    authToken: "bridge-token",
    trustedDeviceAuthEnabled: true,
    publicApiBaseUrl: null,
    publicWebSocketUrl: null
  } as BridgeConfig;
  const keys = createSigningPair();

  const deniedCreate = await handle(authority, config, createRequest("POST", "/pair/sessions", { relayId: "relay-1" }));
  assert.equal(deniedCreate.statusCodeValue, 401);
  assert.equal(JSON.parse(deniedCreate.body).code, "host_auth_required");

  const create = await handle(
    authority,
    config,
    createRequest("POST", "/pair/sessions", { relayId: "relay-1" }, { authorization: "Bearer bridge-token" })
  );
  assert.equal(create.statusCodeValue, 200);
  const session = JSON.parse(create.body) as { pairingSessionId: string; pairingToken: string; verificationCode: string };

  const deniedStatus = await handle(authority, config, createRequest("GET", `/pair/sessions/${session.pairingSessionId}`, null));
  assert.equal(deniedStatus.statusCodeValue, 401);
  assert.equal(JSON.parse(deniedStatus.body).code, "host_auth_required");

  const status = await handle(
    authority,
    config,
    createRequest("GET", `/pair/sessions/${session.pairingSessionId}`, null, { authorization: "Bearer bridge-token" })
  );
  assert.equal(status.statusCodeValue, 200);
  assert.equal(JSON.parse(status.body).status, "pending");

  const claim = await handle(
    authority,
    config,
    createRequest("POST", "/pair/claim", {
      pairingSessionId: session.pairingSessionId,
      pairingToken: session.pairingToken,
      publicKey: keys.publicKeyPem
    })
  );
  assert.equal(claim.statusCodeValue, 200);
  const claimBody = JSON.parse(claim.body) as { claimId: string; challenge: string; verificationCode: string };

  const prove = await handle(
    authority,
    config,
    createRequest("POST", "/pair/prove", {
      claimId: claimBody.claimId,
      challengeProof: signChallenge(keys.privateKeyPem, claimBody.challenge)
    })
  );
  assert.equal(prove.statusCodeValue, 200);

  const confirm = await handle(
    authority,
    config,
    createRequest("POST", "/pair/confirm", {
      claimId: claimBody.claimId,
      verificationCode: claimBody.verificationCode
    })
  );
  assert.equal(confirm.statusCodeValue, 200);
  assert.equal(authority.getPairingSessionStatus(session.pairingSessionId)?.status, "confirmed");
});

test("pairing session create and status fall back to loopback-only when no auth token is configured", async () => {
  const authority = new TrustedDeviceAuthority();
  const config = {
    authToken: null,
    trustedDeviceAuthEnabled: true,
    publicApiBaseUrl: null,
    publicWebSocketUrl: null
  } as BridgeConfig;

  const deniedCreate = await handle(
    authority,
    config,
    createRequest("POST", "/pair/sessions", { relayId: "relay-1" }, {}, "203.0.113.20")
  );
  assert.equal(deniedCreate.statusCodeValue, 401);
  assert.equal(JSON.parse(deniedCreate.body).code, "host_auth_required");

  const create = await handle(
    authority,
    config,
    createRequest("POST", "/pair/sessions", { relayId: "relay-1" })
  );
  assert.equal(create.statusCodeValue, 200);
  const session = JSON.parse(create.body) as { pairingSessionId: string };

  const deniedStatus = await handle(
    authority,
    config,
    createRequest("GET", `/pair/sessions/${session.pairingSessionId}`, null, {}, "203.0.113.20")
  );
  assert.equal(deniedStatus.statusCodeValue, 401);
  assert.equal(JSON.parse(deniedStatus.body).code, "host_auth_required");
});
