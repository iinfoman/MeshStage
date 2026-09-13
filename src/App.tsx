import { useCallback, useMemo, useState } from 'react';
import { StudioProvider, useStudio } from './state/StudioContext';
import { StepBar } from './components/StepBar';
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog';
import { StageInput } from './components/stages/StageInput';
import { StageProcessing } from './components/stages/StageProcessing';
import { StageVoiceRig } from './components/stages/StageVoiceRig';
import { StageExport } from './components/stages/StageExport';
import type { StageId } from './types/studio';

function Studio() {
  const { state, dispatch } = useStudio();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const requestConfirm = useCallback((request: ConfirmRequest) => setConfirmRequest(request), []);

  // Backward travel only, and never back into a job that is mid-flight.
  const navigable = useMemo<StageId[]>(() => {
    if (state.stage === 'export') return ['voice'];
    return [];
  }, [state.stage]);

  return (
    /**
     * The shell is a fixed-height flex column, never a scrolling page. Only the
     * inner panes scroll, which keeps the step bar and action bar pinned while
     * iOS Safari's address bar collapses — `app-height` resolves to 100dvh.
     */
    <div className="app-height flex w-full flex-col overflow-hidden bg-obsidian-950">
      <header className="safe-top z-30 shrink-0">
        <StepBar
          current={state.stage}
          navigable={navigable}
          onNavigate={(stage) => dispatch({ type: 'goToStage', stage })}
        />
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {state.stage === 'input' && <StageInput onConfirm={requestConfirm} />}
        {state.stage === 'processing' && <StageProcessing onConfirm={requestConfirm} />}
        {state.stage === 'voice' && <StageVoiceRig onConfirm={requestConfirm} />}
        {state.stage === 'export' && <StageExport onConfirm={requestConfirm} />}
      </main>

      <ConfirmDialog request={confirmRequest} onDismiss={() => setConfirmRequest(null)} />
    </div>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Studio />
    </StudioProvider>
  );
}
