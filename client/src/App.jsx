import { useState, useCallback, useEffect } from "react";
import Sidebar from "./components/Sidebar/Sidebar";
import MessageList from "./components/MessageList/MessageList";
import MessageInput from "./components/MessageInput/MessageInput";
import LoginForm from "./components/Auth/LoginForm";
import ContactFinder from "./components/ContactFinder/ContactFinder";
import { useAuth } from "./hooks/useAuth";
import { useChat } from "./hooks/useChat";
import { useConversations } from "./hooks/useConversations";
import "./App.css";

// ── Sub-components ────────────────────────────────────────────────────────────

function ChatHeader({ conversation, isConnected }) {
  if (!conversation) {
    return (
      <div className="chat-header chat-header--empty">
        <span className="chat-header__placeholder">Select a conversation or start a new one</span>
      </div>
    );
  }
  return (
    <div className="chat-header">
      <div className="chat-header__avatar">
        {conversation.name?.[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="chat-header__info">
        <span className="chat-header__name">{conversation.name}</span>
        <span className={`chat-header__sub ${conversation.isOnline ? "chat-header__sub--online" : ""}`}>
          {conversation.isOnline ? "Online" : "Offline"}
        </span>
      </div>
      <div
        className={`chat-header__conn ${isConnected ? "chat-header__conn--ok" : ""}`}
        title={isConnected ? "Connected to server" : "Disconnected"}
      >
        <span />
        {isConnected ? "Connected" : "Disconnected"}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-screen__spinner" />
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { user, accessToken, isLoading, login, register, logout } = useAuth();

  const [activeConvId,      setActiveConvId]      = useState(null);
  const [showContactFinder, setShowContactFinder] = useState(false);

  const {
    conversations,
    isLoadingConversations,
    handleNewMessage,
    handlePresenceChange,
    resetUnread,
    addConversation,
  } = useConversations(activeConvId, accessToken, user?.id ?? null);

  // Auto-select the first conversation once the list loads
  useEffect(() => {
    if (!activeConvId && conversations.length > 0) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  const {
    messages,
    typingUsers,
    isConnected,
    isLoadingMessages,
    isLoadingMore,
    hasMoreMessages,
    sendMessage,
    emitTyping,
    loadMoreMessages,
  } = useChat(
    user?.id ?? null,
    activeConvId,
    {
      accessToken,
      onNewMessage:     handleNewMessage,
      onPresenceChange: handlePresenceChange,
      onAuthExpired:    logout,
      onAuthInvalid:    logout,
    }
  );

  const handleSelectConversation = useCallback((convId) => {
    setActiveConvId(convId);
    resetUnread(convId);
  }, [resetUnread]);

  // Called when ContactFinder creates / finds a conversation
  const handleConversationCreated = useCallback((rawConv) => {
    const normalized = addConversation(rawConv);
    setActiveConvId(normalized.id);
    resetUnread(normalized.id);
  }, [addConversation, resetUnread]);

  // ── Render gates ──────────────────────────────────────────────────────────
  if (isLoading) return <LoadingScreen />;

  if (!user) {
    return <LoginForm onLogin={login} onRegister={register} />;
  }

  const activeConversation = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        currentUser={user}
        onLogout={logout}
        onNewChat={() => setShowContactFinder(true)}
      />

      <div className="chat-pane">
        {isLoadingConversations && !activeConversation ? (
          <div className="loading-screen">
            <div className="loading-screen__spinner" />
          </div>
        ) : (
          <>
            <ChatHeader conversation={activeConversation} isConnected={isConnected} />

            <MessageList
              messages={messages}
              currentUserId={user.id}
              typingUsers={typingUsers}
              isLoadingMessages={isLoadingMessages}
              isLoadingMore={isLoadingMore}
              hasMoreMessages={hasMoreMessages}
              onLoadMore={loadMoreMessages}
            />

            <MessageInput
              onSend={sendMessage}
              onTyping={emitTyping}
              disabled={!isConnected || !activeConvId}
            />
          </>
        )}
      </div>

      {showContactFinder && (
        <ContactFinder
          accessToken={accessToken}
          onClose={() => setShowContactFinder(false)}
          onConversationCreated={handleConversationCreated}
        />
      )}
    </div>
  );
}
