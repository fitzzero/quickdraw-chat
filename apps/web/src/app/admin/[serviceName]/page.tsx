"use client";

import * as React from "react";
import { Box, Typography, Button, CircularProgress, Alert } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSocket } from "../../../providers";
import { useRightSidebar, usePageTitle } from "../../../providers/LayoutProvider";
import { AdminTable } from "../../../components/admin/AdminTable";
import { AdminEntitySidebar } from "../../../components/admin/AdminEntitySidebar";
import { AdminCreateModal } from "../../../components/admin/AdminCreateModal";
import { useAdminList } from "../../../hooks/useAdminList";
import { useAdminMeta } from "../../../hooks/useAdminMeta";

/**
 * Generic admin page for any service.
 * Displays a paginated table with entity management.
 */
export default function AdminServicePage(): React.ReactElement {
  const params = useParams();
  const serviceName = params.serviceName as string;
  const t = useTranslations("Admin");
  useSocket(); // Ensure socket is connected

  // Fetch service metadata
  const { meta, isLoading: metaLoading, error: metaError } = useAdminMeta(serviceName);

  // Admin list state
  const {
    data,
    isLoading,
    error,
    page,
    pageSize,
    sortField,
    sortDirection,
    setPage,
    setSort,
    refresh,
  } = useAdminList(serviceName, meta);

  // Selected entity for sidebar
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);

  // Set page title
  usePageTitle(meta?.displayName ?? serviceName);

  // Right sidebar content
  const sidebarContent = React.useMemo(() => {
    if (!selectedId || !meta) return null;
    return (
      <AdminEntitySidebar
        serviceName={serviceName}
        entryId={selectedId}
        meta={meta}
        onClose={(): void => {
          setSelectedId(null);
        }}
        onDeleted={(): void => {
          setSelectedId(null);
          refresh();
        }}
      />
    );
  }, [selectedId, serviceName, meta, refresh]);

  useRightSidebar(sidebarContent);

  // Handle row selection
  const handleRowSelect = React.useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  // Handle create success
  const handleCreateSuccess = React.useCallback(() => {
    setCreateModalOpen(false);
    refresh();
  }, [refresh]);

  // Loading state
  if (metaLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 300,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // Error state
  if (metaError ?? !meta) {
    return (
      <Box sx={{ maxWidth: 800, mx: "auto" }}>
        <Alert severity="error">
          {metaError ?? t("serviceNotFound")}
        </Alert>
      </Box>
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
          {data && (
            <Typography variant="body2" color="text.secondary">
              {t("totalEntries", { count: data.total })}
            </Typography>
          )}
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={(): void => {
            setCreateModalOpen(true);
          }}
        >
          {t("addNew")}
        </Button>
      </Box>

      {/* Error alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Table */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <AdminTable
          data={data?.items ?? []}
          columns={meta.fields.filter((f) => f.showInTable)}
          isLoading={isLoading}
          selectedId={selectedId}
          onRowSelect={handleRowSelect}
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          onPageChange={setPage}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortChange={setSort}
        />
      </Box>

      {/* Create Modal */}
      <AdminCreateModal
        open={createModalOpen}
        onClose={(): void => {
          setCreateModalOpen(false);
        }}
        serviceName={serviceName}
        meta={meta}
        onSuccess={handleCreateSuccess}
      />
    </Box>
  );
}
