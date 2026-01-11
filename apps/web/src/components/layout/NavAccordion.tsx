"use client";

import * as React from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Skeleton,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NavItem } from "../../lib/navigation";
import { useRecentChats } from "../../hooks";

interface NavAccordionProps {
  item: NavItem;
  onNavigate?: () => void;
}

// Navigation item IDs that have translations
const TRANSLATABLE_NAV_IDS = ["home", "chats", "profile", "account"];

export function NavAccordion({
  item,
  onNavigate,
}: NavAccordionProps): React.ReactElement {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const [expanded, setExpanded] = React.useState(item.defaultExpanded ?? false);

  // Load dynamic children (recent chats)
  const { chats, isLoading: isLoadingChats } = useRecentChats(3);

  // Get translated label for nav items, fall back to original label
  const getLabel = (navItem: NavItem): string => {
    if (TRANSLATABLE_NAV_IDS.includes(navItem.id)) {
      return t(navItem.id as "home" | "chats" | "profile" | "account");
    }
    return navItem.label;
  };

  // Build children array - either static children or dynamic from recent chats
  const children: NavItem[] = React.useMemo(() => {
    if (item.children) return item.children;
    if (item.dynamicChildren && item.id === "chats") {
      return chats.map((chat) => ({
        id: chat.id,
        label: chat.title,
        href: `/chats/${chat.id}`,
      }));
    }
    return [];
  }, [item.children, item.dynamicChildren, item.id, chats]);

  const hasChildren =
    children.length > 0 || (item.dynamicChildren && isLoadingChats);
  const isSelected = pathname === item.href;
  const isChildSelected = children.some((child) => pathname === child.href);

  const Icon = item.icon;

  // Simple nav item without children
  if (!hasChildren && !item.dynamicChildren) {
    return (
      <ListItem disablePadding>
        <ListItemButton
          component={Link}
          href={item.href}
          selected={isSelected}
          onClick={onNavigate}
          sx={{ borderRadius: 1 }}
        >
          {Icon && (
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Icon fontSize="small" />
            </ListItemIcon>
          )}
          <ListItemText primary={getLabel(item)} />
        </ListItemButton>
      </ListItem>
    );
  }

  // Accordion nav item with children
  return (
    <Accordion
      expanded={expanded}
      onChange={(_, isExpanded): void => {
        setExpanded(isExpanded);
      }}
      disableGutters
      elevation={0}
      sx={{
        bgcolor: "transparent",
        "&:before": { display: "none" },
        "& .MuiAccordionSummary-root": {
          minHeight: 48,
          px: 2,
          borderRadius: 1,
          "&:hover": { bgcolor: "action.hover" },
        },
        "& .MuiAccordionSummary-content": {
          my: 0,
        },
        "& .MuiAccordionDetails-root": {
          p: 0,
          pl: 2,
        },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          bgcolor:
            isSelected || isChildSelected ? "action.selected" : "transparent",
        }}
      >
        <ListItemButton
          component={Link}
          href={item.href}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onNavigate?.();
          }}
          sx={{
            p: 0,
            "&:hover": { bgcolor: "transparent" },
          }}
        >
          {Icon && (
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Icon fontSize="small" />
            </ListItemIcon>
          )}
          <ListItemText primary={getLabel(item)} />
        </ListItemButton>
      </AccordionSummary>
      <AccordionDetails>
        <List dense disablePadding>
          {item.dynamicChildren && isLoadingChats ? (
            <>
              <ListItem>
                <Skeleton variant="text" width="80%" />
              </ListItem>
              <ListItem>
                <Skeleton variant="text" width="60%" />
              </ListItem>
            </>
          ) : (
            children.map((child) => (
              <ListItem key={child.id} disablePadding>
                <ListItemButton
                  component={Link}
                  href={child.href}
                  selected={pathname === child.href}
                  onClick={onNavigate}
                  sx={{ borderRadius: 1, pl: 2 }}
                >
                  <ListItemText
                    primary={getLabel(child)}
                    primaryTypographyProps={{
                      variant: "body2",
                      noWrap: true,
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
      </AccordionDetails>
    </Accordion>
  );
}
