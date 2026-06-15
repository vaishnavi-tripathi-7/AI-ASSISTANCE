import React from 'react';

/**
 * PostAddSuggestion
 * ─────────────────────────────────────────────────────────────────────────────
 * Shown in the chat panel right after a user adds a product to their cart.
 *
 * Budget mode  (avg_order_value < 500):
 *   Shows items with ≥ 90% similarity — same category/subcategory,
 *   at the same or lower price point.
 *
 * Premium mode (avg_order_value >= 500):
 *   Shows higher-rated items in the same category with a social proof message:
 *   "Customers who bought similar items highly rated these."
 *
 * Props:
 *   suggestion  — { mode, added_product, label, message, suggestions[] }
 *   onDismiss   — called when user closes the card
 *   onAddToCart — called with a suggestion item when user taps "Add"
 */
export default function PostAddSuggestion({ suggestion, onDismiss, onAddToCart }) {
  if (!suggestion || !suggestion.suggestions || suggestion.suggestions.length === 0) return null;

  const isBudget = suggestion.mode === 'budget';

  return (
    <div className="mx-3 my-2 rounded-2xl border shadow-sm overflow-hidden"
      style={{ borderColor: isBudget ? '#bbf7d0' : '#fed7aa' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: isBudget ? '#f0fdf4' : '#fff7ed' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-base">{isBudget ? '💰' : '⭐'}</span>
          <span className="text-xs font-bold" style={{ color: isBudget ? '#15803d' : '#c2410c' }}>
            {suggestion.label}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600 transition-colors text-xs px-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>

      {/* Sub-message */}
      <div className="px-3 py-1.5 bg-white border-b border-gray-50">
        <p className="text-xs text-gray-500">{suggestion.message}</p>
      </div>

      {/* Suggestion rows */}
      <div className="bg-white divide-y divide-gray-50">
        {suggestion.suggestions.slice(0, 4).map((item) => (
          <div key={item.product_id} className="flex items-center gap-2.5 px-3 py-2.5">
            {/* Similarity / rating badge */}
            <div
              className="flex-shrink-0 w-9 h-9 rounded-full flex flex-col items-center justify-center text-white text-center"
              style={{ background: isBudget ? '#22c55e' : '#f97316', fontSize: '9px', lineHeight: 1.2 }}
            >
              {isBudget ? (
                <>
                  <span className="font-bold text-xs">{item.similarity_score}%</span>
                  <span>match</span>
                </>
              ) : (
                <>
                  <span className="font-bold text-xs">★{item.avg_rating?.toFixed(1)}</span>
                  <span>{item.review_count}rev</span>
                </>
              )}
            </div>

            {/* Product info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-xs font-bold text-gray-700">₹{item.price}</span>
                {isBudget && item.price_saving > 0 && (
                  <span className="text-xs text-green-600 font-medium">Save ₹{item.price_saving.toFixed(0)}</span>
                )}
                {!isBudget && item.avg_rating > 0 && (
                  <span className="text-xs text-orange-500">
                    ★ {item.avg_rating?.toFixed(1)} · {item.review_count} reviews
                  </span>
                )}
                {item.brand && (
                  <span className="text-xs text-gray-400">{item.brand}</span>
                )}
              </div>
            </div>

            {/* Add button */}
            <button
              onClick={() => onAddToCart({ product_id: item.product_id, product_code: item.product_id })}
              className="flex-shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors text-white"
              style={{ background: isBudget ? '#22c55e' : '#f97316' }}
            >
              Add
            </button>
          </div>
        ))}
      </div>

      {/* Footer note for premium */}
      {!isBudget && (
        <div className="bg-orange-50 px-3 py-1.5">
          <p className="text-xs text-orange-700 italic">
            🛍️ Customers who bought similar items rated these products highly
          </p>
        </div>
      )}
    </div>
  );
}
