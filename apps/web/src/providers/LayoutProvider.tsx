"use client";

import * as React from "react";

// ============================================================================
// Layout Context Types
// ============================================================================

interface LayoutContextValue {
  /** Content to render in the right sidebar */
  rightSidebar: React.ReactNode;
  /** Set the right sidebar content (call with null to clear) */
  setRightSidebar: (node: React.ReactNode) => void;
  /** Whether left sidebar drawer is open (mobile only) */
  leftDrawerOpen: boolean;
  /** Toggle left drawer */
  setLeftDrawerOpen: (open: boolean) => void;
  /** Whether right sidebar drawer is open (mobile only) */
  rightDrawerOpen: boolean;
  /** Toggle right drawer */
  setRightDrawerOpen: (open: boolean) => void;
  /** Current page title for breadcrumbs (set by pages for dynamic titles) */
  pageTitle: string | null;
  /** Set the current page title */
  setPageTitle: (title: string | null) => void;
}

const LayoutContext = React.createContext<LayoutContextValue | null>(null);

// ============================================================================
// Layout Provider
// ============================================================================

interface LayoutProviderProps {
  children: React.ReactNode;
}

export function LayoutProvider({ children }: LayoutProviderProps): React.ReactElement {
  const [rightSidebar, setRightSidebar] = React.useState<React.ReactNode>(null);
  const [leftDrawerOpen, setLeftDrawerOpen] = React.useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = React.useState(false);
  const [pageTitle, setPageTitle] = React.useState<string | null>(null);

  const value = React.useMemo<LayoutContextValue>(
    () => ({
      rightSidebar,
      setRightSidebar,
      leftDrawerOpen,
      setLeftDrawerOpen,
      rightDrawerOpen,
      setRightDrawerOpen,
      pageTitle,
      setPageTitle,
    }),
    [rightSidebar, leftDrawerOpen, rightDrawerOpen, pageTitle]
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useLayout(): LayoutContextValue {
  const context = React.useContext(LayoutContext);
  if (!context) {
    throw new Error("useLayout must be used within a LayoutProvider");
  }
  return context;
}

/**
 * Hook to set the right sidebar content for a page.
 * Automatically clears on unmount.
 */
export function useRightSidebar(content: React.ReactNode): void {
  const { setRightSidebar } = useLayout();

  React.useEffect(() => {
    setRightSidebar(content);
    return () => {
      setRightSidebar(null);
    };
  }, [content, setRightSidebar]);
}

/**
 * Hook to set the page title for breadcrumbs (for dynamic pages like /chats/[id]).
 * Automatically clears on unmount.
 */
export function usePageTitle(title: string | null): void {
  const { setPageTitle } = useLayout();

  React.useEffect(() => {
    setPageTitle(title);
    return () => {
      setPageTitle(null);
    };
  }, [title, setPageTitle]);
}
