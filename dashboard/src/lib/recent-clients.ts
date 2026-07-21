import { useSyncExternalStore } from "react";

const STORAGE_KEY = "adt_recent_clients";
const MAX_RECENT = 5;

export function recordRecentClient(clientId: string): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readIds().filter((id) => id !== clientId);
    const updated = [clientId, ...existing].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    notifySubscribers();
  } catch {
    // localStorage unavailable (private browsing, etc) — recent list is a nicety, skip silently
  }
}

function readIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// useSyncExternalStore requires getSnapshot to return a stable reference when the
// underlying value hasn't changed, or it re-renders forever — cache by raw string.
let cachedRaw: string | null | undefined;
let cachedIds: string[] = [];
const listeners = new Set<() => void>();

function notifySubscribers() {
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): string[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedIds = readIds();
  }
  return cachedIds;
}

// Must be a stable reference — a fresh [] on every call trips React's
// "getServerSnapshot should be cached" infinite-loop guard.
const EMPTY_IDS: string[] = [];

function getServerSnapshot(): string[] {
  return EMPTY_IDS;
}

export function useRecentClientIds(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
