import { describe, expect, it } from "vitest";
import { getExpenseDate, groupExpensesByDate } from "@/lib/expense-history";
import { getCurrencyTotals, getCurrencyFlag } from "@/lib/money";
import type { Expense } from "@/types";

const records: Expense[] = [
  { id: "a", description: "Lunch", amountMinor: 10000, paidByPersonId: "one", shares: [], splitType: "equal", createdAt: "2026-10-04T23:00:00Z" },
  { id: "b", description: "Taxi", currency: "TWD", amountMinor: 5000, paidByPersonId: "two", shares: [], splitType: "equal", date: "2026-10-05", createdAt: "2026-10-06T01:00:00Z" },
  { id: "c", description: "Dinner", amountMinor: 20000, paidByPersonId: "one", shares: [], splitType: "equal", date: "2026-10-05", createdAt: "2026-10-05T01:00:00Z" }
];

describe("expense history", () => {
  it("uses recorded dates with a legacy creation-date fallback and sorts newest first", () => {
    expect(getExpenseDate(records[0])).toBe("2026-10-04");
    expect(groupExpensesByDate(records).map((group) => [group.date, group.expenses.map((record) => record.id)])).toEqual([["2026-10-05", ["b", "c"]], ["2026-10-04", ["a"]]]);
    expect(records.map((record) => record.id)).toEqual(["a", "b", "c"]);
  });
  it("combines inclusive date boundaries and payer filters", () => {
    expect(groupExpensesByDate(records, { from: "2026-10-05", to: "2026-10-05", payer: "one" })[0].expenses.map((record) => record.id)).toEqual(["c"]);
    expect(groupExpensesByDate(records, { to: "2026-10-04" })[0].expenses.map((record) => record.id)).toEqual(["a"]);
    expect(groupExpensesByDate(records, { from: "2026-10-06", to: "2026-10-04" })).toEqual([]);
    expect(groupExpensesByDate([])).toEqual([]);
  });
  it("keeps daily totals in separate currencies", () => {
    expect(getCurrencyTotals(groupExpensesByDate(records)[0].expenses)).toEqual(new Map([["TWD", 5000], ["PHP", 20000]]));
  });
  it("uses representative flags and a globe for shared currencies", () => {
    expect(getCurrencyFlag("PHP")).toBe("🇵🇭");
    expect(getCurrencyFlag("TWD")).toBe("🇹🇼");
    expect(getCurrencyFlag("EUR")).toBe("🇪🇺");
    expect(getCurrencyFlag("XOF")).toBe("🌐");
  });
});
