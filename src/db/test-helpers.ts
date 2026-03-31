/**
 * Test helpers for mocking Supabase client operations.
 *
 * Instead of connecting to a real Supabase instance, tests use an in-memory
 * store that mimics the Supabase client API (from/select/insert/update/delete).
 */

type Row = Record<string, unknown>;
type TableStore = Row[];

export class MockSupabaseClient {
	private tables: Map<string, TableStore> = new Map();
	private autoId: Map<string, number> = new Map();

	private getTable(name: string): TableStore {
		if (!this.tables.has(name)) {
			this.tables.set(name, []);
		}
		return this.tables.get(name)!;
	}

	private nextId(table: string): number {
		const current = this.autoId.get(table) ?? 0;
		this.autoId.set(table, current + 1);
		return current + 1;
	}

	from(table: string) {
		return new MockQueryBuilder(this.getTable(table), () => this.nextId(table));
	}

	// For compatibility with code that checks rpc
	rpc(_name: string, _params?: unknown) {
		return Promise.resolve({ data: null, error: null });
	}
}

class MockQueryBuilder {
	private rows: TableStore;
	private nextId: () => number;
	private filters: Array<(row: Row) => boolean> = [];
	private orderCol: string | null = null;
	private orderAsc = true;
	private limitCount: number | null = null;
	private isSingle = false;
	private isMaybeSingle = false;
	private isHead = false;
	private pendingOp: "select" | "insert" | "update" | "delete" | "upsert" | null = null;
	private pendingData: Row | Row[] | null = null;
	private upsertConflict: string | null = null;
	private returningSelect = false;

	constructor(rows: TableStore, nextId: () => number) {
		this.rows = rows;
		this.nextId = nextId;
	}

	select(_columns?: string, opts?: { count?: string; head?: boolean }) {
		// If select() is chained after delete/update, it acts as a RETURNING clause
		if (this.pendingOp === "delete" || this.pendingOp === "update") {
			this.returningSelect = true;
		} else {
			this.pendingOp = "select";
		}
		// columns captured for API compatibility
		if (opts?.head) this.isHead = true;
		// count option captured for API compatibility
		return this;
	}

	insert(data: Row | Row[]) {
		this.pendingOp = "insert";
		this.pendingData = data;
		const items = Array.isArray(data) ? data : [data];
		for (const item of items) {
			if (!item.id && !item.request_id && !item.name && !item.session_key) {
				item.id = this.nextId();
			}
			this.rows.push({ ...item });
		}
		return this;
	}

	upsert(data: Row | Row[], opts?: { onConflict?: string }) {
		this.pendingOp = "upsert";
		this.pendingData = data;
		this.upsertConflict = opts?.onConflict ?? null;
		const items = Array.isArray(data) ? data : [data];
		for (const item of items) {
			const conflictKey = this.upsertConflict;
			if (conflictKey) {
				const idx = this.rows.findIndex((r) => r[conflictKey] === item[conflictKey]);
				if (idx >= 0) {
					this.rows[idx] = { ...this.rows[idx], ...item };
					continue;
				}
			}
			this.rows.push({ ...item });
		}
		return this;
	}

	update(data: Row) {
		this.pendingOp = "update";
		this.pendingData = data;
		return this;
	}

	delete() {
		this.pendingOp = "delete";
		return this;
	}

	eq(col: string, val: unknown) {
		this.filters.push((row) => row[col] === val);
		return this;
	}

	neq(col: string, val: unknown) {
		this.filters.push((row) => row[col] !== val);
		return this;
	}

	in(col: string, vals: unknown[]) {
		this.filters.push((row) => vals.includes(row[col]));
		return this;
	}

	gte(col: string, val: unknown) {
		this.filters.push((row) => (row[col] as string) >= (val as string));
		return this;
	}

	lte(col: string, val: unknown) {
		this.filters.push((row) => (row[col] as string) <= (val as string));
		return this;
	}

	lt(col: string, val: unknown) {
		this.filters.push((row) => (row[col] as string) < (val as string));
		return this;
	}

	not(col: string, op: string, val: unknown) {
		if (op === "is") {
			this.filters.push((row) => row[col] !== val);
		}
		return this;
	}

	order(col: string, opts?: { ascending?: boolean }) {
		this.orderCol = col;
		this.orderAsc = opts?.ascending ?? true;
		return this;
	}

	limit(count: number) {
		this.limitCount = count;
		return this;
	}

	single() {
		this.isSingle = true;
		return this.execute();
	}

	maybeSingle() {
		this.isMaybeSingle = true;
		return this.execute();
	}

	then(resolve: (val: { data: unknown; error: unknown; count?: number }) => void, reject?: (err: unknown) => void) {
		try {
			resolve(this.executeSync());
		} catch (err) {
			if (reject) reject(err);
		}
	}

	private execute(): Promise<{ data: unknown; error: unknown; count?: number }> {
		return Promise.resolve(this.executeSync());
	}

	private executeSync(): { data: unknown; error: unknown; count?: number } {
		if (this.pendingOp === "update") {
			const data = this.pendingData as Row;
			let matched = 0;
			for (const row of this.rows) {
				if (this.filters.every((f) => f(row))) {
					Object.assign(row, data);
					matched++;
				}
			}
			return { data: null, error: null };
		}

		if (this.pendingOp === "delete") {
			const matched = this.rows.filter((row) => this.filters.every((f) => f(row)));
			const toKeep = this.rows.filter((row) => !this.filters.every((f) => f(row)));
			this.rows.length = 0;
			this.rows.push(...toKeep);
			if (this.returningSelect) {
				return { data: matched, error: null };
			}
			return { data: null, error: null };
		}

		if (this.pendingOp === "insert" || this.pendingOp === "upsert") {
			return { data: this.pendingData, error: null };
		}

		// SELECT
		let result = this.rows.filter((row) => this.filters.every((f) => f(row)));

		if (this.orderCol) {
			const col = this.orderCol;
			const asc = this.orderAsc;
			result.sort((a, b) => {
				const av = a[col] as string | number;
				const bv = b[col] as string | number;
				if (av < bv) return asc ? -1 : 1;
				if (av > bv) return asc ? 1 : -1;
				return 0;
			});
		}

		if (this.limitCount !== null) {
			result = result.slice(0, this.limitCount);
		}

		if (this.isHead) {
			return { data: null, error: null, count: result.length };
		}

		if (this.isSingle) {
			if (result.length === 0) {
				return { data: null, error: { message: "No rows found", code: "PGRST116" } };
			}
			return { data: result[0], error: null };
		}

		if (this.isMaybeSingle) {
			return { data: result[0] ?? null, error: null };
		}

		return { data: result, error: null, count: result.length };
	}
}

/**
 * Create a mock Supabase client for testing.
 * Returns an object that quacks like SupabaseClient for from()/select()/insert()/etc.
 */
export function createMockSupabase(): MockSupabaseClient {
	return new MockSupabaseClient();
}
