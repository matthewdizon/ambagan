import { describe, expect, it } from "vitest";
import { pesoToMinor, splitEvenly } from "@/lib/money";

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
