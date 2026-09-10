import { describe, expect, it } from "vitest";
import { calculateDirectSettlementBreakdown, calculateDirectSettlements, calculatePersonBalances, calculateSettlementReceipts, calculateSettlements, calculateSimplifiedSettlementBreakdown, calculateSimplifiedSettlementRoutes, getTripTotalMinor } from "@/lib/calculations";
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

  it("calculates itemized expenses from aggregated item shares", () => {
    const trip = tripWithExpenses([
      {
        id: "expense_1",
        description: "Resort trip",
        amountMinor: 250000,
        paidByPersonId: "a",
        splitType: "itemized",
        createdAt: "2026-07-20T00:00:00.000Z",
        lineItems: [
          {
            id: "line_1",
            description: "Entrance",
            amountMinor: 150000,
            participantIds: ["a", "b", "c"],
            shares: [
              { personId: "a", amountMinor: 50000 },
              { personId: "b", amountMinor: 50000 },
              { personId: "c", amountMinor: 50000 }
            ]
          },
          {
            id: "line_2",
            description: "Pillows",
            amountMinor: 100000,
            participantIds: ["b", "c"],
            shares: [
              { personId: "b", amountMinor: 50000 },
              { personId: "c", amountMinor: 50000 }
            ]
          }
        ],
        shares: [
          { personId: "a", amountMinor: 50000 },
          { personId: "b", amountMinor: 100000 },
          { personId: "c", amountMinor: 100000 }
        ]
      }
    ]);

    expect(calculatePersonBalances(trip)).toEqual([
      { personId: "a", paidMinor: 250000, shareMinor: 50000, balanceMinor: 200000 },
      { personId: "b", paidMinor: 0, shareMinor: 100000, balanceMinor: -100000 },
      { personId: "c", paidMinor: 0, shareMinor: 100000, balanceMinor: -100000 }
    ]);
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

  it("applies recorded payments to remaining balances", () => {
    const trip = {
      ...tripWithExpenses([
        {
          id: "expense_1",
          description: "Dinner",
          amountMinor: 90000,
          paidByPersonId: "a",
          splitType: "equal" as const,
          createdAt: "2026-07-20T00:00:00.000Z",
          shares: [
            { personId: "a", amountMinor: 30000 },
            { personId: "b", amountMinor: 30000 },
            { personId: "c", amountMinor: 30000 }
          ]
        }
      ]),
      payments: [
        {
          id: "payment_1",
          fromPersonId: "b",
          toPersonId: "a",
          amountMinor: 30000,
          createdAt: "2026-07-20T00:00:00.000Z"
        }
      ]
    };

    expect(calculatePersonBalances(trip)).toEqual([
      { personId: "a", paidMinor: 90000, shareMinor: 30000, balanceMinor: 30000 },
      { personId: "b", paidMinor: 0, shareMinor: 30000, balanceMinor: 0 },
      { personId: "c", paidMinor: 0, shareMinor: 30000, balanceMinor: -30000 }
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

describe("calculateSimplifiedSettlementBreakdown", () => {
  it("explains how a debtor is routed to a creditor with credit remaining", () => {
    const balances = [
      { personId: "a", paidMinor: 0, shareMinor: 0, balanceMinor: 50000 },
      { personId: "b", paidMinor: 0, shareMinor: 0, balanceMinor: 20000 },
      { personId: "c", paidMinor: 0, shareMinor: 0, balanceMinor: -40000 },
      { personId: "d", paidMinor: 0, shareMinor: 0, balanceMinor: -30000 }
    ];
    const directSettlements = [
      { fromPersonId: "d", toPersonId: "b", amountMinor: 25000 },
      { fromPersonId: "c", toPersonId: "d", amountMinor: 5000 },
      { fromPersonId: "c", toPersonId: "a", amountMinor: 35000 },
      { fromPersonId: "b", toPersonId: "a", amountMinor: 5000 }
    ];
    const settlements = calculateSettlements(balances);

    expect(calculateSimplifiedSettlementBreakdown(balances, directSettlements, settlements, settlements[2])).toMatchObject({
      outgoingTotalMinor: 25000,
      incomingTotalMinor: 5000,
      payerDebtMinor: 30000,
      payerRemainingBeforeMinor: 20000,
      receiverCreditMinor: 20000,
      receiverRemainingBeforeMinor: 20000
    });
  });

  it("accounts for payments already routed to the same receiver", () => {
    const balances = [
      { personId: "a", paidMinor: 0, shareMinor: 0, balanceMinor: 50000 },
      { personId: "c", paidMinor: 0, shareMinor: 0, balanceMinor: -40000 },
      { personId: "d", paidMinor: 0, shareMinor: 0, balanceMinor: -10000 }
    ];
    const settlements = calculateSettlements(balances);

    expect(calculateSimplifiedSettlementBreakdown(balances, [], settlements, settlements[1]).receiverRemainingBeforeMinor).toBe(10000);
  });
});

describe("calculateSimplifiedSettlementRoutes", () => {
  it("shows how a direct debt and a chained debt are combined", () => {
    const directSettlements = [
      { fromPersonId: "aid", toPersonId: "lex", amountMinor: 356024 },
      { fromPersonId: "aid", toPersonId: "nic", amountMinor: 473757 },
      { fromPersonId: "lex", toPersonId: "nic", amountMinor: 149411 }
    ];
    const settlement = { fromPersonId: "aid", toPersonId: "nic", amountMinor: 623168 };

    expect(calculateSimplifiedSettlementRoutes(directSettlements, [settlement]).get(settlement)).toEqual({
      routes: [
        { amountMinor: 473757, personIds: ["aid", "nic"], priorUses: [] },
        { amountMinor: 149411, personIds: ["aid", "lex", "nic"], priorUses: [] }
      ],
      unmatchedMinor: 0
    });
  });

  it("preserves edge capacity while explaining multiple simplified payments", () => {
    const directSettlements = [
      { fromPersonId: "a", toPersonId: "b", amountMinor: 3000 },
      { fromPersonId: "b", toPersonId: "c", amountMinor: 2000 },
      { fromPersonId: "b", toPersonId: "d", amountMinor: 1000 }
    ];
    const settlements = [
      { fromPersonId: "a", toPersonId: "c", amountMinor: 2000 },
      { fromPersonId: "a", toPersonId: "d", amountMinor: 1000 }
    ];
    const routes = calculateSimplifiedSettlementRoutes(directSettlements, settlements);

    expect(routes.get(settlements[0])?.routes).toEqual([{ amountMinor: 2000, personIds: ["a", "b", "c"], priorUses: [] }]);
    expect(routes.get(settlements[1])?.routes).toEqual([{ amountMinor: 1000, personIds: ["a", "b", "d"], priorUses: [] }]);
  });

  it("shows when an earlier simplified payment used part of a direct debt", () => {
    const directSettlements = [
      { fromPersonId: "aid", toPersonId: "lex", amountMinor: 356024 },
      { fromPersonId: "aid", toPersonId: "nic", amountMinor: 473757 },
      { fromPersonId: "lex", toPersonId: "nic", amountMinor: 149411 }
    ];
    const settlements = [
      { fromPersonId: "aid", toPersonId: "nic", amountMinor: 623168 },
      { fromPersonId: "aid", toPersonId: "lex", amountMinor: 206613 }
    ];
    const routes = calculateSimplifiedSettlementRoutes(directSettlements, settlements);

    expect(routes.get(settlements[1])?.routes).toEqual([{
      amountMinor: 206613,
      personIds: ["aid", "lex"],
      priorUses: [{ amountMinor: 149411, personIds: ["aid", "lex", "nic"] }]
    }]);
  });

  it("shows when another payer covered part of a direct debt", () => {
    const directSettlements = [
      { fromPersonId: "m2", toPersonId: "m1", amountMinor: 56800 },
      { fromPersonId: "m1", toPersonId: "m3", amountMinor: 312786 }
    ];
    const settlements = [
      { fromPersonId: "m2", toPersonId: "m3", amountMinor: 56800 },
      { fromPersonId: "m1", toPersonId: "m3", amountMinor: 255986 }
    ];
    const routes = calculateSimplifiedSettlementRoutes(directSettlements, settlements);

    expect(routes.get(settlements[1])?.routes).toEqual([{
      amountMinor: 255986,
      personIds: ["m1", "m3"],
      priorUses: [{ amountMinor: 56800, personIds: ["m2", "m1", "m3"] }]
    }]);
  });
});

describe("calculateDirectSettlements", () => {
  it("keeps debts between the original payer and participants", () => {
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
      },
      {
        id: "expense_2",
        description: "Taxi",
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

    expect(calculateDirectSettlements(trip)).toEqual([
      { fromPersonId: "b", toPersonId: "a", amountMinor: 20000 },
      { fromPersonId: "c", toPersonId: "a", amountMinor: 30000 },
      { fromPersonId: "c", toPersonId: "b", amountMinor: 10000 }
    ]);
  });

  it("explains a direct settlement as pairwise debts and payments", () => {
    const trip = {
      ...tripWithExpenses([
        {
          id: "expense_1",
          description: "Dinner",
          amountMinor: 90000,
          paidByPersonId: "a",
          splitType: "equal" as const,
          createdAt: "2026-07-20T00:00:00.000Z",
          shares: [{ personId: "b", amountMinor: 30000 }]
        },
        {
          id: "expense_2",
          description: "Taxi",
          amountMinor: 15000,
          paidByPersonId: "b",
          splitType: "exact" as const,
          createdAt: "2026-07-20T00:00:00.000Z",
          shares: [{ personId: "a", amountMinor: 15000 }]
        }
      ]),
      payments: [{ id: "payment_1", fromPersonId: "b", toPersonId: "a", amountMinor: 5000, createdAt: "2026-07-20T00:00:00.000Z" }]
    };
    const settlement = { fromPersonId: "b", toPersonId: "a", amountMinor: 10000 };

    expect(calculateDirectSettlementBreakdown(trip, settlement)).toEqual({
      owedToReceiverMinor: 30000,
      receiverOwedBackMinor: 15000,
      paidToReceiverMinor: 5000,
      paidBackMinor: 0
    });
  });

  it("subtracts recorded payments from the matching direct debt", () => {
    const trip = {
      ...tripWithExpenses([
        {
          id: "expense_1",
          description: "Dinner",
          amountMinor: 90000,
          paidByPersonId: "a",
          splitType: "equal" as const,
          createdAt: "2026-07-20T00:00:00.000Z",
          shares: [
            { personId: "a", amountMinor: 30000 },
            { personId: "b", amountMinor: 30000 },
            { personId: "c", amountMinor: 30000 }
          ]
        }
      ]),
      payments: [{ id: "payment_1", fromPersonId: "b", toPersonId: "a", amountMinor: 10000, createdAt: "2026-07-20T00:00:00.000Z" }]
    };

    expect(calculateDirectSettlements(trip)).toEqual([
      { fromPersonId: "b", toPersonId: "a", amountMinor: 20000 },
      { fromPersonId: "c", toPersonId: "a", amountMinor: 30000 }
    ]);
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
