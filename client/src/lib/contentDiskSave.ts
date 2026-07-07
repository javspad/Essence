export interface ContentDiskSaveResult {
  path: string;
  bytes: number;
  warnings: string[];
}

interface ContentDiskSaveResponse {
  ok?: boolean;
  path?: string;
  bytes?: number;
  warnings?: string[];
  error?: string;
  errors?: string[];
}

export async function saveContentJsonToDisk(exportJson: string): Promise<ContentDiskSaveResult> {
  const response = await fetch("/api/dev/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: exportJson,
  });
  const text = await response.text();
  const payload = parseSaveResponse(text);

  if (!response.ok || !payload.ok) {
    const details = payload.errors?.length ? ` ${payload.errors.join(" ")}` : "";
    throw new Error(`${payload.error ?? `Save failed with ${response.status}`}.${details}`);
  }

  return {
    path: payload.path ?? "",
    bytes: payload.bytes ?? 0,
    warnings: payload.warnings ?? [],
  };
}

function parseSaveResponse(text: string): ContentDiskSaveResponse {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as ContentDiskSaveResponse;
  } catch {
    return { error: text };
  }
}
