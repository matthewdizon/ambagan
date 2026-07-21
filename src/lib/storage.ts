import type { Trip } from "@/types";

const STORAGE_KEY = "simple-expense-tracker:v1";

type StoredTrips = {
  version: 1;
  trips: Trip[];
};

export function loadTripsFromStorage(): Trip[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as StoredTrips;
    if (parsed.version !== 1 || !Array.isArray(parsed.trips)) return [];

    return parsed.trips;
  } catch {
    return [];
  }
}

export function saveTripsToStorage(trips: Trip[]): void {
  if (typeof window === "undefined") return;

  const payload: StoredTrips = {
    version: 1,
    trips
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
