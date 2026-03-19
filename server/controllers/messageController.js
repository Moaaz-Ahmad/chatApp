const prisma = require("../lib/prisma");

/** Minimum sender fields to include with every returned message. */
const SENDER_SELECT = {
  id: true,
  displayName: true,
  avatarUrl: true,
};

/** Full message shape returned to clients. */
const MESSAGE_INCLUDE = {
  sender:       { select: SENDER_SELECT },
  attachments:  true,
  readReceipts: { select: { userId: true, readAt: true } },
  replyTo: {
    select: {
      id:      true,
      content: true,
      sender:  { select: SENDER_SELECT },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// createMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a new message together with any attachments in a single transaction.
 * Returns the full message row including sender and attachments.
 */
async function createMessage({ conversationId, senderId, type, content, replyToId, attachments = [] }) {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        senderId,
        type:    type ?? "TEXT",
        content: content ?? null,
        status:  "SENT",
        replyToId: replyToId ?? null,
        attachments: attachments.length
          ? { create: attachments.map(({ url, type: attType, fileName, fileSize, mimeType, duration, width, height }) => ({
              url, type: attType, fileName, fileSize, mimeType, duration, width, height,
            })) }
          : undefined,
      },
      include: MESSAGE_INCLUDE,
    });

    // Bump the conversation's updatedAt so conversation lists sort correctly
    await tx.conversation.update({
      where: { id: conversationId },
      data:  { updatedAt: new Date() },
    });

    return message;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getMessages  — cursor-based pagination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a page of non-deleted messages for a conversation.
 *
 * Uses createdAt-based cursor pagination so new inserts never skew offsets.
 * Results are returned in ascending chronological order (oldest first) so
 * the client can append them naturally.
 *
 * @param {string}   conversationId
 * @param {object}   options
 * @param {string}   [options.before]  - ISO timestamp; return messages older than this
 * @param {string}   [options.after]   - ISO timestamp; return messages newer than this
 * @param {number}   [options.limit]   - page size (default 30, max 100)
 */
async function getMessages(conversationId, { before, after, limit = 30 } = {}) {
  const take = Math.min(Number(limit) || 30, 100);

  const where = {
    conversationId,
    isDeleted: false,
    ...(before && { createdAt: { lt: new Date(before) } }),
    ...(after  && { createdAt: { gt: new Date(after)  } }),
  };

  // Fetch in DESC order so "before" cursor gives the most recent page efficiently,
  // then reverse for chronological display.
  const rows = await prisma.message.findMany({
    where,
    include:  MESSAGE_INCLUDE,
    orderBy:  { createdAt: "desc" },
    take,
  });

  return rows.reverse(); // oldest → newest
}

// ─────────────────────────────────────────────────────────────────────────────
// markDelivered
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upgrade a message's status from SENT → DELIVERED.
 * The condition `status: "SENT"` prevents downgrading a READ message.
 * Returns null if the message was already DELIVERED or READ (safe to ignore).
 */
async function markDelivered(messageId) {
  return prisma.message
    .update({
      where: { id: messageId, status: "SENT" },
      data:  { status: "DELIVERED" },
      select: { id: true, status: true },
    })
    .catch((err) => {
      // P2025 = record not found (already DELIVERED/READ) — not an error
      if (err?.code === "P2025") return null;
      throw err;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// markRead
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record that `userId` has read `messageId`, then upgrade the message status
 * to READ (idempotent — safe to call multiple times for the same pair).
 *
 * Both operations run in a transaction so they succeed or fail together.
 */
async function markRead({ messageId, userId }) {
  return prisma.$transaction([
    prisma.messageReadReceipt.upsert({
      where:  { messageId_userId: { messageId, userId } },
      update: { readAt: new Date() },
      create: { messageId, userId },
    }),
    prisma.message.update({
      where:  { id: messageId },
      data:   { status: "READ" },
      select: { id: true, status: true },
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// editMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Edit the text content of a message.
 * The `senderId` guard ensures users can only edit their own messages.
 */
async function editMessage({ messageId, senderId, content }) {
  return prisma.message
    .update({
      where:   { id: messageId, senderId, isDeleted: false },
      data:    { content, isEdited: true },
      include: MESSAGE_INCLUDE,
    })
    .catch((err) => {
      if (err?.code === "P2025") return null; // not found or not owner
      throw err;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// softDeleteMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete a message (sets isDeleted = true, nulls content).
 * The `senderId` guard prevents deleting others' messages.
 */
async function softDeleteMessage({ messageId, senderId }) {
  return prisma.message
    .update({
      where:  { id: messageId, senderId },
      data:   { isDeleted: true, content: null },
      select: { id: true },
    })
    .catch((err) => {
      if (err?.code === "P2025") return null;
      throw err;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// getUnreadCount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count messages in a conversation that the given user hasn't read yet.
 * Excludes the user's own messages (you can't have unread messages from yourself).
 */
async function getUnreadCount(conversationId, userId) {
  return prisma.message.count({
    where: {
      conversationId,
      isDeleted: false,
      senderId:     { not: userId },
      readReceipts: { none: { userId } },
    },
  });
}

module.exports = {
  createMessage,
  getMessages,
  markDelivered,
  markRead,
  editMessage,
  softDeleteMessage,
  getUnreadCount,
};
