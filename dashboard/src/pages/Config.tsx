import { useCallback, useEffect, useState } from "react";
import { api, type ConfigData, type ModelInfo } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { usePolling } from "../hooks/usePolling";

export function Config() {
  const configFetcher = useCallback(() => api.getConfig(), []);
  const { data: config, loading, error, refresh } = usePolling<ConfigData>(configFetcher, 60000);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState("");
  const [saving, setSaving] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.getModels().then(({ models }) => setModels(models)).catch(() => {});
  }, []);

  useEffect(() => {
    if (config) {
      setSelectedModel(config.model);
      setSelectedEffort(config.effort);
    }
  }, [config]);

  const hasChanges = config && (selectedModel !== config.model || selectedEffort !== config.effort);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const updates: Record<string, string> = {};
      if (config && selectedModel !== config.model) updates.model = selectedModel;
      if (config && selectedEffort !== config.effort) updates.effort = selectedEffort;

      const result = await api.updateConfig(updates);
      if (result.restartRequired) {
        setPendingChanges(true);
      }
      setMessage({ type: "success", text: "Config saved. Restart to apply changes." });
      refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRestart() {
    setShowRestart(false);
    setMessage(null);
    try {
      await api.restart();
      setMessage({ type: "success", text: "Restarting... page will reload shortly." });
      setPendingChanges(false);
      setTimeout(() => window.location.reload(), 5000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Restart failed" });
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Configuration</h1>
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
        <h1 className="text-2xl font-bold">Configuration</h1>
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Configuration</h1>
        {pendingChanges && (
          <button className="btn btn-warning btn-sm" onClick={() => setShowRestart(true)}>
            Restart Required
          </button>
        )}
      </div>

      {message && (
        <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`}>
          <span>{message.text}</span>
        </div>
      )}

      <div className="card bg-base-200 border border-base-300">
        <div className="card-body p-5 space-y-4">
          <h2 className="card-title text-sm font-semibold uppercase tracking-wider text-base-content/60">
            Runtime Settings
          </h2>

          {/* Model selector */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Model</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.tier})
                </option>
              ))}
              {models.length === 0 && <option>{selectedModel}</option>}
            </select>
          </div>

          {/* Effort selector */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Effort</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={selectedEffort}
              onChange={(e) => setSelectedEffort(e.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>

          {/* Read-only fields */}
          <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-base-300">
            <span className="text-base-content/60">Name</span>
            <span className="font-mono">{config?.name}</span>
            <span className="text-base-content/60">Role</span>
            <span>{config?.role}</span>
            <span className="text-base-content/60">Port</span>
            <span className="font-mono">{config?.port}</span>
            <span className="text-base-content/60">Domain</span>
            <span className="font-mono">{config?.domain ?? "none"}</span>
          </div>

          {/* Save button */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              className="btn btn-primary btn-sm"
              disabled={!hasChanges || saving}
              onClick={handleSave}
            >
              {saving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Restart card */}
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body p-5">
          <h2 className="card-title text-sm font-semibold uppercase tracking-wider text-base-content/60">
            Actions
          </h2>
          <div className="flex items-center justify-between mt-2">
            <div>
              <p className="text-sm font-medium">Restart DUSTIN</p>
              <p className="text-xs text-base-content/50">Apply pending config changes</p>
            </div>
            <button
              className="btn btn-error btn-sm btn-outline"
              onClick={() => setShowRestart(true)}
            >
              Restart
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showRestart}
        title="Restart DUSTIN?"
        message="DUSTIN will go offline for a few seconds while the container restarts with the new configuration."
        confirmLabel="Restart"
        onConfirm={handleRestart}
        onCancel={() => setShowRestart(false)}
      />
    </div>
  );
}
