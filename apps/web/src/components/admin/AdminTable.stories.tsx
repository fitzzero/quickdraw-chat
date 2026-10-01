import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AdminFieldConfig } from "@project/shared";
import { fn } from "storybook/test";
import { AdminTable } from "./AdminTable";

const COLUMNS: AdminFieldConfig[] = [
  {
    name: "id",
    type: "string",
    label: "ID",
    required: false,
    editable: false,
    showInTable: true,
    sortable: false,
  },
  {
    name: "name",
    type: "string",
    label: "Name",
    required: true,
    editable: true,
    showInTable: true,
    sortable: true,
  },
  {
    name: "email",
    type: "string",
    label: "Email",
    required: true,
    editable: true,
    showInTable: true,
    sortable: true,
  },
  {
    name: "isAdmin",
    type: "boolean",
    label: "Admin",
    required: false,
    editable: true,
    showInTable: true,
    sortable: true,
  },
  {
    name: "createdAt",
    type: "date",
    label: "Created",
    required: false,
    editable: false,
    showInTable: true,
    sortable: true,
  },
];

const ROWS: Record<string, unknown>[] = [
  {
    id: "user-ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    isAdmin: true,
    createdAt: "2026-08-01T09:15:00.000Z",
  },
  {
    id: "user-grace",
    name: "Grace Hopper",
    email: "grace@example.com",
    isAdmin: false,
    createdAt: "2026-08-03T14:30:00.000Z",
  },
  {
    id: "user-alan",
    name: "Alan Turing",
    email: "alan@example.com",
    isAdmin: false,
    createdAt: "2026-08-10T11:00:00.000Z",
  },
];

const meta = {
  title: "Admin/AdminTable",
  component: AdminTable,
  args: {
    data: ROWS,
    columns: COLUMNS,
    isLoading: false,
    selectedId: null,
    onRowSelect: fn(),
    page: 0,
    pageSize: 25,
    total: ROWS.length,
    onPageChange: fn(),
    sortField: "createdAt",
    sortDirection: "desc",
    onSortChange: fn(),
  },
} satisfies Meta<typeof AdminTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RowSelected: Story = {
  args: { selectedId: "user-grace" },
};

export const Loading: Story = {
  args: { data: [], isLoading: true },
};

export const Empty: Story = {
  args: { data: [], total: 0 },
};
