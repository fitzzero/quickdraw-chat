"use client";

import * as React from "react";
import createCache from "@emotion/cache";
import { useServerInsertedHTML } from "next/navigation";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "../theme";

interface ThemeProviderProps {
  children: React.ReactNode;
}

function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const [cache] = React.useState(() => {
    const c = createCache({ key: "mui" });
    c.compat = true;
    return c;
  });

  useServerInsertedHTML(() => {
    const names = Object.keys(cache.inserted);
    if (names.length === 0) return null;

    let styles = "";
    for (const name of names) {
      if (typeof cache.inserted[name] === "string") {
        styles += cache.inserted[name];
      }
    }

    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(" ")}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return <CacheProvider value={cache}>{children}</CacheProvider>;
}

export function ThemeProvider({
  children,
}: ThemeProviderProps): React.ReactElement {
  return (
    <ThemeRegistry>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeRegistry>
  );
}
