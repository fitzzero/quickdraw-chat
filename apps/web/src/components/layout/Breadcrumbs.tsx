"use client";

import * as React from "react";
import {
  Breadcrumbs as MuiBreadcrumbs,
  Typography,
  Menu,
  MenuItem,
  ButtonBase,
} from "@mui/material";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildBreadcrumbs, type BreadcrumbItem } from "../../lib/navigation";
import { useLayout } from "../../providers";

// Navigation labels that have translations (matches Nav namespace keys)
const TRANSLATABLE_LABELS: Record<string, string> = {
  Home: "home",
  Chats: "chats",
  Profile: "profile",
  Account: "account",
};

interface BreadcrumbLinkProps {
  item: BreadcrumbItem;
  isLast: boolean;
  translateLabel: (label: string) => string;
}

function BreadcrumbLink({
  item,
  isLast,
  translateLabel,
}: BreadcrumbLinkProps): React.ReactElement {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const hasSiblings = item.siblings && item.siblings.length > 1;

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    if (hasSiblings) {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const translatedLabel = translateLabel(item.label);

  // Last item without siblings - just text
  if (isLast && !hasSiblings) {
    return (
      <Typography color="text.primary" variant="body2">
        {translatedLabel}
      </Typography>
    );
  }

  // Clickable with dropdown
  return (
    <>
      <ButtonBase
        onClick={handleOpen}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Typography
          component={hasSiblings ? "span" : Link}
          href={hasSiblings ? undefined : item.href}
          variant="body2"
          color={isLast ? "text.primary" : "text.secondary"}
          sx={{
            textDecoration: "none",
            "&:hover": { textDecoration: hasSiblings ? "none" : "underline" },
          }}
        >
          {translatedLabel}
        </Typography>
        {hasSiblings && (
          <ExpandMoreIcon
            fontSize="small"
            sx={{ color: "text.secondary", fontSize: 18 }}
          />
        )}
      </ButtonBase>

      {hasSiblings && (
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        >
          {item.siblings?.map((sibling) => (
            <MenuItem
              key={sibling.href}
              component={Link}
              href={sibling.href}
              onClick={handleClose}
              selected={sibling.href === item.href}
            >
              {translateLabel(sibling.label)}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

export function Breadcrumbs(): React.ReactElement {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const { pageTitle } = useLayout();

  // Translate label if it's a known navigation label
  const translateLabel = React.useCallback(
    (label: string): string => {
      const key = TRANSLATABLE_LABELS[label];
      if (key) {
        return t(key as "home" | "chats" | "profile" | "account");
      }
      return label;
    },
    [t]
  );

  const items = React.useMemo(() => {
    const breadcrumbs = buildBreadcrumbs(pathname);

    // Replace last item's label with pageTitle if set (for dynamic pages)
    if (pageTitle && breadcrumbs.length > 0) {
      const lastIndex = breadcrumbs.length - 1;
      breadcrumbs[lastIndex] = {
        ...breadcrumbs[lastIndex],
        label: pageTitle,
      };
    }

    return breadcrumbs;
  }, [pathname, pageTitle]);

  return (
    <MuiBreadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      sx={{ "& .MuiBreadcrumbs-separator": { mx: 0.5 } }}
    >
      {items.map((item, index) => (
        <BreadcrumbLink
          key={item.href}
          item={item}
          isLast={index === items.length - 1}
          translateLabel={translateLabel}
        />
      ))}
    </MuiBreadcrumbs>
  );
}
