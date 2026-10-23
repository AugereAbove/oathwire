import { Conflict, type Row } from '../packages/shared/src/model.js';
import type { Store, Write, Page } from '../packages/shared/src/store.js';
export class MemoryStore implements Store {
  rows = new Map<string, Row>();
  failNext = false;
  async get<T extends Row>(pk: string, secret = false): Promise<T | undefined> {
    return structuredClone(this.rows.get((secret ? 'SECRET#' : '') + pk)) as T | undefined;
  }
  async commit(writes: Write[]) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('INJECTED_STORAGE_FAILURE');
    }
    const keys = new Set<string>();
    for (const w of writes) {
      const key = (w.secret ? 'SECRET#' : '') + w.row.pk;
      if (keys.has(key)) throw new Error('Duplicate transaction target');
      keys.add(key);
      const current = this.rows.get(key);
      if (w.expected === null ? current !== undefined : current?.version !== w.expected)
        throw new Conflict();
    }
    for (const w of writes)
      if (!w.check) this.rows.set((w.secret ? 'SECRET#' : '') + w.row.pk, structuredClone(w.row));
  }
  async list<T extends Row>(partition: string, prefix: string, cursor?: string): Promise<Page<T>> {
    const all = [...this.rows.values()]
      .filter((r) => r.listPk === partition && r.listSk?.startsWith(prefix))
      .sort((a, b) => b.listSk!.localeCompare(a.listSk!));
    const offset = cursor ? Number(cursor) : 0;
    return {
      items: structuredClone(all.slice(offset, offset + 50)) as T[],
      cursor: offset + 50 < all.length ? String(offset + 50) : undefined,
    };
  }
  async due(now: number): Promise<Page<Row>> {
    return {
      items: structuredClone(
        [...this.rows.values()]
          .filter((r) => r.workPk === 'WORK' && r.workAt! <= now)
          .sort((a, b) => a.workAt! - b.workAt!)
          .slice(0, 100),
      ),
    };
  }
  async destination<T extends Row>(id: string): Promise<Page<T>> {
    return {
      items: structuredClone(
        [...this.rows.values()].filter((r) => r.destinationPk === id).slice(0, 50),
      ) as T[],
    };
  }
}
