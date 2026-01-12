"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  Paper,
  Skeleton,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslations } from "next-intl";
import type { AdminFieldConfig } from "@project/shared";

interface AdminTableProps {
  data: Record<string, unknown>[];
  columns: AdminFieldConfig[];
  isLoading: boolean;
  selectedId: string | null;
  onRowSelect: (id: string) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  sortField: string | null;
  sortDirection: "asc" | "desc";
  onSortChange: (field: string | null, direction: "asc" | "desc") => void;
}

/**
 * Format a cell value based on field type.
 */
function formatCellValue(
  value: unknown,
  field: AdminFieldConfig,
  t: (key: string) => string
): React.ReactNode {
  if (value === null || value === undefined) {
    return <Typography color="text.secondary" variant="body2">{t("noData")}</Typography>;
  }

  switch (field.type) {
    case "boolean":
      return value ? (
        <CheckIcon color="success" fontSize="small" />
      ) : (
        <CloseIcon color="error" fontSize="small" />
      );

    case "date":
      try {
        const date = new Date(value as string);
        return date.toLocaleString();
      } catch {
        return String(value);
      }

    case "json":
      return (
        <Typography
          variant="body2"
          sx={{
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {JSON.stringify(value)}
        </Typography>
      );

    case "string": {
      // Truncate long strings
      const strValue = String(value);
      if (strValue.length > 50) {
        return (
          <Typography
            variant="body2"
            sx={{
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={strValue}
          >
            {strValue}
          </Typography>
        );
      }
      return strValue;
    }

    default:
      return String(value);
  }
}

/**
 * Admin data table with sorting and pagination.
 */
export function AdminTable({
  data,
  columns,
  isLoading,
  selectedId,
  onRowSelect,
  page,
  pageSize,
  total,
  onPageChange,
  sortField,
  sortDirection,
  onSortChange,
}: AdminTableProps): React.ReactElement {
  const t = useTranslations("Common");
  const tAdmin = useTranslations("Admin");

  const handleSort = (field: string) => {
    if (sortField === field) {
      // Toggle direction
      onSortChange(field, sortDirection === "asc" ? "desc" : "asc");
    } else {
      // New field, default to ascending
      onSortChange(field, "asc");
    }
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    onPageChange(newPage + 1); // MUI uses 0-indexed pages
  };

  // Loading skeleton
  if (isLoading && data.length === 0) {
    return (
      <Paper sx={{ width: "100%", overflow: "hidden" }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((col) => (
                  <TableCell key={col.name}>
                    <Skeleton variant="text" width={80} />
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {[1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.name}>
                      <Skeleton variant="text" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    );
  }

  // Empty state
  if (!isLoading && data.length === 0) {
    return (
      <Paper sx={{ width: "100%", p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">{tAdmin("noEntries")}</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <TableContainer sx={{ flex: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.name}
                  sortDirection={sortField === col.name ? sortDirection : false}
                  sx={{
                    fontWeight: 600,
                    bgcolor: "background.paper",
                  }}
                >
                  {col.sortable ? (
                    <TableSortLabel
                      active={sortField === col.name}
                      direction={sortField === col.name ? sortDirection : "asc"}
                      onClick={(): void => {
                        handleSort(col.name);
                      }}
                    >
                      {col.label}
                    </TableSortLabel>
                  ) : (
                    col.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row) => {
              const id = row.id as string;
              const isSelected = selectedId === id;
              return (
                <TableRow
                  key={id}
                  hover
                  onClick={(): void => {
                    onRowSelect(id);
                  }}
                  selected={isSelected}
                  sx={{
                    cursor: "pointer",
                    "&.Mui-selected": {
                      bgcolor: "action.selected",
                    },
                    "&.Mui-selected:hover": {
                      bgcolor: "action.selected",
                    },
                  }}
                >
                  {columns.map((col) => (
                    <TableCell key={col.name}>
                      {formatCellValue(row[col.name], col, t)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={total}
        page={page - 1} // MUI uses 0-indexed pages
        onPageChange={handleChangePage}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[10, 20, 50]}
        onRowsPerPageChange={() => {
          // This would need setPageSize in props - for now we keep it simple
        }}
        labelRowsPerPage={tAdmin("rowsPerPage")}
        sx={{ borderTop: 1, borderColor: "divider" }}
      />
    </Paper>
  );
}
