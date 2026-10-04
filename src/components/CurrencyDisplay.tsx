import { formatMoney, getCurrencyFlag, getCurrencyTotals } from "@/lib/money";
import type { Currency } from "@/types";

export function CurrencyDisplay({ currency, amountMinor }: { currency: Currency; amountMinor?: number }) {
  return <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">{getCurrencyFlag(currency)}</span>{amountMinor === undefined ? currency : formatMoney(amountMinor, currency)}</span>;
}

export function CurrencyTotals({ records }: { records: Array<{ currency?: Currency; amountMinor: number }> }) {
  return <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">{[...getCurrencyTotals(records)].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => <CurrencyDisplay key={currency} currency={currency} amountMinor={amountMinor} />)}</span>;
}
