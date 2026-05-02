// Auth helpers — talk directly to /api/auth/* with credentials: "include" so the
// signed session cookie travels on every call. Avoids touching the shared
// generated API client (which is also used by non-web bundles).

export interface User {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface MeResponse {
  user: User | null;
}

export interface GoogleAuthResponse {
  user: User;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) throw new Error(`GET /api/auth/me failed (${res.status})`);
  return res.json();
}

export async function postGoogleAuth(idToken: string): Promise<GoogleAuthResponse> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    credentials: "include",
    headers: JSON_HEADERS,
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error(`POST /api/auth/google failed (${res.status})`);
  return res.json();
}

export async function postLogout(): Promise<void> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`POST /api/auth/logout failed (${res.status})`);
  }
}

// ---------------------------------------------------------------------------
// Google Identity Services bridge
// ---------------------------------------------------------------------------

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "small" | "medium" | "large";
      type?: "standard" | "icon";
      shape?: "rectangular" | "pill" | "circle" | "square";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      logo_alignment?: "left" | "center";
      width?: number | string;
    },
  ): void;
  prompt(): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdentityApi;
      };
    };
  }
}

export function getGoogleClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!id || typeof id !== "string") {
    throw new Error(
      "VITE_GOOGLE_OAUTH_CLIENT_ID is not set — Google sign-in cannot initialize",
    );
  }
  return id;
}

// Resolves once the Google Identity Services script has finished loading.
// The <script> tag is async/defer in index.html so window.google may be
// undefined for the first few frames.
export function waitForGoogleIdentity(): Promise<GoogleIdentityApi> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) {
      resolve(window.google.accounts.id);
      return;
    }
    const interval = window.setInterval(() => {
      if (window.google?.accounts?.id) {
        window.clearInterval(interval);
        resolve(window.google.accounts.id);
      }
    }, 50);
  });
}
