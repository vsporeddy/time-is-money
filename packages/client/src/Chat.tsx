import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ChatMessage } from 'shared';
import { SpriteIcon } from './SpriteIcon';

const CHAT_ICON_SPRITE_INDEX = 3; // speech bubble

interface ChatProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export function Chat({ messages, onSend }: ChatProps) {
  const [draft, setDraft] = useState('');
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
    onSend(text);
    setDraft('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <SpriteIcon index={CHAT_ICON_SPRITE_INDEX} scale={2} />
        <span>Chat</span>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <p className="chat-empty">No messages yet — say hi.</p>}
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
    </div>
  );
}
