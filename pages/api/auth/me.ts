import type { NextApiRequest, NextApiResponse } from "next";

import { getSessionUser, type SessionUser } from "@/lib/auth";

type MeResponse = { user: SessionUser } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<MeResponse>) {
  try {
    const user = await getSessionUser(req);

    if (!user) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    res.status(200).json({ user });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Auth check failed.";
    res.status(500).json({ error: message });
  }
}
