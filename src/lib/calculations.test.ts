import { describe, expect, it } from "vitest";
import { calculatePersonBalances, calculateSettlementReceipts, calculateSettlements, getTripTotalMinor } from "@/lib/calculations";
import type { Trip } from "@/types";

function tripWithExpenses(expenses: Trip["expenses"]): Trip {
  return {
    id: "trip_1",
    name: "Test trip",
    currency: "PHP",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    people: [
      { id: "a", name: "Ana" },
      { id: "b", name: "Ben" },
      { id: "c", name: "Cara" }
    ],
    expenses
  };
}

describe("calculatePersonBalances", () => {
  it("calculates an equal split paid by one person", () => {
    const trip = tripWithExpenses([
      {
        id: "expense_1",
        description: "Dinner",
        amountMinor: 90000,
        paidByPersonId: "a",
        splitType: "equal",
        createdAt: "2026-07-20T00:00:00.000Z",
        shares: [
          { personId: "a", amountMinor: 30000 },
          { personId: "b", amountMinor: 30000 },
          { personId: "c", amountMinor: 30000 }
        ]
      }
    ]);

    expect(calculatePersonBalances(trip)).toEqual([
      { personId: "a", paidMinor: 90000, shareMinor: 30000, balanceMinor: 60000 },
      { personId: "b", paidMinor: 0, shareMinor: 30000, balanceMinor: -30000 },
      { personId: "c", paidMinor: 0, shareMinor: 30000, balanceMinor: -30000 }
    ]);
  });

  it("calculates exact split shares", () => {
    const trip = tripWithExpenses([
      {
        id: "expense_1",
        description: "Lunch",
        amountMinor: 100000,
        paidByPersonId: "a",
        splitType: "exact",
        createdAt: "2026-07-20T00:00:00.000Z",
        shares: [
          { personId: "a", amountMinor: 40000 },
          { personId: "b", amountMinor: 10000 },
          { personId: "c", amountMinor: 50000 }
        ]
      }
    ]);

    expect(calculatePersonBalances(trip).map((balance) => balance.balanceMinor)).toEqual([60000, -10000, -50000]);
  });

  it("combines multiple payers across multiple expenses", () => {
    const trip = tripWithExpenses([
      {
        id: "expense_1",
        description: "Fuel",
        amountMinor: 120000,
        paidByPersonId: "a",
        splitType: "equal",
        createdAt: "2026-07-20T00:00:00.000Z",
        shares: [
          { personId: "a", amountMinor: 40000 },
          { personId: "b", amountMinor: 40000 },
          { personId: "c", amountMinor: 40000 }
        ]
      },
      {
        id: "expense_2",
        description: "Snacks",
        amountMinor: 30000,
        paidByPersonId: "b",
        splitType: "equal",
        createdAt: "2026-07-20T00:00:00.000Z",
        shares: [
          { personId: "a", amountMinor: 10000 },
          { personId: "b", amountMinor: 10000 },
          { personId: "c", amountMinor: 10000 }
        ]
      }
    ]);

    expect(calculatePersonBalances(trip)).toEqual([
      { personId: "a", paidMinor: 120000, shareMinor: 50000, balanceMinor: 70000 },
      { personId: "b", paidMinor: 30000, shareMinor: 50000, balanceMinor: -20000 },
      { personId: "c", paidMinor: 0, shareMinor: 50000, balanceMinor: -50000 }
    ]);
  });

  it("returns zero balances for a trip with no expenses", () => {
    expect(calculatePersonBalances(tripWithExpenses([]))).toEqual([
      { personId: "a", paidMinor: 0, shareMinor: 0, balanceMinor: 0 },
      { personId: "b", paidMinor: 0, shareMinor: 0, balanceMinor: 0 },
      { personId: "c", paidMinor: 0, shareMinor: 0, balanceMinor: 0 }
    ]);
  });
});

describe("calculateSettlements", () => {
  it("settles a single creditor", () => {
    const settlements = calculateSettlements([
      { personId: "a", paidMinor: 90000, shareMinor: 30000, balanceMinor: 60000 },
      { personId: "b", paidMinor: 0, shareMinor: 30000, balanceMinor: -30000 },
      { personId: "c", paidMinor: 0, shareMinor: 30000, balanceMinor: -30000 }
    ]);

    expect(settlements).toEqual([
      { fromPersonId: "b", toPersonId: "a", amountMinor: 30000 },
      { fromPersonId: "c", toPersonId: "a", amountMinor: 30000 }
    ]);
  });

  it("settles multiple creditors and debtors", () => {
    const settlements = calculateSettlements([
      { personId: "a", paidMinor: 0, shareMinor: 0, balanceMinor: 50000 },
      { personId: "b", paidMinor: 0, shareMinor: 0, balanceMinor: 20000 },
      { personId: "c", paidMinor: 0, shareMinor: 0, balanceMinor: -40000 },
      { personId: "d", paidMinor: 0, shareMinor: 0, balanceMinor: -30000 }
    ]);

    expect(settlements).toEqual([
      { fromPersonId: "c", toPersonId: "a", amountMinor: 40000 },
      { fromPersonId: "d", toPersonId: "a", amountMinor: 10000 },
      { fromPersonId: "d", toPersonId: "b", amountMinor: 20000 }
    ]);
  });

  it("returns no settlements when everyone is settled", () => {
    expect(
      calculateSettlements([
        { personId: "a", paidMinor: 0, shareMinor: 0, balanceMinor: 0 },
        { personId: "b", paidMinor: 0, shareMinor: 0, balanceMinor: 0 }
      ])
    ).toEqual([]);
  });
});

describe("calculateSettlementReceipts", () => {
  it("totals how much each receiver gets back", () => {
    expect(
      calculateSettlementReceipts([
        { fromPersonId: "b", toPersonId: "a", amountMinor: 30000 },
        { fromPersonId: "c", toPersonId: "a", amountMinor: 20000 },
        { fromPersonId: "d", toPersonId: "b", amountMinor: 10000 }
      ])
    ).toEqual({
      a: 50000,
      b: 10000
    });
  });
});

describe("getTripTotalMinor", () => {
  it("totals all expenses", () => {
    expect(
      getTripTotalMinor(
        tripWithExpenses([
          {
            id: "expense_1",
            description: "A",
            amountMinor: 100,
            paidByPersonId: "a",
            splitType: "exact",
            createdAt: "2026-07-20T00:00:00.000Z",
            shares: []
          },
          {
            id: "expense_2",
            description: "B",
            amountMinor: 250,
            paidByPersonId: "b",
            splitType: "exact",
            createdAt: "2026-07-20T00:00:00.000Z",
            shares: []
          }
        ])
      )
    ).toBe(350);
  });
});
