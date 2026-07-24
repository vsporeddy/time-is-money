import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ChatMessage } from 'shared';
import { SpriteIcon } from './SpriteIcon';
import { playClick } from './sound';

const CHAT_ICON_SPRITE_INDEX = 3; // speech bubble

interface ChatProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export function Chat({ messages, onSend }: ChatProps) {
  const [draft, setDraft] = useState('');
  // Chat eats too much of the screen on phones — start minimized there, but
  // stay open by default on desktop where the extra space isn't precious.
  const [minimized, setMinimized] = useState(() => window.matchMedia('(max-width: 560px)').matches);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    playClick();
    onSend(text);
    setDraft('');
  };

  return (
    <div className={`chat-panel${minimized ? ' minimized' : ''}`}>
      <div className="chat-header">
        <SpriteIcon index={CHAT_ICON_SPRITE_INDEX} scale={1} />
        <span>Chat</span>
        <button
          type="button"
          className="chat-toggle"
          onClick={() => setMinimized((m) => !m)}
          aria-label={minimized ? 'Expand chat' : 'Minimize chat'}
        >
          {minimized ? '+' : '−'}
        </button>
      </div>
      {!minimized && (
        <>
          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 && <p className="chat-empty">It's quiet in here...</p>}
            {messages.map((m) => (
              <p key={m.id} className="chat-line">
                <span className="chat-name">{m.name}:</span> <span className="chat-text">{m.text}</span>
              </p>
            ))}
          </div>
          <form className="chat-input-row" onSubmit={handleSend}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Say something…"
              maxLength={300}
            />
            <button type="submit">Send</button>
          </form>
        </>
      )}
    </div>
  );
}
