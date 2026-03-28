/**
 * ChatWindow – Vitest + React Testing Library test suite
 *
 * Coverage
 * ────────
 * 1.  Renders message content and sender names from props
 * 2.  "Mine" messages do NOT render a sender-name label
 * 3.  Shows empty-state copy when no messages are provided
 * 4.  Shows the initial-load spinner while isLoadingMessages is true
 * 5.  Shows the "Load older messages" button when hasMoreMessages is true
 * 6.  onLoadMore is called when the button is clicked
 * 7.  Typing indicator is visible when typingUsers contains names
 * 8.  User types in the textarea and clicks Send → onSendMessage is called
 *     with the exact typed string
 * 9.  User types and presses Enter → onSendMessage is called
 * 10. Send button is disabled for blank / whitespace-only input
 * 11. Input is cleared after a successful send
 * 12. onSendMessage is NOT called when disabled prop is true
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatWindow from "./ChatWindow";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CURRENT_USER_ID = "user-alice";

/** Builds a minimal message object compatible with MessageBubble */
function makeMessage(overrides = {}) {
  const base = {
    id: "msg-1",
    conversationId: "conv-1",
    senderId: "user-bob",
    content: "Hello!",
    type: "TEXT",
    status: "SENT",
    attachments: [],
    createdAt: new Date("2025-06-01T10:00:00Z").toISOString(),
    sender: { id: "user-bob", displayName: "Bob" },
  };
  return { ...base, ...overrides };
}

const MOCK_MESSAGES = [
  makeMessage({
    id: "msg-1",
    senderId: "user-bob",
    content: "Hey there, Alice!",
    sender: { id: "user-bob", displayName: "Bob" },
    createdAt: new Date("2025-06-01T09:00:00Z").toISOString(),
  }),
  makeMessage({
    id: "msg-2",
    senderId: "user-carol",
    content: "Good morning everyone!",
    sender: { id: "user-carol", displayName: "Carol" },
    createdAt: new Date("2025-06-01T09:01:00Z").toISOString(),
  }),
  makeMessage({
    id: "msg-3",
    senderId: CURRENT_USER_ID, // "mine" — sender name should NOT appear
    content: "Morning! How are you all?",
    sender: { id: CURRENT_USER_ID, displayName: "Alice" },
    createdAt: new Date("2025-06-01T09:02:00Z").toISOString(),
  }),
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Renders ChatWindow with sensible defaults; extra props override them. */
function renderChatWindow(props = {}) {
  const defaults = {
    messages: MOCK_MESSAGES,
    currentUserId: CURRENT_USER_ID,
    onSendMessage: vi.fn(),
  };
  return render(<ChatWindow {...defaults} {...props} />);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ChatWindow", () => {
  // ── 1. Message content ────────────────────────────────────────────────────
  describe("message rendering", () => {
    it("shows the content of every message", () => {
      renderChatWindow();

      expect(screen.getByText("Hey there, Alice!")).toBeInTheDocument();
      expect(screen.getByText("Good morning everyone!")).toBeInTheDocument();
      expect(screen.getByText("Morning! How are you all?")).toBeInTheDocument();
    });

    it("shows sender display names for messages from other users", () => {
      renderChatWindow();

      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Carol")).toBeInTheDocument();
    });

    it("does NOT show a sender name label for the current user's own messages", () => {
      renderChatWindow();

      // "Alice" appears only as an avatar initial inside a .bubble__avatar span —
      // the bubble__sender-name span is never rendered for "mine" messages.
      const senderLabels = document.querySelectorAll(".bubble__sender-name");
      const labelTexts   = Array.from(senderLabels).map((el) => el.textContent);
      expect(labelTexts).not.toContain("Alice");
    });

    it("renders all three messages with correct bubble alignment classes", () => {
      renderChatWindow();

      const theirBubbles = document.querySelectorAll(".bubble-row--theirs");
      const mineBubbles  = document.querySelectorAll(".bubble-row--mine");

      expect(theirBubbles).toHaveLength(2); // Bob + Carol
      expect(mineBubbles).toHaveLength(1);  // Alice
    });
  });

  // ── 2. Empty state ────────────────────────────────────────────────────────
  describe("empty state", () => {
    it("shows the empty-state copy when no messages are provided", () => {
      renderChatWindow({ messages: [] });
      expect(screen.getByText("No messages yet. Say hello!")).toBeInTheDocument();
    });

    it("does NOT show the empty-state copy when messages are present", () => {
      renderChatWindow();
      expect(screen.queryByText("No messages yet. Say hello!")).not.toBeInTheDocument();
    });
  });

  // ── 3. Loading states ─────────────────────────────────────────────────────
  describe("loading states", () => {
    it("shows the loading overlay while isLoadingMessages is true", () => {
      renderChatWindow({ messages: [], isLoadingMessages: true });
      expect(screen.getByText("Loading messages…")).toBeInTheDocument();
    });

    it("hides the loading overlay when isLoadingMessages is false", () => {
      renderChatWindow();
      expect(screen.queryByText("Loading messages…")).not.toBeInTheDocument();
    });

    it("shows the 'Load older messages' button when hasMoreMessages is true", () => {
      renderChatWindow({ hasMoreMessages: true });
      expect(screen.getByRole("button", { name: /load older messages/i })).toBeInTheDocument();
    });

    it("hides the 'Load older messages' button when hasMoreMessages is false", () => {
      renderChatWindow();
      expect(screen.queryByRole("button", { name: /load older messages/i })).not.toBeInTheDocument();
    });

    it("calls onLoadMore when the 'Load older messages' button is clicked", () => {
      const onLoadMore = vi.fn();
      renderChatWindow({ hasMoreMessages: true, onLoadMore });

      fireEvent.click(screen.getByRole("button", { name: /load older messages/i }));

      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  // ── 4. Typing indicator ───────────────────────────────────────────────────
  describe("typing indicator", () => {
    it("is visible when typingUsers contains names", () => {
      renderChatWindow({ typingUsers: ["Bob"] });
      expect(screen.getByText(/Bob is typing/i)).toBeInTheDocument();
    });

    it("shows plural form for multiple typing users", () => {
      renderChatWindow({ typingUsers: ["Bob", "Carol"] });
      expect(screen.getByText(/Bob, Carol are typing/i)).toBeInTheDocument();
    });

    it("is absent when typingUsers is empty", () => {
      renderChatWindow({ typingUsers: [] });
      expect(screen.queryByText(/is typing/i)).not.toBeInTheDocument();
    });
  });

  // ── 5. Sending messages ───────────────────────────────────────────────────
  describe("sending messages", () => {
    it("calls onSendMessage with the typed string when Send is clicked", async () => {
      const user          = userEvent.setup();
      const onSendMessage = vi.fn();
      renderChatWindow({ onSendMessage });

      const textarea   = screen.getByPlaceholderText("Type a message…");
      const sendButton = screen.getByTitle("Send");

      await user.type(textarea, "Nice to meet you all!");
      await user.click(sendButton);

      expect(onSendMessage).toHaveBeenCalledTimes(1);
      expect(onSendMessage).toHaveBeenCalledWith("Nice to meet you all!");
    });

    it("calls onSendMessage with the trimmed string (leading/trailing spaces stripped)", async () => {
      const user          = userEvent.setup();
      const onSendMessage = vi.fn();
      renderChatWindow({ onSendMessage });

      const textarea   = screen.getByPlaceholderText("Type a message…");
      const sendButton = screen.getByTitle("Send");

      await user.type(textarea, "   Hello   ");
      await user.click(sendButton);

      expect(onSendMessage).toHaveBeenCalledWith("Hello");
    });

    it("calls onSendMessage when the user presses Enter (without Shift)", async () => {
      const user          = userEvent.setup();
      const onSendMessage = vi.fn();
      renderChatWindow({ onSendMessage });

      const textarea = screen.getByPlaceholderText("Type a message…");

      await user.type(textarea, "Keyboard shortcut rocks!{Enter}");

      expect(onSendMessage).toHaveBeenCalledTimes(1);
      expect(onSendMessage).toHaveBeenCalledWith("Keyboard shortcut rocks!");
    });

    it("does NOT call onSendMessage when Shift+Enter is pressed (line break intent)", async () => {
      const user          = userEvent.setup();
      const onSendMessage = vi.fn();
      renderChatWindow({ onSendMessage });

      const textarea = screen.getByPlaceholderText("Type a message…");

      await user.type(textarea, "line one{Shift>}{Enter}{/Shift}line two");

      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it("clears the input after a successful send", async () => {
      const user = userEvent.setup();
      renderChatWindow();

      const textarea   = screen.getByPlaceholderText("Type a message…");
      const sendButton = screen.getByTitle("Send");

      await user.type(textarea, "This will be cleared");
      await user.click(sendButton);

      expect(textarea).toHaveValue("");
    });

    it("does NOT call onSendMessage for a blank input", async () => {
      const user          = userEvent.setup();
      const onSendMessage = vi.fn();
      renderChatWindow({ onSendMessage });

      const sendButton = screen.getByTitle("Send");

      // The Send button is disabled when the textarea is empty — clicking has no effect.
      await user.click(sendButton);

      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it("does NOT call onSendMessage for whitespace-only input", async () => {
      const user          = userEvent.setup();
      const onSendMessage = vi.fn();
      renderChatWindow({ onSendMessage });

      const textarea   = screen.getByPlaceholderText("Type a message…");
      const sendButton = screen.getByTitle("Send");

      // The Send button stays disabled until there is non-whitespace text.
      await user.type(textarea, "   ");
      await user.click(sendButton);

      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it("does NOT call onSendMessage when the input is disabled", async () => {
      const user          = userEvent.setup();
      const onSendMessage = vi.fn();
      renderChatWindow({ onSendMessage, disabled: true });

      const textarea   = screen.getByPlaceholderText("Type a message…");
      const sendButton = screen.getByTitle("Send");

      // Typing is blocked when the textarea is disabled.
      await user.type(textarea, "Should not send");
      await user.click(sendButton);

      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it("Send button becomes enabled only after the user types non-whitespace content", async () => {
      const user = userEvent.setup();
      renderChatWindow();

      const textarea   = screen.getByPlaceholderText("Type a message…");
      const sendButton = screen.getByTitle("Send");

      // Initially disabled
      expect(sendButton).toBeDisabled();

      await user.type(textarea, "Hi");

      // Enabled once there is content
      expect(sendButton).not.toBeDisabled();
    });
  });
});
