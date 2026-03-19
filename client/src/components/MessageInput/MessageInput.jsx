import { useState, useRef, useCallback, useEffect } from "react";
import "./MessageInput.css";

const TYPING_DEBOUNCE_MS = 1500;

export default function MessageInput({ onSend, onTyping, disabled }) {
  const [text, setText] = useState("");
  const typingTimerRef = useRef(null);
  const isTypingRef   = useRef(false);
  const textareaRef   = useRef(null);

  // Cross-browser auto-grow: reset to 1 row, then expand to content height.
  // max-height + overflow-y in CSS cap it at 140 px.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const triggerTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTyping?.(true);
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      onTyping?.(false);
    }, TYPING_DEBOUNCE_MS);
  }, [onTyping]);

  const handleChange = (e) => {
    setText(e.target.value);
    if (e.target.value) triggerTyping();
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    onSend?.({ content: trimmed, type: "TEXT" });
    setText("");

    clearTimeout(typingTimerRef.current);
    isTypingRef.current = false;
    onTyping?.(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="message-input">
      <button className="message-input__action" title="Attach file" type="button">
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <path
            d="M16.5 10.5L9 18a5 5 0 01-7-7l8-8a3 3 0 014 4l-7.5 7.5a1 1 0 01-1.5-1.5L12 6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <textarea
        ref={textareaRef}
        className="message-input__textarea"
        rows={1}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Type a message…"
        disabled={disabled}
      />

      <button className="message-input__action" title="Emoji" type="button">
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7 11.5s.9 2 3 2 3-2 3-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7.5" cy="8.5" r="1" fill="currentColor" />
          <circle cx="12.5" cy="8.5" r="1" fill="currentColor" />
        </svg>
      </button>

      <button
        className={`message-input__send ${text.trim() ? "message-input__send--active" : ""}`}
        onClick={handleSend}
        disabled={!text.trim() || disabled}
        title="Send"
        type="button"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
          <path d="M2.5 2.5l15 7.5-15 7.5V12l10-2-10-2V2.5z" />
        </svg>
      </button>
    </div>
  );
}
