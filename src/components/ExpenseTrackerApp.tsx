"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { calculateDirectSettlementBreakdown, calculateDirectSettlements, calculatePersonBalances, calculateSettlements, calculateSimplifiedSettlementBreakdown, calculateSimplifiedSettlementRoutes, getTripTotalMinor } from "@/lib/calculations";
import { decodeTripFromHash } from "@/lib/share";
import { loadTripFromStorage, saveTripToStorage } from "@/lib/storage";
import { formatMoney, minorToPesoInput, pesoToMinor, splitEvenly } from "@/lib/money";
import type { Expense, ExpenseLineItem, ExpenseShare, Payment, Person, PersonBalance, Settlement, SplitType, Trip } from "@/types";
import { toast } from "sonner";

type ExpenseLineItemDraft = {
  id: string;
  description: string;
  amount: string;
  participantIds: string[];
};

type ExpenseDraft = {
  description: string;
  amount: string;
  date: string;
  paidByPersonId: string;
  splitType: SplitType;
  participantIds: string[];
  exactShares: Record<string, string>;
  lineItems: ExpenseLineItemDraft[];
};

type ExpenseDraftError = {
  field: "description" | "amount" | "paidByPersonId" | "participantIds" | "exactShares" | "lineItems";
  message: string;
};

type PaymentDraft = {
  fromPersonId: string;
  toPersonId: string;
  amount: string;
  date: string;
};

type PaymentDraftError = {
  field: "fromPersonId" | "toPersonId" | "amount";
  message: string;
};

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
};

const emptyDraft: ExpenseDraft = {
  description: "",
  amount: "",
  date: "",
  paidByPersonId: "",
  splitType: "equal",
  participantIds: [],
  exactShares: {},
  lineItems: []
};

const emptyPaymentDraft: PaymentDraft = {
  fromPersonId: "",
  toPersonId: "",
  amount: "",
  date: ""
};

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTrip(name: string): Trip {
  const now = new Date().toISOString();

  return {
    id: createId("trip"),
    name,
    currency: "PHP",
    people: [],
    expenses: [],
    payments: [],
    createdAt: now,
    updatedAt: now
  };
}

function touchTrip(trip: Trip): Trip {
  return {
    ...trip,
    updatedAt: new Date().toISOString()
  };
}

function getPersonName(trip: Trip, personId: string) {
  return trip.people.find((person) => person.id === personId)?.name ?? "Unknown";
}

function getTodayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function getExpenseDate(expense: Expense) {
  return expense.date ?? expense.createdAt.slice(0, 10);
}

function createLineItemDraft(people: Person[]): ExpenseLineItemDraft {
  return {
    id: createId("line_item"),
    description: "",
    amount: "",
    participantIds: people.map((person) => person.id)
  };
}

function formatExpenseDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function getAvatarStyle(name: string) {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  const hue = hash % 360;
  const accentHue = (hue + 46 + (hash % 84)) % 360;
  const markSize = 34 + (hash % 22);

  return {
    backgroundColor: `hsl(${hue} 70% 86%)`,
    backgroundImage: `
      radial-gradient(circle at ${22 + (hash % 34)}% ${24 + ((hash >> 4) % 34)}%, hsl(${accentHue} 78% 52%) 0 ${markSize}%, transparent ${markSize + 1}%),
      linear-gradient(135deg, hsl(${hue} 64% 58%), hsl(${(hue + 132) % 360} 58% 72%))
    `
  };
}

function expenseToDraft(expense: Expense, people: Person[]): ExpenseDraft {
  return {
    description: expense.description,
    amount: minorToPesoInput(expense.amountMinor),
    date: getExpenseDate(expense),
    paidByPersonId: expense.paidByPersonId,
    splitType: expense.splitType,
    participantIds: expense.shares.map((share) => share.personId),
    exactShares: Object.fromEntries(
      people.map((person) => {
        const share = expense.shares.find((item) => item.personId === person.id);
        return [person.id, share ? minorToPesoInput(share.amountMinor) : ""];
      })
    ),
    lineItems: expense.lineItems?.map((item) => ({
      id: item.id,
      description: item.description,
      amount: minorToPesoInput(item.amountMinor),
      participantIds: item.participantIds
    })) ?? []
  };
}

function getItemizedAmountMinor(draft: ExpenseDraft): number {
  return draft.lineItems.reduce((total, item) => total + pesoToMinor(item.amount), 0);
}

function aggregateShares(shares: ExpenseShare[]): ExpenseShare[] {
  const totals = new Map<string, number>();

  for (const share of shares) {
    totals.set(share.personId, (totals.get(share.personId) ?? 0) + share.amountMinor);
  }

  return Array.from(totals, ([personId, amountMinor]) => ({ personId, amountMinor })).filter((share) => share.amountMinor > 0);
}

function buildLineItems(draft: ExpenseDraft): ExpenseLineItem[] {
  return draft.lineItems.map((item) => {
    const amountMinor = pesoToMinor(item.amount);

    return {
      id: item.id,
      description: item.description.trim(),
      amountMinor,
      participantIds: item.participantIds,
      shares: splitEvenly(amountMinor, item.participantIds)
    };
  });
}

function buildShares(draft: ExpenseDraft, amountMinor: number): ExpenseShare[] {
  if (draft.splitType === "itemized") {
    return aggregateShares(buildLineItems(draft).flatMap((item) => item.shares));
  }

  if (draft.splitType === "equal") {
    return splitEvenly(amountMinor, draft.participantIds);
  }

  return draft.participantIds.map((personId) => ({
    personId,
    amountMinor: pesoToMinor(draft.exactShares[personId] ?? "")
  }));
}

function validateExpenseDraft(draft: ExpenseDraft): ExpenseDraftError | null {
  const amountMinor = draft.splitType === "itemized" ? getItemizedAmountMinor(draft) : pesoToMinor(draft.amount);

  if (!draft.description.trim()) return { field: "description", message: "Add a description." };
  if (!draft.paidByPersonId) return { field: "paidByPersonId", message: "Choose who paid." };

  if (draft.splitType === "itemized") {
    if (draft.lineItems.length === 0) return { field: "lineItems", message: "Add at least one item." };

    for (const item of draft.lineItems) {
      const itemAmountMinor = pesoToMinor(item.amount);
      if (!item.description.trim()) return { field: "lineItems", message: "Each item needs a name." };
      if (!Number.isFinite(itemAmountMinor) || itemAmountMinor <= 0) {
        return { field: "lineItems", message: "Each item needs a valid amount greater than zero." };
      }
      if (item.participantIds.length === 0) {
        return { field: "lineItems", message: "Each item needs at least one person." };
      }
    }

    return null;
  }

  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return { field: "amount", message: "Enter a valid amount greater than zero." };
  }
  if (draft.participantIds.length === 0) {
    return { field: "participantIds", message: "Choose at least one person involved." };
  }

  if (draft.splitType === "exact") {
    const shares = buildShares(draft, amountMinor);
    if (shares.some((share) => !Number.isFinite(share.amountMinor) || share.amountMinor < 0)) {
      return { field: "exactShares", message: "Exact shares must be valid amounts." };
    }

    const totalShares = shares.reduce((total, share) => total + share.amountMinor, 0);
    if (totalShares !== amountMinor) {
      return { field: "exactShares", message: `Exact shares must add up to ${formatMoney(amountMinor)}.` };
    }
  }

  return null;
}

function getSplitTypeLabel(splitType: SplitType) {
  if (splitType === "itemized") return "Itemized breakdown";
  return splitType === "equal" ? "Split equally" : "Enter exact amounts";
}

function createDraftForTrip(trip: Trip): ExpenseDraft {
  return {
    ...emptyDraft,
    date: getTodayInputDate(),
    paidByPersonId: trip.people[0]?.id ?? "",
    participantIds: trip.people.map((person) => person.id),
    exactShares: Object.fromEntries(trip.people.map((person) => [person.id, ""])),
    lineItems: []
  };
}

function createPaymentDraftForTrip(trip: Trip): PaymentDraft {
  return {
    ...emptyPaymentDraft,
    fromPersonId: trip.people[0]?.id ?? "",
    toPersonId: trip.people.find((person) => person.id !== trip.people[0]?.id)?.id ?? "",
    date: getTodayInputDate()
  };
}

function validatePaymentDraft(draft: PaymentDraft): PaymentDraftError | null {
  const amountMinor = pesoToMinor(draft.amount);

  if (!draft.fromPersonId) return { field: "fromPersonId", message: "Choose who paid." };
  if (!draft.toPersonId) return { field: "toPersonId", message: "Choose who received the payment." };
  if (draft.fromPersonId === draft.toPersonId) {
    return { field: "toPersonId", message: "Choose two different people." };
  }
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return { field: "amount", message: "Enter a valid payment amount greater than zero." };
  }

  return null;
}

export function ExpenseTrackerApp({ initialSharedTrip = null }: { initialSharedTrip?: Trip | null }) {
  const [isReady, setIsReady] = useState(false);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [sharedTrip, setSharedTrip] = useState<Trip | null>(null);
  const [newPersonName, setNewPersonName] = useState("");
  const [isRenamingTrip, setIsRenamingTrip] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [draftError, setDraftError] = useState<ExpenseDraftError | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(emptyPaymentDraft);
  const [paymentDraftError, setPaymentDraftError] = useState<PaymentDraftError | null>(null);
  const [simplifyTransfers, setSimplifyTransfers] = useState(true);
  const [expensePayerFilter, setExpensePayerFilter] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTrip = sharedTrip ?? trip;

  const isReadOnly = Boolean(sharedTrip);

  useEffect(() => {
    const loadedTrip = loadTripFromStorage();
    const loadedSharedTrip = initialSharedTrip ?? decodeTripFromHash(window.location.hash);

    setTrip(loadedTrip ?? createTrip("Untitled ambagan"));
    setSharedTrip(loadedSharedTrip);
    setIsReady(true);
  }, [initialSharedTrip]);

  useEffect(() => {
    if (!isReady || !trip) return;
    saveTripToStorage(trip);
  }, [isReady, trip]);

  useEffect(() => {
    if (!selectedTrip || selectedTrip.people.length === 0 || editingExpenseId) return;

    setDraft((current) => ({
      ...current,
      date: current.date || getTodayInputDate(),
      paidByPersonId: current.paidByPersonId || selectedTrip.people[0].id,
      participantIds: current.participantIds.length > 0 ? current.participantIds : selectedTrip.people.map((person) => person.id)
    }));

    setPaymentDraft((current) => ({
      ...current,
      date: current.date || getTodayInputDate(),
      fromPersonId: current.fromPersonId || selectedTrip.people[0].id,
      toPersonId: current.toPersonId || (selectedTrip.people.find((person) => person.id !== selectedTrip.people[0].id)?.id ?? "")
    }));
  }, [editingExpenseId, selectedTrip]);

  const balances = useMemo(() => (selectedTrip ? calculatePersonBalances(selectedTrip) : []), [selectedTrip]);
  const settlements = useMemo(() => calculateSettlements(balances), [balances]);
  const directSettlements = useMemo(() => (selectedTrip ? calculateDirectSettlements(selectedTrip) : []), [selectedTrip]);
  const visibleSettlements = simplifyTransfers ? settlements : directSettlements;
  const settlementGroups = useMemo(() => {
    const groups = new Map<string, Settlement[]>();

    for (const settlement of visibleSettlements) {
      groups.set(settlement.toPersonId, [...(groups.get(settlement.toPersonId) ?? []), settlement]);
    }

    return Array.from(groups, ([personId, transfers]) => ({
      personId,
      transfers,
      amountMinor: transfers.reduce((total, transfer) => total + transfer.amountMinor, 0)
    }));
  }, [visibleSettlements]);
  const tripTotal = selectedTrip ? getTripTotalMinor(selectedTrip) : 0;
  const payments = selectedTrip?.payments ?? [];
  const filteredExpenses = selectedTrip?.expenses.filter((expense) => !expensePayerFilter || expense.paidByPersonId === expensePayerFilter) ?? [];
  const tripMetrics = selectedTrip
    ? [
        { label: "People", value: selectedTrip.people.length.toString(), detail: "Included in this ambagan" },
        { label: "Expenses", value: selectedTrip.expenses.length.toString(), detail: "Tracked shared costs" },
        { label: "Settled", value: formatMoney(payments.reduce((total, payment) => total + payment.amountMinor, 0)), detail: "Already paid back" },
        { label: "Total", value: formatMoney(tripTotal), detail: "Group spend so far" }
      ]
    : [];

  function showNotice(tone: "success" | "error", message: string) {
    if (tone === "success") {
      toast.success(message);
      return;
    }

    toast.error(message);
  }

  function updateDraft(nextDraft: ExpenseDraft) {
    setDraft(nextDraft);
    if (draftError) setDraftError(null);
  }

  function askConfirm(nextConfirmDialog: ConfirmDialogState) {
    setConfirmDialog(nextConfirmDialog);
  }

  function confirmCurrentDialog() {
    if (!confirmDialog) return;
    confirmDialog.onConfirm();
    setConfirmDialog(null);
  }

  function updateTrip(updater: (trip: Trip) => Trip) {
    setTrip((currentTrip) => (currentTrip ? touchTrip(updater(currentTrip)) : currentTrip));
  }

  function handleRenameTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trip) return;

    const name = renameValue.trim();
    if (!name) {
      showNotice("error", "Ambagan name cannot be empty.");
      return;
    }

    updateTrip((currentTrip) => ({ ...currentTrip, name }));
    setIsRenamingTrip(false);
    setRenameValue("");
    showNotice("success", "Ambagan renamed.");
  }

  function handleExportTrip(trip: Trip) {
    const blob = new Blob([JSON.stringify(trip, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${trip.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "trip"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportTrip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imported = JSON.parse(await file.text()) as Trip;
      if (!imported.name || !Array.isArray(imported.people) || !Array.isArray(imported.expenses)) {
        throw new Error("Invalid trip file.");
      }

      const now = new Date().toISOString();
      const importedTrip: Trip = {
        ...imported,
        id: createId("trip"),
        currency: "PHP",
        payments: imported.payments ?? [],
        createdAt: imported.createdAt ?? now,
        updatedAt: now
      };

      setTrip(importedTrip);
      setSharedTrip(null);
      setIsRenamingTrip(false);
      setDraft(createDraftForTrip(importedTrip));
      setDraftError(null);
      setPaymentDraft(createPaymentDraftForTrip(importedTrip));
      setPaymentDraftError(null);
      setEditingExpenseId(null);
      window.history.replaceState(null, "", "/");
      showNotice("success", "JSON opened.");
    } catch {
      showNotice("error", "That file does not look like a valid Ambagan export.");
    } finally {
      event.target.value = "";
    }
  }

  function handleAddPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTrip || isReadOnly) return;

    const name = newPersonName.trim();
    if (!name) {
      showNotice("error", "Add a person name first.");
      return;
    }

    const person = {
      id: createId("person"),
      name
    };

    updateTrip((currentTrip) => ({
      ...currentTrip,
      people: [...currentTrip.people, person]
    }));
    setDraft((current) => {
      if (editingExpenseId) return current;

      return {
        ...current,
        participantIds: [...new Set([...current.participantIds, person.id])],
        exactShares: {
          ...current.exactShares,
          [person.id]: ""
        }
      };
    });
    setPaymentDraft((current) => ({
      ...current,
      fromPersonId: current.fromPersonId || person.id,
      toPersonId: current.toPersonId || person.id
    }));
    setNewPersonName("");
    showNotice("success", "Person added.");
  }

  function handleRemovePerson(personId: string) {
    if (!selectedTrip || isReadOnly) return;
    const personName = getPersonName(selectedTrip, personId);

    const isUsed = selectedTrip.expenses.some(
      (expense) => expense.paidByPersonId === personId || expense.shares.some((share) => share.personId === personId)
    ) || payments.some((payment) => payment.fromPersonId === personId || payment.toPersonId === personId);
    if (isUsed) {
      showNotice("error", "Delete expenses or payments involving this person before removing them.");
      return;
    }

    askConfirm({
      title: `Remove ${personName}?`,
      description: "This person is not used in any expenses yet, so removing them will only update the group list.",
      confirmLabel: "Remove person",
      tone: "danger",
      onConfirm: () => {
        updateTrip((trip) => ({
          ...trip,
          people: trip.people.filter((person) => person.id !== personId)
        }));
        showNotice("success", "Person removed.");
      }
    });
  }

  function resetExpenseForm() {
    if (!selectedTrip) {
      setDraft(emptyDraft);
      setDraftError(null);
      setEditingExpenseId(null);
      return;
    }

    setDraft(createDraftForTrip(selectedTrip));
    setDraftError(null);
    setEditingExpenseId(null);
  }

  function openAddExpenseDialog() {
    if (!selectedTrip || isReadOnly) return;
    setDraft(createDraftForTrip(selectedTrip));
    setDraftError(null);
    setEditingExpenseId(null);
    setIsExpenseDialogOpen(true);
  }

  function handleSubmitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTrip || isReadOnly) return;

    const error = validateExpenseDraft(draft);
    if (error) {
      setDraftError(error);
      showNotice("error", error.message);
      return;
    }

    const amountMinor = draft.splitType === "itemized" ? getItemizedAmountMinor(draft) : pesoToMinor(draft.amount);
    const shares = buildShares(draft, amountMinor);
    const lineItems = draft.splitType === "itemized" ? buildLineItems(draft) : undefined;
    const now = new Date().toISOString();
    const expense: Expense = {
      id: editingExpenseId ?? createId("expense"),
      description: draft.description.trim(),
      amountMinor,
      paidByPersonId: draft.paidByPersonId,
      shares,
      lineItems,
      splitType: draft.splitType,
      date: draft.date || getTodayInputDate(),
      createdAt: editingExpenseId
        ? selectedTrip.expenses.find((item) => item.id === editingExpenseId)?.createdAt ?? now
        : now
    };

    updateTrip((trip) => ({
      ...trip,
      expenses: editingExpenseId
        ? trip.expenses.map((item) => (item.id === editingExpenseId ? expense : item))
        : [expense, ...trip.expenses]
    }));
    setDraftError(null);
    resetExpenseForm();
    setIsExpenseDialogOpen(false);
    showNotice("success", editingExpenseId ? "Expense updated." : "Expense added.");
  }

  function handleEditExpense(expense: Expense) {
    if (!selectedTrip || isReadOnly) return;
    setEditingExpenseId(expense.id);
    updateDraft(expenseToDraft(expense, selectedTrip.people));
    setIsExpenseDialogOpen(true);
  }

  function deleteExpense(expenseId: string) {
    if (!selectedTrip || isReadOnly) return;

    updateTrip((trip) => ({
      ...trip,
      expenses: trip.expenses.filter((expense) => expense.id !== expenseId)
    }));
    showNotice("success", "Expense deleted.");
  }

  function handleDeleteExpense(expense: Expense) {
    askConfirm({
      title: `Delete ${expense.description}?`,
      description: "This removes the expense and recalculates every balance and settlement for the trip.",
      confirmLabel: "Delete expense",
      tone: "danger",
      onConfirm: () => deleteExpense(expense.id)
    });
  }

  function updatePaymentDraft(nextDraft: PaymentDraft) {
    setPaymentDraft(nextDraft);
    if (paymentDraftError) setPaymentDraftError(null);
  }

  function handleSubmitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTrip || isReadOnly) return;

    const error = validatePaymentDraft(paymentDraft);
    if (error) {
      setPaymentDraftError(error);
      showNotice("error", error.message);
      return;
    }

    const now = new Date().toISOString();
    const payment: Payment = {
      id: createId("payment"),
      fromPersonId: paymentDraft.fromPersonId,
      toPersonId: paymentDraft.toPersonId,
      amountMinor: pesoToMinor(paymentDraft.amount),
      date: paymentDraft.date || getTodayInputDate(),
      createdAt: now
    };

    updateTrip((trip) => ({
      ...trip,
      payments: [payment, ...(trip.payments ?? [])]
    }));
    setPaymentDraft({
      ...createPaymentDraftForTrip(selectedTrip),
      fromPersonId: payment.fromPersonId,
      toPersonId: payment.toPersonId
    });
    setPaymentDraftError(null);
    showNotice("success", "Payment recorded.");
  }

  function deletePayment(paymentId: string) {
    if (!selectedTrip || isReadOnly) return;

    updateTrip((trip) => ({
      ...trip,
      payments: (trip.payments ?? []).filter((payment) => payment.id !== paymentId)
    }));
    showNotice("success", "Payment deleted.");
  }

  function handleDeletePayment(payment: Payment) {
    askConfirm({
      title: "Delete payment?",
      description: `This removes the ${formatMoney(payment.amountMinor)} payment from ${getPersonName(selectedTrip!, payment.fromPersonId)} to ${getPersonName(selectedTrip!, payment.toPersonId)} and recalculates balances.`,
      confirmLabel: "Delete payment",
      tone: "danger",
      onConfirm: () => deletePayment(payment.id)
    });
  }

  async function handleCopyShareLink() {
    if (!selectedTrip) return;

    try {
      const response = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedTrip)
      });

      if (!response.ok) {
        throw new Error("Share link request failed.");
      }

      const data = (await response.json()) as { path?: string };
      if (!data.path) {
        throw new Error("Share link response was missing a path.");
      }

      await navigator.clipboard.writeText(new URL(data.path, window.location.origin).toString());
      showNotice("success", "Read-only share link copied.");
    } catch {
      showNotice("error", "Could not copy the share link.");
    }
  }

  function handleSaveSharedTrip() {
    if (!sharedTrip) return;
    const editableTrip = touchTrip({ ...sharedTrip, id: createId("trip") });
    setTrip(editableTrip);
    setSharedTrip(null);
    setIsRenamingTrip(false);
    setDraft(createDraftForTrip(editableTrip));
    setDraftError(null);
    setPaymentDraft(createPaymentDraftForTrip(editableTrip));
    setPaymentDraftError(null);
    setEditingExpenseId(null);
    window.history.replaceState(null, "", "/");
    showNotice("success", "Editable copy saved.");
  }

  function updateParticipant(personId: string, checked: boolean) {
    setDraft((current) => {
      const participantIds = checked
        ? [...new Set([...current.participantIds, personId])]
        : current.participantIds.filter((id) => id !== personId);

      return { ...current, participantIds };
    });
  }

  function setAllParticipants(checked: boolean) {
    if (!selectedTrip) return;

    setDraft((current) => ({
      ...current,
      participantIds: checked ? selectedTrip.people.map((person) => person.id) : [],
      exactShares: {
        ...Object.fromEntries(selectedTrip.people.map((person) => [person.id, ""])),
        ...current.exactShares
      }
    }));
  }

  function addLineItem() {
    if (!selectedTrip) return;

    setDraft((current) => ({
      ...current,
      lineItems: [...current.lineItems, createLineItemDraft(selectedTrip.people)]
    }));
  }

  function updateLineItem(lineItemId: string, nextLineItem: ExpenseLineItemDraft) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item) => (item.id === lineItemId ? nextLineItem : item))
    }));
    if (draftError) setDraftError(null);
  }

  function removeLineItem(lineItemId: string) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.filter((item) => item.id !== lineItemId)
    }));
  }

  if (!isReady) {
    return (
      <main className="app-shell">
        <section className="loading-panel">
          <strong>Loading Ambagan...</strong>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Toaster position="top-center" richColors />
      <header className="topbar">
        <Button className="brand-button" variant="ghost" type="button" onClick={() => setSharedTrip(null)}>
          <span>
            <strong>Ambagan</strong>
            <small>Shared expenses made simple</small>
          </span>
        </Button>
      </header>
      <input ref={importInputRef} className="file-input" type="file" accept="application/json" onChange={handleImportTrip} />

      <div className="workspace">
        {selectedTrip ? (
          <section className="trip-panel">
            <div className="trip-header">
              <div className="trip-title-block">
                <p className="eyebrow">{isReadOnly ? "Shared read-only snapshot" : "Current ambagan"}</p>
                {isRenamingTrip && !isReadOnly ? (
                  <form className="rename-form" onSubmit={handleRenameTrip}>
                    <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
                    <div className="compact-actions">
                      <Button type="submit">Save</Button>
                      <Button className="ghost-button" variant="outline" type="button" onClick={() => setIsRenamingTrip(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <h1>{selectedTrip.name}</h1>
                )}
                <p>{formatMoney(tripTotal)} tracked across {selectedTrip.expenses.length} expenses.</p>
              </div>
              <div className="header-actions">
                {isReadOnly ? (
                  <Button type="button" onClick={handleSaveSharedTrip}>Save editable copy</Button>
                ) : (
                  <>
                    <Button className="ghost-button" variant="outline" type="button" onClick={() => { setIsRenamingTrip(true); setRenameValue(selectedTrip.name); }}>
                      Rename
                    </Button>
                    <Button type="button" onClick={handleCopyShareLink}>Copy share link</Button>
                    <TripActions
                      onOpenJson={() => importInputRef.current?.click()}
                      onExportJson={() => handleExportTrip(selectedTrip)}
                    />
                  </>
                )}
              </div>
            </div>

            <section className="metrics-grid">
              {tripMetrics.map((metric) => (
                <MetricCard key={metric.label} {...metric} />
              ))}
            </section>

            <section className="two-column overview-grid">
              <div className="sidebar-stack">
                <div className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Group</p>
                    <h2>People</h2>
                  </div>
                </div>
                {!isReadOnly ? (
                  <form className="inline-form" onSubmit={handleAddPerson}>
                    <Input value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} aria-label="Person name" />
                    <Button type="submit">Add</Button>
                  </form>
                ) : null}
                <div className="person-list">
                  {selectedTrip.people.length === 0 ? (
                    <div className="empty-state">Add people before recording expenses.</div>
                  ) : (
                    selectedTrip.people.map((person) => (
                      <div className="person-row" key={person.id}>
                        <span className="person-identity">
                          <PersonAvatar name={person.name} />
                          <span>{person.name}</span>
                        </span>
                        {!isReadOnly ? (
                          <Button className="ghost-button" variant="outline" type="button" onClick={() => handleRemovePerson(person.id)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                </div>

                <div className="panel balance-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Running totals</p>
                      <h2>Balances</h2>
                    </div>
                  </div>
                  {balances.length === 0 ? (
                    <div className="empty-state">Balances will appear once people are added.</div>
                  ) : (
                    <div className="compact-balance-list">
                      {balances.map((balance) => (
                        <div className="compact-balance-row" key={balance.personId}>
                          <span className="person-identity">
                            <PersonAvatar name={getPersonName(selectedTrip, balance.personId)} />
                            <span>{getPersonName(selectedTrip, balance.personId)}</span>
                          </span>
                          <span className={balance.balanceMinor >= 0 ? "positive" : "negative"}>{formatMoney(balance.balanceMinor)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="main-stack">
                <div className="panel">
                <div className="panel-heading settlement-heading">
                  <div>
                    <p className="eyebrow">Settle up</p>
                    <h2>{simplifyTransfers ? "Simplified settlements" : "Direct settlements"}</h2>
                    <p className="panel-description">
                      {simplifyTransfers ? "Balances are combined to clear debts with fewer payments." : "Everyone pays the people who originally covered their expenses."}
                    </p>
                  </div>
                  <label className="transfer-toggle">
                    <span>
                      <strong>Simplify transfers</strong>
                      <small>{simplifyTransfers ? "Fewest payments" : "Pay original spenders"}</small>
                    </span>
                    <button
                      aria-checked={simplifyTransfers}
                      aria-label="Simplify transfers"
                      className="switch-control"
                      role="switch"
                      type="button"
                      onClick={() => setSimplifyTransfers((current) => !current)}
                    >
                      <span />
                    </button>
                  </label>
                </div>
                {!isReadOnly ? (
                  <div className="payment-section">
                    <div>
                      <h3>Record a payment</h3>
                      <p className="panel-description">Log money that has already been sent.</p>
                    </div>
                    <PaymentForm
                      draft={paymentDraft}
                      error={paymentDraftError}
                      people={selectedTrip.people}
                      onSubmit={handleSubmitPayment}
                      onDraftChange={updatePaymentDraft}
                    />
                  </div>
                ) : null}
                {visibleSettlements.length > 0 ? (
                  <div className="transfer-overview">
                    <h3>Who gets paid</h3>
                    <span className="transfer-count">{visibleSettlements.length} {visibleSettlements.length === 1 ? "payment" : "payments"}</span>
                  </div>
                ) : null}
                {visibleSettlements.length === 0 ? (
                  <div className="empty-state">No one owes anything yet.</div>
                ) : (
                  <div className="settlement-groups">
                    {settlementGroups.map((group) => (
                      <details className="settlement-group" key={group.personId}>
                        <summary>
                          <span className="recipient-identity">
                            <PersonAvatar name={getPersonName(selectedTrip, group.personId)} />
                            <span><strong>{getPersonName(selectedTrip, group.personId)}</strong><small>gets back from {group.transfers.length} {group.transfers.length === 1 ? "person" : "people"}</small></span>
                          </span>
                          <span className="recipient-total">
                            <strong>{formatMoney(group.amountMinor)}</strong>
                            <small className="show-breakdown">View breakdown</small>
                            <small className="hide-breakdown">Hide breakdown</small>
                          </span>
                        </summary>
                        <div className="settlement-breakdown">
                          {group.transfers.map((transfer) => (
                            <div className="breakdown-entry" key={`${transfer.fromPersonId}-${transfer.toPersonId}-${transfer.amountMinor}`}>
                              <div className="breakdown-row">
                                <span className="breakdown-payer">
                                  {getPersonName(selectedTrip, transfer.fromPersonId)} pays
                                  {simplifyTransfers ? (
                                    <SimplifiedTransferExplanation
                                      balances={balances}
                                      directSettlements={directSettlements}
                                      settlements={settlements}
                                      trip={selectedTrip}
                                      transfer={transfer}
                                    />
                                  ) : <DirectTransferExplanation trip={selectedTrip} transfer={transfer} />}
                                </span>
                                <strong>{formatMoney(transfer.amountMinor)}</strong>
                              </div>
                            </div>
                          ))}
                          <div className="breakdown-total">
                            <span>Total received</span>
                            <strong>{formatMoney(group.amountMinor)}</strong>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
                <div className="settlement-section-heading recorded-heading"><h3>Payment history</h3></div>
                {payments.length === 0 ? (
                  <div className="empty-state">No payments recorded yet.</div>
                ) : (
                  <div className="settlement-list">
                    {payments.map((payment) => (
                      <div className="settlement-row" key={payment.id}>
                        <span>
                          {getPersonName(selectedTrip, payment.fromPersonId)} paid {getPersonName(selectedTrip, payment.toPersonId)}
                          {payment.date ? ` on ${formatExpenseDate(payment.date)}` : ""}
                        </span>
                        <span className="settlement-actions">
                          <strong>{formatMoney(payment.amountMinor)}</strong>
                          {!isReadOnly ? (
                            <Button className="danger-button" variant="destructive" type="button" onClick={() => handleDeletePayment(payment)}>
                              Delete
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                </div>

                <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Ledger</p>
                  <h2>Expenses</h2>
                </div>
                {!isReadOnly ? (
                  <Button type="button" onClick={openAddExpenseDialog} disabled={selectedTrip.people.length === 0}>
                    Add ambag
                  </Button>
                ) : null}
              </div>
              {selectedTrip.expenses.length > 0 ? (
                <div className="filter-bar" aria-label="Filter expenses by payer">
                  <Button className={expensePayerFilter === null ? "filter-button active" : "filter-button"} type="button" onClick={() => setExpensePayerFilter(null)}>
                    All
                  </Button>
                  {selectedTrip.people.map((person) => (
                    <Button
                      className={expensePayerFilter === person.id ? "filter-button active" : "filter-button"}
                      key={person.id}
                      type="button"
                      onClick={() => setExpensePayerFilter((current) => current === person.id ? null : person.id)}
                    >
                      {person.name}
                    </Button>
                  ))}
                </div>
              ) : null}
              {selectedTrip.expenses.length === 0 ? (
                <div className="empty-state">No expenses yet. Add the first ambag when someone pays.</div>
              ) : filteredExpenses.length === 0 ? (
                <div className="empty-state">No expenses were paid by this person.</div>
              ) : (
                <div className="expense-list">
                  {filteredExpenses.map((expense) => (
                    <article className="expense-item" key={expense.id}>
                      <div>
                        <h3>{expense.description}</h3>
                        <p>
                          {formatExpenseDate(getExpenseDate(expense))} · Paid by {getPersonName(selectedTrip, expense.paidByPersonId)} · {getSplitTypeLabel(expense.splitType)}
                        </p>
                        <ExpenseBreakdown expense={expense} people={selectedTrip.people} />
                      </div>
                      <div className="expense-actions">
                        <strong>{formatMoney(expense.amountMinor)}</strong>
                        {!isReadOnly ? (
                          <div className="compact-actions">
                            <Button className="ghost-button" variant="outline" type="button" onClick={() => handleEditExpense(expense)}>
                              Edit
                            </Button>
                            <Button className="danger-button" variant="destructive" type="button" onClick={() => handleDeleteExpense(expense)}>
                              Delete
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
                </section>
              </div>
            </section>
          </section>
        ) : (
          <section className="trip-panel empty-hero">
            <p className="eyebrow">Ambagan</p>
            <h1>Track shared expenses without accounts.</h1>
            <p>Create a trip, add people, record payments, and copy a read-only link when friends need to see the balances.</p>
          </section>
        )}
      </div>
      <ConfirmDialog
        confirmDialog={confirmDialog}
        onConfirm={confirmCurrentDialog}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirmDialog(null);
        }}
      />
      <ExpenseDialog
        draft={draft}
        error={draftError}
        people={selectedTrip?.people ?? []}
        isEditing={Boolean(editingExpenseId)}
        isOpen={isExpenseDialogOpen}
        onOpenChange={(isOpen) => {
          setIsExpenseDialogOpen(isOpen);
          if (!isOpen) resetExpenseForm();
        }}
        onSubmit={handleSubmitExpense}
        onDraftChange={updateDraft}
        onParticipantChange={updateParticipant}
        onSetAllParticipants={setAllParticipants}
        onAddLineItem={addLineItem}
        onLineItemChange={updateLineItem}
        onLineItemRemove={removeLineItem}
      />
    </main>
  );
}

function DirectTransferExplanation({ trip, transfer }: { trip: Trip; transfer: Settlement }) {
  const breakdown = calculateDirectSettlementBreakdown(trip, transfer);
  const payerName = getPersonName(trip, transfer.fromPersonId);
  const receiverName = getPersonName(trip, transfer.toPersonId);

  return (
    <TransferExplanationTooltip id={`direct-transfer-${transfer.fromPersonId}-${transfer.toPersonId}`}>
      <span><strong>{formatMoney(breakdown.owedToReceiverMinor)}</strong><small>{payerName}&apos;s share paid by {receiverName}</small></span>
      {breakdown.receiverOwedBackMinor > 0 ? <><b>−</b><span><strong>{formatMoney(breakdown.receiverOwedBackMinor)}</strong><small>{receiverName}&apos;s share paid by {payerName}</small></span></> : null}
      {breakdown.paidToReceiverMinor > 0 ? <><b>−</b><span><strong>{formatMoney(breakdown.paidToReceiverMinor)}</strong><small>already paid</small></span></> : null}
      {breakdown.paidBackMinor > 0 ? <><b>+</b><span><strong>{formatMoney(breakdown.paidBackMinor)}</strong><small>payment reversed</small></span></> : null}
      <b>=</b>
      <span><strong>{formatMoney(transfer.amountMinor)}</strong><small>remaining</small></span>
    </TransferExplanationTooltip>
  );
}

function SimplifiedTransferExplanation({
  balances,
  directSettlements,
  settlements,
  trip,
  transfer
}: {
  balances: PersonBalance[];
  directSettlements: Settlement[];
  settlements: Settlement[];
  trip: Trip;
  transfer: Settlement;
}) {
  const personName = getPersonName(trip, transfer.fromPersonId);
  const receiverName = getPersonName(trip, transfer.toPersonId);
  const breakdown = calculateSimplifiedSettlementBreakdown(balances, directSettlements, settlements, transfer);
  const routeBreakdown = calculateSimplifiedSettlementRoutes(directSettlements, settlements).get(transfer);

  return (
    <TransferExplanationTooltip detailed id={`simplified-transfer-${transfer.fromPersonId}-${transfer.toPersonId}`} title={`Why ${personName} pays ${receiverName}`}>
      <span className="explanation-columns">
        <span className="explanation-list">
          <strong>Before simplifying, {personName} would pay</strong>
          {breakdown.outgoingDebts.map((item) => <span key={item.toPersonId}><small>{getPersonName(trip, item.toPersonId)}</small><b>{formatMoney(item.amountMinor)}</b></span>)}
          <span className="explanation-subtotal"><small>Total going out</small><b>{formatMoney(breakdown.outgoingTotalMinor)}</b></span>
        </span>
        <span className="explanation-list">
          <strong>{personName} would receive</strong>
          {breakdown.incomingDebts.length > 0 ? breakdown.incomingDebts.map((item) => <span key={item.fromPersonId}><small>from {getPersonName(trip, item.fromPersonId)}</small><b>{formatMoney(item.amountMinor)}</b></span>) : <small>Nothing</small>}
          <span className="explanation-subtotal"><small>Total coming in</small><b>{formatMoney(breakdown.incomingTotalMinor)}</b></span>
        </span>
      </span>
      <span className="plain-equation">
        <span><small>Would pay</small><b>{formatMoney(breakdown.outgoingTotalMinor)}</b></span>
        <b>−</b>
        <span><small>Would receive</small><b>{formatMoney(breakdown.incomingTotalMinor)}</b></span>
        <b>=</b>
        <span><small>{personName}&apos;s net debt</small><strong>{formatMoney(breakdown.payerDebtMinor)}</strong></span>
      </span>
      <span className="routing-explanation">
        <strong>How those payments become one payment to {receiverName}</strong>
        {routeBreakdown?.routes.map((route, index) => {
          const names = route.personIds.map((personId) => getPersonName(trip, personId));

          const priorUseTotal = route.priorUses.reduce((total, use) => total + use.amountMinor, 0);

          return route.personIds.length === 2 && priorUseTotal > 0 ? (
            <small key={`${route.personIds.join("-")}-${index}`}>
              {personName} originally owed {receiverName} <b>{formatMoney(route.amountMinor + priorUseTotal)}</b>. {route.priorUses.map((use, useIndex) => (
                use.personIds[0] === transfer.fromPersonId ? (
                  <span key={`${use.personIds.join("-")}-${useIndex}`}>{useIndex > 0 ? " Another " : " "}<b>{formatMoney(use.amountMinor)}</b> already went directly to {getPersonName(trip, use.personIds[use.personIds.length - 1])} because {receiverName} also owed {getPersonName(trip, use.personIds[use.personIds.length - 1])},</span>
                ) : (
                  <span key={`${use.personIds.join("-")}-${useIndex}`}>{useIndex > 0 ? " Another " : " "}<b>{formatMoney(use.amountMinor)}</b> was already covered when {getPersonName(trip, use.personIds[0])} paid {receiverName} directly instead of paying {personName} first,</span>
                )
              ))} leaving <b>{formatMoney(route.amountMinor)}</b> for {receiverName}.
            </small>
          ) : route.personIds.length === 2 ? (
            <small key={`${route.personIds.join("-")}-${index}`}>
              <b>{formatMoney(route.amountMinor)}</b> is what {personName} already owes {receiverName} directly.
            </small>
          ) : (
            <small key={`${route.personIds.join("-")}-${index}`}>
              <b>{formatMoney(route.amountMinor)}</b> replaces {names.slice(0, -1).map((name, nameIndex) => (
                <span key={`${name}-${nameIndex}`}>{nameIndex > 0 ? " and " : ""}{name} paying {names[nameIndex + 1]}</span>
              ))}. It goes straight from {personName} to {receiverName}, removing {route.personIds.length - 2} redundant {route.personIds.length - 2 === 1 ? "transaction" : "transactions"}.
            </small>
          );
        })}
        {routeBreakdown && routeBreakdown.routes.length > 1 ? (
          <span className="routing-total"><small>Combined payment</small><b>{formatMoney(transfer.amountMinor)}</b></span>
        ) : null}
        {routeBreakdown?.unmatchedMinor ? (
          <small><b>{formatMoney(routeBreakdown.unmatchedMinor)}</b> is matched through the group&apos;s remaining net balances.</small>
        ) : null}
      </span>
    </TransferExplanationTooltip>
  );
}

function TransferExplanationTooltip({ children, detailed = false, id, title = "Why this amount?" }: { children: React.ReactNode; detailed?: boolean; id: string; title?: string }) {
  return (
    <span className="transfer-explanation">
      <button aria-describedby={id} className="why-button" type="button">Why?</button>
      <span className={detailed ? "transfer-tooltip detailed" : "transfer-tooltip"} id={id} role="tooltip">
        <strong>{title}</strong>
        {detailed ? children : <span className="transfer-equation">{children}</span>}
      </span>
    </span>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TripActions({
  onOpenJson,
  onExportJson
}: {
  onOpenJson: () => void;
  onExportJson: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  function runAction(action: () => void) {
    action();
    setIsOpen(false);
  }

  return (
    <div className="action-menu">
      <Button className="ghost-button" variant="outline" type="button" onClick={() => setIsOpen((current) => !current)}>
        Actions
      </Button>
      {isOpen ? (
        <div className="action-menu-panel">
          <Button className="ghost-button" variant="outline" type="button" onClick={() => runAction(onOpenJson)}>
            Open JSON
          </Button>
          <Button className="ghost-button" variant="outline" type="button" onClick={() => runAction(onExportJson)}>
            Export JSON
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PaymentForm({
  draft,
  error,
  people,
  onSubmit,
  onDraftChange
}: {
  draft: PaymentDraft;
  error: PaymentDraftError | null;
  people: Person[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: PaymentDraft) => void;
}) {
  return (
    <form className="payment-form" onSubmit={onSubmit}>
      <label>
        From
        <PersonSelect
          people={people}
          value={draft.fromPersonId}
          placeholder="Who paid"
          ariaInvalid={error?.field === "fromPersonId"}
          onValueChange={(fromPersonId) => {
            if (fromPersonId) onDraftChange({ ...draft, fromPersonId });
          }}
        />
      </label>
      <label>
        To
        <PersonSelect
          people={people}
          value={draft.toPersonId}
          placeholder="Who received"
          ariaInvalid={error?.field === "toPersonId"}
          onValueChange={(toPersonId) => {
            if (toPersonId) onDraftChange({ ...draft, toPersonId });
          }}
        />
      </label>
      <label>
        Amount
        <Input
          aria-invalid={error?.field === "amount"}
          inputMode="decimal"
          value={draft.amount}
          onChange={(event) => onDraftChange({ ...draft, amount: event.target.value })}
        />
      </label>
      <label>
        Date
        <Input type="date" value={draft.date} onChange={(event) => onDraftChange({ ...draft, date: event.target.value })} />
      </label>
      <Button type="submit" disabled={people.length < 2}>
        Record payment
      </Button>
    </form>
  );
}

function PersonSelect({
  people,
  value,
  placeholder,
  ariaInvalid,
  onValueChange
}: {
  people: Person[];
  value: string;
  placeholder: string;
  ariaInvalid?: boolean;
  onValueChange: (personId: string) => void;
}) {
  const selectedPersonName = people.find((person) => person.id === value)?.name ?? placeholder;

  return (
    <Select
      value={value}
      onValueChange={(personId) => {
        if (personId) onValueChange(personId);
      }}
    >
      <SelectTrigger className="w-full" aria-invalid={ariaInvalid}>
        <span>{selectedPersonName}</span>
      </SelectTrigger>
      <SelectContent>
        {people.map((person) => (
          <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ExpenseBreakdown({ expense, people }: { expense: Expense; people: Person[] }) {
  function personName(personId: string) {
    return people.find((person) => person.id === personId)?.name ?? "Unknown";
  }

  return (
    <div className="expense-breakdown">
      {expense.lineItems && expense.lineItems.length > 0 ? (
        <div className="line-item-breakdown">
          {expense.lineItems.map((item) => (
            <div className="line-item-breakdown-row" key={item.id}>
              <div>
                <strong>{item.description}</strong>
                <small>{formatMoney(item.amountMinor)} split among {item.participantIds.map(personName).join(", ")}</small>
              </div>
              <div className="share-list">
                {item.shares.map((share) => (
                  <span key={`${item.id}-${share.personId}`}>
                    {personName(share.personId)}: {formatMoney(share.amountMinor)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="share-list">
        {expense.shares.map((share) => (
          <span key={`${expense.id}-${share.personId}`}>
            {personName(share.personId)} total: {formatMoney(share.amountMinor)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ExpenseDialog({
  draft,
  error,
  people,
  isEditing,
  isOpen,
  onOpenChange,
  onSubmit,
  onDraftChange,
  onParticipantChange,
  onSetAllParticipants,
  onAddLineItem,
  onLineItemChange,
  onLineItemRemove
}: {
  draft: ExpenseDraft;
  error: ExpenseDraftError | null;
  people: Person[];
  isEditing: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: ExpenseDraft) => void;
  onParticipantChange: (personId: string, checked: boolean) => void;
  onSetAllParticipants: (checked: boolean) => void;
  onAddLineItem: () => void;
  onLineItemChange: (lineItemId: string, nextLineItem: ExpenseLineItemDraft) => void;
  onLineItemRemove: (lineItemId: string) => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="expense-dialog">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit expense" : "Add ambag"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update the record details and save the expense." : "Record a payment and choose who should share it."}
          </DialogDescription>
        </DialogHeader>
        <ExpenseForm
          draft={draft}
          error={error}
          people={people}
          onSubmit={onSubmit}
          onDraftChange={onDraftChange}
          onParticipantChange={onParticipantChange}
          onSetAllParticipants={onSetAllParticipants}
          onAddLineItem={onAddLineItem}
          onLineItemChange={onLineItemChange}
          onLineItemRemove={onLineItemRemove}
          isEditing={isEditing}
        />
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({
  draft,
  error,
  people,
  onSubmit,
  onDraftChange,
  onParticipantChange,
  onSetAllParticipants,
  onAddLineItem,
  onLineItemChange,
  onLineItemRemove,
  isEditing
}: {
  draft: ExpenseDraft;
  error: ExpenseDraftError | null;
  people: Person[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: ExpenseDraft) => void;
  onParticipantChange: (personId: string, checked: boolean) => void;
  onSetAllParticipants: (checked: boolean) => void;
  onAddLineItem: () => void;
  onLineItemChange: (lineItemId: string, nextLineItem: ExpenseLineItemDraft) => void;
  onLineItemRemove: (lineItemId: string) => void;
  isEditing: boolean;
}) {
  const selectedPeople = people.filter((person) => draft.participantIds.includes(person.id));
  const allPeopleSelected = people.length > 0 && draft.participantIds.length === people.length;
  const itemizedTotalMinor = getItemizedAmountMinor(draft);

  return (
    <form className="expense-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Description
          <Input
            aria-invalid={error?.field === "description"}
            value={draft.description}
            onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
          />
        </label>
        <label>
          Amount
          <Input
            aria-invalid={error?.field === "amount"}
            inputMode="decimal"
            disabled={draft.splitType === "itemized"}
            value={draft.amount}
            placeholder={draft.splitType === "itemized" ? formatMoney(itemizedTotalMinor) : undefined}
            onChange={(event) => onDraftChange({ ...draft, amount: event.target.value })}
          />
        </label>
        <label>
          Date
          <Input
            type="date"
            value={draft.date}
            onChange={(event) => onDraftChange({ ...draft, date: event.target.value })}
          />
        </label>
        <label>
          Paid by
          <PersonSelect
            people={people}
            value={draft.paidByPersonId}
            placeholder="Choose payer"
            ariaInvalid={error?.field === "paidByPersonId"}
            onValueChange={(paidByPersonId) => {
              if (paidByPersonId) onDraftChange({ ...draft, paidByPersonId });
            }}
          />
        </label>
        <label>
          Split type
          <Select
            value={draft.splitType}
            onValueChange={(splitType) => {
              if (!splitType) return;

              const nextSplitType = splitType as SplitType;
              onDraftChange({
                ...draft,
                amount: nextSplitType === "itemized" ? "" : draft.amount,
                splitType: nextSplitType,
                lineItems:
                  nextSplitType === "itemized" && draft.lineItems.length === 0
                    ? [createLineItemDraft(people)]
                    : draft.lineItems
              });
            }}
          >
            <SelectTrigger className="w-full">
              <span>{getSplitTypeLabel(draft.splitType)}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="equal">Split equally</SelectItem>
              <SelectItem value="exact">Enter exact amounts</SelectItem>
              <SelectItem value="itemized">Itemized breakdown</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {draft.splitType === "itemized" ? (
        <LineItemEditor
          error={error}
          people={people}
          lineItems={draft.lineItems}
          totalMinor={itemizedTotalMinor}
          onAddLineItem={onAddLineItem}
          onLineItemChange={onLineItemChange}
          onLineItemRemove={onLineItemRemove}
        />
      ) : (
        <>
          <div className="participant-toolbar">
            <span>People involved</span>
            <Button className="ghost-button" variant="outline" type="button" onClick={() => onSetAllParticipants(!allPeopleSelected)} disabled={people.length === 0}>
              {allPeopleSelected ? "Clear all" : "Select everyone"}
            </Button>
          </div>
          <ParticipantSelector
            people={people}
            selectedPersonIds={draft.participantIds}
            ariaInvalid={error?.field === "participantIds"}
            onPersonChange={onParticipantChange}
          />

          {draft.splitType === "exact" ? (
            <div className="exact-grid">
              {selectedPeople.map((person) => (
                <label key={person.id}>
                  {person.name}
                  <Input
                    aria-invalid={error?.field === "exactShares"}
                    inputMode="decimal"
                    value={draft.exactShares[person.id] ?? ""}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        exactShares: {
                          ...draft.exactShares,
                          [person.id]: event.target.value
                        }
                      })
                    }
                  />
                </label>
              ))}
            </div>
          ) : null}
        </>
      )}

      <Button className="submit-button" type="submit" disabled={people.length === 0}>
        {isEditing ? "Save expense" : "Add ambag"}
      </Button>
    </form>
  );
}

function LineItemEditor({
  error,
  people,
  lineItems,
  totalMinor,
  onAddLineItem,
  onLineItemChange,
  onLineItemRemove
}: {
  error: ExpenseDraftError | null;
  people: Person[];
  lineItems: ExpenseLineItemDraft[];
  totalMinor: number;
  onAddLineItem: () => void;
  onLineItemChange: (lineItemId: string, nextLineItem: ExpenseLineItemDraft) => void;
  onLineItemRemove: (lineItemId: string) => void;
}) {
  function toggleParticipant(item: ExpenseLineItemDraft, personId: string, checked: boolean) {
    const participantIds = checked
      ? [...new Set([...item.participantIds, personId])]
      : item.participantIds.filter((id) => id !== personId);

    onLineItemChange(item.id, { ...item, participantIds });
  }

  function setEveryParticipant(item: ExpenseLineItemDraft, checked: boolean) {
    onLineItemChange(item.id, {
      ...item,
      participantIds: checked ? people.map((person) => person.id) : []
    });
  }

  return (
    <section className="line-item-editor" aria-invalid={error?.field === "lineItems"}>
      <div className="participant-toolbar">
        <span>Itemized breakdown</span>
        <strong>{formatMoney(totalMinor)}</strong>
      </div>
      <div className="line-item-list">
        {lineItems.map((item, index) => {
          const allPeopleSelected = people.length > 0 && item.participantIds.length === people.length;
          const itemAmountMinor = pesoToMinor(item.amount);
          const shares = splitEvenly(Number.isFinite(itemAmountMinor) ? itemAmountMinor : 0, item.participantIds);

          return (
            <article className="line-item-card" key={item.id}>
              <div className="line-item-heading">
                <strong>Item {index + 1}</strong>
                <Button
                  className="ghost-button"
                  variant="outline"
                  type="button"
                  onClick={() => onLineItemRemove(item.id)}
                  disabled={lineItems.length === 1}
                >
                  Remove
                </Button>
              </div>
              <div className="form-grid">
                <label>
                  Item name
                  <Input
                    aria-invalid={error?.field === "lineItems"}
                    value={item.description}
                    onChange={(event) => onLineItemChange(item.id, { ...item, description: event.target.value })}
                  />
                </label>
                <label>
                  Amount
                  <Input
                    aria-invalid={error?.field === "lineItems"}
                    inputMode="decimal"
                    value={item.amount}
                    onChange={(event) => onLineItemChange(item.id, { ...item, amount: event.target.value })}
                  />
                </label>
              </div>
              <div className="participant-toolbar">
                <span>Split among</span>
                <Button className="ghost-button" variant="outline" type="button" onClick={() => setEveryParticipant(item, !allPeopleSelected)}>
                  {allPeopleSelected ? "Clear all" : "Select everyone"}
                </Button>
              </div>
              <ParticipantSelector
                people={people}
                selectedPersonIds={item.participantIds}
                onPersonChange={(personId, checked) => toggleParticipant(item, personId, checked)}
              />
              {shares.length > 0 ? (
                <div className="share-list">
                  {shares.map((share) => (
                    <span key={`${item.id}-share-${share.personId}`}>
                      {people.find((person) => person.id === share.personId)?.name ?? "Unknown"}: {formatMoney(share.amountMinor)}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <Button className="ghost-button add-line-item-button" variant="outline" type="button" onClick={onAddLineItem}>
        Add item
      </Button>
    </section>
  );
}

function ParticipantSelector({
  people,
  selectedPersonIds,
  ariaInvalid,
  onPersonChange
}: {
  people: Person[];
  selectedPersonIds: string[];
  ariaInvalid?: boolean;
  onPersonChange: (personId: string, checked: boolean) => void;
}) {
  return (
    <div className="participant-grid" aria-invalid={ariaInvalid}>
      {people.map((person) => (
        <label className="check-row" key={person.id}>
          <Checkbox
            checked={selectedPersonIds.includes(person.id)}
            onCheckedChange={(checked) => onPersonChange(person.id, checked === true)}
          />
          <span>{person.name}</span>
        </label>
      ))}
    </div>
  );
}

function ConfirmDialog({
  confirmDialog,
  onConfirm,
  onOpenChange
}: {
  confirmDialog: ConfirmDialogState | null;
  onConfirm: () => void;
  onOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(confirmDialog)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmDialog?.title}</DialogTitle>
          <DialogDescription>{confirmDialog?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button className="ghost-button" variant="outline" />}>Cancel</DialogClose>
          <Button
            className={confirmDialog?.tone === "danger" ? "danger-button" : undefined}
            variant={confirmDialog?.tone === "danger" ? "destructive" : "default"}
            type="button"
            onClick={onConfirm}
          >
            {confirmDialog?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonAvatar({ name }: { name: string }) {
  return (
    <span className="person-avatar" style={getAvatarStyle(name)} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
