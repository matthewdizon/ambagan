import type { Currency, Trip } from "@/types";

export const DEFAULT_CURRENCY = "PHP";

// Keep the same catalogue on server and browser: older browser ICU data can omit
// newer ISO codes such as SLE, XCG, and ZWG. Includes recognized legacy codes.
export const SUPPORTED_CURRENCIES: Currency[] = [
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL",
  "BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD",
  "EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR",
  "ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR",
  "LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO",
  "NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG",
  "SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD",
  "TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF XSU YER ZAR ZMW",
  "ZWG ZWL"
].join(" ").split(" ");
const supportedCurrencies = new Set(SUPPORTED_CURRENCIES);
const formatters = new Map<Currency, Intl.NumberFormat>();

export function isSupportedCurrency(value: unknown): value is Currency {
  return typeof value === "string" && supportedCurrencies.has(value);
}

export function getCurrency(record: { currency?: Currency }): Currency {
  return record.currency ?? DEFAULT_CURRENCY;
}

function getFormatter(currency: Currency): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-PH", { style: "currency", currency, currencyDisplay: "code" });
    formatters.set(currency, formatter);
  }
  return formatter;
}

export function getCurrencyDigits(currency: Currency = DEFAULT_CURRENCY): number {
  return getFormatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

export function moneyToMinor(value: string, currency: Currency = DEFAULT_CURRENCY): number {
  const normalized = value.replace(/[₱,\s]/g, "");
  if (!normalized) return 0;
  // Reject excess precision instead of silently rounding a payment or exact split.
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return Number.NaN;
  const digits = getCurrencyDigits(currency);
  const [whole, fraction = ""] = normalized.replace(/^-/, "").split(".");
  if (/[1-9]/.test(fraction.slice(digits))) return Number.NaN;
  const unsigned = Number(whole) * 10 ** digits + Number(fraction.slice(0, digits).padEnd(digits, "0"));
  const amount = normalized.startsWith("-") ? -unsigned : unsigned;
  return Number.isSafeInteger(amount) ? amount : Number.NaN;
}

export function minorToMoneyInput(amountMinor: number, currency: Currency = DEFAULT_CURRENCY): string {
  const digits = getCurrencyDigits(currency);
  const absolute = Math.abs(amountMinor);
  const factor = 10 ** digits;
  const whole = Math.floor(absolute / factor);
  const fraction = digits ? `.${(absolute % factor).toString().padStart(digits, "0")}` : "";
  return `${amountMinor < 0 ? "-" : ""}${whole}${fraction}`;
}

export function formatMoney(amountMinor: number, currency: Currency = DEFAULT_CURRENCY): string {
  return getFormatter(currency).format(amountMinor / 10 ** getCurrencyDigits(currency));
}

// Keep the PHP helpers compatible with existing callers and saved amounts.
export const pesoToMinor = moneyToMinor;
export const minorToPesoInput = minorToMoneyInput;

export function getTripCurrencies(trip: Trip): Currency[] {
  const currencies = [...new Set([...trip.expenses, ...(trip.payments ?? [])].map(getCurrency))];
  return currencies.length ? currencies.sort() : [trip.currency ?? DEFAULT_CURRENCY];
}

export function filterTripByCurrency(trip: Trip, currency: Currency): Trip {
  return { ...trip, currency, expenses: trip.expenses.filter((item) => getCurrency(item) === currency), payments: trip.payments?.filter((item) => getCurrency(item) === currency) };
}

export function getCurrencyTotals(records: Array<{ amountMinor: number; currency?: Currency }>): Map<Currency, number> {
  const totals = new Map<Currency, number>();
  for (const record of records) {
    const currency = getCurrency(record);
    totals.set(currency, (totals.get(currency) ?? 0) + record.amountMinor);
  }
  return totals;
}

export function formatCurrencyTotals(records: Array<{ amountMinor: number; currency?: Currency }>): string {
  const totals = getCurrencyTotals(records);
  return totals.size ? [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => formatMoney(amount, currency)).join(" + ") : formatMoney(0);
}

export function hasValidTripCurrencies(trip: Trip): boolean {
  if (!Array.isArray(trip.expenses) || (trip.payments !== undefined && !Array.isArray(trip.payments))) return false;
  return (trip.currency === undefined || isSupportedCurrency(trip.currency)) &&
    (trip.lastExpenseCurrency === undefined || isSupportedCurrency(trip.lastExpenseCurrency)) &&
    [...trip.expenses, ...(trip.payments ?? [])].every((record) => record && (record.currency === undefined || isSupportedCurrency(record.currency)));
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

// Explicit representative regions; shared currencies use regional symbols.
const currencyRegions: Record<string, string> = Object.fromEntries(
  "AED:AE AFN:AF ALL:AL AMD:AM ANG:CW AOA:AO ARS:AR AUD:AU AWG:AW AZN:AZ BAM:BA BBD:BB BDT:BD BGN:BG BHD:BH BIF:BI BMD:BM BND:BN BOB:BO BRL:BR BSD:BS BTN:BT BWP:BW BYN:BY BZD:BZ CAD:CA CDF:CD CHF:CH CLP:CL CNY:CN COP:CO CRC:CR CUC:CU CUP:CU CVE:CV CZK:CZ DJF:DJ DKK:DK DOP:DO DZD:DZ EGP:EG ERN:ER ETB:ET EUR:EU FJD:FJ FKP:FK GBP:GB GEL:GE GHS:GH GIP:GI GMD:GM GNF:GN GTQ:GT GYD:GY HKD:HK HNL:HN HRK:HR HTG:HT HUF:HU IDR:ID ILS:IL INR:IN IQD:IQ IRR:IR ISK:IS JMD:JM JOD:JO JPY:JP KES:KE KGS:KG KHR:KH KMF:KM KPW:KP KRW:KR KWD:KW KYD:KY KZT:KZ LAK:LA LBP:LB LKR:LK LRD:LR LSL:LS LYD:LY MAD:MA MDL:MD MGA:MG MKD:MK MMK:MM MNT:MN MOP:MO MRU:MR MUR:MU MVR:MV MWK:MW MXN:MX MYR:MY MZN:MZ NAD:NA NGN:NG NIO:NI NOK:NO NPR:NP NZD:NZ OMR:OM PAB:PA PEN:PE PGK:PG PHP:PH PKR:PK PLN:PL PYG:PY QAR:QA RON:RO RSD:RS RUB:RU RWF:RW SAR:SA SBD:SB SCR:SC SDG:SD SEK:SE SGD:SG SHP:SH SLE:SL SLL:SL SOS:SO SRD:SR SSP:SS STN:ST SVC:SV SYP:SY SZL:SZ THB:TH TJS:TJ TMT:TM TND:TN TOP:TO TRY:TR TTD:TT TWD:TW TZS:TZ UAH:UA UGX:UG USD:US UYU:UY UZS:UZ VES:VE VND:VN VUV:VU WST:WS YER:YE ZAR:ZA ZMW:ZM ZWG:ZW ZWL:ZW".split(" ").map((entry) => entry.split(":"))
);

export function getCurrencyFlag(currency: Currency): string {
  const region = currencyRegions[currency];
  return region ? String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0))) : "🌐";
}
