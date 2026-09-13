import { useCallback, useEffect, useRef, useState } from 'react';
import { ExportError, runExport, saveToCloudLibrary, type ExportResult } from '../lib/exporters';
import { downloadBlob } from '../lib/utils';
import { useStudio } from '../state/StudioContext';
import { EXPORT_FORMATS, type ExportFormatId } from '../types/studio';

export interface ExportRunnerApi {
  run: (formatId: ExportFormatId) => Promise<void>;
  saveToLibrary: () => Promise<void>;
  lastResult: ExportResult | null;
  /** Re-attempts the file save from a user gesture. */
  saveLastResult: () => void;
  clearResult: () => void;
}

export function useExportRunner(): ExportRunnerApi {
  const { state, dispatch, scene, lipSync, audio } = useStudio();
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);
  const previousUrl = useRef<string | null>(null);

  // Object URLs pin their blob in memory; a few 300KB GLBs and a video add up
  // fast on a phone, so each result releases the one before it.
  const adopt = useCallback((result: ExportResult | null) => {
    if (previousUrl.current) URL.revokeObjectURL(previousUrl.current);
    previousUrl.current = result?.objectUrl ?? null;
    setLastResult(result);
  }, []);

  useEffect(
    () => () => {
      if (previousUrl.current) URL.revokeObjectURL(previousUrl.current);
    },
    [],
  );

  const run = useCallback(
    async (formatId: ExportFormatId) => {
      const format = EXPORT_FORMATS.find((entry) => entry.id === formatId);
      if (!format || !state.character) return;

      // Metered formats are the paywall: check credits before doing any work.
      if (format.metered && state.tier.rendersLeft <= 0) {
        dispatch({
          type: 'exportFailed',
          message: 'No render credits left. Upgrade to keep exporting video.',
        });
        return;
      }

      dispatch({ type: 'exportStarted', formatId });
      adopt(null);

      try {
        // Video capture needs audio unlocked, otherwise the take records a
        // silent, motionless character on iOS.
        if (formatId === 'video' && audio.needsGesture && !audio.unlocked) {
          await audio.unlock();
        }

        const result = await runExport(formatId, {
          rig: scene.current.rig,
          canvas: scene.current.canvas,
          characterId: state.character.id,
          characterName: state.character.name,
          script: state.script,
          voiceLabel: state.voice.voiceURI || state.voice.lang,
          timeline: lipSync.timeline,
          transparentBackground: state.transparentBackground,
          getAudioStream: lipSync.getAudioStream,
          onProgress: (progress) => dispatch({ type: 'exportProgress', progress }),
          playTake:
            formatId === 'video'
              ? () =>
                  new Promise<void>((resolve) => {
                    lipSync.speak();
                    // The timeline length is the source of truth for the take;
                    // `onend` is unreliable on Safari for long utterances.
                    window.setTimeout(resolve, lipSync.timeline.duration + 400);
                  })
              : undefined,
        });

        adopt(result);
        dispatch({
          type: 'exportSucceeded',
          message: `${result.filename} saved`,
          consumedRender: format.metered,
        });
      } catch (error) {
        dispatch({
          type: 'exportFailed',
          message:
            error instanceof ExportError
              ? error.message
              : 'Export failed. Check your connection and try again.',
        });
      } finally {
        if (formatId === 'video') lipSync.stop();
      }
    },
    [state, dispatch, scene, lipSync, audio, adopt],
  );

  const saveLastResult = useCallback(() => {
    if (lastResult?.blob) downloadBlob(lastResult.blob, lastResult.filename);
  }, [lastResult]);

  const saveToLibrary = useCallback(async () => {
    if (!state.character) return;
    dispatch({ type: 'cloudSaveStarted' });

    try {
      await saveToCloudLibrary({
        character: state.character,
        script: state.script,
        voice: state.voice,
        motion: state.motion,
        visemeCount: lipSync.timeline.keys.length,
        durationMs: lipSync.timeline.duration,
      });
      dispatch({ type: 'cloudSaveSucceeded' });
    } catch (error) {
      dispatch({
        type: 'cloudSaveFailed',
        message: error instanceof Error ? error.message : 'Could not reach the library.',
      });
    }
  }, [state, dispatch, lipSync]);

  return { run, saveToLibrary, lastResult, saveLastResult, clearResult: () => adopt(null) };
}
