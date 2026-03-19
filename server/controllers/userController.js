const prisma = require("../lib/prisma");

/** Fields safe to expose publicly (never the password hash). */
const PUBLIC_SELECT = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  isOnline: true,
  lastSeenAt: true,
  createdAt: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new user.
 * The password field stores the bcrypt hash — callers must hash before passing.
 */
async function createUser({ email, username, displayName, passwordHash }) {
  return prisma.user.create({
    data: {
      email:       email.toLowerCase(),
      username:    username.toLowerCase(),
      displayName: displayName?.trim() || username,
      password:    passwordHash,        // schema field is "password"; we store the hash
    },
    select: PUBLIC_SELECT,
  });
}

/**
 * Update a user's online presence.
 * Sets lastSeenAt automatically when going offline.
 */
async function setOnlineStatus(userId, isOnline) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      isOnline,
      lastSeenAt: isOnline ? undefined : new Date(),
    },
    select: PUBLIC_SELECT,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the full row including the password hash — only for auth checks. */
async function getUserByEmailWithPassword(email) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    // select is intentionally omitted so password is included
  });
}

async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: PUBLIC_SELECT,
  });
}

/**
 * Search users whose email contains the given query string.
 * Excludes the requesting user from results.
 * Returns at most 10 matches.
 */
async function searchUsersByEmail(query, excludeUserId) {
  return prisma.user.findMany({
    where: {
      email: { contains: query.toLowerCase(), mode: "insensitive" },
      id:    { not: excludeUserId },
    },
    select: PUBLIC_SELECT,
    take: 10,
  });
}

module.exports = { createUser, setOnlineStatus, getUserByEmailWithPassword, getUserById, searchUsersByEmail };
