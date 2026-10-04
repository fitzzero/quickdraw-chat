import type { UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type {
  AdminPage,
  AdminServiceMeta,
  AdminSubscribers,
  QuickdrawError,
} from "@fitzzero/quickdraw-core";
import type { AdminKeysOf, MethodQueryKey } from "@fitzzero/quickdraw-core/client";
import { qd } from "../../lib/quickdraw";

/** A service the admin screens serve: a key of the client whose contract has the admin kit. */
export type AdminKey = AdminKeysOf<typeof qd>;

/** A row as the admin screens handle it: its fields by name, as `adminMeta` describes them. */
export type AdminRow = Readonly<Record<string, unknown>> & { readonly id: string };

/** An `adminList` sort: one field `adminMeta` marks sortable. */
export interface AdminSort {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

/** What the screens pass `adminList`. */
export interface AdminListRequest {
  readonly page: number;
  readonly pageSize: number;
  readonly sort?: AdminSort;
}

type QueryOptions<Output> = Pick<
  UseQueryOptions<Output, QuickdrawError, Output>,
  "enabled" | "placeholderData"
>;

interface QueryMember<Input, Output> {
  useQuery(input: Input, options?: QueryOptions<Output>): UseQueryResult<Output, QuickdrawError>;
  key(input: Input): MethodQueryKey<Input>;
}

interface MutationMember<Input, Output> {
  useMutation(): UseMutationResult<Output, QuickdrawError, Input>;
}

/**
 * The admin kit's members as a screen driven by `adminMeta` uses them: field
 * names come from the metadata at run time, so inputs and rows are typed by
 * name rather than by each service's entity. `adminCreate` and `adminUpdate`
 * are absent for a service whose contract does not expose them (push
 * subscriptions are read and deleted only).
 */
export interface AdminMembers {
  readonly adminMeta: QueryMember<undefined, AdminServiceMeta>;
  readonly adminList: QueryMember<AdminListRequest, AdminPage<AdminRow>>;
  readonly adminGet: QueryMember<{ readonly id: string }, AdminRow>;
  readonly adminCreate?: MutationMember<{ readonly data: Record<string, unknown> }, AdminRow>;
  readonly adminUpdate?: MutationMember<
    { readonly id: string; readonly data: Record<string, unknown> },
    AdminRow
  >;
  readonly adminDelete?: MutationMember<{ readonly id: string }, null>;
  readonly adminSubscribers?: QueryMember<{ readonly id: string }, AdminSubscribers>;
}

/**
 * `qd[key].admin` for the screens that serve every admin service from its
 * metadata (the route names the key, `useAdminServices(qd)` lists them).
 */
// quickdraw-5.0 finding: the typed client has no shape for a metadata-driven admin screen: `qd[key].admin` over a union of keys is a union of per-entity members whose inputs (sort fields, data) cannot be called with names read from adminMeta at run time, so one cast here stands in for a loosely typed admin surface (or a useAdmin(qd, key)) the kit could ship
export function adminMembers(key: AdminKey): AdminMembers {
  return qd[key].admin as unknown as AdminMembers;
}
