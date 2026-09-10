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

export function calculateDirectSettlements(trip: Trip): Settlement[] {
  const pairBalances = new Map<string, number>();

  function addDebt(fromPersonId: string, toPersonId: string, amountMinor: number) {
    if (fromPersonId === toPersonId || amountMinor === 0) return;

    const [firstPersonId, secondPersonId] = [fromPersonId, toPersonId].sort();
    const key = `${firstPersonId}:${secondPersonId}`;
    const signedAmount = fromPersonId === firstPersonId ? amountMinor : -amountMinor;
    pairBalances.set(key, (pairBalances.get(key) ?? 0) + signedAmount);
  }

  for (const expense of trip.expenses) {
    for (const share of expense.shares) {
      addDebt(share.personId, expense.paidByPersonId, share.amountMinor);
    }
  }

  for (const payment of trip.payments ?? []) {
    addDebt(payment.fromPersonId, payment.toPersonId, -payment.amountMinor);
  }

  return Array.from(pairBalances, ([pair, amountMinor]) => {
    const [firstPersonId, secondPersonId] = pair.split(":");
    return amountMinor > 0
      ? { fromPersonId: firstPersonId, toPersonId: secondPersonId, amountMinor }
      : { fromPersonId: secondPersonId, toPersonId: firstPersonId, amountMinor: Math.abs(amountMinor) };
  }).filter((settlement) => settlement.amountMinor > 0);
}

export function calculateDirectSettlementBreakdown(trip: Trip, settlement: Settlement) {
  let owedToReceiverMinor = 0;
  let receiverOwedBackMinor = 0;

  for (const expense of trip.expenses) {
    if (expense.paidByPersonId === settlement.toPersonId) {
      owedToReceiverMinor += expense.shares.find((share) => share.personId === settlement.fromPersonId)?.amountMinor ?? 0;
    }

    if (expense.paidByPersonId === settlement.fromPersonId) {
      receiverOwedBackMinor += expense.shares.find((share) => share.personId === settlement.toPersonId)?.amountMinor ?? 0;
    }
  }

  let paidToReceiverMinor = 0;
  let paidBackMinor = 0;

  for (const payment of trip.payments ?? []) {
    if (payment.fromPersonId === settlement.fromPersonId && payment.toPersonId === settlement.toPersonId) {
      paidToReceiverMinor += payment.amountMinor;
    }
    if (payment.fromPersonId === settlement.toPersonId && payment.toPersonId === settlement.fromPersonId) {
      paidBackMinor += payment.amountMinor;
    }
  }

  return { owedToReceiverMinor, receiverOwedBackMinor, paidToReceiverMinor, paidBackMinor };
}

export function calculateSimplifiedSettlementBreakdown(
  balances: PersonBalance[],
  directSettlements: Settlement[],
  settlements: Settlement[],
  settlement: Settlement
) {
  const outgoingDebts = directSettlements.filter((item) => item.fromPersonId === settlement.fromPersonId);
  const incomingDebts = directSettlements.filter((item) => item.toPersonId === settlement.fromPersonId);
  const outgoingTotalMinor = outgoingDebts.reduce((total, item) => total + item.amountMinor, 0);
  const incomingTotalMinor = incomingDebts.reduce((total, item) => total + item.amountMinor, 0);
  const payerDebtMinor = Math.max(0, -(balances.find((balance) => balance.personId === settlement.fromPersonId)?.balanceMinor ?? 0));
  const receiverCreditMinor = Math.max(0, balances.find((balance) => balance.personId === settlement.toPersonId)?.balanceMinor ?? 0);
  const settlementIndex = settlements.indexOf(settlement);
  const earlierSettlements = settlementIndex >= 0 ? settlements.slice(0, settlementIndex) : [];
  const alreadyRoutedFromPayerMinor = earlierSettlements
    .filter((item) => item.fromPersonId === settlement.fromPersonId)
    .reduce((total, item) => total + item.amountMinor, 0);
  const alreadyRoutedToReceiverMinor = earlierSettlements
    .filter((item) => item.toPersonId === settlement.toPersonId)
    .reduce((total, item) => total + item.amountMinor, 0);

  return {
    outgoingDebts,
    incomingDebts,
    outgoingTotalMinor,
    incomingTotalMinor,
    payerDebtMinor,
    payerRemainingBeforeMinor: Math.max(0, payerDebtMinor - alreadyRoutedFromPayerMinor),
    receiverCreditMinor,
    receiverRemainingBeforeMinor: Math.max(0, receiverCreditMinor - alreadyRoutedToReceiverMinor)
  };
}

export type SimplifiedSettlementRoute = {
  amountMinor: number;
  personIds: string[];
  priorUses: Array<{ amountMinor: number; personIds: string[] }>;
};

export type SimplifiedSettlementAllocation = {
  amountMinor: number;
  payerOwesPersonId: string;
  receiverOwedByPersonId: string;
};

export function calculateSimplifiedSettlementAllocations(
  directSettlements: Settlement[],
  settlements: Settlement[]
): Map<Settlement, SimplifiedSettlementAllocation[]> {
  const personIds = new Set(directSettlements.flatMap((settlement) => [settlement.fromPersonId, settlement.toPersonId]));
  const remainingDebts = new Map<string, Array<{ personId: string; amountMinor: number }>>();
  const remainingCredits = new Map<string, Array<{ personId: string; amountMinor: number }>>();

  for (const personId of personIds) {
    const outgoing = directSettlements
      .filter((settlement) => settlement.fromPersonId === personId)
      .map((settlement) => ({ personId: settlement.toPersonId, amountMinor: settlement.amountMinor }));
    const incoming = directSettlements
      .filter((settlement) => settlement.toPersonId === personId)
      .map((settlement) => ({ personId: settlement.fromPersonId, amountMinor: settlement.amountMinor }));

    remainingDebts.set(personId, subtractFromSegments(outgoing, incoming.reduce((total, item) => total + item.amountMinor, 0)));
    remainingCredits.set(personId, subtractFromSegments(incoming, outgoing.reduce((total, item) => total + item.amountMinor, 0)));
  }

  const result = new Map<Settlement, SimplifiedSettlementAllocation[]>();

  for (const settlement of settlements) {
    const debts = remainingDebts.get(settlement.fromPersonId) ?? [];
    const credits = remainingCredits.get(settlement.toPersonId) ?? [];
    const allocations: SimplifiedSettlementAllocation[] = [];
    let amountLeftMinor = settlement.amountMinor;

    while (amountLeftMinor > 0 && debts.length > 0 && credits.length > 0) {
      const debt = debts[0];
      const credit = credits[0];
      const amountMinor = Math.min(amountLeftMinor, debt.amountMinor, credit.amountMinor);

      allocations.push({
        amountMinor,
        payerOwesPersonId: debt.personId,
        receiverOwedByPersonId: credit.personId
      });
      amountLeftMinor -= amountMinor;
      debt.amountMinor -= amountMinor;
      credit.amountMinor -= amountMinor;
      if (debt.amountMinor === 0) debts.shift();
      if (credit.amountMinor === 0) credits.shift();
    }

    result.set(settlement, allocations);
  }

  return result;
}

export function sliceSimplifiedSettlementAllocations(
  allocations: SimplifiedSettlementAllocation[],
  offsetMinor: number,
  amountMinor: number
): SimplifiedSettlementAllocation[] {
  const sliced: SimplifiedSettlementAllocation[] = [];
  let amountToSkipMinor = offsetMinor;
  let amountLeftMinor = amountMinor;

  for (const allocation of allocations) {
    if (amountLeftMinor === 0) break;

    const skippedMinor = Math.min(amountToSkipMinor, allocation.amountMinor);
    amountToSkipMinor -= skippedMinor;
    const availableMinor = allocation.amountMinor - skippedMinor;
    if (availableMinor === 0) continue;

    const includedMinor = Math.min(amountLeftMinor, availableMinor);
    sliced.push({ ...allocation, amountMinor: includedMinor });
    amountLeftMinor -= includedMinor;
  }

  return sliced;
}

function subtractFromSegments(
  segments: Array<{ personId: string; amountMinor: number }>,
  amountToSubtractMinor: number
): Array<{ personId: string; amountMinor: number }> {
  const remaining = segments.map((segment) => ({ ...segment }));
  let amountLeftMinor = amountToSubtractMinor;

  while (amountLeftMinor > 0 && remaining.length > 0) {
    const amountMinor = Math.min(amountLeftMinor, remaining[0].amountMinor);
    remaining[0].amountMinor -= amountMinor;
    amountLeftMinor -= amountMinor;
    if (remaining[0].amountMinor === 0) remaining.shift();
  }

  return remaining;
}

export function calculateSimplifiedSettlementRoutes(
  directSettlements: Settlement[],
  settlements: Settlement[]
): Map<Settlement, { routes: SimplifiedSettlementRoute[]; unmatchedMinor: number }> {
  const remainingEdges = directSettlements.map((settlement) => ({ ...settlement }));
  const edgeUses = directSettlements.map(() => [] as Array<{ amountMinor: number; personIds: string[] }>);
  const result = new Map<Settlement, { routes: SimplifiedSettlementRoute[]; unmatchedMinor: number }>();

  for (const settlement of settlements) {
    const routes: SimplifiedSettlementRoute[] = [];
    let unmatchedMinor = settlement.amountMinor;

    while (unmatchedMinor > 0) {
      const pathEdgeIndexes = findSettlementPath(remainingEdges, settlement.fromPersonId, settlement.toPersonId);
      if (!pathEdgeIndexes) break;

      const amountMinor = Math.min(unmatchedMinor, ...pathEdgeIndexes.map((index) => remainingEdges[index].amountMinor));
      const personIds = [settlement.fromPersonId, ...pathEdgeIndexes.map((index) => remainingEdges[index].toPersonId)];
      const priorUses = pathEdgeIndexes.length === 1 ? [...edgeUses[pathEdgeIndexes[0]]] : [];

      routes.push({ amountMinor, personIds, priorUses });
      unmatchedMinor -= amountMinor;
      for (const index of pathEdgeIndexes) {
        remainingEdges[index].amountMinor -= amountMinor;
        edgeUses[index].push({ amountMinor, personIds });
      }
    }

    result.set(settlement, { routes, unmatchedMinor });
  }

  return result;
}

function findSettlementPath(edges: Settlement[], fromPersonId: string, toPersonId: string): number[] | null {
  const queue: Array<{ personId: string; path: number[] }> = [{ personId: fromPersonId, path: [] }];
  const visited = new Set([fromPersonId]);

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index];
      if (edge.amountMinor <= 0 || edge.fromPersonId !== current.personId || visited.has(edge.toPersonId)) continue;

      const path = [...current.path, index];
      if (edge.toPersonId === toPersonId) return path;

      visited.add(edge.toPersonId);
      queue.push({ personId: edge.toPersonId, path });
    }
  }

  return null;
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
