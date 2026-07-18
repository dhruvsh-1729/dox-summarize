import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already logged in, bounce to the app.
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((response) => {
        if (active && response.ok) router.replace("/");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Login failed.");
      }

      router.replace("/");
    } catch (loginError: unknown) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Sign in · Dynamic Media Extractor</title>
      </Head>
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_20%_10%,#f2dfd4_0,#f7f2ee_38%,#f3f7ff_100%)] px-4">
        <div className="w-full max-w-md rounded-3xl border border-black/10 bg-white/90 p-8 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)] backdrop-blur">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1e3f52] text-base font-bold text-white">
              DX
            </div>
            <div>
              <h1 className="text-lg font-semibold">Dynamic Media Extractor</h1>
              <p className="text-xs text-black/55">Sign in to continue</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="mt-1.5 w-full rounded-2xl border border-black/15 bg-white px-3 py-2.5 text-sm focus:border-[#8f3f2d] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="mt-1.5 w-full rounded-2xl border border-black/15 bg-white px-3 py-2.5 text-sm focus:border-[#8f3f2d] focus:outline-none"
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[#1e3f52] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#152f3d] disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-black/50">
            Accounts are provisioned by an administrator.
          </p>
        </div>
      </div>
    </>
  );
}
