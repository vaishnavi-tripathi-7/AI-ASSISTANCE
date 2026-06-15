import React, { useState } from 'react';

export default function LiveCartPanel({
  cart, budget, cartTotal, remaining, isOverBudget,
  onUpdateCart, onAddToCart, onMoveToCart, onSetBudget, checkoutPending,
  intelligence, inlineSuggestions, onDismissInline,
}) {
  const [budgetInput, setBudgetInput] = useState('');
  // Tracks which original-product rec cards have been acted on and should hide
  const [dismissedRecs, setDismissedRecs] = useState(new Set());

  const itemCount    = cart.reduce((s, i) => s + i.qty, 0);
  const budgetPercent = budget ? Math.min(100, (cartTotal / budget) * 100) : 0;
  // IDs already in cart — includes both numeric id and string product_code for flexible matching
  const cartIds = new Set(cart.flatMap((i) => [i.id, i.product_code].filter(Boolean)));

  const handleBudgetKey = (e) => {
    if (e.key === 'Enter' && budgetInput) {
      onSetBudget(budgetInput);
      setBudgetInput('');
    }
  };

  // Adds the alternative to cart AND hides that recommendation group.
  // Only passes product_id — the backend /api/cart/add validates and returns canonical data.
  const handleAddAlternative = (alt, originalProductId) => {
    onAddToCart({ product_id: alt.product_id, product_code: alt.product_id });
    setDismissedRecs((prev) => new Set([...prev, originalProductId]));
  };

  return (
    <div className="flex flex-col bg-white border-l border-gray-100 flex-shrink-0" style={{ width: '340px' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="bg-gray-900 px-4 py-3 flex items-center gap-2 flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-orange-400">
          <path d="M2.25 2.25a.75.75 0 000 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 00-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 000-1.5H5.378A2.25 2.25 0 017.5 15h11.218a.75.75 0 00.674-.421 60.358 60.358 0 002.96-7.228.75.75 0 00-.525-.965A60.864 60.864 0 005.68 4.509l-.232-.867A1.875 1.875 0 003.636 2.25H2.25z" />
        </svg>
        <div className="flex-1">
          <p className="text-white font-semibold text-sm">Chat Picks</p>
          <p className="text-gray-400 text-xs">Review before adding to cart</p>
        </div>
        {itemCount > 0 && (
          <span className="bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {itemCount}
          </span>
        )}
      </div>

      {/* ── Budget tracker ───────────────────────────────────────── */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500 font-medium">Budget</span>
          {budget ? (
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold ${isOverBudget ? 'text-red-500' : 'text-green-600'}`}>
                ₹{cartTotal} / ₹{budget}
              </span>
              <button
                onClick={() => onSetBudget(null)}
                className="text-[10px] text-gray-400 hover:text-red-500 bg-gray-100 hover:bg-red-50 rounded px-1.5 py-0.5 transition-colors"
                title="Reset budget"
              >
                ✕ Reset
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-400">Not set</span>
          )}
        </div>

        {budget ? (
          <>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  isOverBudget ? 'bg-red-500' : budgetPercent > 80 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, budgetPercent)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              {isOverBudget ? (
                <span className="text-xs text-red-500 font-medium">⚠️ ₹{Math.abs(remaining)} over budget</span>
              ) : (
                <span className="text-xs text-green-600 font-medium">₹{remaining} remaining</span>
              )}
              <span className="text-xs text-gray-400">{Math.round(budgetPercent)}%</span>
            </div>
          </>
        ) : (
          <div className="flex gap-1 mt-1">
            <input
              type="number"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onKeyDown={handleBudgetKey}
              placeholder="Set budget ₹"
              className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-orange-300"
              min="1"
            />
            <button
              onClick={() => { if (budgetInput) { onSetBudget(budgetInput); setBudgetInput(''); } }}
              className="bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg px-2.5 py-1.5 transition-colors"
            >
              Set
            </button>
          </div>
        )}
      </div>

      {/* ── Stats row ───────────────────────────────────────────── */}
      {cart.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-gray-100 flex-shrink-0">
          <div className="bg-white px-3 py-2 text-center">
            <p className="text-lg font-bold text-gray-900">{itemCount}</p>
            <p className="text-xs text-gray-400">Items</p>
          </div>
          <div className="bg-white px-3 py-2 text-center">
            <p className="text-lg font-bold text-orange-500">₹{cartTotal}</p>
            <p className="text-xs text-gray-400">Total</p>
          </div>
          <div className="bg-white px-3 py-2 text-center">
            <p className="text-lg font-bold text-green-600">~18</p>
            <p className="text-xs text-gray-400">mins ETA</p>
          </div>
        </div>
      )}

      {/* ── Scrollable body ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-gray-300">
                <path d="M2.25 2.25a.75.75 0 000 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 00-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 000-1.5H5.378A2.25 2.25 0 017.5 15h11.218a.75.75 0 00.674-.421 60.358 60.358 0 002.96-7.228.75.75 0 00-.525-.965A60.864 60.864 0 005.68 4.509l-.232-.867A1.875 1.875 0 003.636 2.25H2.25z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-400">Your chat picks are empty</p>
            <p className="text-xs text-gray-300 mt-1">Click "Put to Cart" on any recommendation!</p>
          </div>
        ) : (
          <div>

            {/* ── 🔥 Selling Fast ────────────────────────────────── */}
            {intelligence?.selling_fast?.length > 0 && (
              <div className="px-3 pt-3 pb-1">
                <p className="text-xs font-bold text-orange-600 mb-2">🔥 Selling Fast</p>
                <div className="space-y-1.5">
                  {intelligence.selling_fast.slice(0, 3).map((p) => {
                    const inCart = cartIds.has(p.product_id);
                    return (
                      <div key={p.product_id} className="flex items-center gap-2 bg-orange-50 rounded-lg px-2 py-1.5">
                        <span className="text-base flex-shrink-0">🔥</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate">{p.name}</p>
                          <p className="text-xs text-orange-500">{p.reason}</p>
                        </div>
                        <p className="text-xs font-bold text-gray-700 flex-shrink-0">₹{p.price}</p>
                        <button
                          onClick={() => !inCart && onAddToCart({ product_id: p.product_id, product_code: p.product_id })}
                          disabled={inCart}
                          className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${
                            inCart
                              ? 'bg-gray-100 text-gray-400 cursor-default'
                              : 'bg-orange-500 hover:bg-orange-600 text-white'
                          }`}
                          aria-label={inCart ? 'Already in cart' : `Add ${p.name}`}
                        >
                          {inCart ? '✓' : '+'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Cart Insights ───────────────────────────────────── */}
            {intelligence?.cart_insights?.length > 0 && (
              <div className="px-3 pt-2 pb-1 space-y-1">
                {intelligence.cart_insights.map((insight, i) => {
                  const colors = {
                    warning:  'bg-red-50 text-red-700 border-red-200',
                    alert:    'bg-yellow-50 text-yellow-700 border-yellow-200',
                    info:     'bg-blue-50 text-blue-700 border-blue-200',
                    tip:      'bg-purple-50 text-purple-700 border-purple-200',
                    positive: 'bg-green-50 text-green-700 border-green-200',
                    urgency:  'bg-red-50 text-red-700 border-red-200',
                  };
                  return (
                    <div key={i} className={`text-xs px-2.5 py-1.5 rounded-lg border ${colors[insight.type] || colors.info}`}>
                      {insight.message}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Cart Items List + inline similar suggestions ─────── */}
            <ul className="divide-y divide-gray-50 px-1 mt-1">
              {cart.map((item) => {
                const sugg = (inlineSuggestions || {})[item.product_code] || (inlineSuggestions || {})[item.id];
                const isBudget = sugg?.mode === 'budget';
                return (
                  <li key={item.id}>
                    <CartItem item={item} onUpdate={onUpdateCart} />

                    {/* Similar items — shown inline below this cart row */}
                    {sugg && sugg.suggestions?.length > 0 && (
                      <div className="mx-2 mb-2 rounded-xl border overflow-hidden"
                        style={{ borderColor: isBudget ? '#bbf7d0' : '#fed7aa' }}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between px-2.5 py-1.5"
                          style={{ background: isBudget ? '#f0fdf4' : '#fff7ed' }}
                        >
                          <span className="text-[10px] font-bold"
                            style={{ color: isBudget ? '#15803d' : '#c2410c' }}
                          >
                            {isBudget ? (budget ? '💰 Cheaper similar items' : '🔄 Similar items') : '⭐ Customers also loved'}
                          </span>
                          <button
                            onClick={() => onDismissInline(item.product_code || item.id)}
                            className="text-gray-400 hover:text-gray-600 text-[10px] px-1"
                            aria-label="Dismiss"
                          >✕</button>
                        </div>

                        {/* Suggestion rows */}
                        <div className="bg-white divide-y divide-gray-50">
                          {sugg.suggestions.slice(0, 3).map((s) => {
                            const inCart = cartIds.has(s.product_id);
                            return (
                              <div key={s.product_id} className="flex items-center gap-2 px-2.5 py-2">
                                {/* Badge */}
                                <div
                                  className="flex-shrink-0 w-8 h-8 rounded-full flex flex-col items-center justify-center text-white text-center"
                                  style={{ background: isBudget ? '#22c55e' : '#f97316', fontSize: '8px', lineHeight: 1.2 }}
                                >
                                  {isBudget ? (
                                    <><span className="font-bold text-[10px]">{s.similarity_score}%</span><span>match</span></>
                                  ) : (
                                    <><span className="font-bold text-[10px]">★{s.avg_rating?.toFixed(1)}</span><span>{s.review_count}r</span></>
                                  )}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-semibold text-gray-800 truncate">{s.name}</p>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span className="text-[11px] font-bold text-gray-700">₹{s.price}</span>
                                    {isBudget && s.price_saving > 0 && (
                                      <span className="text-[10px] text-green-600 font-medium">Save ₹{s.price_saving.toFixed(0)}</span>
                                    )}
                                    {!isBudget && s.avg_rating > 0 && (
                                      <span className="text-[10px] text-orange-500">★{s.avg_rating?.toFixed(1)}</span>
                                    )}
                                  </div>
                                </div>

                                {/* Add button */}
                                <button
                                  onClick={() => !inCart && onAddToCart({ product_id: s.product_id, product_code: s.product_id })}
                                  disabled={inCart}
                                  className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg transition-colors ${
                                    inCart
                                      ? 'bg-gray-100 text-gray-400 cursor-default'
                                      : isBudget
                                        ? 'bg-green-500 hover:bg-green-600 text-white'
                                        : 'bg-orange-500 hover:bg-orange-600 text-white'
                                  }`}
                                >
                                  {inCart ? '✓' : 'Add'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* ── Smart Replacements / Premium Upgrades ───────────── */}
            {intelligence && (() => {
              const isBudget = intelligence.mode === 'budget';
              // Filter out cards the user already acted on
              const recs = (isBudget
                ? Object.values(intelligence.replacements || {})
                : Object.values(intelligence.premium_alternatives || {})
              ).filter((rec) => !dismissedRecs.has(rec.original.product_id));

              if (!recs.length) return null;

              return (
                <div className="px-3 pt-2 pb-3">
                  <p className="text-xs font-bold text-gray-600 mb-2">
                    {isBudget ? '💰 Save Money On These Items' : '⭐ Customers Prefer These'}
                  </p>
                  <div className="space-y-3">
                    {recs.slice(0, 3).map((rec) => (
                      <div key={rec.original.product_id} className="bg-gray-50 rounded-xl p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-500 mb-1.5">
                          Instead of{' '}
                          <span className="font-semibold text-gray-700">{rec.original.name}</span>
                          {' '}₹{rec.original.price}
                        </p>
                        <div className="space-y-1.5">
                          {rec.alternatives.slice(0, 3).map((alt) => {
                            const inCart = cartIds.has(alt.product_id);
                            return (
                              <div key={alt.product_id} className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-800 truncate">{alt.name}</p>
                                  <p className="text-xs text-gray-400">
                                    {alt.rating > 0 && `⭐ ${alt.rating}`}
                                    {alt.price_saving > 0 && ` · Save ₹${alt.price_saving.toFixed(0)}`}
                                  </p>
                                </div>
                                <p className={`text-xs font-bold flex-shrink-0 ${isBudget ? 'text-green-600' : 'text-orange-500'}`}>
                                  ₹{alt.price}
                                </p>
                                <button
                                  onClick={() => handleAddAlternative(alt, rec.original.product_id)}
                                  disabled={inCart}
                                  className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${
                                    inCart
                                      ? 'bg-gray-100 text-gray-400 cursor-default'
                                      : isBudget
                                        ? 'bg-green-500 hover:bg-green-600 text-white'
                                        : 'bg-orange-500 hover:bg-orange-600 text-white'
                                  }`}
                                  aria-label={inCart ? 'Already in cart' : `Add ${alt.name}`}
                                >
                                  {inCart ? '✓' : 'Add'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-400 mt-1.5 italic">{rec.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          </div>
        )}
      </div>

      {/* ── Footer: total + checkout ────────────────────────────── */}
      {cart.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-3 bg-white flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400">Order Total</p>
              <p className="text-xl font-bold text-gray-900">₹{cartTotal}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Est. Delivery</p>
              <p className="text-sm font-semibold text-green-600">~18 mins 🚀</p>
            </div>
          </div>

          {isOverBudget && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
              <p className="text-xs text-red-600 font-medium">
                ⚠️ ₹{Math.abs(remaining)} over your budget of ₹{budget}
              </p>
            </div>
          )}

          {checkoutPending && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-2">
              <p className="text-xs text-orange-700 font-medium">
                ✅ Cart ready for confirmation! Confirm in chat ↖
              </p>
            </div>
          )}

          <button
            onClick={onMoveToCart}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            ✅ Add to Final Cart →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Individual cart item row ─────────────────────────────────────────────────

function CartItem({ item, onUpdate }) {
  return (
    <li className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors group">
      <div className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate">{item.name}</p>
        <p className="text-xs text-gray-400">₹{item.price} each</p>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onUpdate(item.id, -1)}
          className="w-6 h-6 rounded-full bg-gray-100 hover:bg-red-100 hover:text-red-500 text-gray-600 text-sm flex items-center justify-center transition-colors"
          aria-label="Decrease"
        >
          {item.qty === 1 ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5z" clipRule="evenodd" />
            </svg>
          ) : '−'}
        </button>
        <span className="w-5 text-center text-xs font-bold text-gray-800">{item.qty}</span>
        <button
          onClick={() => onUpdate(item.id, 1)}
          className="w-6 h-6 rounded-full bg-gray-100 hover:bg-orange-100 hover:text-orange-500 text-gray-600 text-sm flex items-center justify-center transition-colors"
          aria-label="Increase"
        >
          +
        </button>
      </div>

      <p className="text-xs font-bold text-gray-700 w-12 text-right">₹{item.price * item.qty}</p>
    </li>
  );
}
