import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  SignJWT,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  type JSONWebKeySet,
  type JWK,
  type KeyLike,
} from "jose";
import { AuthError, createAnalyticsTokenIssuer, createJwtStrategy } from "./auth.js";
import type { ServeRequest } from "./types.js";

const ISSUER = "https://issuer.example.com/";
const AUDIENCE = "https://api.example.com";
const KID = "test-key";
const SECRET = "test-secret-at-least-32-bytes-long";

let privateKey: KeyLike;
let publicKey: KeyLike;
let jwks: JSONWebKeySet;
let jwksServer: Server;
let jwksUri: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  jwks = { keys: [publicJwk] };

  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(jwks));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const address = jwksServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start JWKS test server");
  }
  jwksUri = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    jwksServer.close((error) => error ? reject(error) : resolve());
  });
});

async function signRsToken(
  claims: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string; expiresIn?: string; kid?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: overrides.kid ?? KID })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? "2h")
    .sign(privateKey);
}

async function signHsToken(
  claims: Record<string, unknown>,
  secret = SECRET,
  overrides: { issuer?: string; audience?: string; expiresIn?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? "2h")
    .sign(new TextEncoder().encode(secret));
}

function bearerRequest(token: string, header = "authorization"): ServeRequest {
  return { method: "GET", path: "/", query: {}, headers: { [header]: `Bearer ${token}` } };
}

const noHeaders: ServeRequest = { method: "GET", path: "/", query: {}, headers: {} };

describe("createJwtStrategy", () => {
  it("throws if neither secret nor jwksUri is provided", () => {
    expect(() => createJwtStrategy({} as never)).toThrow(/secret.*jwksUri/);
  });

  it("throws for empty secret and JWKS key sources", () => {
    expect(() => createJwtStrategy({ secret: "" })).toThrow(/secret.*empty/);
    expect(() => createJwtStrategy({ secret: new Uint8Array() })).toThrow(/secret.*empty/);
    expect(() => createJwtStrategy({ jwksUri: "   " })).toThrow(/jwksUri.*empty/);
  });

  it("verifies a valid HS256 token and maps default claims", async () => {
    const strategy = createJwtStrategy({ secret: SECRET, issuer: ISSUER, audience: AUDIENCE });
    const token = await signHsToken({
      sub: "user-1",
      org_id: "tenant-1",
      roles: ["admin"],
      scope: "read:metrics write:metrics",
    });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth?.userId).toBe("user-1");
    expect(auth?.tenantId).toBe("tenant-1");
    expect(auth?.roles).toEqual(["admin"]);
    expect(auth?.scopes).toEqual(["read:metrics", "write:metrics"]);
  });

  it("verifies a valid RS256 token against a remote JWKS", async () => {
    const strategy = createJwtStrategy({ jwksUri, issuer: ISSUER, audience: AUDIENCE });
    const token = await signRsToken({ sub: "user-1", roles: ["admin"] });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth?.userId).toBe("user-1");
    expect(auth?.roles).toEqual(["admin"]);
  });

  it("maps an array `scopes` claim", async () => {
    const strategy = createJwtStrategy({ secret: SECRET });
    const token = await signHsToken({ sub: "u", scopes: ["a", "b"] });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth?.scopes).toEqual(["a", "b"]);
  });

  it("supports a custom claim mapper", async () => {
    const strategy = createJwtStrategy<{ userId?: string; orgId?: string }>({
      secret: SECRET,
      mapClaims: (payload) => ({ userId: payload.sub as string, orgId: payload.org as string }),
    });
    const token = await signHsToken({ sub: "user-1", org: "acme" });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth).toEqual({ userId: "user-1", orgId: "acme" });
  });

  it("respects a custom header and prefix", async () => {
    const strategy = createJwtStrategy({ secret: SECRET, header: "x-access-token", prefix: "JWT " });
    const token = await signHsToken({ sub: "u" });

    const auth = await strategy({
      request: { method: "GET", path: "/", query: {}, headers: { "x-access-token": `JWT ${token}` } },
    });

    expect(auth?.userId).toBe("u");
  });

  it("throws MISSING when no token is present", async () => {
    const strategy = createJwtStrategy({ secret: SECRET });
    await expect(strategy({ request: noHeaders }))
      .rejects.toMatchObject({ name: "AuthError", reason: "MISSING" });
  });

  it("resolves to null for a missing token when optional", async () => {
    const strategy = createJwtStrategy({ secret: SECRET, optional: true });
    await expect(strategy({ request: noHeaders })).resolves.toBeNull();
  });

  it("throws INVALID for a token with the wrong issuer", async () => {
    const strategy = createJwtStrategy({ secret: SECRET, issuer: ISSUER, audience: AUDIENCE });
    const token = await signHsToken({ sub: "u" }, SECRET, { issuer: "https://evil.example.com/" });

    await expect(strategy({ request: bearerRequest(token) }))
      .rejects.toMatchObject({ name: "AuthError", reason: "INVALID" });
  });

  it("throws INVALID for a token with an unknown JWKS kid", async () => {
    const strategy = createJwtStrategy({ jwksUri, issuer: ISSUER, audience: AUDIENCE });
    const token = await signRsToken({ sub: "u" }, { kid: "unknown-key" });

    await expect(strategy({ request: bearerRequest(token) }))
      .rejects.toMatchObject({ name: "AuthError", reason: "INVALID" });
  });

  it("throws INVALID for an expired token", async () => {
    const strategy = createJwtStrategy({ secret: SECRET });
    const token = await signHsToken({ sub: "u" }, SECRET, { expiresIn: "-1h" });

    await expect(strategy({ request: bearerRequest(token) }))
      .rejects.toMatchObject({ name: "AuthError", reason: "INVALID" });
  });

  it("throws INVALID (AuthError) for a malformed token", async () => {
    const strategy = createJwtStrategy({ secret: SECRET });
    await expect(strategy({ request: bearerRequest("not-a-jwt") }))
      .rejects.toBeInstanceOf(AuthError);
  });

  it("rejects HS256 tokens for a JWKS strategy", async () => {
    const strategy = createJwtStrategy({ jwksUri });
    const publicKeyBytes = new TextEncoder().encode(await exportSPKI(publicKey));
    const token = await new SignJWT({ sub: "u" })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(publicKeyBytes);

    await expect(strategy({ request: bearerRequest(token) }))
      .rejects.toMatchObject({ name: "AuthError", reason: "INVALID" });
  });
});

describe("createAnalyticsTokenIssuer", () => {
  it("throws for an empty secret", () => {
    expect(() => createAnalyticsTokenIssuer({ secret: "" })).toThrow(/secret.*empty/);
    expect(() => createAnalyticsTokenIssuer({ secret: new Uint8Array() })).toThrow(/secret.*empty/);
  });

  it("mints tokens that round-trip through createJwtStrategy defaults", async () => {
    const issueToken = createAnalyticsTokenIssuer({
      secret: SECRET,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: "15m",
    });
    const token = await issueToken({
      userId: "user-1",
      tenantId: "tenant-1",
      roles: ["admin"],
    });
    const strategy = createJwtStrategy({ secret: SECRET, issuer: ISSUER, audience: AUDIENCE });

    const auth = await strategy({ request: bearerRequest(token) });

    expect(auth?.userId).toBe("user-1");
    expect(auth?.tenantId).toBe("tenant-1");
    expect(auth?.roles).toEqual(["admin"]);
  });
});
