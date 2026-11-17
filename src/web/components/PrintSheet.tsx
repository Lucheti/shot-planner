import { totalSeconds } from '../../domain/storyboard.js';
import { formatSeconds, humanize } from '../format.js';
import { useSession } from '../state/session-context.js';

/** The printable storyboard. Hidden on screen, the only thing visible when printing. */
export function PrintSheet() {
  const board = useSession((s) => s.board);
  if (board.shots.length === 0) return null;

  return (
    <section className="print-sheet" aria-hidden="true">
      <h1>{board.title}</h1>
      <p>
        {board.shots.length} shots · {formatSeconds(totalSeconds(board))} · {board.aspectRatio}
      </p>
      <ol>
        {board.shots.map((shot, index) => (
          <li key={shot.id}>
            <div className="print-frame" style={{ aspectRatio: board.aspectRatio.replace(':', ' / ') }}>
              {shot.keyframeUrl ? <img src={shot.keyframeUrl} alt="" /> : <span>{String(index + 1).padStart(2, '0')}</span>}
            </div>
            <div>
              <h2>
                Shot {index + 1} · {formatSeconds(shot.durationSeconds)} · {humanize(shot.framing)} · {humanize(shot.cameraMove)}
              </h2>
              <p>{shot.description}</p>
              <p className="print-prompt">{shot.prompt}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
