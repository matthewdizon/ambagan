import { describe, expect, it } from "vitest";
import { createShareUrl, decodeTripFromHash, encodeTripForHash } from "@/lib/share";
import type { Trip } from "@/types";

const trip: Trip = {
  id: "trip_1",
  name: "Dahilayan",
  currency: "PHP",
  people: [{ id: "a", name: "Ana" }],
  expenses: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z"
};

describe("share links", () => {
  it("encodes and decodes a trip payload", () => {
    const encoded = encodeTripForHash(trip);

    expect(decodeTripFromHash(`#${encoded}`)).toEqual(trip);
  });

  it("returns null for an empty hash", () => {
    expect(decodeTripFromHash("#")).toBeNull();
  });

  it("returns null for malformed hash content", () => {
    expect(decodeTripFromHash("#not-valid-json")).toBeNull();
  });

  it("creates a hash-based share URL", () => {
    const url = createShareUrl(trip, "https://example.com");

    expect(url.startsWith("https://example.com/#")).toBe(true);
    expect(decodeTripFromHash(url.split("#")[1])).toEqual(trip);
  });
});


describe("multi-currency shares", () => {
  it("preserves currencies, minor units, and the last-used currency", () => {
    const mixed: Trip = { ...trip, lastExpenseCurrency: "JPY", expenses: [{ id: "e", currency: "JPY", description: "Train", amountMinor: 101, paidByPersonId: "a", shares: [{ personId: "a", amountMinor: 101 }], splitType: "equal", createdAt: trip.createdAt }], payments: [{ id: "p", currency: "KWD", amountMinor: 1005, fromPersonId: "a", toPersonId: "b", createdAt: trip.createdAt }] };
    expect(decodeTripFromHash(encodeTripForHash(mixed))).toEqual(mixed);
  });

  it("rejects unsupported currencies in shared data", () => {
    expect(decodeTripFromHash(encodeTripForHash({ ...trip, currency: "NOT_A_CURRENCY" }))).toBeNull();
  });
});
