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
import { buildBreadcrumbs, type BreadcrumbItem } from "../../lib/navigation";
import { useLayout } from "../../providers";

interface BreadcrumbLinkProps {
  item: BreadcrumbItem;
  isLast: boolean;
}

function BreadcrumbLink({ item, isLast }: BreadcrumbLinkProps): React.ReactElement {
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

  // Last item without siblings - just text
  if (isLast && !hasSiblings) {
    return (
      <Typography color="text.primary" variant="body2">
        {item.label}
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
          {item.label}
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
          {item.siblings!.map((sibling) => (
            <MenuItem
              key={sibling.href}
              component={Link}
              href={sibling.href}
              onClick={handleClose}
              selected={sibling.href === item.href}
            >
              {sibling.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

export function Breadcrumbs(): React.ReactElement {
  const pathname = usePathname();
  const { pageTitle } = useLayout();

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
        />
      ))}
    </MuiBreadcrumbs>
  );
}
