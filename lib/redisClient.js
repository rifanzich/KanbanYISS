import { createClient } from "redis";

const globalForRedis = globalThis;

export async function getRedisClient() {
  if (!process.env.REDIS_URL) {
    throw new Error(
      "REDIS_URL belum di-set. Tambahkan integrasi Redis dari Vercel Marketplace ke project ini terlebih dahulu."
    );
  }
  if (!globalForRedis._redisClientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => {
      console.error("Redis client error:", err);
      globalForRedis._redisClientPromise = null;
    });
    globalForRedis._redisClientPromise = client
      .connect()
      .then(() => client)
      .catch((err) => {
        globalForRedis._redisClientPromise = null;
        throw err;
      });
  }
  return globalForRedis._redisClientPromise;
}
