import type { NextApiRequest, NextApiResponse } from "next";

import { canManageUsers, getSessionUser, type Role, type SessionUser } from "@/lib/auth";
import { deleteUser, getUserById, updateUser, type UpdateUserInput, type UserRecord } from "@/lib/users-store";

type Response = { user: UserRecord } | { ok: true } | { error: string };

function parseRole(value: unknown): Role | undefined {
  if (value === "super_admin" || value === "admin" || value === "user") {
    return value;
  }
  return undefined;
}

/** Admins may only manage plain users; super_admins may manage anyone but themselves for role/active. */
function canActOn(actor: SessionUser, target: UserRecord): boolean {
  if (actor.role === "super_admin") {
    return true;
  }
  // admin
  return target.role === "user";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
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

    const id = String(req.query.id ?? "").trim();
    const target = await getUserById(id);

    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (!canActOn(actor, target)) {
      res.status(403).json({ error: "You cannot manage this account." });
      return;
    }

    if (req.method === "PUT") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const nextRole = parseRole(body.role);

      // Only super_admin can elevate someone to admin/super_admin.
      if (nextRole && nextRole !== "user" && actor.role !== "super_admin") {
        res.status(403).json({ error: "Only a super admin can assign admin roles." });
        return;
      }

      // Prevent an actor from removing their own privileges / locking themselves out.
      if (actor.id === target.id && ((nextRole && nextRole !== actor.role) || body.isActive === false)) {
        res.status(400).json({ error: "You cannot change your own role or deactivate yourself." });
        return;
      }

      const update: UpdateUserInput = {};
      if (body.name !== undefined) update.name = String(body.name);
      if (nextRole !== undefined) update.role = nextRole;
      if (body.canCreateCategories !== undefined) update.canCreateCategories = Boolean(body.canCreateCategories);
      if (body.isActive !== undefined) update.isActive = Boolean(body.isActive);
      if (body.password !== undefined && String(body.password)) update.password = String(body.password);
      if (Array.isArray(body.categoryAccess)) {
        update.categoryAccess = body.categoryAccess.map((entry) => String(entry).trim()).filter(Boolean);
      }

      const user = await updateUser(id, update);
      res.status(200).json({ user });
      return;
    }

    if (req.method === "DELETE") {
      if (actor.id === target.id) {
        res.status(400).json({ error: "You cannot delete your own account." });
        return;
      }

      await deleteUser(id);
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader("Allow", ["PUT", "DELETE"]);
    res.status(405).json({ error: "Method Not Allowed" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "User operation failed.";
    res.status(400).json({ error: message });
  }
}
