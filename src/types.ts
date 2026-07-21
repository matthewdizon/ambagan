export type SplitType = "equal" | "exact";

export type Person = {
  id: string;
  name: string;
};

export type ExpenseShare = {
  personId: string;
  amountMinor: number;
};

export type Expense = {
  id: string;
  description: string;
  amountMinor: number;
  paidByPersonId: string;
  shares: ExpenseShare[];
  splitType: SplitType;
  date?: string;
  createdAt: string;
};

export type Trip = {
  id: string;
  name: string;
  currency: "PHP";
  people: Person[];
  expenses: Expense[];
  createdAt: string;
  updatedAt: string;
};

export type PersonBalance = {
  personId: string;
  paidMinor: number;
  shareMinor: number;
  balanceMinor: number;
};

export type Settlement = {
  fromPersonId: string;
  toPersonId: string;
  amountMinor: number;
};
