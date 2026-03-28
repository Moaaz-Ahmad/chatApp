import MessageList from "../MessageList/MessageList";
import MessageInput from "../MessageInput/MessageInput";

/**
 * ChatWindow
 *
 * Composes the scrollable message list with the message-input bar.
 * Keeps App.jsx clean by owning the vertical chat pane layout.
 *
 * Props
 * ─────
 * messages        {Array}    Normalised message objects (see MessageBubble)
 * currentUserId   {string}   ID of the authenticated user (for "mine" colouring)
 * typingUsers     {string[]} Display-names of users currently typing
 * isLoadingMessages {bool}   Show initial load spinner
 * isLoadingMore   {bool}     Show "loading older" spinner at the top
 * hasMoreMessages {bool}     Show "Load older messages" button
 * onLoadMore      {Function} Called when the user wants older messages
 * onSendMessage   {Function} Called with the trimmed message string when sent
 * onTyping        {Function} Called with true/false as the user types
 * disabled        {bool}     Disable the input (e.g. disconnected)
 */
export default function ChatWindow({
  messages = [],
  currentUserId,
  typingUsers = [],
  isLoadingMessages = false,
  isLoadingMore = false,
  hasMoreMessages = false,
  onLoadMore,
  onSendMessage,
  onTyping,
  disabled = false,
}) {
  // MessageInput delivers { content, type }; ChatWindow's public API is a plain string.
  const handleSend = ({ content }) => {
    onSendMessage?.(content);
  };

  return (
    <div className="chat-window">
      <MessageList
        messages={messages}
        currentUserId={currentUserId}
        typingUsers={typingUsers}
        isLoadingMessages={isLoadingMessages}
        isLoadingMore={isLoadingMore}
        hasMoreMessages={hasMoreMessages}
        onLoadMore={onLoadMore}
      />
      <MessageInput
        onSend={handleSend}
        onTyping={onTyping}
        disabled={disabled}
      />
    </div>
  );
}
