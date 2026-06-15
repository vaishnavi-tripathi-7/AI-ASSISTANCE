import React, { useRef, useEffect, useState } from 'react';
import ChatBubble from './ChatBubble';
import NudgeCard from './NudgeCard';
import BudgetSuggestions from './BudgetSuggestions';
import PostAddSuggestion from './PostAddSuggestion';

const URGENCY_OPTIONS = [
  { label: "⚡ Within 15 min", value: "15min" },
  { label: "🕐 Within 30 min", value: "30min" },
  { label: "🕑 Within 1 hour", value: "1hour" },
  { label: "📅 Later today",   value: "later" },
];

export default function ChatPanel({
  messages, input, loading, urgency,
  onInputChange, onSend, onAddToCart, onUrgency,
  onSetBudget, onApplyReplacement, onOpenCartDrawer, cart,
  stagingCart, onMoveToCart,
  budget, inlineSuggestions, onDismissInline,
}) {
  const bottomRef = useRef(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [showBudgetInput, setShowBudgetInput] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  const handleBudgetSubmit = (e) => {
    e.preventDefault();
    if (budgetInput) {
      onSetBudget(budgetInput);
      setBudgetInput('');
      setShowBudgetInput(false);
    }
  };

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="flex flex-col flex-1 border-r border-gray-100" style={{ minWidth: 0 }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-orange-500 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-orange-500 font-bold text-sm">Q</div>
          <div>
            <p className="text-white font-semibold text-sm">QuickCart AI</p>
            <p className="text-orange-100 text-xs">Your smart shopping assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
        </div>
      </div>

      {/* ── Budget input row ────────────────────────────────────── */}
      {showBudgetInput && (
        <form onSubmit={handleBudgetSubmit} className="flex gap-2 px-3 py-2 bg-orange-50 border-b border-orange-100">
          <span className="text-sm text-orange-700 self-center">₹</span>
          <input
            type="number"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="Enter your budget…"
            className="flex-1 bg-white border border-orange-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-orange-300"
            min="1"
            autoFocus
          />
          <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium">
            Set
          </button>
        </form>
      )}

      {/* ── Messages ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>

            <ChatBubble type={msg.role === 'user' ? 'user' : 'bot'} text={msg.content} />

            {/* Intent tags */}
            {msg.role === 'assistant' && msg.intents?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 max-w-xs">
                {msg.intents.slice(0, 2).map((it) => (
                  <span key={it.intent} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                    {it.intent} {Math.round((it.confidence ?? it.score ?? 0) * 100)}%
                  </span>
                ))}
              </div>
            )}

            {/* ── Product recommendations grid + inline suggestions ── */}
            {msg.role === 'assistant' && msg.recommendations?.length > 0 && (
              <div className="mt-2 w-full max-w-sm space-y-2">
                {/* 3-col × 2-row grid */}
                <div className="grid grid-cols-3 gap-2">
                  {msg.recommendations.slice(0, 6).map((rec) => (
                    <NudgeCard
                      key={rec.product_id}
                      nudge={rec}
                      budget={budget}
                      onAddToCart={onAddToCart}
                    />
                  ))}
                </div>

                {/* Inline similar-item suggestions — shown below the grid
                    for whichever product was just added */}
                {msg.recommendations.slice(0, 6).map((rec) => {
                  const sugg = (inlineSuggestions || {})[rec.product_id];
                  if (!sugg) return null;
                  return (
                    <PostAddSuggestion
                      key={`sugg-${rec.product_id}`}
                      suggestion={sugg}
                      onDismiss={() => onDismissInline(rec.product_id)}
                      onAddToCart={(item) => { onAddToCart(item); onDismissInline(rec.product_id); }}
                    />
                  );
                })}

                {/* Budget alternatives — inline for any product over budget */}
                {budget && msg.recommendations.slice(0, 6).map((rec) => {
                  const price = rec.price ?? rec.product_price ?? 0;
                  if (price <= budget) return null;
                  return (
                    <div key={`budget-alt-${rec.product_id}`} className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs">
                      <p className="font-semibold text-amber-800 mb-0.5">
                        💡 <span className="font-bold">{rec.name}</span> is ₹{price} — over your ₹{budget} budget
                      </p>
                      <p className="text-amber-700">Ask me for cheaper alternatives in the same category!</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Budget suggestions (replacements) */}
            {msg.role === 'assistant' && msg.budget_suggestions?.length > 0 && (
              <BudgetSuggestions suggestions={msg.budget_suggestions} onApply={onApplyReplacement} />
            )}

            {/* Checkout actions */}
            {msg.role === 'assistant' && msg.checkout_pending && (
              <div className="mt-2 bg-orange-50 border border-orange-200 rounded-xl p-3 w-full max-w-sm">
                <p className="text-xs font-semibold text-orange-800 mb-2">Ready to proceed?</p>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={onOpenCartDrawer}
                    className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg transition-colors"
                  >
                    ✅ Yes, view & confirm order
                  </button>
                  <button
                    onClick={() => onSend("I want to replace some expensive items with cheaper ones")}
                    className="text-xs bg-white border border-orange-300 hover:bg-orange-50 text-orange-700 py-2 rounded-lg transition-colors"
                  >
                    🔄 Replace some items
                  </button>
                  <button
                    onClick={() => onSend("I want to add more items to my cart")}
                    className="text-xs bg-white border border-orange-300 hover:bg-orange-50 text-orange-700 py-2 rounded-lg transition-colors"
                  >
                    ➕ Add more items
                  </button>
                </div>
              </div>
            )}

            {/* Urgency follow-up */}
            {msg.role === 'assistant' && msg.urgency_required && !urgency && (
              <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-xl p-3 w-full max-w-sm">
                <p className="text-xs font-semibold text-yellow-800 mb-2">🕐 How soon do you need this?</p>
                <div className="grid grid-cols-2 gap-1">
                  {URGENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onUrgency(opt.value)}
                      className="text-xs bg-white border border-yellow-300 hover:bg-yellow-100 text-yellow-800 rounded-lg px-2 py-1.5 transition-colors text-left"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ETA card */}
            {msg.role === 'assistant' && msg.eta && (
              <div className="mt-2 bg-green-50 border border-green-200 rounded-xl p-3 w-full max-w-sm">
                <p className="text-xs font-semibold text-green-800">🚀 Fastest Delivery</p>
                <p className="text-sm font-bold text-green-700 mt-0.5">{msg.eta.warehouse_name}</p>
                <p className="text-xs text-green-600">{msg.eta.distance_km} km · ~{msg.eta.eta_minutes} min</p>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex items-start">
            <div className="bg-white px-4 py-2 rounded-2xl rounded-tl-sm shadow text-sm text-gray-400 flex gap-1">
              <span className="animate-bounce">●</span>
              <span className="animate-bounce" style={{ animationDelay: '0.15s' }}>●</span>
              <span className="animate-bounce" style={{ animationDelay: '0.3s' }}>●</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ───────────────────────────────────────────────── */}
      <div className="px-3 py-3 bg-white border-t border-gray-100 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask me anything… e.g. groceries for a week under ₹1000"
          className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-300"
          disabled={loading}
        />
        <button
          onClick={() => onSend()}
          disabled={loading || !input.trim()}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full w-9 h-9 flex items-center justify-center transition-colors flex-shrink-0"
          aria-label="Send"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
