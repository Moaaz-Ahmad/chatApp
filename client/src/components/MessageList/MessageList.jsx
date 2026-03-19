import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import MessageBubble from "./MessageBubble";
import "./MessageList.css";

// ── Helpers ───────────────────────────────────────────────────────────────────

function DateDivider({ date }) {
  const label = (() => {
    const d         = new Date(date);
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString())     return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  })();
  return <div className="date-divider"><span>{label}</span></div>;
}

function groupByDate(messages) {
  const groups  = [];
  let lastDate  = null;
  for (const msg of messages) {
    const date = new Date(msg.createdAt).toDateString();
    if (date !== lastDate) {
      groups.push({ type: "date", date: msg.createdAt, key: `date-${msg.createdAt}-${msg.id}` });
      lastDate = date;
    }
    groups.push({ type: "message", message: msg, key: msg.id });
  }
  return groups;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MessageList({
  messages,
  currentUserId,
  typingUsers       = [],
  isLoadingMessages = false,
  isLoadingMore     = false,
  hasMoreMessages   = false,
  onLoadMore,
}) {
  const listRef          = useRef(null);
  const bottomRef        = useRef(null);
  const prevLengthRef    = useRef(0);
  const prevScrollHeight = useRef(0);
  const isPrependRef     = useRef(false);

  // ── Capture scrollHeight BEFORE React paints the prepended messages ───────
  // useLayoutEffect runs synchronously after state update but before browser paint.
  // We set isPrependRef when messages shrinks (cleared) or grows at the front.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const newLength = messages.length;
    const oldLength = prevLengthRef.current;

    if (newLength === 0) {
      // Conversation cleared — will scroll to bottom after new messages load
      isPrependRef.current = false;
    } else if (newLength > oldLength && isPrependRef.current) {
      // Restore scroll so the user stays at the same visual position
      list.scrollTop = list.scrollHeight - prevScrollHeight.current;
      isPrependRef.current = false;
    } else if (newLength > oldLength) {
      // Append — scroll to bottom
      bottomRef.current?.scrollIntoView({ behavior: oldLength === 0 ? "auto" : "smooth" });
    }

    prevLengthRef.current = newLength;
  }, [messages]);

  // Scroll to bottom when typing indicator appears
  useEffect(() => {
    if (typingUsers.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [typingUsers]);

  // ── Scroll handler: trigger loadMore when user scrolls near the top ───────
  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list || !hasMoreMessages || isLoadingMore || !onLoadMore) return;
    if (list.scrollTop < 100) {
      // Snapshot scrollHeight so we can restore position after prepend
      prevScrollHeight.current = list.scrollHeight;
      isPrependRef.current     = true;
      onLoadMore();
    }
  }, [hasMoreMessages, isLoadingMore, onLoadMore]);

  const items = groupByDate(messages);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="message-list" ref={listRef} onScroll={handleScroll}>

      {/* Top: spinner while loading older pages */}
      {isLoadingMore && (
        <div className="message-list__load-more-spinner">
          <span className="ml-spinner" />
        </div>
      )}

      {/* "Load more" sentinel shown when there are older pages but not loading */}
      {hasMoreMessages && !isLoadingMore && messages.length > 0 && (
        <button className="message-list__load-more-btn" onClick={() => {
          const list = listRef.current;
          if (list) prevScrollHeight.current = list.scrollHeight;
          isPrependRef.current = true;
          onLoadMore?.();
        }}>
          Load older messages
        </button>
      )}

      {/* Initial load spinner */}
      {isLoadingMessages && (
        <div className="message-list__loading">
          <span className="ml-spinner" />
          <span>Loading messages…</span>
        </div>
      )}

      {/* Empty state (only when not loading) */}
      {!isLoadingMessages && items.length === 0 && (
        <p className="message-list__empty">No messages yet. Say hello!</p>
      )}

      {/* Message items */}
      {items.map((item) =>
        item.type === "date" ? (
          <DateDivider key={item.key} date={item.date} />
        ) : (
          <MessageBubble
            key={item.key}
            message={item.message}
            isMine={item.message.senderId === currentUserId}
          />
        )
      )}

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="typing-indicator">
          <div className="typing-indicator__dots">
            <span /><span /><span />
          </div>
          <span className="typing-indicator__label">
            {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing…
          </span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
