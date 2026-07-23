const TOKEN_KEY = "adt_auth_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Every request the dashboard makes goes through apiRequest() in lib/api.ts, which
// calls this on a 401 — clears the stale/invalid token and bounces to /login rather
// than leaving the app stuck making requests that will never succeed.
export function redirectToLogin(): void {
  clearToken();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

// Returns a JWT's exp claim in epoch ms, or null if it can't be parsed — purely a
// client-side heuristic for "is this getting old" (see lib/api.ts's opportunistic
// refresh), never a substitute for the server's own verification.
export function getTokenExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
