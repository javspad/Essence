export function sameOriginReturnRoute(candidate: string | null | undefined, origin: string): string | undefined {
  if (!candidate) return undefined;

  try {
    const route = new URL(candidate, origin);
    if (route.origin !== origin) return undefined;
    return `${route.pathname}${route.search}${route.hash}`;
  } catch {
    return undefined;
  }
}
