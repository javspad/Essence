import { isDeveloperToolsEnabled } from "@essence/shared/devTools";

type EssenceEnvironment = {
  ESSENCE_DEV_TOOLS?: boolean | string;
};

export function developerToolsEnabled(): boolean {
  const value = (import.meta as unknown as { env?: EssenceEnvironment }).env?.ESSENCE_DEV_TOOLS;
  return isDeveloperToolsEnabled(value);
}
