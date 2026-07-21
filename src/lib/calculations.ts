import type { PersonBalance, Settlement, Trip } from "@/types";

export function calculatePersonBalances(trip: Trip): PersonBalance[] {
  const balances = new Map<string, PersonBalance>();

  for (const person of trip.people) {
    balances.set(person.id, {
      personId: person.id,
      paidMinor: 0,
      shareMinor: 0,
      balanceMinor: 0
    });
  }

  for (const expense of trip.expenses) {
    const payer = balances.get(expense.paidByPersonId);
    if (payer) {
      payer.paidMinor += expense.amountMinor;
      payer.balanceMinor += expense.amountMinor;
    }

    for (const share of expense.shares) {
      const balance = balances.get(share.personId);
      if (!balance) continue;

      balance.shareMinor += share.amountMinor;
      balance.balanceMinor -= share.amountMinor;
    }
  }

  for (const payment of trip.payments ?? []) {
    const sender = balances.get(payment.fromPersonId);
    if (sender) {
      sender.balanceMinor += payment.amountMinor;
    }

    const receiver = balances.get(payment.toPersonId);
    if (receiver) {
      receiver.balanceMinor -= payment.amountMinor;
    }
  }

  return trip.people.map((person) => balances.get(person.id)).filter(Boolean) as PersonBalance[];
}

export function calculateSettlements(balances: PersonBalance[]): Settlement[] {
  const debtors = balances
    .filter((balance) => balance.balanceMinor < 0)
    .map((balance) => ({
      personId: balance.personId,
      amountMinor: Math.abs(balance.balanceMinor)
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const creditors = balances
    .filter((balance) => balance.balanceMinor > 0)
    .map((balance) => ({
      personId: balance.personId,
      amountMinor: balance.balanceMinor
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = Math.min(debtor.amountMinor, creditor.amountMinor);

    if (amountMinor > 0) {
      settlements.push({
        fromPersonId: debtor.personId,
        toPersonId: creditor.personId,
        amountMinor
      });
    }

    debtor.amountMinor -= amountMinor;
    creditor.amountMinor -= amountMinor;

    if (debtor.amountMinor === 0) debtorIndex += 1;
    if (creditor.amountMinor === 0) creditorIndex += 1;
  }

  return settlements;
}

export function calculateSettlementReceipts(settlements: Settlement[]): Record<string, number> {
  return settlements.reduce<Record<string, number>>((totals, settlement) => {
    totals[settlement.toPersonId] = (totals[settlement.toPersonId] ?? 0) + settlement.amountMinor;
    return totals;
  }, {});
}

export function getTripTotalMinor(trip: Trip): number {
  return trip.expenses.reduce((total, expense) => total + expense.amountMinor, 0);
}
