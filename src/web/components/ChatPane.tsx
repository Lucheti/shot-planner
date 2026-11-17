import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ComponentType, type FormEvent, type KeyboardEvent } from 'react';
import type { ActionStatus, AssistantPart, TranscriptEntry } from '../state/session.js';
import { useSession } from '../state/session-context.js';
import { CheckIcon, CrossIcon, SendIcon, SpinnerIcon, StopIcon } from './icons.js';

const EXAMPLES = [
  'A 20-second teaser for a ceramic studio, warm morning light',
  'A vertical 15-second ad for a cold brew coffee brand',
  'A 30-second product film for a minimalist watch, moody and slow',
];

const STATUS_ICON: Readonly<Record<ActionStatus, ComponentType>> = {
  running: SpinnerIcon,
  ok: CheckIcon,
  error: CrossIcon,
};

function ActionChip({ part }: { part: Extract<AssistantPart, { kind: 'action' }> }) {
  const Icon = STATUS_ICON[part.status];
  return (
    <motion.div
      className={`action action-${part.status}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      title={part.tool}
    >
      <Icon />
      <span>{part.summary}</span>
    </motion.div>
  );
}

function AssistantMessage({ entry }: { entry: Extract<TranscriptEntry, { role: 'assistant' }> }) {
  const empty = entry.parts.length === 0;
  return (
    <div className="message message-assistant">
      {entry.parts.map((part, index) => {
        switch (part.kind) {
          case 'text':
            return (
              <p key={index} className="prose">
                {part.text.trim()}
              </p>
            );
          case 'action':
            return <ActionChip key={part.callId} part={part} />;
          case 'notice':
            return (
              <p key={index} className="notice">
                {part.text}
              </p>
            );
        }
      })}
      {empty && !entry.done && <span className="typing" aria-label="Thinking"><i /><i /><i /></span>}
    </div>
  );
}

function Transcript({ entries }: { entries: readonly TranscriptEntry[] }) {
  return (
    <>
      {entries.map((entry) => (
        <motion.div key={entry.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {entry.role === 'user' ? (
            <div className="message message-user">{entry.text}</div>
          ) : (
            <AssistantMessage entry={entry} />
          )}
        </motion.div>
      ))}
    </>
  );
}

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="chat-empty">
      <h2>Describe your video.</h2>
      <p>I will ask a question or two, then propose a shot list you can steer by talking.</p>
      <ul>
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button type="button" className="example" onClick={() => onPick(example)}>
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Composer() {
  const send = useSession((s) => s.send);
  const stop = useSession((s) => s.stop);
  const running = useSession((s) => s.chatRunning);
  const [draft, setDraft] = useState('');

  const submit = (event?: FormEvent): void => {
    event?.preventDefault();
    if (!draft.trim() || running) return;
    void send(draft);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        aria-label="Message"
        placeholder="Write a brief, or tell me what to change…"
        rows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {running ? (
        <button type="button" className="icon-button stop" onClick={stop} aria-label="Stop">
          <StopIcon />
        </button>
      ) : (
        <button type="submit" className="icon-button send" disabled={!draft.trim()} aria-label="Send">
          <SendIcon />
        </button>
      )}
    </form>
  );
}

/** The left pane: the streamed conversation with inline tool actions, and the composer. */
export function ChatPane() {
  const transcript = useSession((s) => s.transcript);
  const send = useSession((s) => s.send);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [transcript]);

  return (
    <section className="pane chat" aria-label="Chat">
      <div className="scroller" ref={scroller}>
        <AnimatePresence initial={false}>
          {transcript.length === 0 ? <EmptyChat onPick={(text) => void send(text)} /> : <Transcript entries={transcript} />}
        </AnimatePresence>
      </div>
      <Composer />
    </section>
  );
}
