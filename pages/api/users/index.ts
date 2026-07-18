import type { NextApiRequest, NextApiResponse } from "next";

import { canManageUsers, getSessionUser, type Role, type SessionUser } from "@/lib/auth";
import { createUser, listUsers, type UserRecord } from "@/lib/users-store";

type UsersResponse = { users: UserRecord[] } | { user: UserRecord } | { error: string };

function parseRole(value: unknown): Role {
  if (value === "super_admin" || value === "admin" || value === "user") {
    return value;
  }
  return "user";
}

function parseAccess(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return [];
}

/** Only a super_admin may create/manage admin or super_admin accounts. */
function canAssignRole(actor: SessionUser, targetRole: Role): boolean {
  if (targetRole === "user") {
    return true;
  }
  return actor.role === "super_admin";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<UsersResponse>) {
  try {
    const actor = await getSessionUser(req);

    if (!actor) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!canManageUsers(actor)) {
      res.status(403).json({ error: "You do not have permission to manage users." });
      return;
    }

    if (req.method === "GET") {
      const users = await listUsers();
      res.status(200).json({ users });
      return;
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const role = parseRole(body.role);

      if (!canAssignRole(actor, role)) {
        res.status(403).json({ error: "Only a super admin can create admin accounts." });
        return;
      }

      const user = await createUser({
        email: String(body.email ?? ""),
        name: String(body.name ?? ""),
        password: String(body.password ?? ""),
        role,
        canCreateCategories: Boolean(body.canCreateCategories),
        categoryAccess: parseAccess(body.categoryAccess),
      });

      res.status(201).json({ user });
      return;
    }

    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).json({ error: "Method Not Allowed" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "User operation failed.";
    res.status(400).json({ error: message });
  }
}
