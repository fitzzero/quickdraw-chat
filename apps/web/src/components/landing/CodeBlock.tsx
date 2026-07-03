"use client";

import * as React from "react";
import { Box } from "@mui/material";

// ============================================================================
// CodeBlock — a deliberately tiny, dependency-free syntax highlighter.
//
// The landing dialogs show short, CURATED snippets (we control every string
// that passes through here), so a full grammar is overkill: one ordered
// regex alternation per language covers comments, strings, keywords,
// numbers, and types well enough to read like the editor. Tokyo-night
// token colors to match the theme.
// ============================================================================

export type SnippetLanguage = "ts" | "json" | "yaml" | "bash";

const COLORS = {
  comment: "#565f89",
  string: "#9ece6a",
  keyword: "#bb9af7",
  number: "#ff9e64",
  type: "#7dcfff",
  fn: "#7aa2f7",
  plain: "#c0caf5",
} as const;

type TokenKind = keyof typeof COLORS;

interface TokenRule {
  kind: TokenKind;
  pattern: string;
}

const TS_RULES: TokenRule[] = [
  { kind: "comment", pattern: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` },
  {
    kind: "string",
    pattern: String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60`,
  },
  {
    kind: "keyword",
    pattern: String.raw`\b(?:async|await|const|let|return|if|else|for|of|new|throw|this|import|from|export|protected|private|public|override|function|void|typeof|as)\b`,
  },
  { kind: "number", pattern: String.raw`\b\d[\d_.]*\b` },
  { kind: "type", pattern: String.raw`\b[A-Z][A-Za-z0-9]*\b` },
  { kind: "fn", pattern: String.raw`\b[a-z_$][A-Za-z0-9_$]*(?=\()` },
];

const JSON_RULES: TokenRule[] = [
  // JSONC: curated snippets may carry explanatory comments
  { kind: "comment", pattern: String.raw`\/\/[^\n]*` },
  { kind: "type", pattern: String.raw`"(?:[^"\\]|\\.)*"(?=\s*:)` },
  { kind: "string", pattern: String.raw`"(?:[^"\\]|\\.)*"` },
  { kind: "number", pattern: String.raw`\b\d[\d.]*\b` },
  { kind: "keyword", pattern: String.raw`\b(?:true|false|null)\b` },
];

const YAML_RULES: TokenRule[] = [
  { kind: "comment", pattern: String.raw`#[^\n]*` },
  { kind: "type", pattern: String.raw`^\s*-?\s*[\w.-]+(?=:)` },
  { kind: "string", pattern: String.raw`"(?:[^"\\]|\\.)*"|'[^']*'` },
  { kind: "keyword", pattern: String.raw`\$\{\{[^}]*\}\}` },
  { kind: "number", pattern: String.raw`\b\d[\d.]*\b` },
];

const BASH_RULES: TokenRule[] = [
  { kind: "comment", pattern: String.raw`#[^\n]*` },
  { kind: "string", pattern: String.raw`"(?:[^"\\]|\\.)*"|'[^']*'` },
  {
    kind: "keyword",
    pattern: String.raw`(?:^|\n)\s*(?:\.\/[\w./-]+|git|cd|bun|node|docker-compose)\b`,
  },
  { kind: "type", pattern: String.raw`--[\w-]+|<[\w-]+>|\[[\w@ -]+\]` },
];

const LANGUAGE_RULES: Record<SnippetLanguage, TokenRule[]> = {
  ts: TS_RULES,
  json: JSON_RULES,
  yaml: YAML_RULES,
  bash: BASH_RULES,
};

interface Token {
  kind: TokenKind;
  text: string;
}

/** Tokenize with one combined alternation; unmatched spans fall to "plain". */
function tokenize(code: string, language: SnippetLanguage): Token[] {
  const rules = LANGUAGE_RULES[language];
  const combined = new RegExp(rules.map((rule) => `(${rule.pattern})`).join("|"), "gm");
  const tokens: Token[] = [];
  let lastIndex = 0;

  for (const match of code.matchAll(combined)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: "plain", text: code.slice(lastIndex, index) });
    }
    const groupIndex = match.slice(1).findIndex((group) => group !== undefined);
    const rule = rules[groupIndex];
    tokens.push({ kind: rule?.kind ?? "plain", text: match[0] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < code.length) {
    tokens.push({ kind: "plain", text: code.slice(lastIndex) });
  }
  return tokens;
}

interface CodeBlockProps {
  code: string;
  language: SnippetLanguage;
}

export function CodeBlock({ code, language }: CodeBlockProps): React.ReactElement {
  const tokens = React.useMemo(() => tokenize(code, language), [code, language]);

  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 2.5,
        overflowX: "auto",
        fontFamily: "var(--font-mono), monospace",
        fontSize: 13,
        lineHeight: 1.65,
        color: COLORS.plain,
      }}
    >
      <code>
        {tokens.map((token, index) => (
          <Box key={index} component="span" sx={{ color: COLORS[token.kind] }}>
            {token.text}
          </Box>
        ))}
      </code>
    </Box>
  );
}
