import { useCallback, useState } from 'react';
import { ExportError, runExport, saveToCloudLibrary, type ExportResult } from '../lib/exporters';
import { useStudio } from '../state/StudioContext';
import { EXPORT_FORMATS, type ExportFormatId } from '../types/studio';

export interface ExportRunnerApi {
  run: (formatId: ExportFormatId) => Promise<void>;
  saveToLibrary: () => Promise<void>;
  lastResult: ExportResult | null;
  clearResult: () => void;
}

export function useExportRunner(): ExportRunnerApi {
  const { state, dispatch, scene, lipSync, audio } = useStudio();
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);

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
      setLastResult(null);

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

        setLastResult(result);
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
    [state, dispatch, scene, lipSync, audio],
  );

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

  return { run, saveToLibrary, lastResult, clearResult: () => setLastResult(null) };
}
