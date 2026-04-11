/**
 * @file Tests for trusted-device pairing, auth, refresh, and revoke flows.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { TrustedDeviceAuthority } from "./trusted-device-authority.js";

function createAuthority(
  maxPairingSessions = 128,
  now: (() => number) | undefined = undefined
): TrustedDeviceAuthority {
  return new TrustedDeviceAuthority({
    pairingTtlMs: 60_000,
    accessTokenTtlMs: 300_000,
    refreshTokenTtlMs: 900_000,
    maxPairingSessions,
    now
  });
}

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

function completePairing(
  authority: TrustedDeviceAuthority,
  publicKeyPem: string,
  privateKeyPem: string,
  accessLevel?: "read_only" | "write" | "full_control"
) {
  const session = authority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const claim = authority.claimPairing({
    pairingSessionId: session.pairingSessionId,
    pairingToken: session.pairingToken,
    publicKey: publicKeyPem
  });
  authority.provePairing({
    claimId: claim.claimId,
    challengeProof: signChallenge(privateKeyPem, claim.challenge)
  });
  return {
    session,
    claim,
    paired: authority.confirmPairing({
      claimId: claim.claimId,
      verificationCode: claim.verificationCode,
      accessLevel
    })
  };
}

test("new pairing session revokes older idle session and pairing claim is single-use", () => {
  const authority = createAuthority();
  const first = authority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const second = authority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const { publicKeyPem } = createSigningPair();

  assert.equal(authority.getPairingSessionStatus(first.pairingSessionId)?.status, "revoked");
  assert.equal(authority.getPairingSessionStatus(second.pairingSessionId)?.status, "pending");
  assert.throws(
    () =>
      authority.claimPairing({
        pairingSessionId: first.pairingSessionId,
        pairingToken: first.pairingToken,
        publicKey: publicKeyPem
      }),
    /pairing_session_not_available/
  );

  const claim = authority.claimPairing({
    pairingSessionId: second.pairingSessionId,
    pairingToken: second.pairingToken,
    publicKey: publicKeyPem
  });
  assert.equal(authority.getPairingSessionStatus(second.pairingSessionId)?.status, "claimed");
  assert.equal(claim.verificationCode, second.verificationCode);
  assert.throws(
    () =>
      authority.claimPairing({
        pairingSessionId: second.pairingSessionId,
        pairingToken: second.pairingToken,
        publicKey: publicKeyPem
      }),
    /pairing_session_not_available/
  );
});

test("trusted-device auth default is read-only and refresh rotation invalidates the previous refresh token", () => {
  const authority = createAuthority();
  const { privateKeyPem, publicKeyPem } = createSigningPair();
  const session = authority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const claim = authority.claimPairing({
    pairingSessionId: session.pairingSessionId,
    pairingToken: session.pairingToken,
    publicKey: publicKeyPem,
    deviceName: "Primary iPhone",
    platform: "ios"
  });

  assert.throws(
    () =>
      authority.provePairing({
        claimId: claim.claimId,
        challengeProof: signChallenge(privateKeyPem, "wrong-challenge")
      }),
    /invalid_challenge_proof/
  );

  const proof = authority.provePairing({
    claimId: claim.claimId,
    challengeProof: signChallenge(privateKeyPem, claim.challenge)
  });
  assert.equal(proof.verified, true);
  assert.throws(
    () =>
      authority.confirmPairing({
        claimId: claim.claimId,
        verificationCode: "000000"
      }),
    /invalid_verification_code/
  );

  const paired = authority.confirmPairing({
    claimId: claim.claimId,
    verificationCode: claim.verificationCode
  });
  assert.equal(paired.accessLevel, "read_only");
  assert.deepEqual(paired.capabilities, ["read_only", "can_request_write", "can_request_full_control"]);
  assert.equal(authority.getPairingSessionStatus(session.pairingSessionId)?.status, "confirmed");
  assert.throws(
    () =>
      authority.confirmPairing({
        claimId: claim.claimId,
        verificationCode: claim.verificationCode
      }),
    /pairing_claim_already_used/
  );

  const authChallenge = "bridge-auth-challenge";
  const auth = authority.authenticateDevice({
    deviceId: paired.deviceId,
    accessToken: paired.accessToken,
    authChallenge,
    challengeProof: signChallenge(privateKeyPem, authChallenge)
  });
  assert.equal(auth.mode, "device");
  assert.equal(auth.accessLevel, "read_only");

  const refreshed = authority.refreshAccessToken({
    deviceId: paired.deviceId,
    refreshToken: paired.refreshToken
  });
  assert.notEqual(refreshed.refreshToken, paired.refreshToken);
  assert.notEqual(refreshed.accessToken, paired.accessToken);
  assert.throws(
    () =>
      authority.refreshAccessToken({
        deviceId: paired.deviceId,
        refreshToken: paired.refreshToken
      }),
    /invalid_refresh_token/
  );

  const revoked = authority.revokeDevice({ deviceId: paired.deviceId });
  assert.equal(revoked.revoked, true);
  assert.throws(
    () =>
      authority.authenticateDevice({
        deviceId: paired.deviceId,
        accessToken: refreshed.accessToken,
        authChallenge,
        challengeProof: signChallenge(privateKeyPem, authChallenge)
      }),
    /device_not_found|invalid_access_token/
  );
});

test("pairing confirmation is temporarily locked out after repeated wrong verification codes", () => {
  let now = 1_700_000_000_000;
  const { privateKeyPem, publicKeyPem } = createSigningPair();
  const attemptAuthority = new TrustedDeviceAuthority({
    pairingTtlMs: 60_000,
    accessTokenTtlMs: 300_000,
    refreshTokenTtlMs: 900_000,
    maxPairingSessions: 128,
    maxVerificationAttempts: 3,
    verificationCodeLockoutWindowMs: 30_000,
    now: () => now
  });
  const sessionForAttempt = attemptAuthority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const claimForAttempt = attemptAuthority.claimPairing({
    pairingSessionId: sessionForAttempt.pairingSessionId,
    pairingToken: sessionForAttempt.pairingToken,
    publicKey: publicKeyPem
  });
  attemptAuthority.provePairing({
    claimId: claimForAttempt.claimId,
    challengeProof: signChallenge(privateKeyPem, claimForAttempt.challenge)
  });

  assert.throws(
    () =>
      attemptAuthority.confirmPairing({
        claimId: claimForAttempt.claimId,
        verificationCode: "000001"
      }),
    /invalid_verification_code/
  );
  assert.throws(
    () =>
      attemptAuthority.confirmPairing({
        claimId: claimForAttempt.claimId,
        verificationCode: "000002"
      }),
    /invalid_verification_code/
  );
  assert.throws(
    () =>
      attemptAuthority.confirmPairing({
        claimId: claimForAttempt.claimId,
        verificationCode: "000003"
      }),
    /pairing_verification_code_locked/
  );
  assert.throws(
    () =>
      attemptAuthority.confirmPairing({
        claimId: claimForAttempt.claimId,
        verificationCode: claimForAttempt.verificationCode
      }),
    /pairing_verification_code_locked/
  );

  now += 40_000;
  const paired = attemptAuthority.confirmPairing({
    claimId: claimForAttempt.claimId,
    verificationCode: claimForAttempt.verificationCode
  });
  assert.equal(paired.accessLevel, "read_only");
});

test("pairing confirmation can issue write and full-control devices", () => {
  const authority = createAuthority();
  const writePair = createSigningPair();
  const fullPair = createSigningPair();
  const sessionA = authority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const claimA = authority.claimPairing({
    pairingSessionId: sessionA.pairingSessionId,
    pairingToken: sessionA.pairingToken,
    publicKey: writePair.publicKeyPem
  });
  authority.provePairing({
    claimId: claimA.claimId,
    challengeProof: signChallenge(writePair.privateKeyPem, claimA.challenge)
  });
  const writeDevice = authority.confirmPairing({
    claimId: claimA.claimId,
    verificationCode: claimA.verificationCode,
    accessLevel: "write"
  });
  assert.deepEqual(writeDevice.capabilities, ["write", "can_request_full_control"]);

  const sessionB = authority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const claimB = authority.claimPairing({
    pairingSessionId: sessionB.pairingSessionId,
    pairingToken: sessionB.pairingToken,
    publicKey: fullPair.publicKeyPem
  });
  authority.provePairing({
    claimId: claimB.claimId,
    challengeProof: signChallenge(fullPair.privateKeyPem, claimB.challenge)
  });
  const fullControlDevice = authority.confirmPairing({
    claimId: claimB.claimId,
    verificationCode: claimB.verificationCode,
    accessLevel: "full_control"
  });
  assert.deepEqual(fullControlDevice.capabilities, ["write", "full_control"]);
});

test("confirmed pairing sessions are evicted once the terminal-state cap is exceeded", () => {
  const authority = createAuthority(2);
  const keys = createSigningPair();
  const first = completePairing(authority, keys.publicKeyPem, keys.privateKeyPem);
  const second = completePairing(authority, keys.publicKeyPem, keys.privateKeyPem);
  const third = completePairing(authority, keys.publicKeyPem, keys.privateKeyPem);

  assert.equal(authority.getPairingSessionStatus(first.session.pairingSessionId), null);
  assert.equal(authority.getPairingSessionStatus(second.session.pairingSessionId)?.status, "confirmed");
  assert.equal(authority.getPairingSessionStatus(third.session.pairingSessionId)?.status, "confirmed");
  assert.equal(first.paired.accessLevel, "read_only");
});
