import Link from "next/link";
import { useRouter } from "next/router";

import type { SessionUser } from "@/lib/auth";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  user: "User",
};

const ROLE_STYLE: Record<string, string> = {
  super_admin: "bg-[#8f3f2d] text-white",
  admin: "bg-[#1e3f52] text-white",
  user: "bg-black/10 text-black/70",
};

export default function AppNav({ user }: { user: SessionUser }) {
  const router = useRouter();

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  const canManageUsers = user.role === "super_admin" || user.role === "admin";

  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1900px] items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1e3f52] text-sm font-bold text-white">
            DX
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Dynamic Media Extractor</p>
            <p className="text-[11px] text-black/55">Multi-model structured extraction</p>
          </div>
        </div>

        <nav className="flex items-center gap-2">
          <Link
            href="/"
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              router.pathname === "/" ? "bg-[#1e3f52] text-white" : "text-black/70 hover:bg-black/5"
            }`}
          >
            Extractor
          </Link>
          {canManageUsers ? (
            <Link
              href="/admin/users"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                router.pathname === "/admin/users" ? "bg-[#1e3f52] text-white" : "text-black/70 hover:bg-black/5"
              }`}
            >
              Users
            </Link>
          ) : null}

          <span className={`ml-1 hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline ${ROLE_STYLE[user.role]}`}>
            {ROLE_LABEL[user.role]}
          </span>
          <span className="hidden text-xs text-black/60 md:inline">{user.email}</span>

          <button
            type="button"
            onClick={onLogout}
            className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5"
          >
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}
