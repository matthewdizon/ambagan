import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

export function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Missing Upstash Redis environment variables.");
  }

  redis ??= new Redis({ url, token, automaticDeserialization: false });
  return redis;
}
