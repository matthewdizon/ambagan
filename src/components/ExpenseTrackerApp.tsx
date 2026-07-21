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
import { calculatePersonBalances, calculateSettlementReceipts, calculateSettlements, getTripTotalMinor } from "@/lib/calculations";
import { createShareUrl, decodeTripFromHash } from "@/lib/share";
import { loadTripFromStorage, saveTripToStorage } from "@/lib/storage";
import { formatMoney, minorToPesoInput, pesoToMinor, splitEvenly } from "@/lib/money";
import type { Expense, ExpenseShare, Person, SplitType, Trip } from "@/types";
import { toast } from "sonner";

type ExpenseDraft = {
  description: string;
  amount: string;
  date: string;
  paidByPersonId: string;
  splitType: SplitType;
  participantIds: string[];
  exactShares: Record<string, string>;
};

type ExpenseDraftError = {
  field: "description" | "amount" | "paidByPersonId" | "participantIds" | "exactShares";
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
  exactShares: {}
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
    )
  };
}

function buildShares(draft: ExpenseDraft, amountMinor: number): ExpenseShare[] {
  if (draft.splitType === "equal") {
    return splitEvenly(amountMinor, draft.participantIds);
  }

  return draft.participantIds.map((personId) => ({
    personId,
    amountMinor: pesoToMinor(draft.exactShares[personId] ?? "")
  }));
}

function validateExpenseDraft(draft: ExpenseDraft): ExpenseDraftError | null {
  const amountMinor = pesoToMinor(draft.amount);

  if (!draft.description.trim()) return { field: "description", message: "Add a description." };
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return { field: "amount", message: "Enter a valid amount greater than zero." };
  }
  if (!draft.paidByPersonId) return { field: "paidByPersonId", message: "Choose who paid." };
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
  return splitType === "equal" ? "Split equally" : "Enter exact amounts";
}

function createDraftForTrip(trip: Trip): ExpenseDraft {
  return {
    ...emptyDraft,
    date: getTodayInputDate(),
    paidByPersonId: trip.people[0]?.id ?? "",
    participantIds: trip.people.map((person) => person.id),
    exactShares: Object.fromEntries(trip.people.map((person) => [person.id, ""]))
  };
}

export function ExpenseTrackerApp() {
  const [isReady, setIsReady] = useState(false);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [sharedTrip, setSharedTrip] = useState<Trip | null>(null);
  const [newPersonName, setNewPersonName] = useState("");
  const [isRenamingTrip, setIsRenamingTrip] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [draftError, setDraftError] = useState<ExpenseDraftError | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTrip = sharedTrip ?? trip;

  const isReadOnly = Boolean(sharedTrip);

  useEffect(() => {
    const loadedTrip = loadTripFromStorage();
    const loadedSharedTrip = decodeTripFromHash(window.location.hash);

    setTrip(loadedTrip ?? createTrip("Untitled ambagan"));
    setSharedTrip(loadedSharedTrip);
    setIsReady(true);
  }, []);

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
  }, [editingExpenseId, selectedTrip]);

  const balances = useMemo(() => (selectedTrip ? calculatePersonBalances(selectedTrip) : []), [selectedTrip]);
  const settlements = useMemo(() => calculateSettlements(balances), [balances]);
  const settlementReceipts = useMemo(() => calculateSettlementReceipts(settlements), [settlements]);
  const tripTotal = selectedTrip ? getTripTotalMinor(selectedTrip) : 0;
  const tripMetrics = selectedTrip
    ? [
        { label: "People", value: selectedTrip.people.length.toString(), detail: "Included in this ambagan" },
        { label: "Expenses", value: selectedTrip.expenses.length.toString(), detail: "Tracked payments" },
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
        createdAt: imported.createdAt ?? now,
        updatedAt: now
      };

      setTrip(importedTrip);
      setSharedTrip(null);
      setIsRenamingTrip(false);
      setDraft(createDraftForTrip(importedTrip));
      setDraftError(null);
      setEditingExpenseId(null);
      window.history.replaceState(null, "", window.location.pathname);
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
    setNewPersonName("");
    showNotice("success", "Person added.");
  }

  function handleRemovePerson(personId: string) {
    if (!selectedTrip || isReadOnly) return;
    const personName = getPersonName(selectedTrip, personId);

    const isUsed = selectedTrip.expenses.some(
      (expense) => expense.paidByPersonId === personId || expense.shares.some((share) => share.personId === personId)
    );
    if (isUsed) {
      showNotice("error", "Delete expenses involving this person before removing them.");
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

    const amountMinor = pesoToMinor(draft.amount);
    const shares = buildShares(draft, amountMinor);
    const now = new Date().toISOString();
    const expense: Expense = {
      id: editingExpenseId ?? createId("expense"),
      description: draft.description.trim(),
      amountMinor,
      paidByPersonId: draft.paidByPersonId,
      shares,
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

  async function handleCopyShareLink() {
    if (!selectedTrip) return;

    try {
      await navigator.clipboard.writeText(createShareUrl(selectedTrip, window.location.origin));
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
    setEditingExpenseId(null);
    window.history.replaceState(null, "", window.location.pathname);
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

            <section className="two-column">
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

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Settle up</p>
                    <h2>Settlements</h2>
                  </div>
                </div>
                {settlements.length === 0 ? (
                  <div className="empty-state">No one owes anything yet.</div>
                ) : (
                  <div className="settlement-list">
                    {settlements.map((settlement) => (
                      <div className="settlement-row" key={`${settlement.fromPersonId}-${settlement.toPersonId}-${settlement.amountMinor}`}>
                        <span>{getPersonName(selectedTrip, settlement.fromPersonId)} pays {getPersonName(selectedTrip, settlement.toPersonId)}</span>
                        <strong>{formatMoney(settlement.amountMinor)}</strong>
                      </div>
                    ))}
                    {Object.entries(settlementReceipts).map(([personId, amountMinor]) => (
                      <div className="settlement-row settlement-summary" key={`receipt-${personId}`}>
                        <span>{getPersonName(selectedTrip, personId)} gets back</span>
                        <strong>{formatMoney(amountMinor)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Running totals</p>
                  <h2>Balances</h2>
                </div>
              </div>
              {balances.length === 0 ? (
                <div className="empty-state">Balances will appear once people are added.</div>
              ) : (
                <div className="balance-table">
                  <div className="table-row table-head">
                    <span>Person</span>
                    <span>Paid</span>
                    <span>Share</span>
                    <span>Balance</span>
                  </div>
                  {balances.map((balance) => (
                    <div className="table-row" key={balance.personId}>
                      <span>{getPersonName(selectedTrip, balance.personId)}</span>
                      <span>{formatMoney(balance.paidMinor)}</span>
                      <span>{formatMoney(balance.shareMinor)}</span>
                      <span className={balance.balanceMinor >= 0 ? "positive" : "negative"}>{formatMoney(balance.balanceMinor)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

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
              {selectedTrip.expenses.length === 0 ? (
                <div className="empty-state">No expenses yet. Add the first ambag when someone pays.</div>
              ) : (
                <div className="expense-list">
                  {selectedTrip.expenses.map((expense) => (
                    <article className="expense-item" key={expense.id}>
                      <div>
                        <h3>{expense.description}</h3>
                        <p>
                          {formatExpenseDate(getExpenseDate(expense))} · Paid by {getPersonName(selectedTrip, expense.paidByPersonId)} · {expense.splitType === "equal" ? "Equal split" : "Exact split"}
                        </p>
                        <div className="share-list">
                          {expense.shares.map((share) => (
                            <span key={`${expense.id}-${share.personId}`}>
                              {getPersonName(selectedTrip, share.personId)}: {formatMoney(share.amountMinor)}
                            </span>
                          ))}
                        </div>
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
      />
    </main>
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
  onSetAllParticipants
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
  isEditing
}: {
  draft: ExpenseDraft;
  error: ExpenseDraftError | null;
  people: Person[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: ExpenseDraft) => void;
  onParticipantChange: (personId: string, checked: boolean) => void;
  onSetAllParticipants: (checked: boolean) => void;
  isEditing: boolean;
}) {
  const selectedPeople = people.filter((person) => draft.participantIds.includes(person.id));
  const allPeopleSelected = people.length > 0 && draft.participantIds.length === people.length;
  const selectedPayerName = people.find((person) => person.id === draft.paidByPersonId)?.name ?? "Choose payer";

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
            value={draft.amount}
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
          <Select
            value={draft.paidByPersonId}
            onValueChange={(paidByPersonId) => {
              if (paidByPersonId) onDraftChange({ ...draft, paidByPersonId });
            }}
          >
            <SelectTrigger className="w-full" aria-invalid={error?.field === "paidByPersonId"}>
              <span>{selectedPayerName}</span>
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          Split type
          <Select
            value={draft.splitType}
            onValueChange={(splitType) => {
              if (splitType) onDraftChange({ ...draft, splitType: splitType as SplitType });
            }}
          >
            <SelectTrigger className="w-full">
              <span>{getSplitTypeLabel(draft.splitType)}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="equal">Split equally</SelectItem>
              <SelectItem value="exact">Enter exact amounts</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="participant-toolbar">
        <span>People involved</span>
        <Button className="ghost-button" variant="outline" type="button" onClick={() => onSetAllParticipants(!allPeopleSelected)} disabled={people.length === 0}>
          {allPeopleSelected ? "Clear all" : "Select everyone"}
        </Button>
      </div>
      <div className="participant-grid" aria-invalid={error?.field === "participantIds"}>
        {people.map((person) => (
          <label className="check-row" key={person.id}>
            <Checkbox
              checked={draft.participantIds.includes(person.id)}
              onCheckedChange={(checked) => onParticipantChange(person.id, checked === true)}
            />
            <span>{person.name}</span>
          </label>
        ))}
      </div>

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

      <Button className="submit-button" type="submit" disabled={people.length === 0}>
        {isEditing ? "Save expense" : "Add ambag"}
      </Button>
    </form>
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
