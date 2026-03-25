import type { Redis } from 'ioredis';

export interface IdempotencyStore {
  /**
   * Attempts to mark a transaction hash as used.
   * @returns true if the hash was newly added, false if it already exists.
   */
  checkAndSet(txHash: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Deletes a transaction hash from the store.
   * Used for rolling back a lock if subsequent verification fails.
   */
  delete(txHash: string): Promise<void>;
}

/**
 * Default implementation for MVP.
 * Uses a Map with expiration logic.
 * @deprecated Use RedisIdempotencyStore for production environments.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private cache: Map<string, number> = new Map();

  constructor() {
    // Basic cleanup interval
    setInterval(() => this.cleanup(), 60000);
  }

  async checkAndSet(txHash: string, ttlSeconds: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.cache.get(txHash);

    if (existing && existing > now) {
      return false;
    }

    this.cache.set(txHash, now + ttlSeconds);
    return true;
  }

  async delete(txHash: string): Promise<void> {
    this.cache.delete(txHash);
  }

  private cleanup() {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, expiry] of this.cache.entries()) {
      if (expiry <= now) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Production-ready implementation using Redis.
 * Uses `SET txHash 1 NX EX ttlSeconds` for atomic check-and-set.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private redis: Redis;
  private prefix: string;

  constructor(redisClient: Redis, prefix: string = 'paynode:tx:') {
    this.redis = redisClient;
    this.prefix = prefix;
  }

  async checkAndSet(txHash: string, ttlSeconds: number): Promise<boolean> {
    const key = `${this.prefix}${txHash}`;
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async delete(txHash: string): Promise<void> {
    const key = `${this.prefix}${txHash}`;
    await this.redis.del(key);
  }
}
