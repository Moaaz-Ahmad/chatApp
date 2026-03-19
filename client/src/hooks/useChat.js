import { useEffect, useState, useCallback, useRef } from "react";
import socket from "../socket";
import { fetchMessages } from "../api/conversations";

const HEARTBEAT_INTERVAL_MS = 30_000;
const PAGE_SIZE = 30;

/**
 * Manages the active conversation's message list and all socket I/O.
 *
 * @param {string|null} userId
 * @param {string|null} conversationId
 * @param {{
 *   accessToken?: string|null,
 *   onNewMessage?: (msg: object) => void,
 *   onPresenceChange?: (userId: string, isOnline: boolean, lastSeenAt?: string) => void,
 *   onAuthExpired?: () => void,
 *   onAuthInvalid?: () => void,
 * }} [options]
 */
export function useChat(userId, conversationId, {
  accessToken,
  onNewMessage,
  onPresenceChange,
  onAuthExpired,
  onAuthInvalid,
} = {}) {
  const [messages,          setMessages]          = useState([]);
  const [typingUsers,       setTypingUsers]       = useState([]);
  const [isConnected,       setIsConnected]       = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMore,     setIsLoadingMore]     = useState(false);
  const [hasMoreMessages,   setHasMoreMessages]   = useState(false);

  // ── Stable refs (avoid stale closures in callbacks) ───────────────────────
  const conversationIdRef   = useRef(conversationId);
  const userIdRef           = useRef(userId);
  const accessTokenRef      = useRef(accessToken);
  const onNewMessageRef     = useRef(onNewMessage);
  const onPresenceChangeRef = useRef(onPresenceChange);
  const onAuthExpiredRef    = useRef(onAuthExpired);
  const onAuthInvalidRef    = useRef(onAuthInvalid);
  const heartbeatTimerRef   = useRef(null);

  // Cursor: createdAt of the oldest loaded message — used for "load more" pagination
  const oldestCreatedAtRef  = useRef(null);

  useEffect(() => { conversationIdRef.current   = conversationId;   }, [conversationId]);
  useEffect(() => { userIdRef.current           = userId;           }, [userId]);
  useEffect(() => { accessTokenRef.current      = accessToken;      }, [accessToken]);
  useEffect(() => { onNewMessageRef.current     = onNewMessage;     }, [onNewMessage]);
  useEffect(() => { onPresenceChangeRef.current = onPresenceChange; }, [onPresenceChange]);
  useEffect(() => { onAuthExpiredRef.current    = onAuthExpired;    }, [onAuthExpired]);
  useEffect(() => { onAuthInvalidRef.current    = onAuthInvalid;    }, [onAuthInvalid]);

  // ── Connection lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken || !userId) return;

    socket.auth = { token: accessToken };

    function onConnect() {
      setIsConnected(true);
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = setInterval(() => {
        socket.emit("presence:heartbeat");
      }, HEARTBEAT_INTERVAL_MS);

      // Re-join active conversation on connect / reconnect
      if (conversationIdRef.current) {
        socket.emit("conversation:join", conversationIdRef.current);
      }
    }

    function onDisconnect() {
      setIsConnected(false);
      clearInterval(heartbeatTimerRef.current);
    }

    function onConnectError(err) {
      if (err.message === "AUTH_EXPIRED") {
        onAuthExpiredRef.current?.();
      } else if (err.message === "AUTH_INVALID" || err.message === "AUTH_MISSING") {
        onAuthInvalidRef.current?.();
      }
    }

    socket.on("connect",       onConnect);
    socket.on("disconnect",    onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.connect();

    return () => {
      clearInterval(heartbeatTimerRef.current);
      socket.off("connect",       onConnect);
      socket.off("disconnect",    onDisconnect);
      socket.off("connect_error", onConnectError);
      setIsConnected(false);
      socket.disconnect();
    };
  }, [accessToken, userId]);

  // ── Join / leave rooms + load history ────────────────────────────────────
  const prevConvRef = useRef(null);

  useEffect(() => {
    if (prevConvRef.current && prevConvRef.current !== conversationId) {
      socket.emit("conversation:leave", prevConvRef.current);
    }

    // Reset message state for the new conversation
    setMessages([]);
    setTypingUsers([]);
    setHasMoreMessages(false);
    oldestCreatedAtRef.current = null;

    if (conversationId) {
      socket.emit("conversation:join", conversationId);

      // Fetch the most recent page of messages from the REST API.
      // We use accessTokenRef to avoid re-triggering this effect on token refresh.
      const token = accessTokenRef.current;
      if (token) {
        setIsLoadingMessages(true);
        fetchMessages(conversationId, token, { limit: PAGE_SIZE })
          .then((msgs) => {
            // Only apply if the user hasn't switched away during the fetch
            if (conversationIdRef.current !== conversationId) return;
            setMessages(msgs);
            setHasMoreMessages(msgs.length === PAGE_SIZE);
            if (msgs.length > 0) oldestCreatedAtRef.current = msgs[0].createdAt;
          })
          .catch((err) => console.error("[useChat] fetchMessages:", err))
          .finally(() => {
            if (conversationIdRef.current === conversationId) {
              setIsLoadingMessages(false);
            }
          });
      }
    }

    prevConvRef.current = conversationId;
  }, [conversationId]); // accessToken intentionally excluded — use ref to avoid refetch on rotation

  // ── Load older messages (scroll-up pagination) ────────────────────────────
  const loadMoreMessages = useCallback(async () => {
    const convId = conversationIdRef.current;
    const token  = accessTokenRef.current;
    if (!convId || !token || !oldestCreatedAtRef.current) return;

    setIsLoadingMore(true);
    try {
      const older = await fetchMessages(convId, token, {
        before: oldestCreatedAtRef.current,
        limit:  PAGE_SIZE,
      });
      if (older.length === 0) {
        setHasMoreMessages(false);
        return;
      }
      setMessages((prev) => {
        // Deduplicate — older pages should never overlap but guard anyway
        const existingIds = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m) => !existingIds.has(m.id));
        return [...fresh, ...prev];
      });
      oldestCreatedAtRef.current = older[0].createdAt;
      setHasMoreMessages(older.length === PAGE_SIZE);
    } catch (err) {
      console.error("[useChat] loadMoreMessages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, []); // no deps — everything read via refs

  // ── Incoming socket events ────────────────────────────────────────────────
  useEffect(() => {
    function onMessageNew(message) {
      setMessages((prev) => {
        const isDuplicate = prev.some(
          (m) => m.id === message.id || (message.clientId && m.clientId === message.clientId)
        );
        if (isDuplicate) return prev;
        return [...prev, message];
      });

      onNewMessageRef.current?.(message);

      socket.emit("message:delivered", {
        messageId:      message.id,
        senderId:       message.senderId,
        conversationId: message.conversationId,
      });

      if (message.conversationId === conversationIdRef.current) {
        socket.emit("message:read", {
          messageId:      message.id,
          senderId:       message.senderId,
          conversationId: message.conversationId,
        });
      }
    }

    function onMessageDelivered({ messageId }) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.status === "SENT" ? { ...m, status: "DELIVERED" } : m
        )
      );
    }

    function onMessageRead({ messageId, readerId }) {
      if (readerId === userIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: "READ" } : m))
      );
    }

    function onTyping({ userId: typingUserId, isTyping }) {
      if (typingUserId === userIdRef.current) return;
      setTypingUsers((prev) =>
        isTyping
          ? prev.includes(typingUserId) ? prev : [...prev, typingUserId]
          : prev.filter((id) => id !== typingUserId)
      );
    }

    function onConversationPresence({ conversationId: convId, onlineUserIds, typingUserIds }) {
      if (convId !== conversationIdRef.current) return;
      setTypingUsers(typingUserIds.filter((uid) => uid !== userIdRef.current));
      onlineUserIds.forEach((uid) => onPresenceChangeRef.current?.(uid, true));
    }

    function onUserOnline({ userId: uid }) {
      onPresenceChangeRef.current?.(uid, true);
    }

    function onUserOffline({ userId: uid, lastSeenAt }) {
      onPresenceChangeRef.current?.(uid, false, lastSeenAt);
    }

    socket.on("message:new",           onMessageNew);
    socket.on("message:delivered",     onMessageDelivered);
    socket.on("message:read",          onMessageRead);
    socket.on("conversation:typing",   onTyping);
    socket.on("conversation:presence", onConversationPresence);
    socket.on("user:online",           onUserOnline);
    socket.on("user:offline",          onUserOffline);

    return () => {
      socket.off("message:new",           onMessageNew);
      socket.off("message:delivered",     onMessageDelivered);
      socket.off("message:read",          onMessageRead);
      socket.off("conversation:typing",   onTyping);
      socket.off("conversation:presence", onConversationPresence);
      socket.off("user:online",           onUserOnline);
      socket.off("user:offline",          onUserOffline);
    };
  }, []);

  // ── Send message (optimistic) ─────────────────────────────────────────────
  const sendMessage = useCallback(
    (payload) => {
      const convId = conversationIdRef.current;
      if (!convId || !isConnected) return;

      const clientId   = crypto.randomUUID();
      const optimistic = {
        id:             clientId,
        clientId,
        conversationId: convId,
        senderId:       userIdRef.current,
        content:        payload.content ?? null,
        type:           payload.type ?? "TEXT",
        attachments:    payload.attachments ?? [],
        status:         "SENDING",
        createdAt:      new Date().toISOString(),
        isOptimistic:   true,
      };

      setMessages((prev) => [...prev, optimistic]);

      socket.emit("message:send", { ...payload, conversationId: convId, clientId }, (ack) => {
        if (ack?.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientId === clientId ? { ...ack.message, isOptimistic: false } : m
            )
          );
          onNewMessageRef.current?.(ack.message);
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.clientId === clientId ? { ...m, status: "FAILED" } : m))
          );
          console.error("[sendMessage] server rejected:", ack?.error);
        }
      });
    },
    [isConnected]
  );

  // ── Typing indicator ──────────────────────────────────────────────────────
  const emitTyping = useCallback((isTyping) => {
    const convId = conversationIdRef.current;
    if (!convId) return;
    socket.emit("conversation:typing", { conversationId: convId, isTyping });
  }, []);

  return {
    messages,
    typingUsers,
    isConnected,
    isLoadingMessages,
    isLoadingMore,
    hasMoreMessages,
    sendMessage,
    emitTyping,
    loadMoreMessages,
  };
}
