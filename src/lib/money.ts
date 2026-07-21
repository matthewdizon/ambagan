export const DEFAULT_CURRENCY = "PHP";

export function pesoToMinor(value: string): number {
  const normalized = value.replace(/[₱,\s]/g, "");
  if (!normalized) return 0;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return Number.NaN;

  return Math.round(parsed * 100);
}

export function minorToPesoInput(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export function formatMoney(amountMinor: number): string {
  const formatter = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: DEFAULT_CURRENCY,
    minimumFractionDigits: 2
  });

  return formatter.format(amountMinor / 100);
}

export function splitEvenly(amountMinor: number, personIds: string[]) {
  if (personIds.length === 0) return [];

  const baseAmount = Math.floor(amountMinor / personIds.length);
  const remainder = amountMinor % personIds.length;

  return personIds.map((personId, index) => ({
    personId,
    amountMinor: baseAmount + (index < remainder ? 1 : 0)
  }));
}
