import React from 'react';

// Render plain text, stripping markdown asterisks for bold (just show plain)
function renderText(text) {
  // Replace **text** with plain text (remove asterisks)
  return text.replace(/\*\*(.+?)\*\*/g, '$1');
}

export default function ChatBubble({ type, text }) {
  if (!text) return null;
  const isUser = type === 'user';

  return (
    <div
      className={`max-w-sm px-4 py-2.5 rounded-2xl text-sm shadow leading-relaxed ${
        isUser
          ? 'bg-orange-500 text-white rounded-tr-sm'
          : 'bg-white text-gray-800 rounded-tl-sm'
      }`}
    >
      {renderText(text)}
    </div>
  );
}
