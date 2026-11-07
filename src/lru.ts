/** Tiny LRU map: least-recently-used entries are evicted (and handed to onEvict) past `max`. */
export class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(
    private max: number,
    private onEvict?: (value: V, key: K) => void,
  ) {}
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const [k, v] = this.map.entries().next().value as [K, V];
      this.map.delete(k);
      this.onEvict?.(v, k);
    }
  }
  get size() {
    return this.map.size;
  }
  has(key: K) {
    return this.map.has(key);
  }
}

/** Run fn at most once per `ms`, always delivering the latest call (trailing). */
export function throttleLatest<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  const wrapped = (...a: A) => {
    last = a;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const args = last!;
      last = null;
      fn(...args);
    }, ms);
  };
  wrapped.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    const args = last;
    last = null;
    if (args) fn(...args);
  };
  return wrapped;
}
