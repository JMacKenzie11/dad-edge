"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Client-side context for the current "view" within a page.
 *
 * Most pages have a single view — the URL is enough to resolve
 * help content. The ITC map canvas is the exception: the URL is
 * `/itc/[mapId]` for every stage, so we need a client-side signal
 * to tell the Help widget which stage's content to serve.
 *
 * Consumers:
 *   - Reader:  HelpWidget reads currentView on open + on change.
 *   - Writer:  ITC map-canvas sets currentView = map.current_stage
 *              when the active stage changes.
 *
 * Default null = "no override, use the URL alone".
 */

type CurrentHelpViewShape = {
  currentView: string | null;
  setCurrentView: (v: string | null) => void;
};

const CurrentHelpViewContext = createContext<CurrentHelpViewShape>({
  currentView: null,
  setCurrentView: () => {},
});

export function CurrentHelpViewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentView, setCurrentView] = useState<string | null>(null);
  const value = useMemo(
    () => ({ currentView, setCurrentView }),
    [currentView],
  );
  return (
    <CurrentHelpViewContext.Provider value={value}>
      {children}
    </CurrentHelpViewContext.Provider>
  );
}

export function useCurrentHelpView(): CurrentHelpViewShape {
  return useContext(CurrentHelpViewContext);
}
