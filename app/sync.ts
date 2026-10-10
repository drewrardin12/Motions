import type { ProgressRow, SharedMotion, SharedRhythm } from './supabase';

export type SyncStatus = 'loading' | 'saving' | 'synced' | 'offline' | 'error';
type Edit<T> = { id: string; value: T | null };
type Write = ProgressRow & { memberId: string; version: number };
export type Snapshot = {
  motions: SharedMotion[]; rhythms: SharedRhythm[]; progress: ProgressRow[];
  motionEdits: Edit<SharedMotion>[]; rhythmEdits: Edit<SharedRhythm>[];
  motionOrder?: string[]; rhythmOrder?: string[]; writes: Write[];
};
export type SyncApi = {
  motions(): Promise<SharedMotion[]>; rhythms(): Promise<SharedRhythm[]>;
  progress(keys: string[]): Promise<ProgressRow[]>;
  saveMotions(member: string, items: SharedMotion[], expected?: SharedMotion[]): Promise<boolean>;
  saveRhythms(member: string, items: SharedRhythm[], expected?: SharedRhythm[]): Promise<boolean>;
  setProgress(member: string, period: string, type: string, id: string, completed: boolean): Promise<boolean>;
};
const keyOf = (row: ProgressRow) => JSON.stringify([row.period_key, row.item_type, row.item_id]);
export function normalizeMotion(m: SharedMotion): SharedMotion {
  // Legacy numeric identifiers preserve completions already stored by the original app.
  return { ...m, taskIds: m.tasks.map((_, i) => m.taskIds?.[i] ?? String(i)) };
}
export function taskKey(m: SharedMotion, index: number) { return `${m.id}:${m.taskIds?.[index] ?? index}`; }
export function taskIndex(m: SharedMotion, itemId: string) {
  if (!itemId.startsWith(`${m.id}:`)) return -1;
  return normalizeMotion(m).taskIds!.indexOf(itemId.slice(m.id.length + 1));
}
function merge<T extends {id: string}>(remote: T[], edits: Edit<T>[], order?: string[]): T[] {
  const items = new Map(remote.map(item => [item.id, item]));
  for (const edit of edits) { if (edit.value) items.set(edit.id, edit.value); else items.delete(edit.id); }
  const rank = new Map(order?.map((id, i) => [id, i]));
  return [...items.values()].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
function accepted<T extends {id: string}>(confirmed: T[], edits: Edit<T>[]) {
  return edits.every(edit => {
    const saved = confirmed.find(item => item.id === edit.id);
    if (!edit.value) return !saved;
    return !!saved && Object.keys(edit.value).every(key => JSON.stringify(saved[key as keyof T]) === JSON.stringify(edit.value![key as keyof T]));
  });
}
function changes<T extends {id: string}>(previous: T[], next: T[], pending: Edit<T>[]): Edit<T>[] {
  const edits = new Map(pending.map(edit => [edit.id, edit]));
  for (const item of previous) if (!next.some(x => x.id === item.id)) edits.set(item.id, {id: item.id, value: null});
  for (const item of next) if (JSON.stringify(item) !== JSON.stringify(previous.find(x => x.id === item.id))) edits.set(item.id, {id: item.id, value: item});
  return [...edits.values()];
}
export function visibleProgress(snapshot: Snapshot, periods: string[]): ProgressRow[] {
  const rows = new Map(snapshot.progress.map(row => [keyOf(row), row]));
  for (const write of snapshot.writes) rows.set(keyOf(write), write);
  return [...rows.values()].filter(row => periods.includes(row.period_key));
}

// Daily selection has its own period, so it never counts as task completion.
export function dailyMotionPlan(rows: ProgressRow[], period: string): string[] | null {
  const plan=rows.filter(r=>r.period_key===period&&r.item_type==='motion');
  if(!plan.some(r=>r.item_id==='plan-ready'&&r.completed))return null;
  return plan.filter(r=>r.completed&&r.item_id.startsWith('include:')).map(r=>r.item_id.slice(8));
}

// One serialized cycle per household. Pending changes are persisted before any network call.
export class HouseholdSync {
  snapshot: Snapshot;
  status: SyncStatus = 'loading';
  error = '';
  private revision = 0;
  private active: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  constructor(private api: SyncApi, private storage: Pick<Storage, 'getItem' | 'setItem'>, private key: string, private memberId: string,
    initial: {motions: SharedMotion[]; rhythms: SharedRhythm[]}) {
    let saved: Partial<Snapshot> = {};
    try { saved = JSON.parse(storage.getItem(key) || '{}'); } catch { /* Keep usable defaults if cache is corrupt. */ }
    this.snapshot = { motions: saved.motions ?? initial.motions, rhythms: saved.rhythms ?? initial.rhythms,
      progress: saved.progress ?? [], motionEdits: saved.motionEdits ?? [], rhythmEdits: saved.rhythmEdits ?? [],
      motionOrder: saved.motionOrder, rhythmOrder: saved.rhythmOrder, writes: saved.writes ?? [] };
    this.snapshot.motions = this.snapshot.motions.map(normalizeMotion);
    this.revision = Math.max(0, ...this.snapshot.writes.map(w => w.version));
  }
  setMember(memberId: string) { this.memberId = memberId; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  private persist() {
    try { this.storage.setItem(this.key, JSON.stringify(this.snapshot)); }
    catch { this.status = 'error'; this.error = 'This phone could not keep a backup. Keep the app open and retry.'; this.emit(); throw new Error(this.error); }
    this.emit();
  }
  get pending() { return !!(this.snapshot.writes.length || this.snapshot.motionEdits.length || this.snapshot.rhythmEdits.length || this.snapshot.motionOrder || this.snapshot.rhythmOrder); }
  editMotions(next: SharedMotion[]) {
    next = next.map(normalizeMotion);
    const previous = this.snapshot.motions;
    this.snapshot.motionEdits = changes(previous, next, this.snapshot.motionEdits);
    if (previous.map(x => x.id).join('|') !== next.map(x => x.id).join('|')) this.snapshot.motionOrder = next.map(x => x.id);
    this.snapshot.motions = next; this.revision++; this.status = 'saving'; this.persist();
  }
  editRhythms(next: SharedRhythm[]) {
    const previous = this.snapshot.rhythms;
    this.snapshot.rhythmEdits = changes(previous, next, this.snapshot.rhythmEdits);
    if (previous.map(x => x.id).join('|') !== next.map(x => x.id).join('|')) this.snapshot.rhythmOrder = next.map(x => x.id);
    this.snapshot.rhythms = next; this.revision++; this.status = 'saving'; this.persist();
  }
  complete(period: string, type: string, id: string, completed: boolean, name: string) {
    const write: Write = {period_key: period, item_type: type, item_id: id, completed, updated_by_name: name,
      updated_at: new Date().toISOString(), memberId: this.memberId, version: ++this.revision};
    this.snapshot.writes = [...this.snapshot.writes.filter(w => keyOf(w) !== keyOf(write)), write];
    this.status = 'saving'; this.persist();
  }
  chooseDailyMotions(period: string, motionIds: string[], selected: string[], name: string) {
    for(const id of motionIds)this.complete(period,'motion',`include:${id}`,selected.includes(id),name);
    this.complete(period,'motion','plan-ready',true,name);
  }
  cycle(periods: string[], online = true): Promise<void> {
    if (this.active) return this.active;
    if (!online) { this.status = 'offline'; this.emit(); return Promise.resolve(); }
    this.active = this.run(periods).finally(() => { this.active = null; });
    return this.active;
  }
  private async run(periods: string[]) {
    if (this.pending) this.status = 'saving';
    this.error = ''; this.emit();
    try {
      const [motions, rhythms] = await Promise.all([this.api.motions(), this.api.rhythms()]);
      this.snapshot.motions = merge(motions.map(normalizeMotion), this.snapshot.motionEdits, this.snapshot.motionOrder);
      this.snapshot.rhythms = merge(rhythms, this.snapshot.rhythmEdits, this.snapshot.rhythmOrder);
      this.persist();
      // Capture the exact batch; newer edits must survive acknowledgement of older writes.
      const motionEdits = this.snapshot.motionEdits, motionOrder = this.snapshot.motionOrder;
      if (motionEdits.length || motionOrder) {
        if (!await this.api.saveMotions(this.memberId, this.snapshot.motions, motions)) throw new Error('The household did not accept the Motion update.');
        const confirmed = await this.api.motions();
        for (const edit of motionEdits) if (edit.value && JSON.stringify(confirmed.find(m => m.id === edit.id)?.taskIds) !== JSON.stringify(edit.value.taskIds)) {
          throw new Error('The household needs the checklist identity update before these edits can sync. Your edits are saved on this phone.');
        }
        if (!accepted(confirmed, motionEdits)) throw new Error('The Motion update could not be confirmed. Your edits are saved on this phone.');
        this.snapshot.motionEdits = this.snapshot.motionEdits.filter(edit => !motionEdits.includes(edit));
        if (this.snapshot.motionOrder === motionOrder) this.snapshot.motionOrder = undefined;
        this.persist();
      }
      const rhythmEdits = this.snapshot.rhythmEdits, rhythmOrder = this.snapshot.rhythmOrder;
      if (rhythmEdits.length || rhythmOrder) {
        if (!await this.api.saveRhythms(this.memberId, this.snapshot.rhythms, rhythms)) throw new Error('The household did not accept the Rhythm update.');
        const confirmed = await this.api.rhythms();
        if (!accepted(confirmed, rhythmEdits)) throw new Error('The Rhythm update could not be confirmed. Your edits are saved on this phone.');
        this.snapshot.rhythmEdits = this.snapshot.rhythmEdits.filter(edit => !rhythmEdits.includes(edit));
        if (this.snapshot.rhythmOrder === rhythmOrder) this.snapshot.rhythmOrder = undefined;
        this.persist();
      }
      for (const write of [...this.snapshot.writes]) {
        if (!await this.api.setProgress(write.memberId, write.period_key, write.item_type, write.item_id, write.completed)) throw new Error('The household did not accept this completion.');
        this.snapshot.writes = this.snapshot.writes.filter(w => w !== write); // A later toggle has a different object.
        this.snapshot.progress = [...this.snapshot.progress.filter(r => keyOf(r) !== keyOf(write)), write];
        this.persist();
      }
      this.snapshot.progress = await this.api.progress(periods);
      this.status = this.pending ? 'saving' : 'synced'; this.persist();
    } catch (error) {
      this.status = 'error'; this.error = error instanceof Error ? error.message : 'The household could not be reached.'; this.emit();
    }
  }
}
