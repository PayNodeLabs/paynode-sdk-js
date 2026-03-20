export interface IdempotencyStore {
  /**
   * Attempts to mark a transaction hash as used.
   * @returns true if the hash was newly added, false if it already exists.
   */
  checkAndSet(txHash: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * Default implementation for MVP.
 * Uses a Map with expiration logic.
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

  private cleanup() {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, expiry] of this.cache.entries()) {
      if (expiry <= now) {
        this.cache.delete(key);
      }
    }
  }
}
