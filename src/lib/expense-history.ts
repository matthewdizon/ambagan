import type { Expense } from "@/types";

export function getExpenseDate(expense: Expense): string {
  return expense.date || expense.createdAt.slice(0, 10);
}

export function groupExpensesByDate(expenses: Expense[], { from = "", to = "", payer = null }: { from?: string; to?: string; payer?: string | null } = {}) {
  const groups = new Map<string, Expense[]>();
  for (const expense of expenses) {
    const date = getExpenseDate(expense);
    if ((from && date < from) || (to && date > to) || (payer && expense.paidByPersonId !== payer)) continue;
    const group = groups.get(date) ?? [];
    group.push(expense);
    groups.set(date, group);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, records]) => ({ date, expenses: [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
}
