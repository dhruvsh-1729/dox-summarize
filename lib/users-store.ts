import { type InStatement } from "@libsql/client";

import { hashPassword, type Role, type SessionUser } from "@/lib/auth";
import { getTursoClient } from "@/lib/turso";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      can_create_categories INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE TABLE IF NOT EXISTS user_category_access (
      user_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, category_id)
    )`,
];

let schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  const client = getTursoClient();
  await client.batch(
    SCHEMA_STATEMENTS.map((sql) => ({ sql })),
    "write",
  );
  schemaReady = true;
}

function asString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== BigInt(0);
  return String(value) === "1" || String(value).toLowerCase() === "true";
}

function asRole(value: unknown): Role {
  const normalized = asString(value, "user");
  if (normalized === "super_admin" || normalized === "admin" || normalized === "user") {
    return normalized;
  }
  return "user";
}

export type UserRecord = SessionUser & {
  createdAt: string;
};

async function loadAccess(userId: string): Promise<string[]> {
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT category_id FROM user_category_access WHERE user_id = ? ORDER BY category_id`,
    args: [userId],
  });
  return (result.rows as Array<Record<string, unknown>>).map((row) => asString(row.category_id));
}

function mapUser(row: Record<string, unknown>, access: string[]): UserRecord {
  const role = asRole(row.role);
  const privileged = role === "super_admin" || role === "admin";

  return {
    id: asString(row.id),
    email: asString(row.email),
    name: asString(row.name),
    role,
    canCreateCategories: privileged ? true : asBoolean(row.can_create_categories),
    categoryAccess: access,
    isActive: asBoolean(row.is_active),
    createdAt: asString(row.created_at),
  };
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  await ensureSchema();

  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT id, email, name, role, can_create_categories, is_active, created_at
          FROM users WHERE id = ? LIMIT 1`,
    args: [id],
  });

  const rows = result.rows as Array<Record<string, unknown>>;
  if (!rows.length) {
    return null;
  }

  const access = await loadAccess(id);
  return mapUser(rows[0], access);
}

/** Returns the raw row incl. password hash — for login only. */
export async function getUserAuthByEmail(
  email: string,
): Promise<{ user: UserRecord; passwordHash: string } | null> {
  await ensureSchema();

  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT id, email, name, role, can_create_categories, is_active, created_at, password_hash
          FROM users WHERE email = ? LIMIT 1`,
    args: [email.trim().toLowerCase()],
  });

  const rows = result.rows as Array<Record<string, unknown>>;
  if (!rows.length) {
    return null;
  }

  const access = await loadAccess(asString(rows[0].id));
  return { user: mapUser(rows[0], access), passwordHash: asString(rows[0].password_hash) };
}

export async function listUsers(): Promise<UserRecord[]> {
  await ensureSchema();

  const client = getTursoClient();
  const result = await client.execute(
    `SELECT id, email, name, role, can_create_categories, is_active, created_at
     FROM users ORDER BY created_at`,
  );

  const rows = result.rows as Array<Record<string, unknown>>;
  const accessResult = await client.execute(`SELECT user_id, category_id FROM user_category_access`);
  const accessByUser = new Map<string, string[]>();

  for (const row of accessResult.rows as Array<Record<string, unknown>>) {
    const userId = asString(row.user_id);
    const list = accessByUser.get(userId) ?? [];
    list.push(asString(row.category_id));
    accessByUser.set(userId, list);
  }

  return rows.map((row) => mapUser(row, accessByUser.get(asString(row.id)) ?? []));
}

export async function countUsers(): Promise<number> {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute(`SELECT COUNT(*) AS total FROM users`);
  const rows = result.rows as Array<Record<string, unknown>>;
  return Number(rows[0]?.total ?? 0);
}

export type CreateUserInput = {
  email: string;
  name: string;
  password: string;
  role: Role;
  canCreateCategories: boolean;
  categoryAccess: string[];
};

function randomId(): string {
  return `usr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  await ensureSchema();

  const email = input.email.trim().toLowerCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("A valid email is required.");
  }

  if (!input.password || input.password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const existing = await getUserAuthByEmail(email);
  if (existing) {
    throw new Error("A user with this email already exists.");
  }

  const id = randomId();
  const client = getTursoClient();

  const statements: InStatement[] = [
    {
      sql: `INSERT INTO users (id, email, name, password_hash, role, can_create_categories, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)`,
      args: [
        id,
        email,
        input.name.trim(),
        hashPassword(input.password),
        input.role,
        input.canCreateCategories ? 1 : 0,
      ],
    },
  ];

  for (const categoryId of dedupe(input.categoryAccess)) {
    statements.push({
      sql: `INSERT OR IGNORE INTO user_category_access (user_id, category_id) VALUES (?, ?)`,
      args: [id, categoryId],
    });
  }

  await client.batch(statements, "write");

  const created = await getUserById(id);
  if (!created) {
    throw new Error("Failed to create user.");
  }
  return created;
}

export type UpdateUserInput = {
  name?: string;
  role?: Role;
  canCreateCategories?: boolean;
  isActive?: boolean;
  password?: string;
  categoryAccess?: string[];
};

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserRecord> {
  await ensureSchema();

  const client = getTursoClient();
  const sets: string[] = [];
  const args: Array<string | number> = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    args.push(input.name.trim());
  }
  if (input.role !== undefined) {
    sets.push("role = ?");
    args.push(input.role);
  }
  if (input.canCreateCategories !== undefined) {
    sets.push("can_create_categories = ?");
    args.push(input.canCreateCategories ? 1 : 0);
  }
  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    args.push(input.isActive ? 1 : 0);
  }
  if (input.password !== undefined && input.password) {
    if (input.password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }
    sets.push("password_hash = ?");
    args.push(hashPassword(input.password));
  }

  const statements: InStatement[] = [];

  if (sets.length) {
    sets.push("updated_at = CURRENT_TIMESTAMP");
    statements.push({
      sql: `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
      args: [...args, id],
    });
  }

  if (input.categoryAccess !== undefined) {
    statements.push({ sql: `DELETE FROM user_category_access WHERE user_id = ?`, args: [id] });
    for (const categoryId of dedupe(input.categoryAccess)) {
      statements.push({
        sql: `INSERT OR IGNORE INTO user_category_access (user_id, category_id) VALUES (?, ?)`,
        args: [id, categoryId],
      });
    }
  }

  if (statements.length) {
    await client.batch(statements, "write");
  }

  const updated = await getUserById(id);
  if (!updated) {
    throw new Error("User not found after update.");
  }
  return updated;
}

export async function deleteUser(id: string): Promise<void> {
  await ensureSchema();
  const client = getTursoClient();
  await client.batch(
    [
      { sql: `DELETE FROM user_category_access WHERE user_id = ?`, args: [id] },
      { sql: `DELETE FROM users WHERE id = ?`, args: [id] },
    ],
    "write",
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
