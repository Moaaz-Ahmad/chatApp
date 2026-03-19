const prisma = require("../lib/prisma");
const { getUnreadCount } = require("./messageController");

const MEMBER_USER_SELECT = {
  id:          true,
  displayName: true,
  avatarUrl:   true,
  isOnline:    true,
  lastSeenAt:  true,
  username:    true,
};

const LAST_MESSAGE_INCLUDE = {
  orderBy:  { createdAt: "desc" },
  take:     1,
  where:    { isDeleted: false },
  include:  { sender: { select: { id: true, displayName: true } } },
};

// ─────────────────────────────────────────────────────────────────────────────
// verifyMembership  — security guard used by socket handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the membership record if `userId` is an active member of the
 * conversation, or null otherwise.
 * Call this before allowing any conversation-scoped socket event.
 */
async function verifyMembership(conversationId, userId) {
  return prisma.conversationMember.findFirst({
    where: { conversationId, userId, leftAt: null },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getUserConversations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all active conversations for a user, ordered by most recently updated.
 * Attaches the last message and per-user unread count to each conversation.
 *
 * N+1 note: unread counts require one extra query per conversation.
 * For a typical user (<50 conversations) this is acceptable. If you need to
 * scale, replace with a single $queryRaw using a subquery or GROUP BY.
 */
async function getUserConversations(userId) {
  const conversations = await prisma.conversation.findMany({
    where: {
      members: { some: { userId, leftAt: null } },
    },
    include: {
      members: {
        where:   { leftAt: null },
        include: { user: { select: MEMBER_USER_SELECT } },
      },
      messages: LAST_MESSAGE_INCLUDE,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Attach unread counts in parallel
  const withUnread = await Promise.all(
    conversations.map(async (conv) => ({
      ...conv,
      unreadCount: await getUnreadCount(conv.id, userId),
      lastMessage: conv.messages[0] ?? null,
      messages:    undefined, // strip the raw messages array from the response
    }))
  );

  return withUnread;
}

// ─────────────────────────────────────────────────────────────────────────────
// getConversationById
// ─────────────────────────────────────────────────────────────────────────────

async function getConversationById(conversationId) {
  return prisma.conversation.findUnique({
    where:   { id: conversationId },
    include: {
      members: {
        where:   { leftAt: null },
        include: { user: { select: MEMBER_USER_SELECT } },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// createDirectConversation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find or create a 1-on-1 conversation between two users.
 * Prevents duplicate direct conversations by checking for an existing one first.
 */
async function createDirectConversation(userIdA, userIdB) {
  // Look for a DIRECT conversation both users are active members of
  const existing = await prisma.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: userIdA, leftAt: null } } },
        { members: { some: { userId: userIdB, leftAt: null } } },
      ],
    },
    include: {
      members: {
        where:   { leftAt: null },
        include: { user: { select: MEMBER_USER_SELECT } },
      },
    },
  });

  if (existing) return { conversation: existing, created: false };

  const conversation = await prisma.conversation.create({
    data: {
      type: "DIRECT",
      members: {
        create: [{ userId: userIdA }, { userId: userIdB }],
      },
    },
    include: {
      members: {
        where:   { leftAt: null },
        include: { user: { select: MEMBER_USER_SELECT } },
      },
    },
  });

  return { conversation, created: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// createGroupConversation
// ─────────────────────────────────────────────────────────────────────────────

async function createGroupConversation({ name, description, creatorId, memberIds }) {
  const uniqueIds = [...new Set([creatorId, ...memberIds])];

  return prisma.conversation.create({
    data: {
      type: "GROUP",
      name,
      description: description ?? null,
      members: {
        create: uniqueIds.map((uid) => ({
          userId:  uid,
          isAdmin: uid === creatorId,
        })),
      },
    },
    include: {
      members: {
        where:   { leftAt: null },
        include: { user: { select: MEMBER_USER_SELECT } },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// leaveConversation
// ─────────────────────────────────────────────────────────────────────────────

async function leaveConversation(conversationId, userId) {
  return prisma.conversationMember.updateMany({
    where:  { conversationId, userId, leftAt: null },
    data:   { leftAt: new Date() },
  });
}

module.exports = {
  verifyMembership,
  getUserConversations,
  getConversationById,
  createDirectConversation,
  createGroupConversation,
  leaveConversation,
};
