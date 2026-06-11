import { beforeAll, describe, expect, it } from "vitest";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWK,
  type KeyLike,
} from "jose";
import { AuthError, createJwksStrategy } from "./auth.js";
import type { ServeRequest } from "./types.js";

const ISSUER = "https://issuer.example.com/";
const AUDIENCE = "https://api.example.com";
const KID = "test-key";

let privateKey: KeyLike;
let jwks: JSONWebKeySet;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  jwks = { keys: [publicJwk] };
});

async function signToken(
  claims: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string; expiresIn?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? "2h")
    .sign(privateKey);
}

function bearerRequest(token: string, header = "authorization"): ServeRequest {
  return { method: "GET", path: "/", query: {}, headers: { [header]: `Bearer ${token}` } };
}

const noHeaders: ServeRequest = { method: "GET", path: "/", query: {}, headers: {} };

describe("createJwksStrategy", () => {
  it("throws if neither jwksUri nor jwks is provided", () => {
    expect(() => createJwksStrategy({} as never)).toThrow(/jwksUri.*jwks/);
  });

  it("verifies a valid token and maps default claims", async () => {
    const strategy = createJwksStrategy({ jwks, issuer: ISSUER, audience: AUDIENCE });
    const token = await signToken({ sub: "user-1", roles: ["admin"], scope: "read:metrics write:metrics" });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth?.userId).toBe("user-1");
    expect(auth?.roles).toEqual(["admin"]);
    expect(auth?.scopes).toEqual(["read:metrics", "write:metrics"]);
  });

  it("maps an array `scopes` claim", async () => {
    const strategy = createJwksStrategy({ jwks });
    const token = await signToken({ sub: "u", scopes: ["a", "b"] });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth?.scopes).toEqual(["a", "b"]);
  });

  it("supports a custom claim mapper", async () => {
    const strategy = createJwksStrategy<{ userId?: string; orgId?: string }>({
      jwks,
      mapClaims: (payload) => ({ userId: payload.sub as string, orgId: payload.org as string }),
    });
    const token = await signToken({ sub: "user-1", org: "acme" });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth).toEqual({ userId: "user-1", orgId: "acme" });
  });

  it("respects a custom header and prefix", async () => {
    const strategy = createJwksStrategy({ jwks, header: "x-access-token", prefix: "JWT " });
    const token = await signToken({ sub: "u" });

    const auth = await strategy({
      request: { method: "GET", path: "/", query: {}, headers: { "x-access-token": `JWT ${token}` } },
    });

    expect(auth?.userId).toBe("u");
  });

  it("throws MISSING when no token is present", async () => {
    const strategy = createJwksStrategy({ jwks });
    await expect(strategy({ request: noHeaders }))
      .rejects.toMatchObject({ name: "AuthError", reason: "MISSING" });
  });

  it("resolves to null for a missing token when optional", async () => {
    const strategy = createJwksStrategy({ jwks, optional: true });
    await expect(strategy({ request: noHeaders })).resolves.toBeNull();
  });

  it("throws INVALID for a token with the wrong issuer", async () => {
    const strategy = createJwksStrategy({ jwks, issuer: ISSUER, audience: AUDIENCE });
    const token = await signToken({ sub: "u" }, { issuer: "https://evil.example.com/" });

    await expect(strategy({ request: bearerRequest(token) }))
      .rejects.toMatchObject({ name: "AuthError", reason: "INVALID" });
  });

  it("throws INVALID for an expired token", async () => {
    const strategy = createJwksStrategy({ jwks });
    const token = await signToken({ sub: "u" }, { expiresIn: "-1h" });

    await expect(strategy({ request: bearerRequest(token) }))
      .rejects.toMatchObject({ name: "AuthError", reason: "INVALID" });
  });

  it("throws INVALID (AuthError) for a malformed token", async () => {
    const strategy = createJwksStrategy({ jwks });
    await expect(strategy({ request: bearerRequest("not-a-jwt") }))
      .rejects.toBeInstanceOf(AuthError);
  });
});
