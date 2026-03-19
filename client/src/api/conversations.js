const BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

export async function fetchConversations(token) {
  const res = await fetch(`${BASE}/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

/**
 * Fetch a page of messages for a conversation.
 * @param {string} conversationId
 * @param {string} token
 * @param {{ before?: string, after?: string, limit?: number }} [opts]
 */
export async function fetchMessages(conversationId, token, opts = {}) {
  const params = new URLSearchParams();
  if (opts.before) params.set("before", opts.before);
  if (opts.after)  params.set("after",  opts.after);
  if (opts.limit)  params.set("limit",  String(opts.limit));

  const qs  = params.toString();
  const url = `${BASE}/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

export async function createDirectConversation(targetUserId, token) {
  const res = await fetch(`${BASE}/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ type: "DIRECT", targetUserId }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}
