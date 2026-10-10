/** Sends a whole config to the settings route. Returns an error message, or null when it was saved. */
export async function saveConfig(config: unknown): Promise<string | null> {
  try {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    if (res.ok) return null;
    return ((await res.json()) as { error?: string }).error ?? "Could not save.";
  } catch {
    return "Could not reach the server.";
  }
}
