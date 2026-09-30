// The lab-scoped seam. A read handle is scoped by table class, generated from the database:
//   lab tables    need a Lab scope; the plugin adds `<alias>.lab_id = $lab`
//   ledger tables get `ledger_id in ($lab, $company)`, or `= $company` in company scope
//   portal views  are the only relations a Customer scope may name, filtered to the Customer
//   company tables are readable in any staff scope
// A query that names a table its scope may not see throws ScopeViolation before it reaches
// Postgres. The type split (ReadFor) catches most of that at compile time; the plugin catches
// the rest at runtime, including inside CTEs, subqueries and joins.

import {
  AliasNode, AndNode, ColumnNode, IdentifierNode, OnNode, OperationNodeTransformer, RawNode, ReferenceNode, TableNode,
  ValueNode, WhereNode, BinaryOperationNode, OperatorNode, ValueListNode,
  type DeleteQueryNode, type InsertQueryNode, type JoinNode, type Kysely, type KyselyPlugin, type OperationNode,
  type PluginTransformQueryArgs, type PluginTransformResultArgs, type QueryId, type QueryResult, type RootOperationNode,
  type SelectQueryNode, type UnknownRow, type UpdateQueryNode,
} from 'kysely';
import type { DB } from './generated.ts';
import { COMPANY_TABLES, LAB_TABLES, LEDGER_TABLES, PORTAL_VIEWS, type CompanyTable, type LedgerTable, type PortalView } from './tables.generated.ts';
import { COMPANY_LEDGER } from './ledgers.ts';
import type { CustomerId, LabId } from '@lims/domain/ids';

export type Scope =
  | { readonly kind: 'lab'; readonly labId: LabId }
  | { readonly kind: 'customer'; readonly customerId: CustomerId }
  | { readonly kind: 'company' };

/** A read handle: selects only. The type has no insertInto, updateTable or deleteFrom. */
export type ReadDb<T> = Pick<Kysely<T>, 'selectFrom' | 'selectNoFrom' | 'with' | 'withRecursive'>;
export type LabRead = ReadDb<DB>;
export type CustomerRead = ReadDb<Pick<DB, PortalView>>;
export type CompanyRead = ReadDb<Pick<DB, CompanyTable | LedgerTable>>;
export type ReadFor<S extends Scope> =
  S extends { kind: 'lab' } ? LabRead : S extends { kind: 'customer' } ? CustomerRead : CompanyRead;

export class ScopeViolation extends Error {
  readonly table: string;
  readonly scope: Scope['kind'];
  constructor(table: string, scope: Scope['kind']) {
    super(`${table} queried in ${scope} scope`);
    this.table = table;
    this.scope = scope;
  }
}

export type TableClasses = {
  readonly lab: ReadonlySet<string>;
  readonly ledger: ReadonlySet<string>;
  readonly portal: ReadonlySet<string>;
  readonly company: ReadonlySet<string>;
};

export const GENERATED_CLASSES: TableClasses = {
  lab: new Set<string>(LAB_TABLES),
  ledger: new Set<string>(LEDGER_TABLES),
  portal: new Set<string>(PORTAL_VIEWS),
  company: new Set<string>(COMPANY_TABLES),
};

const eq = (table: string, column: string, value: unknown): OperationNode =>
  BinaryOperationNode.create(
    ReferenceNode.create(ColumnNode.create(column), TableNode.create(table)),
    OperatorNode.create('='),
    ValueNode.create(value),
  );

const inList = (table: string, column: string, values: readonly unknown[]): OperationNode =>
  BinaryOperationNode.create(
    ReferenceNode.create(ColumnNode.create(column), TableNode.create(table)),
    OperatorNode.create('in'),
    ValueListNode.create(values.map((v) => ValueNode.create(v))),
  );

const andAll = (nodes: readonly OperationNode[]): OperationNode | undefined =>
  nodes.reduce<OperationNode | undefined>((acc, n) => (acc ? AndNode.create(acc, n) : n), undefined);

class ScopeTransformer extends OperationNodeTransformer {
  readonly #scope: Scope;
  readonly #classes: TableClasses;

  constructor(scope: Scope, classes: TableClasses) {
    super();
    this.#scope = scope;
    this.#classes = classes;
  }

  /** The table a FROM or JOIN item names, with the name a predicate must use to reach it. */
  #tableRef(item: OperationNode): { table: string; ref: string } | null {
    const inner = AliasNode.is(item) ? item.node : item;
    if (RawNode.is(inner)) throw new ScopeViolation('raw sql', this.#scope.kind);
    if (!TableNode.is(inner)) return null;
    const table = inner.table.identifier.name;
    const ref = AliasNode.is(item) && IdentifierNode.is(item.alias) ? item.alias.name : table;
    return { table, ref };
  }

  #predicateFor(item: OperationNode): OperationNode | undefined {
    const t = this.#tableRef(item);
    if (!t) return undefined;
    const scope = this.#scope;
    const classes = this.#classes;
    if (classes.lab.has(t.table)) {
      if (scope.kind !== 'lab') throw new ScopeViolation(t.table, scope.kind);
      return eq(t.ref, 'lab_id', scope.labId);
    }
    if (classes.ledger.has(t.table)) {
      if (scope.kind === 'customer') throw new ScopeViolation(t.table, scope.kind);
      return scope.kind === 'lab'
        ? inList(t.ref, 'ledger_id', [scope.labId, COMPANY_LEDGER])
        : eq(t.ref, 'ledger_id', COMPANY_LEDGER);
    }
    if (classes.portal.has(t.table)) {
      return scope.kind === 'customer' ? eq(t.ref, 'customer_id', scope.customerId) : undefined;
    }
    if (classes.company.has(t.table) && scope.kind === 'customer') throw new ScopeViolation(t.table, scope.kind);
    return undefined;
  }

  #scopeJoins(joins: ReadonlyArray<JoinNode> | undefined): ReadonlyArray<JoinNode> | undefined {
    return joins?.map((j) => {
      const p = this.#predicateFor(j.table);
      if (!p) return j;
      return { ...j, on: OnNode.create(j.on ? AndNode.create(j.on.on, p) : p) };
    });
  }

  #scopeWhere(where: WhereNode | undefined, items: ReadonlyArray<OperationNode>): WhereNode | undefined {
    const preds = items.map((i) => this.#predicateFor(i)).filter((p): p is OperationNode => p !== undefined);
    const extra = andAll(preds);
    if (!extra) return where;
    return WhereNode.create(where ? AndNode.create(where.where, extra) : extra);
  }

  protected override transformSelectQuery(node: SelectQueryNode, queryId?: QueryId): SelectQueryNode {
    const n = super.transformSelectQuery(node, queryId);
    const where = this.#scopeWhere(n.where, n.from?.froms ?? []);
    const joins = this.#scopeJoins(n.joins);
    return { ...n, ...(where ? { where } : {}), ...(joins ? { joins } : {}) };
  }

  protected override transformUpdateQuery(node: UpdateQueryNode, queryId?: QueryId): UpdateQueryNode {
    const n = super.transformUpdateQuery(node, queryId);
    const targets = [...(n.table ? [n.table] : []), ...(n.from?.froms ?? [])];
    const where = this.#scopeWhere(n.where, targets);
    const joins = this.#scopeJoins(n.joins);
    return { ...n, ...(where ? { where } : {}), ...(joins ? { joins } : {}) };
  }

  protected override transformDeleteQuery(node: DeleteQueryNode, queryId?: QueryId): DeleteQueryNode {
    const n = super.transformDeleteQuery(node, queryId);
    const targets = [...n.from.froms, ...(n.using?.tables ?? [])];
    const where = this.#scopeWhere(n.where, targets);
    const joins = this.#scopeJoins(n.joins);
    return { ...n, ...(where ? { where } : {}), ...(joins ? { joins } : {}) };
  }

  protected override transformInsertQuery(node: InsertQueryNode, queryId?: QueryId): InsertQueryNode {
    const n = super.transformInsertQuery(node, queryId);
    if (n.into) this.#predicateFor(n.into);
    return n;
  }
}

/** Kysely plugin that scopes every query to `scope`. `classes` defaults to the generated classification. */
export function scopePlugin(scope: Scope, classes: TableClasses = GENERATED_CLASSES): KyselyPlugin {
  return {
    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
      if (args.node.kind === 'RawNode') throw new ScopeViolation('raw sql', scope.kind);
      return new ScopeTransformer(scope, classes).transformNode(args.node, args.queryId);
    },
    transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
      return Promise.resolve(args.result);
    },
  };
}

/**
 * Runs `fn` in a READ ONLY, READ COMMITTED transaction on a handle scoped to `scope`. No audit
 * context is set and nothing can be written: Postgres refuses any write inside it (25006).
 */
export async function openRead<S extends Scope, T>(
  db: Kysely<DB>,
  scope: S,
  fn: (q: ReadFor<S>) => Promise<T>,
  classes: TableClasses = GENERATED_CLASSES,
): Promise<T> {
  return db
    .transaction()
    .setAccessMode('read only')
    .setIsolationLevel('read committed')
    .execute((trx) => fn(trx.withPlugin(scopePlugin(scope, classes)) as unknown as ReadFor<S>));
}
