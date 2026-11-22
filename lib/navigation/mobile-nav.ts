export interface MobileTabState {
  isExactPage: boolean;
  isActiveSection: boolean;
}

/**
 * Determines whether the persistent mobile bottom navigation bar should render.
 * Shown across all primary discovery, catalog, library, profile, search, legal,
 * AND product detail pages (/books/[slug], /exams/[slug]).
 * Hidden strictly on full-screen document reader (/read/*) and active CBT workstation (/attempt/*) routes.
 */
export function shouldShowMobileBottomNav(pathname: string): boolean {
  const clean = (pathname || '/').trim() || '/';
  if (clean === '/read' || clean.startsWith('/read/')) {
    return false;
  }
  if (clean === '/attempt' || clean.startsWith('/attempt/')) {
    return false;
  }
  return true;
}

/**
 * Resolves exact-page aria-current state and section-level visual highlight state
 * for each mobile bottom navigation destination.
 */
export function resolveMobileTabState(
  pathname: string,
  tabHref: string
): MobileTabState {
  const clean = (pathname || '/').trim() || '/';
  const isExactPage = clean === tabHref;
  const isActiveSection =
    tabHref === '/'
      ? clean === '/'
      : clean === tabHref || clean.startsWith(`${tabHref}/`);

  return {
    isExactPage,
    isActiveSection,
  };
}
