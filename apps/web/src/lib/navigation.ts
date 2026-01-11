import ChatIcon from "@mui/icons-material/Chat";
import HomeIcon from "@mui/icons-material/Home";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import type { SvgIconComponent } from "@mui/icons-material";

// ============================================================================
// Navigation Types
// ============================================================================

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: SvgIconComponent;
  children?: NavItem[];
  defaultExpanded?: boolean;
  requireAuth?: boolean;
  /** If true, children are loaded dynamically (e.g., recent chats) */
  dynamicChildren?: boolean;
}

export interface BreadcrumbItem {
  label: string;
  href: string;
  /** Sibling routes for dropdown navigation */
  siblings?: { label: string; href: string }[];
}

// ============================================================================
// Site Navigation Configuration
// ============================================================================

export const siteNavigation: NavItem[] = [
  {
    id: "home",
    label: "Home",
    href: "/",
    icon: HomeIcon,
    requireAuth: false,
  },
  {
    id: "chats",
    label: "Chats",
    href: "/chats",
    icon: ChatIcon,
    defaultExpanded: true,
    requireAuth: true,
    dynamicChildren: true, // Children loaded via useRecentChats
  },
];

/** User menu items (bottom of sidebar) */
export const userMenuItems: NavItem[] = [
  {
    id: "profile",
    label: "Profile",
    href: "/profile",
    icon: PersonIcon,
    requireAuth: true,
  },
  {
    id: "account",
    label: "Account",
    href: "/account",
    icon: SettingsIcon,
    requireAuth: true,
  },
];

// ============================================================================
// Navigation Helpers
// ============================================================================

/**
 * Find a nav item by its href (exact match or starts with for nested routes)
 */
export function findNavItemByHref(
  items: NavItem[],
  href: string
): NavItem | undefined {
  for (const item of items) {
    if (item.href === href) return item;
    if (item.children) {
      const found = findNavItemByHref(item.children, href);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Find the parent nav item for a given href
 */
export function findParentNavItem(
  items: NavItem[],
  href: string
): NavItem | undefined {
  for (const item of items) {
    if (item.children) {
      const childMatch = item.children.find((c) => c.href === href);
      if (childMatch) return item;
      const nested = findParentNavItem(item.children, href);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Build breadcrumbs from a pathname
 */
export function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [];

  // Always start with home
  if (pathname === "/") {
    breadcrumbs.push({
      label: "Home",
      href: "/",
      siblings: siteNavigation
        .filter((item) => item.href === "/" || !item.requireAuth)
        .map((item) => ({ label: item.label, href: item.href })),
    });
    return breadcrumbs;
  }

  // Split pathname into segments
  const segments = pathname.split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    currentPath += `/${segment}`;
    const navItem = findNavItemByHref(siteNavigation, currentPath);

    if (navItem) {
      // Find siblings at this level
      const parent = findParentNavItem(siteNavigation, currentPath);
      const siblingItems = parent?.children ?? siteNavigation;

      breadcrumbs.push({
        label: navItem.label,
        href: navItem.href,
        siblings: siblingItems.map((item) => ({
          label: item.label,
          href: item.href,
        })),
      });
    } else {
      // Dynamic segment (e.g., [chatId])
      // Label will be set by the page component
      breadcrumbs.push({
        label: segment,
        href: currentPath,
      });
    }
  }

  return breadcrumbs;
}

/**
 * Check if a route requires authentication
 */
export function routeRequiresAuth(pathname: string): boolean {
  // Check main navigation
  const navItem = findNavItemByHref(siteNavigation, pathname);
  if (navItem) return navItem.requireAuth ?? false;

  // Check user menu items
  const userItem = findNavItemByHref(userMenuItems, pathname);
  if (userItem) return userItem.requireAuth ?? false;

  // Check if any parent requires auth (for nested routes like /chats/[id])
  const segments = pathname.split("/").filter(Boolean);
  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const item = findNavItemByHref(siteNavigation, currentPath);
    if (item?.requireAuth) return true;
  }

  return false;
}
