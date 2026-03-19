import { useState, useEffect, useRef, useCallback } from "react";
import { searchUsers } from "../../api/users";
import { createDirectConversation } from "../../api/conversations";
import "./ContactFinder.css";

/**
 * Modal that lets the user find contacts by email and start a direct chat.
 *
 * Props:
 *   accessToken  – current JWT
 *   onClose      – called when the modal should close
 *   onConversationCreated(conv) – called with the raw conversation object so
 *                                 App can add it to the sidebar and select it
 */
export default function ContactFinder({ accessToken, onClose, onConversationCreated }) {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [startingId, setStartingId] = useState(null); // user id being opened

  const inputRef     = useRef(null);
  const debounceRef  = useRef(null);

  // Auto-focus the input on open
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced search — fires 400 ms after the user stops typing
  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setQuery(val);
    setSearchError(null);

    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const users = await searchUsers(val.trim(), accessToken);
        setResults(users);
      } catch {
        setSearchError("Search failed. Please try again.");
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }, [accessToken]);

  const handleStartChat = useCallback(async (targetUser) => {
    setStartingId(targetUser.id);
    try {
      const conv = await createDirectConversation(targetUser.id, accessToken);
      onConversationCreated(conv);
      onClose();
    } catch {
      setSearchError("Could not open conversation. Please try again.");
    } finally {
      setStartingId(null);
    }
  }, [accessToken, onConversationCreated, onClose]);

  return (
    <div className="cf-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf-modal" role="dialog" aria-modal="true" aria-label="Find a contact">
        {/* Header */}
        <div className="cf-header">
          <span className="cf-title">New Conversation</span>
          <button className="cf-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="cf-search-wrap">
          <svg className="cf-search-icon" viewBox="0 0 20 20" fill="none" width="16" height="16">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="cf-search"
            type="email"
            placeholder="Search by email address…"
            value={query}
            onChange={handleChange}
            autoComplete="off"
          />
          {isSearching && <span className="cf-spinner" />}
        </div>

        {/* Error */}
        {searchError && <p className="cf-error">{searchError}</p>}

        {/* Results */}
        <ul className="cf-results">
          {results.length === 0 && query.trim().length >= 2 && !isSearching && (
            <li className="cf-empty">No users found for &ldquo;{query}&rdquo;</li>
          )}
          {results.map((u) => (
            <li key={u.id} className="cf-result-item">
              <div className="cf-result-avatar" aria-hidden="true">
                {u.avatarUrl
                  ? <img src={u.avatarUrl} alt="" className="cf-result-avatar-img" />
                  : (u.displayName ?? u.username)?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="cf-result-info">
                <span className="cf-result-name">{u.displayName ?? u.username}</span>
                <span className="cf-result-email">{u.email}</span>
              </div>
              <button
                className="cf-chat-btn"
                disabled={startingId === u.id}
                onClick={() => handleStartChat(u)}
              >
                {startingId === u.id ? "Opening…" : "Chat"}
              </button>
            </li>
          ))}
        </ul>

        {query.trim().length < 2 && (
          <p className="cf-hint">Type at least 2 characters to search</p>
        )}
      </div>
    </div>
  );
}
