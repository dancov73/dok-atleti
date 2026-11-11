// What stays on the phone for the use with no network (docs/ruoli.md §11): the copies of what the athlete can see without it and the
// marks still to send, in IndexedDB. The cache of the service worker holds only the pages. A newer app reads what an older one left: a
// copy of another FORMAT is dropped (the cloud has it), the queue never. With no IndexedDB (some private windows) all lasts the page.
const FORMAT = 1;

export class Store {
  constructor(name) {
    this.db = new Promise(ok => {
      try {
        const r = indexedDB.open(name, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('copies'); r.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true }); };
        r.onsuccess = () => ok(r.result);
        r.onerror = r.onblocked = () => ok(null);
      } catch { ok(null); }
    });
    this.mem = { copies: new Map(), queue: new Map(), n: 0 };
  }

  /** One request in its own transaction, done when the transaction is: nothing waits across two of them. */
  async one(store, mode, make, inMemory) {
    const db = await this.db;
    if (!db) return inMemory(this.mem);
    const t = db.transaction(store, mode), r = make(t.objectStore(store));
    return new Promise((ok, ko) => { t.oncomplete = () => ok(r.result); t.onerror = t.onabort = () => ko(t.error); });
  }

  /** The copy under [key] ({ at, data }), or null. */
  async get(key) {
    const c = await this.one('copies', 'readonly', s => s.get(key), m => m.copies.has(key) ? structuredClone(m.copies.get(key)) : undefined);
    return c && c.f === FORMAT ? c : null;
  }
  put(key, data) {
    const c = { f: FORMAT, at: Date.now(), data };
    return this.one('copies', 'readwrite', s => s.put(c, key), m => { m.copies.set(key, structuredClone(c)); });
  }
  del(key) { return this.one('copies', 'readwrite', s => s.delete(key), m => { m.copies.delete(key); }); }
  keys() { return this.one('copies', 'readonly', s => s.getAllKeys(), m => [...m.copies.keys()]); }
  clearCopies() { return this.one('copies', 'readwrite', s => s.clear(), m => { m.copies.clear(); }); }

  /** The marks still to send, in the order they were written. */
  queue() { return this.one('queue', 'readonly', s => s.getAll(), m => [...m.queue.values()]); }
  add(item) { return this.one('queue', 'readwrite', s => s.add(item), m => { const id = ++m.n; m.queue.set(id, { ...item, id }); return id; }); }
  remove(id) { return this.one('queue', 'readwrite', s => s.delete(id), m => { m.queue.delete(id); }); }

  async clearAll() {
    await this.clearCopies();
    await this.one('queue', 'readwrite', s => s.clear(), m => { m.queue.clear(); });
  }

  /** Asks the phone not to erase these data when space runs low: the iPhone grants it to the app on the Home Screen, Chrome by its own rules. */
  keepOn() { try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not there: the data stay as long as the phone keeps them */ } }
}
