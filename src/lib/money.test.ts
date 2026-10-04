import { describe, expect, it } from "vitest";
import { pesoToMinor, splitEvenly, moneyToMinor, minorToMoneyInput, formatMoney, formatCurrencyTotals, getCurrencyDigits, isSupportedCurrency } from "@/lib/money";

describe("pesoToMinor", () => {
  it("parses peso strings into minor units", () => {
    expect(pesoToMinor("1,234.56")).toBe(123456);
    expect(pesoToMinor("₱100")).toBe(10000);
  });
});

describe("splitEvenly", () => {
  it("distributes rounding remainder by cent", () => {
    expect(splitEvenly(10000, ["a", "b", "c"])).toEqual([
      { personId: "a", amountMinor: 3334 },
      { personId: "b", amountMinor: 3333 },
      { personId: "c", amountMinor: 3333 }
    ]);
  });
});


describe("currency precision", () => {
  it("supports current codes even when browser currency data is older", () => {
    for (const currency of ["SLE", "XCG", "ZWG"]) {
      expect(isSupportedCurrency(currency)).toBe(true);
      expect(moneyToMinor("1.01", currency)).toBe(101);
    }
  });
  it("uses zero, two, and three decimal minor units without floating point rounding", () => {
    expect(moneyToMinor("100", "JPY")).toBe(100);
    expect(moneyToMinor("100.00", "JPY")).toBe(100);
    expect(moneyToMinor("-.50", "PHP")).toBe(-50);
    expect(moneyToMinor("1.01", "PHP")).toBe(101);
    expect(moneyToMinor(".50", "PHP")).toBe(50);
    expect(moneyToMinor("1.005", "KWD")).toBe(1005);
    expect(minorToMoneyInput(100, "JPY")).toBe("100");
    expect(minorToMoneyInput(1005, "KWD")).toBe("1.005");
    expect(getCurrencyDigits("TWD")).toBe(2);
    expect(formatMoney(100, "JPY")).toContain("100");
    expect(formatMoney(1005, "KWD")).toContain("1.005");
  });

  it("rejects unsupported precision and unsafe amounts", () => {
    expect(moneyToMinor("100.5", "JPY")).toBeNaN();
    expect(moneyToMinor("1.001", "PHP")).toBeNaN();
    expect(moneyToMinor("9007199254740992", "JPY")).toBeNaN();
    expect(moneyToMinor("Infinity", "PHP")).toBeNaN();
  });

  it("keeps totals separate and treats legacy records as PHP", () => {
    const formatted = formatCurrencyTotals([{ amountMinor: 10000 }, { currency: "TWD", amountMinor: 5000 }, { currency: "TWD", amountMinor: 5000 }]);
    expect(formatted).toBe(`${formatMoney(10000, "PHP")} + ${formatMoney(10000, "TWD")}`);
  });
});
