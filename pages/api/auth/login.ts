import type { NextApiRequest, NextApiResponse } from "next";

import { buildSessionCookie, verifyPassword, type SessionUser } from "@/lib/auth";
import { getUserAuthByEmail } from "@/lib/users-store";

type LoginResponse = { user: SessionUser } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<LoginResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }

    const record = await getUserAuthByEmail(email);

    if (!record || !record.user.isActive || !verifyPassword(password, record.passwordHash)) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    res.setHeader("Set-Cookie", buildSessionCookie(record.user.id));
    res.status(200).json({ user: record.user });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Login failed.";
    res.status(500).json({ error: message });
  }
}
