"use client";

import * as React from "react";
import { Box, Typography, Button, CircularProgress, Alert } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData } from "@tanstack/react-query";
import {
  adminOf,
  useAdminServices,
  type AdminKeysOf,
  type AdminScreen,
  type AdminServiceInfo,
} from "@fitzzero/quickdraw-core/client";
import type { AdminServiceMeta } from "@project/shared";
import { useRightSidebar, usePageTitle } from "../../../providers/LayoutProvider";
import { AdminTable } from "../../../components/admin/AdminTable";
import { AdminEntitySidebar } from "../../../components/admin/AdminEntitySidebar";
import { AdminCreateModal } from "../../../components/admin/AdminCreateModal";
import { useErrorText } from "../../../hooks/useErrorText";
import { qd } from "../../../lib/quickdraw";

const PAGE_SIZE = 20;

/** An `adminList` sort the screen chose: one field `adminMeta` marks sortable. */
interface AdminSort {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

/** Newest first when the service sorts by creation time, else the kit's default order. */
function defaultSort(meta: AdminServiceMeta | undefined): AdminSort | null {
  const created = meta?.fields.find((field) => field.name === "createdAt" && field.sortable);
  return created === undefined ? null : { field: created.name, direction: "desc" };
}

/**
 * One page of the service's rows: the page and the sort the screen chose,
 * and `adminList`'s answer for them. The admin list is a query (the kit's
 * rows are not live: another admin's write shows at the next read): the
 * previous page stays on screen while the next one loads, and admin writes
 * from this screen read it again (`refresh`).
 */
function useAdminPage(admin: AdminScreen, meta: AdminServiceMeta | undefined) {
  const [page, setPage] = React.useState(1);
  const [chosenSort, setChosenSort] = React.useState<AdminSort | null>(null);
  const fallbackSort = React.useMemo(() => defaultSort(meta), [meta]);
  const sort = chosenSort ?? fallbackSort;
  const listInput = React.useMemo(
    () => ({ page, pageSize: PAGE_SIZE, ...(sort === null ? {} : { sort }) }),
    [page, sort],
  );
  const list = admin.adminList.useQuery(listInput, {
    enabled: meta !== undefined,
    placeholderData: keepPreviousData,
  });
  const changeSort = React.useCallback((field: string | null, direction: "asc" | "desc") => {
    setChosenSort(field === null ? null : { field, direction });
    setPage(1);
  }, []);
  const refresh = React.useCallback((): void => {
    qd.invalidate(admin.adminList);
  }, [admin]);
  return {
    rows: list.data?.items ?? [],
    total: list.data?.total ?? 0,
    isLoading: list.isFetching && list.data === undefined,
    error: list.error,
    page,
    setPage,
    sortField: sort?.field ?? null,
    sortDirection: sort?.direction ?? "asc",
    changeSort,
    refresh,
  };
}

function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 300 }}>
      {children}
    </Box>
  );
}

/**
 * The admin screen of one service: a page of its rows, sorted by a field its
 * metadata marks sortable, a sidebar for the selected row, and a create form.
 * Every call goes through the service's admin kit members, as one shape for
 * every service (`adminOf(qd, key)`: rows and inputs by field name).
 */
function AdminServiceScreen({
  service,
}: {
  service: AdminServiceInfo<AdminKeysOf<typeof qd>>;
}): React.ReactElement {
  const t = useTranslations("Admin");
  const errorText = useErrorText();
  const admin = adminOf(qd, service.key);

  const { data: meta, error: metaError } = admin.adminMeta.useQuery(undefined);
  const list = useAdminPage(admin, meta);
  const refreshList = list.refresh;

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);

  usePageTitle(meta?.displayName ?? service.displayName);

  // Right sidebar: the selected row (services whose kit exposes adminGet)
  const sidebarContent = React.useMemo(() => {
    if (!selectedId || !meta || admin.adminGet === undefined) return null;
    return (
      <AdminEntitySidebar
        key={selectedId}
        admin={admin}
        adminGet={admin.adminGet}
        serviceKey={service.key}
        entryId={selectedId}
        meta={meta}
        onClose={(): void => {
          setSelectedId(null);
        }}
        onChanged={refreshList}
        onDeleted={(): void => {
          setSelectedId(null);
          refreshList();
        }}
      />
    );
  }, [selectedId, meta, admin, service.key, refreshList]);

  useRightSidebar(sidebarContent);

  const handleRowSelect = React.useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleCreateSuccess = React.useCallback(() => {
    setCreateModalOpen(false);
    refreshList();
  }, [refreshList]);

  if (metaError !== null) {
    return (
      <Box sx={{ maxWidth: 800, mx: "auto" }}>
        <Alert severity="error">{errorText(metaError)}</Alert>
      </Box>
    );
  }
  if (meta === undefined) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  }

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            {meta.displayName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("totalEntries", { count: list.total })}
          </Typography>
        </Box>
        {admin.adminCreate !== undefined && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={(): void => {
              setCreateModalOpen(true);
            }}
          >
            {t("addNew")}
          </Button>
        )}
      </Box>

      {/* Error alert */}
      {list.error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorText(list.error)}
        </Alert>
      )}

      {/* Table */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <AdminTable
          data={list.rows}
          columns={meta.fields.filter((f) => f.showInTable)}
          isLoading={list.isLoading}
          selectedId={selectedId}
          onRowSelect={handleRowSelect}
          page={list.page}
          pageSize={PAGE_SIZE}
          total={list.total}
          onPageChange={list.setPage}
          sortField={list.sortField}
          sortDirection={list.sortDirection}
          onSortChange={list.changeSort}
        />
      </Box>

      {/* Create Modal (services whose kit exposes adminCreate) */}
      {admin.adminCreate !== undefined && (
        <AdminCreateModal
          open={createModalOpen}
          onClose={(): void => {
            setCreateModalOpen(false);
          }}
          adminCreate={admin.adminCreate}
          meta={meta}
          onSuccess={handleCreateSuccess}
        />
      )}
    </Box>
  );
}

/**
 * The admin page of the service the route names: `/admin/<key>`, a key of
 * the typed client (`useAdminServices(qd)` lists those whose admin kit
 * answers this user).
 */
export default function AdminServicePage(): React.ReactElement {
  const params = useParams();
  const requested = typeof params.serviceName === "string" ? params.serviceName : "";
  const t = useTranslations("Admin");
  const { services, isLoading } = useAdminServices(qd);
  const service = services.find((candidate) => candidate.key === requested);

  if (service !== undefined) {
    // Keyed: another service's screen starts from its own first page
    return <AdminServiceScreen key={service.key} service={service} />;
  }
  if (isLoading) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  }
  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      <Alert severity="error">{t("serviceNotFound")}</Alert>
    </Box>
  );
}
