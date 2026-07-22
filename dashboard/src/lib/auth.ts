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
