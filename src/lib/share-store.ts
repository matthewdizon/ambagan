import "server-only";

import { randomBytes } from "node:crypto";
import { getRedis } from "@/lib/redis";
import { decodeTripFromHash, encodeTripForHash } from "@/lib/share";
import type { Trip } from "@/types";

const SHARE_KEY_PREFIX = "share:";
const SHARE_INDEX_KEY = "shares:index";

export type SharedTripRecord = {
  version: 1;
  id: string;
  payload: string;
  tripName: string;
  peopleCount: number;
  expenseCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SharedTripSummary = Omit<SharedTripRecord, "payload">;

function createShareId() {
  return randomBytes(6).toString("base64url");
}

function getShareKey(id: string) {
  return `${SHARE_KEY_PREFIX}${id}`;
}

export function isValidShareId(id: string) {
  return /^[A-Za-z0-9_-]{6,32}$/.test(id);
}

function createRecord(id: string, trip: Trip): SharedTripRecord {
  const now = new Date().toISOString();

  return {
    version: 1,
    id,
    payload: encodeTripForHash(trip),
    tripName: trip.name,
    peopleCount: trip.people.length,
    expenseCount: trip.expenses.length,
    createdAt: now,
    updatedAt: trip.updatedAt
  };
}

export async function createSharedTrip(trip: Trip) {
  const redis = getRedis();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = createShareId();
    const key = getShareKey(id);
    const record = createRecord(id, trip);
    const didCreate = await redis.set(key, JSON.stringify(record), { nx: true });

    if (didCreate === "OK") {
      await redis.zadd(SHARE_INDEX_KEY, { score: Date.now(), member: id });
      return record;
    }
  }

  throw new Error("Could not create a unique share link.");
}

export async function getSharedTrip(id: string): Promise<Trip | null> {
  if (!isValidShareId(id)) return null;

  const redis = getRedis();
  const rawRecord = await redis.get<string>(getShareKey(id));
  if (!rawRecord) return null;

  try {
    const record = JSON.parse(rawRecord) as SharedTripRecord;
    return decodeTripFromHash(record.payload);
  } catch {
    return null;
  }
}

export async function listSharedTrips(limit = 50): Promise<SharedTripSummary[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(SHARE_INDEX_KEY, 0, Math.max(0, limit - 1), { rev: true });
  if (ids.length === 0) return [];

  const records = await Promise.all(
    ids.map(async (id) => {
      const rawRecord = await redis.get<string>(getShareKey(id));
      if (!rawRecord) return null;

      try {
        const { payload: _payload, ...summary } = JSON.parse(rawRecord) as SharedTripRecord;
        return summary;
      } catch {
        return null;
      }
    })
  );

  return records.filter((record): record is SharedTripSummary => Boolean(record));
}
