import { motion } from 'motion/react';
import type { AspectRatio, GenerationMode, Shot } from '../../domain/shot.js';
import { isGenerationInFlight } from '../../domain/shot.js';
import { describeGeneration, formatSeconds, humanize } from '../format.js';
import { ImageIcon, PlayIcon } from './icons.js';

export interface ShotCardProps {
  readonly shot: Shot;
  readonly number: number;
  readonly aspectRatio: AspectRatio;
  readonly onGenerate: (mode: GenerationMode) => void;
  readonly onCancel: () => void;
}

function planSignature(shot: Shot): string {
  return [shot.durationSeconds, shot.framing, shot.cameraMove, shot.description, shot.prompt].join('|');
}

function Media({ shot, aspectRatio }: Pick<ShotCardProps, 'shot' | 'aspectRatio'>) {
  const frame = { aspectRatio: aspectRatio.replace(':', ' / ') };
  const { clip, keyframeUrl } = shot;
  if (clip && clip.mimeType.startsWith('video/')) {
    return (
      <div className="media" style={frame}>
        <video src={clip.url} poster={keyframeUrl ?? undefined} controls loop muted playsInline />
      </div>
    );
  }
  const url = clip?.url ?? keyframeUrl;
  return (
    <div className="media" style={frame}>
      {url ? <img src={url} alt={`Shot: ${shot.description}`} /> : <span className="media-empty">No keyframe yet</span>}
      {clip && <span className="media-badge">Clip</span>}
    </div>
  );
}

/** One storyboard card: the plan, the render status, and the generate actions. */
export function ShotCard({ shot, number, aspectRatio, onGenerate, onCancel }: ShotCardProps) {
  const status = describeGeneration(shot.generation);
  const busy = isGenerationInFlight(shot.generation);

  return (
    <motion.li
      layout="position"
      className="shot"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      data-testid={`shot-${shot.id}`}
    >
      <motion.span
        key={planSignature(shot)}
        className="flash"
        initial={{ opacity: 0.55 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        aria-hidden="true"
      />
      <div className="shot-head">
        <motion.span key={number} className="shot-number" initial={{ scale: 1.25 }} animate={{ scale: 1 }}>
          {String(number).padStart(2, '0')}
        </motion.span>
        <span className="chip">{formatSeconds(shot.durationSeconds)}</span>
        <span className="chip">{humanize(shot.framing)}</span>
        <span className="chip">{humanize(shot.cameraMove)}</span>
        <span className={`status status-${status.tone}`}>{status.label}</span>
      </div>

      <Media shot={shot} aspectRatio={aspectRatio} />

      {status.progress !== null && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.progress * 100)}>
          <motion.div className="progress-bar" animate={{ width: `${Math.max(4, status.progress * 100)}%` }} />
        </div>
      )}
      {shot.generation.status === 'failed' && <p className="shot-error">{shot.generation.error}</p>}

      <p className="shot-description">{shot.description}</p>
      <details className="shot-prompt">
        <summary>Generation prompt</summary>
        <code>{shot.prompt}</code>
      </details>

      <div className="shot-actions">
        {busy ? (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <>
            <button type="button" className="button" onClick={() => onGenerate('image')}>
              <ImageIcon /> {shot.keyframeUrl ? 'Redo keyframe' : 'Keyframe'}
            </button>
            <button type="button" className="button button-accent" onClick={() => onGenerate('video')}>
              <PlayIcon /> {shot.clip ? 'Redo clip' : 'Animate'}
            </button>
          </>
        )}
      </div>
    </motion.li>
  );
}
