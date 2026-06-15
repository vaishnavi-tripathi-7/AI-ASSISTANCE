import React from 'react';

/**
 * Shows smart replacement suggestions when cart is over budget.
 * Each suggestion: { original: {product_id, name, price}, replacement: {product_id, name, price, ...}, savings }
 */
export default function BudgetSuggestions({ suggestions, onApply }) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="mt-2 w-full max-w-sm">
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
        <p className="text-xs font-semibold text-yellow-800 mb-2">
          💡 Budget Optimization — Smart Replacements
        </p>
        <div className="space-y-2">
          {suggestions.map((s, i) => (
            <div key={i} className="bg-white rounded-lg p-2.5 border border-yellow-100">
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                <span className="line-through text-red-400">{s.original.name}</span>
                <span>₹{s.original.price}</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-800">→ {s.replacement.name}</p>
                  <p className="text-xs text-green-600 font-medium">
                    ₹{s.replacement.price} · Save ₹{s.savings.toFixed(0)}
                  </p>
                </div>
                <button
                  onClick={() => onApply(s.original, s.replacement)}
                  className="bg-green-500 hover:bg-green-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ml-2"
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
