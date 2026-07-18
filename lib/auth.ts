import crypto from "node:crypto";

import type { NextApiRequest } from "next";

import { getUserById } from "@/lib/users-store";

export type Role = "super_admin" | "admin" | "user";

export const ROLES: Role[] = ["super_admin", "admin", "user"];

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Whether this user may create brand-new categories. Always true for admin/super_admin. */
  canCreateCategories: boolean;
  /** Category ids this user may use. Ignored (treated as "all") for admin/super_admin. */
  categoryAccess: string[];
  isActive: boolean;
};

const COOKIE_NAME = "dme_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 16) {
    throw new Error("Missing or too-short JWT_SECRET in server environment (min 16 chars).");
  }

  return secret;
}

/* -------------------------------------------------------------------------- */
/* Password hashing (scrypt via node:crypto — no external dependency)          */
/* -------------------------------------------------------------------------- */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");

  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");

  if (!expected.length) {
    return false;
  }

  const derived = crypto.scryptSync(password, salt, expected.length);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/* -------------------------------------------------------------------------- */
/* JWT (HS256, hand-rolled with node:crypto)                                   */
/* -------------------------------------------------------------------------- */

type JwtPayload = Record<string, unknown> & { iat?: number; exp?: number; sub?: string };

export function signToken(payload: Record<string, unknown>, ttlSeconds = SESSION_TTL_SECONDS): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };

  const headerPart = Buffer.from(JSON.stringify(header)).toString("base64url");
  const bodyPart = Buffer.from(JSON.stringify(body)).toString("base64url");
  const data = `${headerPart}.${bodyPart}`;
  const signature = crypto.createHmac("sha256", getJwtSecret()).update(data).digest("base64url");

  return `${data}.${signature}`;
}

export function verifyToken(token: string): JwtPayload | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, bodyPart, signature] = parts;
  const data = `${headerPart}.${bodyPart}`;
  const expected = crypto.createHmac("sha256", getJwtSecret()).update(data).digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(bodyPart, "base64url").toString("utf8")) as JwtPayload;

    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Session cookies                                                             */
/* -------------------------------------------------------------------------- */

export function buildSessionCookie(userId: string): string {
  const token = signToken({ sub: userId });
  // Secure cookies require HTTPS. In production we default to Secure, but allow an
  // explicit opt-out (COOKIE_INSECURE=true) for testing over plain http:// (e.g. an IP).
  const useSecure = process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "true";
  const secure = useSecure ? " Secure;" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${SESSION_TTL_SECONDS}`;
}

export function buildLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getSessionUser(req: NextApiRequest): Promise<SessionUser | null> {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return null;
  }

  const payload = verifyToken(token);

  if (!payload || typeof payload.sub !== "string") {
    return null;
  }

  const user = await getUserById(payload.sub);

  if (!user || !user.isActive) {
    return null;
  }

  return user;
}

/* -------------------------------------------------------------------------- */
/* Authorization helpers                                                       */
/* -------------------------------------------------------------------------- */

export function isPrivileged(user: SessionUser): boolean {
  return user.role === "super_admin" || user.role === "admin";
}

export function canManageUsers(user: SessionUser): boolean {
  return isPrivileged(user);
}

/** Can the user run extraction / view this category? */
export function userCanAccessCategory(user: SessionUser, categoryId: string): boolean {
  if (isPrivileged(user)) {
    return true;
  }

  return user.categoryAccess.includes(categoryId);
}

/** Can the user edit or delete an existing category? */
export function userCanManageCategory(user: SessionUser, categoryId: string): boolean {
  if (isPrivileged(user)) {
    return true;
  }

  return user.canCreateCategories && user.categoryAccess.includes(categoryId);
}
