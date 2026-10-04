import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTripFromStorage, saveTripToStorage } from "@/lib/storage";
import { calculateSettlements, calculatePersonBalances } from "@/lib/calculations";
import type { Trip } from "@/types";

const trip: Trip = {
  id: "legacy",
  name: "Saved trip",
  currency: "PHP",
  people: [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }],
  expenses: [{ id: "e", description: "Dinner", amountMinor: 10000, paidByPersonId: "a", shares: [{ personId: "b", amountMinor: 10000 }], splitType: "exact", createdAt: "2026-10-04T00:00:00Z" }],
  payments: [{ id: "p", fromPersonId: "b", toPersonId: "a", amountMinor: 4000, createdAt: "2026-10-04T00:00:00Z" }],
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z"
};

function mockStorage(key?: string, payload?: unknown) {
  const values = new Map<string, string>();
  if (key) values.set(key, JSON.stringify(payload));
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  } });
}

afterEach(() => vi.unstubAllGlobals());

describe("saved currency compatibility", () => {
  it.each([
    ["simple-expense-tracker:v1", { version: 1, trips: [trip] }],
    ["simple-expense-tracker:v2", { version: 2, trip }]
  ])("loads legacy PHP expenses and payments from %s", (key, payload) => {
    mockStorage(key, payload);
    const loaded = loadTripFromStorage();
    expect(loaded).toEqual(trip);
    expect(calculateSettlements(calculatePersonBalances(loaded!))).toEqual([{ currency: "PHP", fromPersonId: "b", toPersonId: "a", amountMinor: 6000 }]);
  });

  it("persists explicit currencies and the last-used expense currency", () => {
    mockStorage();
    const mixed: Trip = { ...trip, lastExpenseCurrency: "JPY", expenses: [{ ...trip.expenses[0], currency: "JPY", amountMinor: 100, shares: [{ personId: "b", amountMinor: 100 }] }], payments: [{ ...trip.payments![0], currency: "TWD" }] };
    saveTripToStorage(mixed);
    expect(loadTripFromStorage()).toEqual(mixed);
  });
});
