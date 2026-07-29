import type { NextApiRequest, NextApiResponse } from "next";

import { getSessionUser, userCanAccessCategory } from "@/lib/auth";
import { getCategoryConfigById } from "@/lib/category-config-store";
import {
  listFieldValueSuggestions,
  type FieldValueSuggestionMap,
} from "@/lib/extraction-history-store";

type SuccessResponse = {
  suggestions: FieldValueSuggestionMap;
};

type ErrorResponse = {
  error: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const categoryId = String(req.query.category ?? "").trim();
    if (!categoryId) {
      res.status(400).json({ error: "Missing category id." });
      return;
    }

    const category = await getCategoryConfigById(categoryId);
    if (!category || !category.isActive) {
      res.status(404).json({ error: "Category not found." });
      return;
    }

    if (!userCanAccessCategory(user, category.id)) {
      res.status(403).json({ error: "You do not have access to this category." });
      return;
    }

    res.status(200).json({ suggestions: await listFieldValueSuggestions(category.id) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Suggestions API error.";
    res.status(400).json({ error: message });
  }
}
