import { createClient } from "redis";

let clientPromise = null;

export async function getRedisClient() {
  if (!process.env.REDIS_URL) {
    throw new Error(
      "REDIS_URL belum di-set. Tambahkan integrasi Redis dari Vercel Marketplace ke project ini terlebih dahulu."
    );
  }
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.error("Redis client error:", err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}
