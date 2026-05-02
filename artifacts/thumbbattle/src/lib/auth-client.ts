import { createAuthClient } from "better-auth/react";

// Same-origin in production (Vite serves frontend, Express serves /api on
// the same Replit URL). baseURL falls back to empty string during SSR/build
// so the module loads without `window`; in the browser it resolves to the
// current origin and Better Auth derives the /api/auth/* paths from there.
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
});

export const { signIn, signUp, signOut, useSession } = authClient;
