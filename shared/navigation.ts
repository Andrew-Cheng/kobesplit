// Only application-owned paths are accepted, never a redirect URL from the query string.
export function signInDestination(pathname: string): string {
  if (/^\/(s|invite)\/[A-Za-z0-9_-]+\/?$/.test(pathname)) return pathname;
  return '/dashboard';
}
