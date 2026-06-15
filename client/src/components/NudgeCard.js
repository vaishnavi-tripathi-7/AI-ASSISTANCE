import React from 'react';

const NUDGE_CONFIG = {
  bundle: {
    border:   'border-green-400',
    bg:       'bg-green-50',
    badge:    'bg-green-500',
    emoji:    '🎁',
    label:    'Bundle',
    cta:      'Put to Cart',
    ctaColor: 'bg-green-500 hover:bg-green-600',
  },
  compare: {
    border:   'border-blue-400',
    bg:       'bg-blue-50',
    badge:    'bg-blue-500',
    emoji:    '⚖️',
    label:    'Compare',
    cta:      'Put to Cart',
    ctaColor: 'bg-blue-500 hover:bg-blue-600',
  },
  substitute: {
    border:   'border-orange-400',
    bg:       'bg-orange-50',
    badge:    'bg-orange-500',
    emoji:    '🔄',
    label:    'Swap',
    cta:      'Put to Cart',
    ctaColor: 'bg-orange-500 hover:bg-orange-600',
  },
  social_proof: {
    border:   'border-purple-400',
    bg:       'bg-purple-50',
    badge:    'bg-purple-500',
    emoji:    '🔥',
    label:    'Popular',
    cta:      'Put to Cart',
    ctaColor: 'bg-purple-500 hover:bg-purple-600',
  },
};

export default function NudgeCard({ nudge, onAddToCart }) {
  if (!nudge) return null;

  const c = NUDGE_CONFIG[nudge.nudge_type] || NUDGE_CONFIG['social_proof'];

  return (
    <div className={`flex flex-col border-l-4 rounded-xl p-2 shadow-sm h-full ${c.bg} ${c.border}`}>
      {/* Type badge */}
      <span className={`self-start text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full mb-1 ${c.badge}`}>
        {c.emoji} {c.label}
      </span>

      {/* Product name — clamp to 3 lines */}
      <p className="text-[11px] font-semibold text-gray-800 leading-tight line-clamp-3 flex-1 mb-1">
        {nudge.name || nudge.product_name}
      </p>

      {/* Price */}
      <p className="text-xs font-bold text-gray-900 mb-0.5">
        ₹{nudge.price ?? nudge.product_price}
      </p>

      {/* Low stock */}
      {nudge.stock !== undefined && nudge.stock <= 20 && (
        <p className="text-[9px] text-red-500 font-medium mb-1">Only {nudge.stock} left</p>
      )}

      {/* Rating */}
      {nudge.avg_rating > 0 && (
        <p className="text-[9px] text-gray-400 mb-1">⭐ {Number(nudge.avg_rating).toFixed(1)}</p>
      )}

      {/* CTA */}
      <button
        onClick={() => onAddToCart({ product_id: nudge.product_id, product_code: nudge.product_code || nudge.product_id })}
        className={`w-full text-white text-[10px] font-bold py-1.5 rounded-lg transition-colors mt-auto ${c.ctaColor}`}
      >
        {c.cta}
      </button>
    </div>
  );
}
