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

### The TTS service

`server/` is a dependency-free Node service (Node 22's built-in `fetch` and
`WebSocket` cover everything) providing neural voices and the cloud library:

```bash
node server/index.mjs                       # http://localhost:8787
VITE_MESHSTAGE_API=http://localhost:8787 npm run dev
```

Two providers, tried in order (`MESHSTAGE_TTS_PROVIDERS=edge,espeak`):

- **`edge`** — Microsoft Edge read-aloud neural voices. Sounds good, and emits
  `WordBoundary` marks that give real per-word viseme timing.
- **`espeak`** — local `espeak-ng` (`apt install espeak-ng`). Robotic, but
  offline, deterministic, and the right thing to develop and run CI against.

With no service configured the studio still works end to end on device voices,
and the cloud library falls back to `localStorage`.

### Why a service at all, when browsers have `speechSynthesis`

Two reasons, and the second is the load-bearing one:

1. **Consistency.** System voices vary wildly between an iPhone, a Pixel and a
   desktop, so the same character never sounds twice alike.
2. **The audio is reachable.** `speechSynthesis` output cannot be routed into
   WebAudio on any current browser — you cannot analyse it, and you cannot
   record it. Service audio is a plain buffer, so it plays through an
   `AudioBufferSourceNode` that is also tapped into a
   `MediaStreamAudioDestinationNode` — which is what lets the video export
   contain sound.

That difference is visible in the output. Same scene, same script:

| Voice | Export note | Tracks in the file |
|---|---|---|
| Neural (service) | "Video and audio captured." | `vide`, `soun` |
| System (device) | "Video captured (system voices record silent)." | `vide` |

The UI says which you are getting *before* you spend a render credit.

## Testing it

```bash
npm test          # the full suite against a production build
npm run test:ui   # Playwright's UI mode, for watching it drive
```

15 specs at an iPhone 14 Pro viewport, run against a production build rather
than the dev server — WebGL setup, chunk loading and exporter output all behave
differently once Vite has bundled and minified them.

The export specs assert on the in-page verification panel, which parses the
bytes the exporter actually produced. That makes them real format tests: a
regression in the skeleton bind, the morph targets or the video muxing fails
here instead of shipping a file that only looks right by its size.

`CHROMIUM_PATH` points the runner at a preinstalled browser when the
environment provides one; otherwise Playwright uses its own.

### In GitHub

Three workflows, all runnable from the Actions tab:

| Workflow | What it gives you |
|---|---|
| **CI** | Typecheck, build, and the 15 specs on every push. Uploads the Playwright HTML report as an artifact. |
| **CI → TTS service** | Boots `server/index.mjs` with espeak-ng and asserts the catalogue and synthesis return real audio. Also probes Edge reachability (informational — it won't fail the build). |
| **Deploy to GitHub Pages** | Publishes the studio to `https://<owner>.github.io/MeshStage/`. |

GitHub Pages is static, so a Pages deploy has **no TTS service** — the studio
falls back to device voices, which is the full experience on a phone minus
neural voices and audio in video exports. For those, deploy to Netlify (below)
or open the repo in a Codespace, where `.devcontainer/devcontainer.json`
installs espeak-ng and forwards both ports.

## Deploying it somewhere testable

The repo carries a `netlify.toml` and one serverless function, so a Netlify
site needs no further setup:

1. In Netlify, **Add new site → Import an existing project → GitHub**, pick
   this repo, and choose the branch.
2. Leave the build settings alone — `netlify.toml` already sets the build
   command (`npm run build:deploy`), the publish directory (`dist`) and the
   functions directory.
3. Deploy.

`netlify/functions/api.mts` serves the TTS service at `/api/*`, sharing
`server/providers/edge.mjs` with the standalone Node server so there is one
implementation of the Edge protocol. The deployed build points the studio at
its own `/api`, so neural voices work with no configuration.

A deployed site is **Edge-only**: there is no `espeak-ng` binary in the Lambda
image. If Edge is unreachable the voice catalogue returns empty with a readable
error rather than failing, and the studio falls back to the device's own voices.

FBX conversion returns 501 there — the Autodesk FBX SDK cannot run in a
serverless function.

## Going to production

### What's ready to serve real users

The frontend is a static bundle — any CDN host works, with no special
requirements beyond serving `dist/` and falling back to `index.html`:

| Host | How |
|---|---|
| **Netlify** | Connect the repo. `netlify.toml` configures build, publish and the `/api` function. Neural voices work with no extra setup. |
| **Vercel** | Framework preset "Vite". Port `netlify/functions/api.mts` to `api/[...path].ts` for TTS. |
| **Cloudflare Pages** | Build `npm run build`, output `dist`. Port the function to a Pages Function. |
| **GitHub Pages** | Static only — device voices, no TTS service. |

The TTS service is verified working: CI fetches **322 Edge neural voices** and
synthesises real audio on every push.

### Accounts and render credits

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` against a project with
`supabase/migrations` applied, and metering becomes real:

- Magic-link sign-in, plus an optional guest account so the flow can be tried
  without an email address. A guest is a real auth user with its own balance.
- Every new user gets a profile with the free-tier allowance, created by a
  trigger on `auth.users`.
- Metered exports call `consume_render_credit()` **before** any rendering
  work, so a failed balance check costs nothing.
- The balance shown in the UI is whatever the database returned. The client
  never computes it.

**Why it cannot be forged.** `profiles` has row-level security on with SELECT
policies only — no INSERT, UPDATE or DELETE policy exists, so every client
write is rejected outright. The one path that can move a balance is a
`SECURITY DEFINER` function that re-checks the balance, locks the row (so two
concurrent exports cannot both spend the last credit), decrements, and writes
an audit row — all in one transaction. Plan changes live in a separate function
granted to `service_role` only, ready for a payment webhook and unreachable
from a browser.

Verified directly against the database:

| Attempt | Result |
|---|---|
| Client reads own profile | allowed |
| Client `UPDATE`s its own credits to 9999 | **0 rows written**, balance unchanged |
| Client `INSERT`s a profile for another user | **rejected** (`42501`) |
| Client calls `consume_render_credit()` | allowed, 10 → 9, ledger row written |
| Client calls `apply_plan_change()` to self-upgrade | **permission denied** |

The anon key is meant to ship in the bundle — it grants nothing on its own, and
RLS is what protects the data.

Guest accounts need **Anonymous sign-ins** enabled under Supabase →
Authentication → Providers; magic links work out of the box.

### What is still NOT production-ready

The pipeline, rig, lip-sync, exports and now metering are real. What remains:

- **Character generation is simulated.** `useGenerationPipeline.ts` runs a
  timed progress bar and `characterFactory.ts` builds a procedural mesh from a
  hash of the input. No image or prompt is reconstructed into geometry. This is
  the single biggest gap — it is the product's core promise, and it needs a
  real reconstruction service behind it.
- **No payments.** `apply_plan_change()` is the seam a webhook would call; the
  "Upgrade" button does not yet reach it.
- **Credits never refill.** `period_started_at` exists for a monthly reset job
  that has not been written.
- **The cloud library does not persist.** Without a backend it writes to
  `localStorage`; the reference endpoint accepts and discards.
- **FBX is unimplemented.** The client posts glTF to a conversion service that
  has to exist and run the FBX SDK.
- **No rate limiting on the TTS endpoint.** As written, anyone who finds the
  URL can drive synthesis at your cost.

A reasonable order from here: payments → monthly credit reset → real
generation backend → FBX conversion.

## Architecture

```
src/
  state/
    studioReducer.ts      Pipeline state machine — every stage transition and discard
    StudioContext.tsx     Wires reducer + audio unlock + lip-sync + scene handles
  hooks/
    useAudioUnlock.ts     iOS Safari WebAudio gesture handshake
    useLipSync.ts         Viseme playhead + system/neural playback
    useVoiceCatalogue.ts  Merged device + service voice list
    useGenerationPipeline.ts  Stage-2 progress driver (swap for your backend)
    useExportRunner.ts    Export orchestration, credit metering
  three/
    characterFactory.ts   Skinned humanoid rig + 15 viseme blendshapes
    Character.tsx         Animation loop: visemes, jaw, motion presets, blink
    RiggingPreview.tsx    Stage-2 wireframe/skeleton assembly view
    FitCamera.tsx         Bounding-box camera framing
    Viewport.tsx          Canvas shell, mobile perf guards
  lib/
    visemes.ts            Text → viseme timeline, retiming, JSON export shape
    tts.ts                Neural TTS client
    exporters.ts          GLB · USDZ · video · JSON · FBX dispatch
server/
  index.mjs               TTS + library service (no dependencies)
  providers/edge.mjs      Edge-TTS neural voices
  providers/espeak.mjs    Local espeak-ng fallback
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
frame would put the viewport well under 60fps.

The estimate gets mouth *shapes* right but only guesses timing, so once real
audio exists `retimeTimeline()` re-anchors it, best source first:

1. **Word-boundary marks** (Edge-TTS, and Chrome's `onboundary`) — each word's
   visemes are redistributed across that word's real start and duration, so
   drift cannot accumulate across a long script.
2. **Total duration** (espeak, Safari) — one scale factor for the whole
   timeline. Cruder, but still beats an estimate that can be 20% out at an
   unusual rate.

**Watchdog.** Playback never relies on `onend` alone. Safari drops it on long
utterances, and a Linux `speech-dispatcher` with no audio sink never fires it at
all — in both cases the mouth would animate forever with Stop as the only way
out. Every take arms a timeout at `duration + 1.5s`.

### Exports

| Format | Where it runs | Notes |
|---|---|---|
| `.GLB` | Browser | Full skeleton, blendshapes, PBR materials |
| `.USDZ` | Browser | AR Quick Look |
| `.MP4 / .WEBM` | Browser | `captureStream()` + `MediaRecorder`; audio muxed on neural voices; metered |
| `.JSON` | Browser | Viseme timeline with ms offsets and weights |
| `.FBX` | Service | See below |

**On FBX:** three.js ships an FBX *importer* only — the format is a closed binary
spec with no browser-side writer. The app therefore posts the glTF payload to the
conversion service and lets it run the FBX SDK. With no `VITE_MESHSTAGE_API`
configured it says so plainly and points at `.GLB`, which carries the same
skeleton and morph targets and imports directly into Blender and Unity. It does
not fake a download.

**On video audio:** the capture is real — `captureStream()` on the live viewport,
so the file contains the frames the user just watched. Audio is muxed in when a
neural voice drove the take, and omitted (with the UI saying so) when a device
voice did, for the `speechSynthesis` reason above. The true
transparent-background pass still belongs in the cloud renderer.

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
- `server/providers/` — add a provider by exporting `listVoices()` and
  `synthesize()`; returning word-boundary marks gets you the better timing path
  for free.

## Verification status

Checked in a headless Chromium at iPhone viewport, against the live service:

- Full pipeline runs clean, no console errors; GLB export carries 13 named
  joints with `JOINTS_0`/`WEIGHTS_0` plus 15 named viseme targets.
- Neural speech: 358ms synthesis, playback measured at 2814ms against the
  service's reported 2857ms of audio, ending on its own.
- Video export track table verified by parsing the MP4 box structure —
  `vide`+`soun` with a neural voice, `vide` only with a device voice.
- Voice catalogue capping verified against a pathological host: a box with
  `espeak-ng` installed reports 13,363 voices to Chromium, which the
  dedupe/cap reduces to 131.

**Edge-TTS is verified in CI**, not in the sandbox this was built in: that
environment's egress proxy blocks `speech.platform.bing.com`. The GitHub runner
has open egress and fetches 322 neural voices with no errors, so the protocol
implementation — token, handshake and headers — is confirmed against the live
service.
