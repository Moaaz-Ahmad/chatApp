import "./MessageList.css";

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusIcon({ status }) {
  if (status === "FAILED")
    return <span className="bubble__status bubble__status--failed" title="Failed to send">!</span>;
  if (status === "SENDING")
    return <span className="bubble__status bubble__status--sending" title="Sending…">◌</span>;
  if (status === "READ")
    return <span className="bubble__status bubble__status--read" title="Read">✓✓</span>;
  if (status === "DELIVERED")
    return <span className="bubble__status" title="Delivered">✓✓</span>;
  return <span className="bubble__status" title="Sent">✓</span>;
}

function AttachmentPreview({ attachment }) {
  if (attachment.type === "IMAGE") {
    return (
      <img
        className="bubble__image"
        src={attachment.url}
        alt={attachment.fileName ?? "image"}
      />
    );
  }
  if (attachment.type === "AUDIO") {
    return (
      <audio className="bubble__audio" controls src={attachment.url}>
        Your browser does not support the audio element.
      </audio>
    );
  }
  return (
    <a className="bubble__file" href={attachment.url} target="_blank" rel="noreferrer">
      <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
        <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V7l-5-4H4z" />
        <path d="M13 3v4h4" />
      </svg>
      {attachment.fileName ?? "Download file"}
      {attachment.fileSize ? (
        <span className="bubble__file-size">
          {(attachment.fileSize / 1024).toFixed(1)} KB
        </span>
      ) : null}
    </a>
  );
}

export default function MessageBubble({ message, isMine }) {
  const { content, attachments = [], status, createdAt, sender, isOptimistic } = message;
  const isFailed = status === "FAILED";

  return (
    <div className={`bubble-row ${isMine ? "bubble-row--mine" : "bubble-row--theirs"}`}>
      {!isMine && (
        <div className="bubble__avatar" title={sender?.displayName}>
          {sender?.displayName?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}

      <div className="bubble__wrap">
        {!isMine && (
          <span className="bubble__sender-name">{sender?.displayName}</span>
        )}

        <div
          className={[
            "bubble",
            isMine ? "bubble--mine" : "bubble--theirs",
            isOptimistic ? "bubble--optimistic" : "",
            isFailed ? "bubble--failed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {attachments.map((att, i) => (
            <AttachmentPreview key={i} attachment={att} />
          ))}
          {content && <p className="bubble__text">{content}</p>}

          <div className="bubble__meta">
            <span className="bubble__time">{formatTime(createdAt)}</span>
            {isMine && <StatusIcon status={status} />}
          </div>
        </div>

        {isFailed && (
          <span className="bubble__fail-label">Failed to send. Tap to retry.</span>
        )}
      </div>
    </div>
  );
}
