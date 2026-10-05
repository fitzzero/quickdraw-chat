"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { QuickdrawError } from "@fitzzero/quickdraw-core";

/** The first problem a `VALIDATION` error names (the schema's own message), if any. */
function firstIssue(error: QuickdrawError): string | undefined {
  const { data } = error;
  if (typeof data !== "object" || data === null || !("issues" in data)) return undefined;
  const { issues } = data;
  if (!Array.isArray(issues)) return undefined;
  const [issue]: unknown[] = issues;
  if (typeof issue !== "object" || issue === null || !("message" in issue)) return undefined;
  return typeof issue.message === "string" ? issue.message : undefined;
}

/**
 * Turns a failed call into a sentence for people, by its code: the same
 * wording wherever a mutation or a read fails (`FORBIDDEN`, `VALIDATION`
 * with the schema's message, `RATE_LIMITED`, ...). Anything that is not a
 * `QuickdrawError` (a `catch` block's error) reads as the generic sentence.
 *
 * @example
 * const errorText = useErrorText();
 * {rename.error && <FormHelperText error>{errorText(rename.error)}</FormHelperText>}
 */
export function useErrorText(): (error: unknown) => string {
  const t = useTranslations("Errors");
  return React.useCallback(
    (error: unknown): string => {
      if (!(error instanceof QuickdrawError)) return t("generic");
      switch (error.code) {
        case "UNAUTHENTICATED":
          return t("unauthenticated");
        case "FORBIDDEN":
          return t("forbidden");
        case "NOT_FOUND":
          return t("notFound");
        case "CONFLICT":
          return t("conflict");
        case "VALIDATION": {
          const detail = firstIssue(error);
          return detail === undefined ? t("validationGeneric") : t("validation", { detail });
        }
        case "RATE_LIMITED":
          return t("rateLimited");
        case "TIMEOUT":
          return t("timeout");
        default:
          return t("generic");
      }
    },
    [t],
  );
}
