# MeshStage Studio

A mobile-first creation studio for 3D character generation and real-time lip-sync,
built for iOS Safari and Android Chrome as the primary target rather than as a
responsive afterthought.

The app walks a linear four-stage pipeline:

```
[1. Input] → [2. 3D Processing] → [3. Voice & Rig] → [4. Export & Save]
```

Every stage keeps the same shell: a compact step bar pinned to the top, the stage
body in the middle, and a bottom action bar carrying exactly one primary CTA and
one destructive secondary. Nothing scrolls except the stage body.

## Stack

React 18 · TypeScript · Vite · Tailwind CSS v4 · Three.js · @react-three/fiber

## Running it

```bash
npm install
npm run dev        # http://localhost:5173 — also bound to your LAN IP for phone testing
npm run build
npm run typecheck
```

To test on a real phone, run `npm run dev` and open the network URL Vite prints
on a device on the same Wi-Fi. The iOS audio guard and the dynamic-viewport
behaviour only exercise properly on actual hardware.

### Optional backend

```bash
VITE_MESHSTAGE_API=https://api.example.com   # enables FBX conversion + cloud library
```

Unset, the app still works end to end: GLB, USDZ, video and JSON all export
locally, and the cloud library falls back to `localStorage`. FBX reports honestly
that it needs the conversion service (see [Exports](#exports)).

## Architecture

```
src/
  state/
    studioReducer.ts      Pipeline state machine — every stage transition and discard
    StudioContext.tsx     Wires reducer + audio unlock + lip-sync + scene handles
  hooks/
    useAudioUnlock.ts     iOS Safari WebAudio gesture handshake
    useLipSync.ts         Viseme playhead, shared with the render loop
    useSpeechVoices.ts    System/neural voice catalogue
    useGenerationPipeline.ts  Stage-2 progress driver (swap for your backend)
    useExportRunner.ts    Export orchestration, credit metering
  three/
    characterFactory.ts   Skinned humanoid rig + 15 viseme blendshapes
    Character.tsx         Animation loop: visemes, jaw, motion presets, blink
    RiggingPreview.tsx    Stage-2 wireframe/skeleton assembly view
    FitCamera.tsx         Bounding-box camera framing
    Viewport.tsx          Canvas shell, mobile perf guards
  lib/
    visemes.ts            Text → viseme timeline, sampling, JSON export shape
    exporters.ts          GLB · USDZ · video · JSON · FBX dispatch
  components/
    stages/               One file per pipeline stage
```

### State

A single reducer owns the pipeline. Stage transitions are actions, not route
changes, which keeps the WebGL context alive across stages 3 → 4 instead of
tearing down and re-initialising the renderer mid-flow.

Discard semantics differ by stage, deliberately:

| Stage | Action | What it clears |
|---|---|---|
| 1 | Discard / Reset Input | Prompt and uploaded reference |
| 2 | Discard & Start Over | Cancels the job, **keeps** the input so there's no re-upload |
| 3 | Discard Character | Mesh, rig, script — full session reset |
| 4 | Discard & New Character | Full session reset; warns if unsaved to the library |

All four route through one confirmation sheet. The buttons themselves stay
visually quiet — the weight of the decision lives in the sheet, not in a
permanently alarming red button.

### The rig is real

`characterFactory.ts` builds an actual `THREE.SkinnedMesh`: a 13-bone humanoid
chain with computed skin weights, and a mouth mesh carrying 15 morph targets
named `viseme_sil` … `viseme_U` (the ARKit/Oculus set).

This matters because it is what gets exported. A GLB out of this app contains:

```
skins        : 1 | joints: 13
joint names  : hips, spine, chest, neck, head, shoulderL, elbowL, …
skin attrs   : POSITION, TEXCOORD_0, NORMAL, JOINTS_0, WEIGHTS_0
morph targets: 15
target names : viseme_sil, viseme_PP, viseme_FF, … viseme_U
```

Two subtleties worth knowing if you touch this code:

- **Bind pose.** `THREE.Skeleton` derives its inverse bind matrices from each
  bone's *world* matrix, so the hierarchy must be resolved (`updateMatrixWorld`)
  before the skeleton is constructed. Skip it and every inverse is identity,
  which double-applies each bone's translation.
- **Cloning for export.** `Object3D.clone()` deep-copies nodes but leaves the
  `SkinnedMesh` bound to the *original* skeleton, so the exporter emits joint
  indices pointing at bones that aren't in the exported scene. The export path
  uses `SkeletonUtils.clone()` instead.

### Lip-sync

`visemes.ts` maps text to a viseme timeline with per-shape durations —
grapheme-driven rather than a full phonemiser, cheap enough to re-run on every
keystroke on a mid-range phone.

Playback runs off a mutable clock object the render loop samples 60×/second.
Keeping the playhead out of React state is deliberate: re-rendering the tree per
frame would put the viewport well under 60fps. Where the browser emits
`onboundary` word events (Chrome, Edge) the clock re-anchors to the real engine
timings; Safari doesn't emit them, so the estimate is the baseline.

### Exports

| Format | Where it runs | Notes |
|---|---|---|
| `.GLB` | Browser | Full skeleton, blendshapes, PBR materials |
| `.USDZ` | Browser | AR Quick Look |
| `.MP4 / .WEBM` | Browser | `captureStream()` + `MediaRecorder`; metered |
| `.JSON` | Browser | Viseme timeline with ms offsets and weights |
| `.FBX` | Service | See below |

**On FBX:** three.js ships an FBX *importer* only — the format is a closed binary
spec with no browser-side writer. The app therefore posts the glTF payload to the
conversion service and lets it run the FBX SDK. With no `VITE_MESHSTAGE_API`
configured it says so plainly and points at `.GLB`, which carries the same
skeleton and morph targets and imports directly into Blender and Unity. It does
not fake a download.

**On video audio:** the capture is real — `captureStream()` on the live viewport,
so the file contains the frames the user just watched. The TTS audio is *not*
muxed in: `speechSynthesis` output doesn't route through WebAudio on any current
browser, so there is no stream to attach. Audio muxing and the true
transparent-background pass belong in the cloud renderer.

## Mobile specifics

**Dynamic viewport.** The shell is `100dvh` (with a `100vh` fallback) and is a
fixed-height flex column, never a scrolling page. Only inner panes scroll, so the
step bar and action bar stay pinned while Safari's address bar collapses.
`viewport-fit=cover` plus `env(safe-area-inset-*)` keeps the CTA clear of the
home indicator and Android's gesture pill.

**WebAudio gesture guard.** WebKit refuses to start an `AudioContext` or speak an
utterance that wasn't initiated by a real touch, and it fails *silently* — the
user taps Speak, nothing happens, the app looks broken. `useAudioUnlock` detects
the suspended context, shows a "Tap to Initialize WebAudio" overlay inside the
viewport (the rest of the studio stays usable), and on tap resumes the context
*synchronously inside the gesture*, primes it with a silent buffer, and primes
`speechSynthesis` with a zero-volume utterance — Safari drops the first real
utterance otherwise. Backgrounding the tab re-suspends the context on iOS, so the
overlay re-arms on `visibilitychange`.

**Touch targets.** Every button, pill, toggle, slider and discard trigger is at
least 48px tall via the `min-h-touch` token. Inputs are 16px to stop iOS zooming
on focus.

**Render budget.** DPR is capped at 2 — a 3× render of a full-bleed viewport is
the fastest way to thermally throttle an iPhone, and 2× is visually
indistinguishable here. Contact shadows are a generated canvas texture rather
than a shadow pass, no HDR environment is fetched (three-point lights instead, so
nothing blocks first paint), and `webglcontextlost` is handled because iOS evicts
contexts under memory pressure.

**Gestures.** One finger orbits, two fingers dolly. Drag-to-pan is disabled — on
a phone it is almost always an accidental scroll.

## Where to plug in a real backend

- `useGenerationPipeline.ts` — replace the rAF ticker with a WebSocket/SSE
  subscription on the reconstruction job; dispatch the same `pipelineProgress`
  and `generationComplete` actions.
- `characterFactory.ts` — replace with your asset loader. The rest of the studio
  only needs the returned handles (`root`, `mouth`, `jaw`, `bones`,
  `visemeIndex`).
- `exporters.ts` — `saveToCloudLibrary` and the FBX branch already speak to
  `VITE_MESHSTAGE_API`.
