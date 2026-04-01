import { useCallback } from "react";
import { api, type HealthData } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { usePolling } from "../hooks/usePolling";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function Overview() {
  const fetcher = useCallback(() => api.getHealth(), []);
  const { data, error, loading } = usePolling<HealthData>(fetcher, 30000);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="flex items-center gap-2 text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="alert alert-error">
          <span>Failed to load: {error}</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <StatusBadge status={data.status} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Agent" value={data.agent} />
        <StatCard label="Model" value={data.config?.model ?? "unknown"} />
        <StatCard label="Uptime" value={formatUptime(data.uptime)} />
        <StatCard label="Evolution" value={`Gen ${data.evolution.generation}`} />
      </div>

      {/* Channels */}
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body p-5">
          <h2 className="card-title text-sm font-semibold uppercase tracking-wider text-base-content/60">
            Channels
          </h2>
          <div className="flex flex-wrap gap-3 mt-2">
            {Object.entries(data.channels).map(([name, healthy]) => (
              <div key={name} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${healthy ? "bg-success" : "bg-error"}`} />
                <span className="text-sm capitalize">{name}</span>
              </div>
            ))}
            {Object.keys(data.channels).length === 0 && (
              <span className="text-sm text-base-content/40">No channels configured</span>
            )}
          </div>
        </div>
      </div>

      {/* Memory */}
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body p-5">
          <h2 className="card-title text-sm font-semibold uppercase tracking-wider text-base-content/60">
            Memory
          </h2>
          <div className="flex flex-wrap gap-3 mt-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${data.memory.qdrant ? "bg-success" : "bg-error"}`} />
              <span className="text-sm">Qdrant</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${data.memory.embeddings ? "bg-success" : "bg-error"}`} />
              <span className="text-sm">Embeddings</span>
            </div>
          </div>
        </div>
      </div>

      {/* Config summary */}
      {data.config && (
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-5">
            <h2 className="card-title text-sm font-semibold uppercase tracking-wider text-base-content/60">
              Configuration
            </h2>
            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
              <span className="text-base-content/60">Role</span>
              <span>{data.config.role}</span>
              <span className="text-base-content/60">Effort</span>
              <span>{data.config.effort}</span>
              <span className="text-base-content/60">Version</span>
              <span className="font-mono text-xs">{data.version}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card bg-base-200 border border-base-300">
      <div className="card-body p-4">
        <span className="text-xs font-medium uppercase tracking-wider text-base-content/50">
          {label}
        </span>
        <span className="text-lg font-semibold mt-1 truncate">{value}</span>
      </div>
    </div>
  );
}
