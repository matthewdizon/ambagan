export type Currency = string;

export type SplitType = "equal" | "exact" | "itemized";

export type Person = {
  id: string;
  name: string;
};

export type ExpenseShare = {
  personId: string;
  amountMinor: number;
};

export type ExpenseLineItem = {
  id: string;
  description: string;
  amountMinor: number;
  participantIds: string[];
  shares: ExpenseShare[];
};

export type Expense = {
  /** Missing on legacy PHP records. */
  currency?: Currency;
  id: string;
  description: string;
  amountMinor: number;
  paidByPersonId: string;
  shares: ExpenseShare[];
  lineItems?: ExpenseLineItem[];
  splitType: SplitType;
  date?: string;
  createdAt: string;
};

export type Payment = {
  /** Missing on legacy PHP records. */
  currency?: Currency;
  id: string;
  fromPersonId: string;
  toPersonId: string;
  amountMinor: number;
  date?: string;
  createdAt: string;
};

export type Trip = {
  id: string;
  name: string;
  currency: Currency;
  lastExpenseCurrency?: Currency;
  people: Person[];
  expenses: Expense[];
  payments?: Payment[];
  createdAt: string;
  updatedAt: string;
};

export type PersonBalance = {
  currency?: Currency;
  personId: string;
  paidMinor: number;
  shareMinor: number;
  balanceMinor: number;
};

export type Settlement = {
  currency?: Currency;
  fromPersonId: string;
  toPersonId: string;
  amountMinor: number;
};
