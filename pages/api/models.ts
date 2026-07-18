import type { NextApiRequest, NextApiResponse } from "next";

import { getSessionUser } from "@/lib/auth";
import { listOpenRouterModels, type OpenRouterModelInfo } from "@/lib/openrouter";

type ModelsResponse = { models: OpenRouterModelInfo[] } | { error: string };

// Simple in-memory cache — the model catalog changes rarely.
let cache: { at: number; models: OpenRouterModelInfo[] } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ModelsResponse>) {
  try {
    const user = await getSessionUser(req);

    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      res.status(200).json({ models: cache.models });
      return;
    }

    const models = await listOpenRouterModels();
    cache = { at: Date.now(), models };
    res.status(200).json({ models });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load models.";
    res.status(502).json({ error: message });
  }
}
