/**
 * Reports what a provider-reconstructed mesh is doing.
 *
 * The reconstruction arrives over the network after the viewport has already
 * mounted, so without this the user sees an empty stage and has no way to tell
 * a slow download from a failed one. It also states plainly when the returned
 * geometry has no blendshapes — image-to-3D services return a surface, not a
 * rig, unless they also run a rigging pass — because silently showing a mouth
 * that never moves is worse than saying so.
 */
export function MeshStatusOverlay({
  status,
}: {
  status: { loading: boolean; error: string | null; rigged: boolean };
}) {
  if (status.loading) {
    return (
      <div
        role="status"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="flex items-center gap-2.5 rounded-full bg-obsidian-950/80 px-4 py-2.5 text-[13px] text-ink-100 backdrop-blur-sm">
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400"
          />
          Loading reconstructed mesh…
        </div>
      </div>
    );
  }

  if (status.error) {
    return (
      <div
        role="alert"
        className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-rose-950/80 px-4 py-3 text-[13px] text-rose-100 backdrop-blur-sm"
      >
        {status.error}
      </div>
    );
  }

  if (!status.rigged) {
    return (
      <div
        role="status"
        className="pointer-events-none absolute right-4 bottom-3 left-4 rounded-xl bg-amber-950/70 px-3 py-2 text-[12px] leading-snug text-amber-100 backdrop-blur-sm"
      >
        Reconstructed geometry has no blendshapes, so lip-sync will not move
        this mesh. Voice and the viseme timeline still export.
      </div>
    );
  }

  return null;
}
