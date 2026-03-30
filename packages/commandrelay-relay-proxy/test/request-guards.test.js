import assert from "node:assert/strict";
import test from "node:test";
import { extractBearerTokenFromRequest, isTokenValidFromRequest } from "../src/request-guards.js";
function createRequest(overrides = {}) {
    return {
        headers: {},
        url: "/status",
        ...overrides
    };
}
test("extractBearerTokenFromRequest reads the authorization header", () => {
    const request = createRequest({
        headers: {
            authorization: "Bearer secret-token"
        }
    });
    assert.equal(extractBearerTokenFromRequest(request), "secret-token");
});
test("extractBearerTokenFromRequest ignores query tokens", () => {
    const request = createRequest({
        url: "/status?token=secret-token"
    });
    assert.equal(extractBearerTokenFromRequest(request), "");
});
test("isTokenValidFromRequest rejects requests that only provide query tokens", () => {
    const request = createRequest({
        url: "/status?token=secret-token"
    });
    assert.equal(isTokenValidFromRequest(request, "secret-token"), false);
});
test("isTokenValidFromRequest accepts the matching bearer token", () => {
    const request = createRequest({
        headers: {
            authorization: "Bearer secret-token"
        },
        url: "/status?token=wrong-token"
    });
    assert.equal(isTokenValidFromRequest(request, "secret-token"), true);
});
