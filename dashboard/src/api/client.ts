const BASE = "/api/admin";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (res.status === 401) {
    window.location.href = "/ui/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export type HealthData = {
  status: string;
  uptime: number;
  version: string;
  agent: string;
  role: { id: string; name: string };
  channels: Record<string, boolean>;
  memory: { qdrant: boolean; embeddings: boolean; configured: boolean };
  evolution: { generation: number };
  config: {
    name: string;
    model: string;
    effort: string;
    role: string;
  };
};

export type ConfigData = {
  name: string;
  model: string;
  effort: string;
  role: string;
  port: number;
  domain: string | null;
};

export type ModelInfo = {
  id: string;
  name: string;
  tier: string;
};

export const api = {
  getHealth: () => request<HealthData>("/health"),
  getConfig: () => request<ConfigData>("/config"),
  getModels: () => request<{ models: ModelInfo[] }>("/models"),
  updateConfig: (updates: { model?: string; effort?: string }) =>
    request<{ updated: Record<string, string>; restartRequired: boolean }>("/config", {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
  restart: () =>
    request<{ status: string; message: string }>("/restart", {
      method: "POST",
    }),
};
