import { createClient, type Client } from "@libsql/client";

let clientInstance: Client | null = null;

export function getTursoClient(): Client {
  if (clientInstance) {
    return clientInstance;
  }

  const url = process.env.TURSO_DB_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("Missing TURSO_DB_URL in server environment.");
  }

  clientInstance = createClient({
    url,
    ...(authToken ? { authToken } : {}),
  });

  return clientInstance;
}
