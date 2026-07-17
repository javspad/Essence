export function isDeveloperToolsEnabled(value: unknown): boolean {
  return value === true || value === "1" || value === "true";
}
