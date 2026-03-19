import ConversationItem from "./ConversationItem";
import "./Sidebar.css";

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  currentUser,
  onLogout,
  onNewChat,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__avatar">
          {currentUser?.displayName?.[0] ?? "U"}
        </div>
        <span className="sidebar__username">{currentUser?.displayName ?? "You"}</span>
        <span className="sidebar__status-dot" title="Online" />
        {onLogout && (
          <button className="sidebar__logout" onClick={onLogout} title="Sign out">
            <svg viewBox="0 0 20 20" fill="none" width="15" height="15">
              <path d="M13 3h4v14h-4M8 14l4-4-4-4M3 10h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="sidebar__search-wrap">
        <svg className="sidebar__search-icon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          className="sidebar__search"
          type="text"
          placeholder="Search conversations…"
        />
      </div>

      <div className="sidebar__section-row">
        <p className="sidebar__section-label">Messages</p>
        {onNewChat && (
          <button className="sidebar__new-chat" onClick={onNewChat} title="New conversation">
            <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <ul className="sidebar__list">
        {conversations.length === 0 && (
          <li className="sidebar__empty">
            No conversations yet.
            <br />
            <button className="sidebar__empty-btn" onClick={onNewChat}>
              Start one
            </button>
          </li>
        )}
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeId}
            onClick={() => onSelect(conv.id)}
          />
        ))}
      </ul>
    </aside>
  );
}
