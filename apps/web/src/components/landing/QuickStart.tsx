"use client";

import * as React from "react";
import { Box, Container, Link as MuiLink, Stack, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { CORE_NPM_URL, GITHUB_URL } from "../../lib/site";
import { TerminalFrame } from "./TerminalFrame";

const CLONE_COMMANDS = [
  "git clone https://github.com/fitzzero/quickdraw-chat my-app",
  "cd my-app && docker-compose up -d",
  "bun install && bun run db:migrate && bun run db:seed",
  "bun run dev",
];

const FORK_COMMAND = "./scripts/init-fork.sh my-app --scope @my";

function TerminalPaper({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TerminalFrame>
      <Box sx={{ p: 2.5, fontFamily: "var(--font-mono), monospace", fontSize: 14 }}>{children}</Box>
    </TerminalFrame>
  );
}

function CommandLine({ command }: { command: string }): React.ReactElement {
  return (
    <Box sx={{ display: "flex", gap: 1.25, py: 0.5, overflowX: "auto" }}>
      <Box component="span" sx={{ color: "primary.light", userSelect: "none" }}>
        {"$"}
      </Box>
      <Box component="code" sx={{ color: "text.primary", whiteSpace: "nowrap" }}>
        {command}
      </Box>
    </Box>
  );
}

export function QuickStart(): React.ReactElement {
  const t = useTranslations("Landing");

  return (
    <Container maxWidth="md" sx={{ pb: { xs: 6, md: 10 } }}>
      <Typography variant="overline" color="primary.light" sx={{ display: "block" }}>
        {t("quickStartOverline")}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 4 }}>
        {t("quickStartTitle")}
      </Typography>

      <TerminalPaper>
        {CLONE_COMMANDS.map((command) => (
          <CommandLine key={command} command={command} />
        ))}
        <Box sx={{ color: "text.secondary", pt: 2, pb: 0.5 }}>
          <Typography variant="body2" sx={{ fontFamily: "inherit" }}>
            {t("quickStartForkHint")}
          </Typography>
        </Box>
        <CommandLine command={FORK_COMMAND} />
      </TerminalPaper>

      <Stack direction="row" spacing={3} justifyContent="center" sx={{ mt: 5 }}>
        <MuiLink
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          color="text.secondary"
          underline="hover"
          variant="body2"
        >
          {t("footerGitHub")}
        </MuiLink>
        <MuiLink
          href={CORE_NPM_URL}
          target="_blank"
          rel="noopener noreferrer"
          color="text.secondary"
          underline="hover"
          variant="body2"
        >
          {t("footerCore")}
        </MuiLink>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", textAlign: "center", mt: 1.5 }}
      >
        {t("footerNote")}
      </Typography>
    </Container>
  );
}
