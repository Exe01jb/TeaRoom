/**
 * Bounded LRU Cache for message ID deduplication
 */
export class IdDeduplicator {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.set = new Set();
  }

  /**
   * Returns true if id is new (not seen before), false if duplicate.
   */
  checkAndAdd(id) {
    if (!id || typeof id !== 'string') return false;
    if (this.set.has(id)) {
      return false;
    }
    if (this.set.size >= this.maxSize) {
      // Remove oldest entry
      const oldest = this.set.values().next().value;
      this.set.delete(oldest);
    }
    this.set.add(id);
    return true;
  }

  has(id) {
    return this.set.has(id);
  }

  clear() {
    this.set.clear();
  }
}
