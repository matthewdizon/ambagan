import { NextResponse } from "next/server";
import { createSharedTrip } from "@/lib/share-store";
import type { Trip } from "@/types";

export const dynamic = "force-dynamic";

function isTrip(value: unknown): value is Trip {
  if (!value || typeof value !== "object") return false;

  const trip = value as Partial<Trip>;
  return (
    typeof trip.id === "string" &&
    typeof trip.name === "string" &&
    trip.currency === "PHP" &&
    Array.isArray(trip.people) &&
    Array.isArray(trip.expenses) &&
    typeof trip.createdAt === "string" &&
    typeof trip.updatedAt === "string"
  );
}

export async function POST(request: Request) {
  try {
    const trip = (await request.json()) as unknown;
    if (!isTrip(trip)) {
      return NextResponse.json({ error: "Invalid trip payload." }, { status: 400 });
    }

    const record = await createSharedTrip(trip);
    return NextResponse.json({ shareId: record.id, path: `/s/${record.id}` });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not create share link." }, { status: 500 });
  }
}
