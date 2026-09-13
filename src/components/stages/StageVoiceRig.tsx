import { useEffect, useMemo } from 'react';
import { Viewport } from '../../three/Viewport';
import { Character } from '../../three/Character';
import { StageFloor } from '../../three/StageFloor';
import { ActionBar } from '../ActionBar';
import { Button } from '../Button';
import { GlassSheet, SheetSection } from '../GlassSheet';
import { PillGroup, Slider } from '../Controls';
import { AudioUnlockOverlay } from '../AudioUnlockOverlay';
import { ArrowRightIcon, BoneIcon, ChevronDownIcon, CubeIcon, PlayIcon, StopIcon, TrashIcon } from '../icons';
import { useStudio } from '../../state/StudioContext';
import { useSpeechVoices } from '../../hooks/useSpeechVoices';
import { formatDuration } from '../../lib/utils';
import { MOTION_PRESETS, type MotionPreset } from '../../types/studio';
import type { ConfirmRequest } from '../ConfirmDialog';

export function StageVoiceRig({ onConfirm }: { onConfirm: (request: ConfirmRequest) => void }) {
  const { state, dispatch, audio, lipSync } = useStudio();
  const { groups, ready: voicesReady } = useSpeechVoices();
  const character = state.character;

  // Pick a sensible default voice as soon as the catalogue lands: the device
  // locale's first neural voice, else whatever is first in the list.
  useEffect(() => {
    if (state.voice.voiceURI || groups.length === 0) return;
    const preferred = groups[0]?.voices[0];
    if (preferred) {
      dispatch({ type: 'setVoice', patch: { voiceURI: preferred.voiceURI, lang: preferred.lang } });
    }
  }, [groups, state.voice.voiceURI, dispatch]);

  const selectedVoice = useMemo(
    () => groups.flatMap((group) => group.voices).find((voice) => voice.voiceURI === state.voice.voiceURI),
    [groups, state.voice.voiceURI],
  );

  const handleDiscard = () => {
    onConfirm({
      title: 'Discard this character?',
      body: `"${character?.name ?? 'This mesh'}" and its rig, blendshapes and script will be permanently deleted, and the studio returns to step 1. This cannot be undone.`,
      confirmLabel: 'Discard character',
      onConfirm: () => {
        lipSync.stop();
        dispatch({ type: 'discardAll' });
      },
    });
  };

  const speakDisabled = !state.script.trim() || (audio.needsGesture && !audio.unlocked);

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Viewport
          className="min-h-0 flex-1"
          accent="#22d3ee"
          fit={{ focus: 0.66, padding: 1.22, dependency: character?.seed }}
          overlay={
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,rgba(59,130,246,0.12),transparent_60%)]"
              />

              {character && (
                <div className="pointer-events-none absolute top-3 left-4 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-obsidian-950/70 px-3 py-1.5 text-[12.5px] font-medium text-ink-100 backdrop-blur-sm">
                    {character.name}
                  </span>
                  <RigChip icon={<CubeIcon className="size-3" />} label={`${(character.polycount / 1000).toFixed(1)}k tris`} />
                  <RigChip icon={<BoneIcon className="size-3" />} label={`${character.boneCount} bones`} />
                  <RigChip label={`${character.blendshapeCount} visemes`} />
                </div>
              )}

              {lipSync.speaking && <SpeakingMeter />}

              {audio.needsGesture && !audio.unlocked && (
                <AudioUnlockOverlay onUnlock={() => void audio.unlock()} />
              )}
            </>
          }
        >
          {character && <Character seed={character.seed} motion={state.motion} />}
          <StageFloor accent="#22d3ee" />
        </Viewport>
      </div>

      <GlassSheet className="max-h-[46dvh] shrink-0">
        <div className="scroll-pane space-y-5 px-4 pb-4">
          <SheetSection
            title="Voice model"
            hint={voicesReady ? `${groups.reduce((sum, group) => sum + group.voices.length, 0)} available` : 'Loading…'}
          >
            <div className="relative">
              <select
                value={state.voice.voiceURI}
                onChange={(event) => {
                  const voiceURI = event.target.value;
                  const match = groups.flatMap((group) => group.voices).find((voice) => voice.voiceURI === voiceURI);
                  dispatch({ type: 'setVoice', patch: { voiceURI, lang: match?.lang ?? state.voice.lang } });
                }}
                className="min-h-touch w-full appearance-none rounded-2xl border border-obsidian-700 bg-obsidian-850/80 px-4 pr-11 text-[14.5px] text-ink-100 focus:border-beam-500/50 focus:outline-none"
              >
                {groups.length === 0 && <option value="">No system voices detected</option>}
                {groups.map((group) => (
                  <optgroup key={group.lang} label={group.label}>
                    {group.voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name}
                        {voice.localService ? '' : ' · neural'}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-ink-500" />
            </div>

            <div className="grid grid-cols-2 gap-x-4">
              <Slider
                label="Rate"
                min={0.6}
                max={1.6}
                step={0.05}
                value={state.voice.rate}
                onChange={(rate) => dispatch({ type: 'setVoice', patch: { rate } })}
                format={(value) => `${value.toFixed(2)}×`}
              />
              <Slider
                label="Pitch"
                min={0.5}
                max={1.6}
                step={0.05}
                value={state.voice.pitch}
                onChange={(pitch) => dispatch({ type: 'setVoice', patch: { pitch } })}
                format={(value) => value.toFixed(2)}
              />
            </div>

            {groups.length === 0 && voicesReady && (
              <p className="text-[11.5px] leading-relaxed text-warn-400/90">
                No TTS engine found on this device. The rig still previews the viseme timeline
                silently, and cloud rendering uses server-side neural voices.
              </p>
            )}
          </SheetSection>

          <SheetSection
            title="Test script"
            hint={`${lipSync.timeline.keys.length} visemes · ${formatDuration(lipSync.timeline.duration)}`}
          >
            <div className="rounded-2xl border border-obsidian-700 bg-obsidian-850/80 p-1 focus-within:border-beam-500/50">
              <textarea
                value={state.script}
                onChange={(event) => dispatch({ type: 'setScript', script: event.target.value.slice(0, 500) })}
                rows={3}
                enterKeyHint="done"
                placeholder="Type a line to test real-time lip-sync synthesis…"
                className="w-full resize-none rounded-[0.9rem] bg-transparent px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink-100 placeholder:text-ink-600 focus:outline-none"
              />
            </div>

            <Button
              variant={lipSync.speaking ? 'secondary' : 'outline'}
              block
              disabled={speakDisabled}
              icon={lipSync.speaking ? <StopIcon className="size-[17px]" /> : <PlayIcon className="size-[17px]" />}
              onClick={() => (lipSync.speaking ? lipSync.stop() : lipSync.speak())}
            >
              {lipSync.speaking ? 'Stop preview' : 'Preview lip-sync'}
            </Button>
          </SheetSection>

          <SheetSection title="Motion preset" hint="Idle loop">
            <PillGroup<MotionPreset>
              ariaLabel="Idle animation preset"
              value={state.motion}
              onChange={(motion) => dispatch({ type: 'setMotion', motion })}
              options={MOTION_PRESETS.map((preset) => ({
                value: preset.id,
                label: preset.label,
                hint: preset.hint,
              }))}
            />
          </SheetSection>

          {selectedVoice && (
            <p className="text-[11px] text-ink-600">
              Rendering with <span className="text-ink-500">{selectedVoice.name}</span> ·{' '}
              {selectedVoice.lang}
            </p>
          )}
        </div>
      </GlassSheet>

      <ActionBar>
        <Button
          variant="primary"
          block
          icon={<ArrowRightIcon className="size-[18px]" />}
          onClick={() => {
            lipSync.stop();
            dispatch({ type: 'goToStage', stage: 'export' });
          }}
        >
          Finalize & Continue to Export
        </Button>

        <Button
          variant="destructive"
          block
          icon={<TrashIcon className="size-[17px]" />}
          onClick={handleDiscard}
        >
          Discard Character
        </Button>
      </ActionBar>
    </>
  );
}

function RigChip({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-obsidian-950/60 px-2.5 py-1 font-mono text-[10px] tracking-wide text-ink-500 backdrop-blur-sm">
      {icon}
      {label}
    </span>
  );
}

/** Ambient level meter — a cue that audio is live, not a real FFT readout. */
function SpeakingMeter() {
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 flex items-end gap-[3px]">
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-beam-400/80"
          style={{
            height: `${10 + ((index * 7) % 16)}px`,
            animation: `breathe ${0.5 + index * 0.12}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}
