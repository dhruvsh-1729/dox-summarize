import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import type { SessionUser } from "@/lib/auth";

type Role = "super_admin" | "admin" | "user";

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  canCreateCategories: boolean;
  categoryAccess: string[];
  isActive: boolean;
  createdAt: string;
};

type CategoryLite = { id: string; label: string };

const ROLES: Role[] = ["user", "admin", "super_admin"];
const ROLE_LABEL: Record<Role, string> = { super_admin: "Super Admin", admin: "Admin", user: "User" };

const EMPTY_FORM = {
  email: "",
  name: "",
  password: "",
  role: "user" as Role,
  canCreateCategories: false,
  categoryAccess: [] as string[],
};

export default function UsersAdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/users");
    const payload = (await response.json()) as { users?: ManagedUser[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Failed to load users.");
    setUsers(payload.users ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const meResponse = await fetch("/api/auth/me");
        if (!meResponse.ok) {
          router.replace("/login");
          return;
        }
        const mePayload = (await meResponse.json()) as { user: SessionUser };
        if (!active) return;

        if (mePayload.user.role !== "super_admin" && mePayload.user.role !== "admin") {
          router.replace("/");
          return;
        }
        setMe(mePayload.user);

        const catResponse = await fetch("/api/category-configs");
        const catPayload = (await catResponse.json()) as { categories?: CategoryLite[] };
        if (active) setCategories((catPayload.categories ?? []).map((c) => ({ id: c.id, label: c.label })));

        await loadUsers();
      } catch (loadError: unknown) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [router, loadUsers]);

  const isSuperAdmin = me?.role === "super_admin";
  const assignableRoles = useMemo<Role[]>(() => (isSuperAdmin ? ROLES : ["user"]), [isSuperAdmin]);

  const toggleFormAccess = (categoryId: string) => {
    setForm((current) => ({
      ...current,
      categoryAccess: current.categoryAccess.includes(categoryId)
        ? current.categoryAccess.filter((id) => id !== categoryId)
        : [...current.categoryAccess, categoryId],
    }));
  };

  const onCreate = async () => {
    setError(null);
    setNote(null);
    setCreating(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to create user.");
      setNote(`Created ${form.email}.`);
      setForm(EMPTY_FORM);
      await loadUsers();
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : "Failed to create user.");
    } finally {
      setCreating(false);
    }
  };

  const patchUser = async (id: string, patch: Partial<ManagedUser> & { password?: string }) => {
    setError(null);
    setNote(null);
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Update failed.");
      await loadUsers();
      setNote("Saved.");
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : "Update failed.");
    }
  };

  const removeUser = async (id: string, email: string) => {
    if (!window.confirm(`Delete ${email}? This cannot be undone.`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/users/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Delete failed.");
      await loadUsers();
      setNote("User deleted.");
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    }
  };

  const resetPassword = async (id: string) => {
    const next = window.prompt("Enter a new password (min 6 chars):");
    if (!next) return;
    await patchUser(id, { password: next });
  };

  if (!ready || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f2ee] text-sm text-black/60">Loading…</div>
    );
  }

  return (
    <>
      <Head>
        <title>Users · Dynamic Media Extractor</title>
      </Head>
      <div className="min-h-screen bg-[radial-gradient(circle_at_20%_10%,#f2dfd4_0,#f7f2ee_38%,#f3f7ff_100%)] text-[#131313]">
        <AppNav user={me} />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8">
          <h1 className="text-2xl font-semibold">User Management</h1>
          <p className="mt-1 text-sm text-black/60">
            Roles and per-category access. {isSuperAdmin ? "You can manage every account." : "You can manage standard users."}
          </p>

          {error ? (
            <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          ) : null}
          {note ? (
            <p className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {note}
            </p>
          ) : null}

          {/* Create user */}
          <section className="mt-5 rounded-3xl border border-black/10 bg-white/85 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
            <p className="text-sm font-semibold">Create a new user</p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <input
                placeholder="Email"
                value={form.email}
                onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
                className="rounded-xl border border-black/15 px-3 py-2 text-sm"
              />
              <input
                placeholder="Name"
                value={form.name}
                onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
                className="rounded-xl border border-black/15 px-3 py-2 text-sm"
              />
              <input
                placeholder="Temporary password"
                value={form.password}
                onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))}
                className="rounded-xl border border-black/15 px-3 py-2 text-sm"
              />
              <select
                value={form.role}
                onChange={(event) => setForm((c) => ({ ...c, role: event.target.value as Role }))}
                className="rounded-xl border border-black/15 px-3 py-2 text-sm"
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-black/80">
              <input
                type="checkbox"
                checked={form.canCreateCategories}
                onChange={(event) => setForm((c) => ({ ...c, canCreateCategories: event.target.checked }))}
              />
              Can create new categories
            </label>

            {form.role === "user" ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60">Category access</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => toggleFormAccess(category.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        form.categoryAccess.includes(category.id)
                          ? "border-[#1e3f52] bg-[#1e3f52] text-white"
                          : "border-black/20 text-black/70 hover:bg-black/5"
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                  {!categories.length ? <span className="text-xs text-black/50">No categories yet.</span> : null}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-black/50">Admins and super admins have access to all categories.</p>
            )}

            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              className="mt-4 rounded-full bg-[#8f3f2d] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#7b3323] disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create user"}
            </button>
          </section>

          {/* Users list */}
          <section className="mt-5 space-y-3">
            {users.map((user) => {
              const editable = isSuperAdmin || user.role === "user";
              return (
                <div
                  key={user.id}
                  className="rounded-2xl border border-black/10 bg-white/85 p-4 shadow-[0_14px_45px_-35px_rgba(15,23,42,0.45)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {user.name || user.email}
                        {user.id === me.id ? <span className="ml-2 text-xs text-black/50">(you)</span> : null}
                      </p>
                      <p className="text-xs text-black/55">{user.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={user.role}
                        disabled={!editable || user.id === me.id}
                        onChange={(event) => patchUser(user.id, { role: event.target.value as Role })}
                        className="rounded-lg border border-black/15 px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role} disabled={!isSuperAdmin && role !== "user"}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-black/70">
                        <input
                          type="checkbox"
                          checked={user.canCreateCategories}
                          disabled={!editable || user.role !== "user"}
                          onChange={(event) => patchUser(user.id, { canCreateCategories: event.target.checked })}
                        />
                        Create categories
                      </label>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-black/70">
                        <input
                          type="checkbox"
                          checked={user.isActive}
                          disabled={!editable || user.id === me.id}
                          onChange={(event) => patchUser(user.id, { isActive: event.target.checked })}
                        />
                        Active
                      </label>
                      <button
                        type="button"
                        onClick={() => resetPassword(user.id)}
                        disabled={!editable}
                        className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:opacity-40"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUser(user.id, user.email)}
                        disabled={!editable || user.id === me.id}
                        className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {user.role === "user" ? (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50">Category access</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {categories.map((category) => {
                          const granted = user.categoryAccess.includes(category.id);
                          return (
                            <button
                              key={category.id}
                              type="button"
                              disabled={!editable}
                              onClick={() =>
                                patchUser(user.id, {
                                  categoryAccess: granted
                                    ? user.categoryAccess.filter((id) => id !== category.id)
                                    : [...user.categoryAccess, category.id],
                                })
                              }
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${
                                granted
                                  ? "border-[#1e3f52] bg-[#1e3f52] text-white"
                                  : "border-black/20 text-black/60 hover:bg-black/5"
                              }`}
                            >
                              {category.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        </main>
      </div>
    </>
  );
}
