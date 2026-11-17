import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import type { AppInfo } from '../../protocol/messages.js';
import { useSession } from '../state/session-context.js';
import { ChatPane } from './ChatPane.js';
import { PrintSheet } from './PrintSheet.js';
import { StoryboardPane } from './StoryboardPane.js';

function ModeBanner({ info }: { info: AppInfo }) {
  const demoPlanner = info.planner === 'mock';
  const mockProviders = info.providers === 'mock';
  if (!demoPlanner && !mockProviders) return null;
  return (
    <div className="banner" role="status">
      <strong>{demoPlanner ? 'Demo mode' : 'Mock providers'}</strong>
      <span>
        {demoPlanner ? 'A scripted planner replies' : `Claude plans with ${info.model ?? 'the configured model'}`}
        {mockProviders ? ' and keyframes and clips are generated locally.' : ' and Runway renders the shots.'}
        {demoPlanner ? ' Set ANTHROPIC_API_KEY and RUNWAYML_API_SECRET to go live.' : ''}
      </span>
    </div>
  );
}

function ErrorToast() {
  const error = useSession((s) => s.error);
  const dismiss = useSession((s) => s.dismissError);
  if (!error) return null;
  return (
    <div className="toast" role="alert">
      <span>{error}</span>
      <button type="button" className="button button-quiet" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** The two-pane shell: chat on the left, storyboard on the right. */
export function App() {
  const info = useSession((s) => s.info);
  const loadInfo = useSession((s) => s.loadInfo);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <header className="topbar">
          <span className="brand">
            <i aria-hidden="true" /> shot-planner
          </span>
          {info && <ModeBanner info={info} />}
        </header>
        <main className="panes">
          <ChatPane />
          <StoryboardPane />
        </main>
        <ErrorToast />
      </div>
      <PrintSheet />
    </MotionConfig>
  );
}
