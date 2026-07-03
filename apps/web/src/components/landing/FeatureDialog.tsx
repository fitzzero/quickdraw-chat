"use client";

import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import GitHubIcon from "@mui/icons-material/GitHub";
import type { SvgIconComponent } from "@mui/icons-material";
import { useTranslations } from "next-intl";
import { GITHUB_URL } from "../../lib/site";
import { CodeBlock } from "./CodeBlock";
import { TerminalFrame } from "./TerminalFrame";
import type { FeatureSnippet } from "./featureSnippets";

interface FeatureDialogProps {
  /** Feature key (e.g. "featRealtime") — resolves title/detail copy. */
  featureKey: string | null;
  icon?: SvgIconComponent;
  accent?: string;
  snippet?: FeatureSnippet;
  onClose: () => void;
}

function sourceUrl(snippet: FeatureSnippet): string {
  const base = `${GITHUB_URL}/blob/main/${snippet.path}`;
  return snippet.lines ? `${base}#L${snippet.lines[0]}-L${snippet.lines[1]}` : base;
}

/**
 * "README-style" feature deep-dive: the card's story next to the actual
 * code from this repo, with a deep link to the source on GitHub.
 */
export function FeatureDialog(props: FeatureDialogProps): React.ReactElement {
  const t = useTranslations("Landing");
  const tCommon = useTranslations("Common");
  const { featureKey, icon: Icon, accent, snippet } = props;

  return (
    <Dialog open={featureKey !== null} onClose={props.onClose} maxWidth="md">
      {featureKey !== null && snippet && (
        <>
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            {Icon && <Icon sx={{ color: accent }} />}
            {t(`${featureKey}Title`)}
          </DialogTitle>
          <DialogContent>
            <Typography color="text.secondary" sx={{ mb: 2.5 }}>
              {t(`${featureKey}Detail`)}
            </Typography>
            <TerminalFrame>
              <CodeBlock code={snippet.code} language={snippet.language} />
            </TerminalFrame>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1.5, fontFamily: "var(--font-mono), monospace" }}
            >
              {snippet.path}
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={props.onClose} color="inherit">
              {tCommon("close")}
            </Button>
            <Button
              component="a"
              href={sourceUrl(snippet)}
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
              startIcon={<GitHubIcon />}
            >
              {t("viewSource")}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
