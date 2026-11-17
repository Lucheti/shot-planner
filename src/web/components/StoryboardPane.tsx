import { AnimatePresence } from 'motion/react';
import { isEmpty, totalSeconds } from '../../domain/storyboard.js';
import { exportFilename, storyboardToJson } from '../export/storyboard-export.js';
import { downloadTextFile } from '../export/download.js';
import { formatSeconds } from '../format.js';
import { useSession } from '../state/session-context.js';
import { DownloadIcon, ImageIcon, PlayIcon, PrintIcon, TrashIcon } from './icons.js';
import { ShotCard } from './ShotCard.js';

function EmptyBoard() {
  return (
    <div className="board-empty">
      <div className="frames" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <h2>Your storyboard appears here.</h2>
      <p>Shots arrive as cards and move when you ask for changes in the chat.</p>
    </div>
  );
}

function Toolbar() {
  const board = useSession((s) => s.board);
  const generateAll = useSession((s) => s.generateAll);
  const reset = useSession((s) => s.reset);
  const empty = isEmpty(board);

  return (
    <div className="toolbar" role="toolbar" aria-label="Storyboard actions">
      <button type="button" className="button" disabled={empty} onClick={() => void generateAll('image')}>
        <ImageIcon /> Generate all
      </button>
      <button type="button" className="button" disabled={empty} onClick={() => void generateAll('video')}>
        <PlayIcon /> Animate all
      </button>
      <span className="toolbar-gap" />
      <button
        type="button"
        className="button"
        disabled={empty}
        onClick={() => downloadTextFile(exportFilename(board, 'json'), storyboardToJson(board), 'application/json')}
      >
        <DownloadIcon /> JSON
      </button>
      <button type="button" className="button" disabled={empty} onClick={() => window.print()}>
        <PrintIcon /> Print
      </button>
      <button type="button" className="button button-quiet" onClick={reset} aria-label="Start over">
        <TrashIcon /> New
      </button>
    </div>
  );
}

/** The right pane: the animated shot list, with generate and export actions. */
export function StoryboardPane() {
  const board = useSession((s) => s.board);
  const generate = useSession((s) => s.generate);
  const cancel = useSession((s) => s.cancelGeneration);

  return (
    <section className="pane board" aria-label="Storyboard">
      <header className="board-head">
        <div>
          <h1>{board.title || 'Storyboard'}</h1>
          {!isEmpty(board) && (
            <p className="meta">
              {board.shots.length} shots · {formatSeconds(totalSeconds(board))} · {board.aspectRatio}
            </p>
          )}
        </div>
        <Toolbar />
      </header>
      <div className="scroller">
        {isEmpty(board) ? (
          <EmptyBoard />
        ) : (
          <ol className="shots">
            <AnimatePresence initial={false} mode="popLayout">
              {board.shots.map((shot, index) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  number={index + 1}
                  aspectRatio={board.aspectRatio}
                  onGenerate={(mode) => void generate(shot.id, mode)}
                  onCancel={() => cancel(shot.id)}
                />
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </section>
  );
}
