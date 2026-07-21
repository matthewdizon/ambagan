import type { Trip } from "@/types";

const STORAGE_KEY = "simple-expense-tracker:v1";
const CURRENT_STORAGE_KEY = "simple-expense-tracker:v2";

type StoredTrips = {
  version: 1;
  trips: Trip[];
};

type StoredCurrentTrip = {
  version: 2;
  trip: Trip;
};

export function loadTripFromStorage(): Trip | null {
  if (typeof window === "undefined") return null;

  try {
    const currentRaw = window.localStorage.getItem(CURRENT_STORAGE_KEY);
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw) as StoredCurrentTrip;
      if (parsed.version === 2 && parsed.trip) return parsed.trip;
    }

    const legacyRaw = window.localStorage.getItem(STORAGE_KEY);
    if (!legacyRaw) return null;

    const parsed = JSON.parse(legacyRaw) as StoredTrips;
    if (parsed.version !== 1 || !Array.isArray(parsed.trips)) return null;

    return parsed.trips[0] ?? null;
  } catch {
    return null;
  }
}

export function saveTripToStorage(trip: Trip): void {
  if (typeof window === "undefined") return;

  const payload: StoredCurrentTrip = {
    version: 2,
    trip
  };

  window.localStorage.setItem(CURRENT_STORAGE_KEY, JSON.stringify(payload));
}
