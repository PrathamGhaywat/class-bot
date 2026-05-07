import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "class_admin_token";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function readCookie(req: Request, cookieName: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [name, ...rest] = part.split("=");
    if (name === cookieName) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

export function createAdminToken(secret: string): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const nonce = randomBytes(10).toString("hex");
  const payload = `${expiresAt}.${nonce}`;
  const signature = sign(secret, payload);
  return `${payload}.${signature}`;
}

export function verifyAdminToken(secret: string, token: string | null): boolean {
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [expiresAtRaw, nonce, signature] = parts;
  if (!expiresAtRaw || !nonce || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return false;
  }

  const expected = sign(secret, `${expiresAtRaw}.${nonce}`);
  return safeEqual(expected, signature);
}

export function setAuthCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
      SESSION_MAX_AGE_MS / 1000
    }`,
  );
}

export function clearAuthCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const bearerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : null;
    const cookieToken = readCookie(req, COOKIE_NAME);
    const token = bearerToken ?? cookieToken;

    if (!verifyAdminToken(secret, token)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}
