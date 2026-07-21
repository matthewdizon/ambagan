import { notFound } from "next/navigation";
import { ExpenseTrackerApp } from "@/components/ExpenseTrackerApp";
import { getSharedTrip } from "@/lib/share-store";

export const dynamic = "force-dynamic";

export default async function SharedTripPage({
  params
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const sharedTrip = await getSharedTrip(shareId);

  if (!sharedTrip) {
    notFound();
  }

  return <ExpenseTrackerApp initialSharedTrip={sharedTrip} />;
}
