import type { NextApiRequest, NextApiResponse } from "next";

import { buildLogoutCookie } from "@/lib/auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Set-Cookie", buildLogoutCookie());
  res.status(200).json({ ok: true });
}
