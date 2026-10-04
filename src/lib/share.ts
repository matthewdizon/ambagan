import { hasValidTripCurrencies } from "@/lib/money";
import LZString from "lz-string";
import type { Trip } from "@/types";

export function encodeTripForHash(trip: Trip): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(trip));
}

export function decodeTripFromHash(hash: string): Trip | null {
  const encoded = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!encoded) return null;

  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;

    const trip = JSON.parse(json) as Trip;
    return Array.isArray(trip?.people) && Array.isArray(trip?.expenses) && hasValidTripCurrencies(trip) ? trip : null;
  } catch {
    return null;
  }
}

export function createShareUrl(trip: Trip, origin: string): string {
  return `${origin}/#${encodeTripForHash(trip)}`;
}
