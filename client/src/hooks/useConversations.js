import { useState, useCallback, useRef, useEffect } from "react";
import { fetchConversations } from "../api/conversations";

// ── Shape normalizer ──────────────────────────────────────────────────────────
// The API returns conversations with a `members` array. We flatten them into
// the shape the Sidebar components expect.
function normalizeConversation(conv, currentUserId) {
  if (conv.type === "DIRECT") {
    const other = conv.members?.find((m) => m.user.id !== currentUserId);
    return {
      id:          conv.id,
      type:        "DIRECT",
      name:        other?.user.displayName ?? other?.user.username ?? "Unknown",
      memberId:    other?.user.id ?? null,
      avatarUrl:   other?.user.avatarUrl ?? null,
      isOnline:    other?.user.isOnline ?? false,
      lastSeenAt:  other?.user.lastSeenAt ?? null,
      lastMessage: conv.lastMessage ?? null,
      unreadCount: conv.unreadCount ?? 0,
    };
  }
  return {
    id:          conv.id,
    type:        "GROUP",
    name:        conv.name ?? "Group",
    memberId:    null,
    avatarUrl:   null,
    isOnline:    false,
    lastSeenAt:  null,
    lastMessage: conv.lastMessage ?? null,
    unreadCount: conv.unreadCount ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the sidebar conversation list.
 *
 * @param {string|null} activeConvId  - currently open conversation
 * @param {string|null} accessToken   - JWT; triggers a fetch when it becomes available
 * @param {string|null} currentUserId - used to identify the "other" member in DIRECT chats
 */
export function useConversations(activeConvId, accessToken, currentUserId) {
  const [conversations, setConversations] = useState([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  const activeConvIdRef  = useRef(activeConvId);
  const currentUserIdRef = useRef(currentUserId);
  activeConvIdRef.current  = activeConvId;
  currentUserIdRef.current = currentUserId;

  // ── Load real conversations from the API ──────────────────────────────────
  useEffect(() => {
    if (!accessToken || !currentUserId) return;
    let cancelled = false;
    setIsLoadingConversations(true);
    fetchConversations(accessToken)
      .then((data) => {
        if (cancelled) return;
        setConversations(data.map((c) => normalizeConversation(c, currentUserId)));
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setIsLoadingConversations(false); });
    return () => { cancelled = true; };
  }, [accessToken, currentUserId]);

  // ── Add a freshly created conversation to the top of the list ────────────
  const addConversation = useCallback((rawConv) => {
    const normalized = normalizeConversation(rawConv, currentUserIdRef.current);
    setConversations((prev) => {
      if (prev.some((c) => c.id === normalized.id)) return prev;
      return [normalized, ...prev];
    });
    return normalized;
  }, []);

  // ── Sidebar last-message preview + unread count ───────────────────────────
  const handleNewMessage = useCallback((message) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== message.conversationId) return conv;
        const isActive = conv.id === activeConvIdRef.current;
        return {
          ...conv,
          lastMessage: {
            content:   message.content ?? "(attachment)",
            createdAt: message.createdAt,
          },
          unreadCount: isActive ? 0 : (conv.unreadCount ?? 0) + 1,
        };
      })
    );
  }, []);

  const resetUnread = useCallback((convId) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c))
    );
  }, []);

  // ── Presence ──────────────────────────────────────────────────────────────
  const handlePresenceChange = useCallback((userId, isOnline, lastSeenAt) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.memberId !== userId) return conv;
        return {
          ...conv,
          isOnline,
          ...(lastSeenAt && !isOnline ? { lastSeenAt } : {}),
        };
      })
    );
  }, []);

  return {
    conversations,
    isLoadingConversations,
    handleNewMessage,
    handlePresenceChange,
    resetUnread,
    addConversation,
  };
}
