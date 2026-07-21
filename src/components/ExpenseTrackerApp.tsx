"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { calculatePersonBalances, calculateSettlementReceipts, calculateSettlements, getTripTotalMinor } from "@/lib/calculations";
import { createShareUrl, decodeTripFromHash } from "@/lib/share";
import { loadTripsFromStorage, saveTripsToStorage } from "@/lib/storage";
import { formatMoney, minorToPesoInput, pesoToMinor, splitEvenly } from "@/lib/money";
import type { Expense, ExpenseShare, Person, SplitType, Trip } from "@/types";

type AppNotice = {
  tone: "success" | "error";
  message: string;
};

type ExpenseDraft = {
  description: string;
  amount: string;
  date: string;
  paidByPersonId: string;
  splitType: SplitType;
  participantIds: string[];
  exactShares: Record<string, string>;
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

function validateExpenseDraft(draft: ExpenseDraft) {
  const amountMinor = pesoToMinor(draft.amount);

  if (!draft.description.trim()) return "Add a description.";
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return "Enter a valid amount greater than zero.";
  if (!draft.paidByPersonId) return "Choose who paid.";
  if (draft.participantIds.length === 0) return "Choose at least one person involved.";

  if (draft.splitType === "exact") {
    const shares = buildShares(draft, amountMinor);
    if (shares.some((share) => !Number.isFinite(share.amountMinor) || share.amountMinor < 0)) {
      return "Exact shares must be valid amounts.";
    }

    const totalShares = shares.reduce((total, share) => total + share.amountMinor, 0);
    if (totalShares !== amountMinor) {
      return `Exact shares must add up to ${formatMoney(amountMinor)}.`;
    }
  }

  return null;
}

export function ExpenseTrackerApp() {
  const [isReady, setIsReady] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [sharedTrip, setSharedTrip] = useState<Trip | null>(null);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [newTripName, setNewTripName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [renamingTripId, setRenamingTripId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTrip = useMemo(() => {
    if (sharedTrip) return sharedTrip;
    return trips.find((trip) => trip.id === selectedTripId) ?? null;
  }, [selectedTripId, sharedTrip, trips]);

  const isReadOnly = Boolean(sharedTrip);

  useEffect(() => {
    const loadedTrips = loadTripsFromStorage();
    const loadedSharedTrip = decodeTripFromHash(window.location.hash);

    setTrips(loadedTrips);
    setSharedTrip(loadedSharedTrip);
    setSelectedTripId(loadedSharedTrip ? loadedSharedTrip.id : loadedTrips[0]?.id ?? null);
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    saveTripsToStorage(trips);
  }, [isReady, trips]);

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

  function showNotice(tone: AppNotice["tone"], message: string) {
    setNotice({ tone, message });
  }

  function updateTrip(tripId: string, updater: (trip: Trip) => Trip) {
    setTrips((currentTrips) => currentTrips.map((trip) => (trip.id === tripId ? touchTrip(updater(trip)) : trip)));
  }

  function handleCreateTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = newTripName.trim();
    if (!name) {
      showNotice("error", "Add a trip name first.");
      return;
    }

    const trip = createTrip(name);
    setTrips((currentTrips) => [trip, ...currentTrips]);
    setSelectedTripId(trip.id);
    setSharedTrip(null);
    setNewTripName("");
    showNotice("success", "Trip created.");
  }

  function handleRenameTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renamingTripId) return;

    const name = renameValue.trim();
    if (!name) {
      showNotice("error", "Trip name cannot be empty.");
      return;
    }

    updateTrip(renamingTripId, (trip) => ({ ...trip, name }));
    setRenamingTripId(null);
    setRenameValue("");
    showNotice("success", "Trip renamed.");
  }

  function handleDeleteTrip(tripId: string) {
    setTrips((currentTrips) => {
      const nextTrips = currentTrips.filter((trip) => trip.id !== tripId);
      if (selectedTripId === tripId) setSelectedTripId(nextTrips[0]?.id ?? null);
      return nextTrips;
    });
    showNotice("success", "Trip deleted.");
  }

  function handleDuplicateTrip(trip: Trip) {
    const now = new Date().toISOString();
    const duplicate = {
      ...trip,
      id: createId("trip"),
      name: `${trip.name} copy`,
      createdAt: now,
      updatedAt: now
    };

    setTrips((currentTrips) => [duplicate, ...currentTrips]);
    setSelectedTripId(duplicate.id);
    setSharedTrip(null);
    showNotice("success", "Trip duplicated.");
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

      setTrips((currentTrips) => [importedTrip, ...currentTrips]);
      setSelectedTripId(importedTrip.id);
      setSharedTrip(null);
      showNotice("success", "Trip imported.");
    } catch {
      showNotice("error", "That file does not look like a valid trip export.");
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

    updateTrip(selectedTrip.id, (trip) => ({
      ...trip,
      people: [...trip.people, person]
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

    const isUsed = selectedTrip.expenses.some(
      (expense) => expense.paidByPersonId === personId || expense.shares.some((share) => share.personId === personId)
    );
    if (isUsed) {
      showNotice("error", "Delete expenses involving this person before removing them.");
      return;
    }

    updateTrip(selectedTrip.id, (trip) => ({
      ...trip,
      people: trip.people.filter((person) => person.id !== personId)
    }));
  }

  function resetExpenseForm() {
    if (!selectedTrip) {
      setDraft(emptyDraft);
      return;
    }

    setDraft({
      ...emptyDraft,
      date: getTodayInputDate(),
      paidByPersonId: selectedTrip.people[0]?.id ?? "",
      participantIds: selectedTrip.people.map((person) => person.id),
      exactShares: Object.fromEntries(selectedTrip.people.map((person) => [person.id, ""]))
    });
    setEditingExpenseId(null);
  }

  function handleSubmitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTrip || isReadOnly) return;

    const error = validateExpenseDraft(draft);
    if (error) {
      showNotice("error", error);
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

    updateTrip(selectedTrip.id, (trip) => ({
      ...trip,
      expenses: editingExpenseId
        ? trip.expenses.map((item) => (item.id === editingExpenseId ? expense : item))
        : [expense, ...trip.expenses]
    }));
    resetExpenseForm();
    showNotice("success", editingExpenseId ? "Expense updated." : "Expense added.");
  }

  function handleEditExpense(expense: Expense) {
    if (!selectedTrip || isReadOnly) return;
    setEditingExpenseId(expense.id);
    setDraft(expenseToDraft(expense, selectedTrip.people));
  }

  function handleDeleteExpense(expenseId: string) {
    if (!selectedTrip || isReadOnly) return;

    updateTrip(selectedTrip.id, (trip) => ({
      ...trip,
      expenses: trip.expenses.filter((expense) => expense.id !== expenseId)
    }));
    showNotice("success", "Expense deleted.");
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
    handleDuplicateTrip(sharedTrip);
    window.history.replaceState(null, "", window.location.pathname);
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
          <span className="brand-mark" aria-hidden="true">A</span>
          <strong>Loading Ambagan...</strong>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-button" type="button" onClick={() => setSharedTrip(null)}>
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>
            <strong>Ambagan</strong>
            <small>Shared expenses made simple</small>
          </span>
        </button>
        <div className="topbar-actions">
          <input ref={importInputRef} className="file-input" type="file" accept="application/json" onChange={handleImportTrip} />
          <button className="ghost-button" type="button" onClick={() => importInputRef.current?.click()}>
            Import trip
          </button>
        </div>
      </header>

      {notice ? <div className={`notice ${notice.tone}`}>{notice.message}</div> : null}

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <p className="eyebrow">Trips</p>
            <h2>Your ambagans</h2>
          </div>
          <form className="stack" onSubmit={handleCreateTrip}>
            <label htmlFor="new-trip">New trip</label>
            <div className="inline-form">
              <input
                id="new-trip"
                value={newTripName}
                onChange={(event) => setNewTripName(event.target.value)}
                placeholder="Dahilayan weekend"
              />
              <button type="submit">Create</button>
            </div>
          </form>

          <div className="trip-list" aria-label="Saved trips">
            {trips.length === 0 ? (
              <div className="empty-state">No trips yet. Create one to start tracking balances.</div>
            ) : (
              trips.map((trip) => (
                <article className={`trip-item ${selectedTrip?.id === trip.id && !isReadOnly ? "active" : ""}`} key={trip.id}>
                  {renamingTripId === trip.id ? (
                    <form className="stack" onSubmit={handleRenameTrip}>
                      <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
                      <div className="compact-actions">
                        <button type="submit">Save</button>
                        <button className="ghost-button" type="button" onClick={() => setRenamingTripId(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button className="trip-select" type="button" onClick={() => { setSelectedTripId(trip.id); setSharedTrip(null); }}>
                        <span>{trip.name}</span>
                        <small>{trip.people.length} people | {trip.expenses.length} expenses | {formatMoney(getTripTotalMinor(trip))}</small>
                      </button>
                      <div className="compact-actions">
                        <button className="ghost-button" type="button" onClick={() => { setRenamingTripId(trip.id); setRenameValue(trip.name); }}>
                          Rename
                        </button>
                        <button className="ghost-button" type="button" onClick={() => handleDuplicateTrip(trip)}>
                          Duplicate
                        </button>
                        <button className="ghost-button" type="button" onClick={() => handleExportTrip(trip)}>
                          Export
                        </button>
                        <button className="danger-button" type="button" onClick={() => handleDeleteTrip(trip.id)}>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))
            )}
          </div>
        </aside>

        {selectedTrip ? (
          <section className="trip-panel">
            <div className="trip-header">
              <div>
                <p className="eyebrow">{isReadOnly ? "Shared read-only snapshot" : "Local ambagan"}</p>
                <h1>{selectedTrip.name}</h1>
                <p>{formatMoney(tripTotal)} tracked across {selectedTrip.expenses.length} expenses.</p>
              </div>
              <div className="header-actions">
                {isReadOnly ? (
                  <button type="button" onClick={handleSaveSharedTrip}>Duplicate to my trips</button>
                ) : (
                  <>
                    <button className="ghost-button" type="button" onClick={() => handleExportTrip(selectedTrip)}>
                      Export JSON
                    </button>
                    <button type="button" onClick={handleCopyShareLink}>Copy share link</button>
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
                    <input value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} placeholder="Matthew" />
                    <button type="submit">Add</button>
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
                          <button className="ghost-button" type="button" onClick={() => handleRemovePerson(person.id)}>
                            Remove
                          </button>
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

            {!isReadOnly ? (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Record</p>
                    <h2>{editingExpenseId ? "Edit expense" : "Add ambag"}</h2>
                  </div>
                  {editingExpenseId ? (
                    <button className="ghost-button" type="button" onClick={resetExpenseForm}>
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                <ExpenseForm
                  draft={draft}
                  people={selectedTrip.people}
                  onSubmit={handleSubmitExpense}
                  onDraftChange={setDraft}
                  onParticipantChange={updateParticipant}
                  onSetAllParticipants={setAllParticipants}
                  isEditing={Boolean(editingExpenseId)}
                />
              </section>
            ) : null}

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Ledger</p>
                  <h2>Expenses</h2>
                </div>
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
                            <button className="ghost-button" type="button" onClick={() => handleEditExpense(expense)}>
                              Edit
                            </button>
                            <button className="danger-button" type="button" onClick={() => handleDeleteExpense(expense.id)}>
                              Delete
                            </button>
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

function ExpenseForm({
  draft,
  people,
  onSubmit,
  onDraftChange,
  onParticipantChange,
  onSetAllParticipants,
  isEditing
}: {
  draft: ExpenseDraft;
  people: Person[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: ExpenseDraft) => void;
  onParticipantChange: (personId: string, checked: boolean) => void;
  onSetAllParticipants: (checked: boolean) => void;
  isEditing: boolean;
}) {
  const selectedPeople = people.filter((person) => draft.participantIds.includes(person.id));
  const allPeopleSelected = people.length > 0 && draft.participantIds.length === people.length;

  return (
    <form className="expense-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Description
          <input
            value={draft.description}
            onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
            placeholder="Lunch, van rental, groceries"
          />
        </label>
        <label>
          Amount
          <input
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) => onDraftChange({ ...draft, amount: event.target.value })}
            placeholder="1000.00"
          />
        </label>
        <label>
          Date
          <input
            type="date"
            value={draft.date}
            onChange={(event) => onDraftChange({ ...draft, date: event.target.value })}
          />
        </label>
        <label>
          Paid by
          <select value={draft.paidByPersonId} onChange={(event) => onDraftChange({ ...draft, paidByPersonId: event.target.value })}>
            <option value="">Choose payer</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </label>
        <label>
          Split type
          <select value={draft.splitType} onChange={(event) => onDraftChange({ ...draft, splitType: event.target.value as SplitType })}>
            <option value="equal">Split equally</option>
            <option value="exact">Enter exact amounts</option>
          </select>
        </label>
      </div>

      <div className="participant-toolbar">
        <span>People involved</span>
        <button className="ghost-button" type="button" onClick={() => onSetAllParticipants(!allPeopleSelected)} disabled={people.length === 0}>
          {allPeopleSelected ? "Clear all" : "Select everyone"}
        </button>
      </div>
      <div className="participant-grid">
        {people.map((person) => (
          <label className="check-row" key={person.id}>
            <input
              type="checkbox"
              checked={draft.participantIds.includes(person.id)}
              onChange={(event) => onParticipantChange(person.id, event.target.checked)}
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
              <input
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
                placeholder="0.00"
              />
            </label>
          ))}
        </div>
      ) : null}

      <button className="submit-button" type="submit" disabled={people.length === 0}>
        {isEditing ? "Save expense" : "Add ambag"}
      </button>
    </form>
  );
}

function PersonAvatar({ name }: { name: string }) {
  return (
    <span className="person-avatar" style={getAvatarStyle(name)} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
