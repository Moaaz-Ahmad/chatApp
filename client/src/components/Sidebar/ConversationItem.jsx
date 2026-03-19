import "./Sidebar.css";

function formatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ConversationItem({ conversation, isActive, onClick }) {
  const { name, avatarUrl, lastMessage, unreadCount, isOnline } = conversation;

  return (
    <li className={`conv-item ${isActive ? "conv-item--active" : ""}`} onClick={onClick}>
      <div className="conv-item__avatar-wrap">
        {avatarUrl ? (
          <img className="conv-item__avatar" src={avatarUrl} alt={name} />
        ) : (
          <div className="conv-item__avatar conv-item__avatar--fallback">
            {name?.[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        {isOnline && <span className="conv-item__online-dot" />}
      </div>

      <div className="conv-item__body">
        <div className="conv-item__top">
          <span className="conv-item__name">{name}</span>
          <span className="conv-item__time">{formatTime(lastMessage?.createdAt)}</span>
        </div>
        <div className="conv-item__bottom">
          <span className="conv-item__preview">
            {lastMessage?.content ?? "No messages yet"}
          </span>
          {unreadCount > 0 && (
            <span className="conv-item__badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
          )}
        </div>
      </div>
    </li>
  );
}
