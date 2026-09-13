import { useCallback, useRef, useState } from 'react';
import { Button } from '../Button';
import { ActionBar } from '../ActionBar';
import { SegmentedTabs } from '../Controls';
import { CameraIcon, SparkIcon, TextIcon, TrashIcon, UploadIcon } from '../icons';
import { useStudio } from '../../state/StudioContext';
import { hasUsableInput } from '../../state/studioReducer';
import { cn, formatBytes } from '../../lib/utils';
import type { ConfirmRequest } from '../ConfirmDialog';
import type { InputMode } from '../../types/studio';

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const PROMPT_IDEAS = [
  'Cyberpunk astronaut with a neon visor',
  'Art-deco jazz singer in brass and velvet',
  'Deep-sea archivist in a bioluminescent suit',
  'Desert courier wrapped in sun-bleached linen',
];

export function StageInput({ onConfirm }: { onConfirm: (request: ConfirmRequest) => void }) {
  const { state, dispatch } = useStudio();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed generation lands back here; show why before the local error.
  const message = error ?? state.generationError;

  const ready = hasUsableInput(state);
  const dirty = Boolean(state.imageDataUrl) || state.prompt.trim().length > 0;

  const ingestFile = useCallback(
    (file: File | undefined) => {
      setError(null);
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        setError('That file is not an image. Upload a JPG, PNG, HEIC or WebP.');
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`Reference is ${formatBytes(file.size)}. The limit is 12 MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        dispatch({ type: 'setImage', dataUrl: String(reader.result), name: file.name });
      };
      reader.onerror = () => setError('Could not read that file. Try another image.');
      reader.readAsDataURL(file);
    },
    [dispatch],
  );

  const handleDiscard = () => {
    onConfirm({
      title: 'Discard this input?',
      body:
        state.inputMode === 'image'
          ? 'The uploaded reference will be removed from this session. Nothing has been sent to our servers yet.'
          : 'Your prompt will be cleared. This cannot be undone.',
      confirmLabel: 'Discard input',
      onConfirm: () => {
        dispatch({ type: 'resetInput' });
        setError(null);
      },
    });
  };

  return (
    <>
      <div className="scroll-pane flex-1 px-4 pb-6">
        <header className="pt-1 pb-5">
          <h1 className="text-[26px] leading-[1.15] font-semibold tracking-tight text-ink-100">
            Start your character
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-500">
            One photo or one sentence. MeshStage reconstructs the mesh, fits a humanoid rig and
            binds the viseme blendshapes.
          </p>
        </header>

        <SegmentedTabs<InputMode>
          ariaLabel="Character input source"
          value={state.inputMode}
          onChange={(mode) => dispatch({ type: 'setInputMode', mode })}
          options={[
            { value: 'image', label: 'Upload Image', icon: <UploadIcon className="size-4" /> },
            { value: 'prompt', label: 'Prompt Text', icon: <TextIcon className="size-4" /> },
          ]}
        />

        <div className="mt-4">
          {state.inputMode === 'image' ? (
            <UploadPane
              dragging={dragging}
              setDragging={setDragging}
              onFile={ingestFile}
              onPick={() => fileInputRef.current?.click()}
              onCapture={() => cameraInputRef.current?.click()}
              imageDataUrl={state.imageDataUrl}
              imageName={state.imageName}
              onClear={() => dispatch({ type: 'clearImage' })}
            />
          ) : (
            <PromptPane
              value={state.prompt}
              onChange={(prompt) => dispatch({ type: 'setPrompt', prompt })}
            />
          )}
        </div>

        {message && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-500/10 px-3.5 py-2.5 text-[12.5px] text-danger-400">
            {message}
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => ingestFile(event.target.files?.[0])}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          // `capture` opens the rear camera directly on Android and offers the
          // camera first in the iOS sheet.
          capture="user"
          className="sr-only"
          onChange={(event) => ingestFile(event.target.files?.[0])}
        />
      </div>

      <ActionBar>
        <Button
          variant="primary"
          block
          disabled={!ready}
          icon={<SparkIcon className="size-[18px]" />}
          onClick={() => dispatch({ type: 'startGeneration' })}
        >
          Generate 3D Character
        </Button>

        <Button
          variant="destructive"
          block
          disabled={!dirty}
          icon={<TrashIcon className="size-[17px]" />}
          onClick={handleDiscard}
        >
          Discard / Reset Input
        </Button>
      </ActionBar>
    </>
  );
}

function UploadPane({
  dragging,
  setDragging,
  onFile,
  onPick,
  onCapture,
  imageDataUrl,
  imageName,
  onClear,
}: {
  dragging: boolean;
  setDragging: (value: boolean) => void;
  onFile: (file: File | undefined) => void;
  onPick: () => void;
  onCapture: () => void;
  imageDataUrl: string | null;
  imageName: string | null;
  onClear: () => void;
}) {
  if (imageDataUrl) {
    return (
      <div className="space-y-3">
        <figure className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-obsidian-900">
          <img
            src={imageDataUrl}
            alt={imageName ?? 'Uploaded reference'}
            className="aspect-[4/5] w-full object-cover"
          />
          <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-obsidian-950 to-transparent px-4 pt-10 pb-3">
            <span className="min-w-0 truncate text-[12.5px] text-ink-300">{imageName}</span>
            <span className="shrink-0 rounded-full bg-ok-400/14 px-2.5 py-1 text-[10.5px] font-medium tracking-wide text-ok-400 uppercase">
              Ready
            </span>
          </figcaption>
        </figure>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onPick} icon={<UploadIcon className="size-4" />}>
            Replace
          </Button>
          <Button variant="ghost" onClick={onClear} icon={<TrashIcon className="size-4" />}>
            Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onFile(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'rounded-3xl border-2 border-dashed transition-colors duration-200',
          dragging ? 'border-beam-500 bg-beam-500/8' : 'border-obsidian-700 bg-obsidian-900/50',
        )}
      >
        <button
          type="button"
          onClick={onPick}
          className="flex w-full flex-col items-center gap-3 px-6 py-10 text-center"
        >
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-beam-500/18 to-pulse-500/12 text-beam-400 ring-1 ring-beam-500/25">
            <UploadIcon className="size-6" />
          </span>

          <span>
            <span className="block text-[15px] font-medium text-ink-100">
              Upload 2D Reference / Selfie to 3D
            </span>
            <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-500">
              Tap to browse your camera roll, or drop an image here.
              <br />
              JPG · PNG · HEIC · WebP — up to 12 MB.
            </span>
          </span>
        </button>
      </div>

      <Button variant="outline" block onClick={onCapture} icon={<CameraIcon className="size-[18px]" />}>
        Take a photo now
      </Button>

      <p className="px-1 text-[11.5px] leading-relaxed text-ink-600">
        Best results: a front-facing photo, even lighting, shoulders in frame.
      </p>
    </div>
  );
}

function PromptPane({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const remaining = 320 - value.length;

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-obsidian-700 bg-obsidian-900/70 p-1 focus-within:border-beam-500/50">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 320))}
          rows={6}
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="on"
          spellCheck
          placeholder="Describe your character: e.g., Cyberpunk astronaut with neon visor, matte black armour, cyan rim light."
          className="w-full resize-none rounded-[1.35rem] bg-transparent px-4 py-3.5 leading-relaxed text-ink-100 placeholder:text-ink-600 focus:outline-none"
        />
        <div className="flex items-center justify-between px-4 pb-2.5">
          <span className="text-[11px] text-ink-600">Describe build, wardrobe and mood.</span>
          <span
            className={cn(
              'font-mono text-[11px] tabular-nums',
              remaining < 40 ? 'text-warn-400' : 'text-ink-600',
            )}
          >
            {remaining}
          </span>
        </div>
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {PROMPT_IDEAS.map((idea) => (
          <button
            key={idea}
            type="button"
            onClick={() => onChange(idea)}
            className="min-h-touch shrink-0 rounded-full border border-obsidian-700 bg-obsidian-850/70 px-4 text-[12.5px] text-ink-300 active:bg-obsidian-800"
          >
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}
