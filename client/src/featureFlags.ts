type EssenceEnvironment = {
  ESSENCE_PRODUCTION?: boolean | string;
};

export function isProductionMode(): boolean {
  const value = (import.meta as unknown as { env?: EssenceEnvironment }).env?.ESSENCE_PRODUCTION;
  return value === true || value === "true";
}

