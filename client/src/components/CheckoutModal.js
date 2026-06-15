import React from 'react';

export default function CheckoutModal({
  cart, budget, cartTotal, orderResult,
  onConfirm, onClose, onAddMore, onReplace,
}) {
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);
  const isOverBudget = budget && cartTotal > budget;
  const overBy = isOverBudget ? cartTotal - budget : 0;

  // ── Order success screen ────────────────────────────────────────────────
  if (orderResult) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <div className="text-center mb-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-green-500">
                <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Order Placed! 🎉</h2>
            <p className="text-sm text-gray-500 mt-1">Your order is being processed</p>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order ID</span>
              <span className="font-mono font-medium text-gray-800">{orderResult.order_id}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Items</span>
              <span className="font-semibold text-gray-800">{orderResult.item_count}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total</span>
              <span className="font-bold text-orange-500 text-base">₹{orderResult.total_amount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Est. Delivery</span>
              <span className="font-semibold text-green-600">~18 mins 🚀</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Continue Shopping
          </button>
        </div>
      </div>
    );
  }

  // ── Checkout confirmation screen ────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gray-900 rounded-t-2xl px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-base">Confirm Order</h2>
            <p className="text-gray-400 text-xs mt-0.5">{itemCount} items · Est. 18 mins</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>

        {/* Cart summary */}
        <div className="px-5 py-4 max-h-48 overflow-y-auto">
          <ul className="divide-y divide-gray-50">
            {cart.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">x{item.qty} · ₹{item.price} each</p>
                </div>
                <p className="text-sm font-bold text-gray-700 ml-3">₹{item.price * item.qty}</p>
              </li>
            ))}
          </ul>
        </div>

        {/* Total */}
        <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Order Total</span>
            <span className="text-xl font-bold text-orange-500">₹{cartTotal}</span>
          </div>
          {budget && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-gray-400">Budget</span>
              <span className={`text-xs font-medium ${isOverBudget ? 'text-red-500' : 'text-green-600'}`}>
                ₹{budget} {isOverBudget ? `(₹${overBy.toFixed(0)} over)` : `(₹${(budget - cartTotal).toFixed(0)} saved)`}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-gray-400">Est. Delivery</span>
            <span className="text-xs font-semibold text-green-600">~18 mins 🚀</span>
          </div>
        </div>

        {/* Over-budget warning */}
        {isOverBudget && (
          <div className="px-5 py-2 bg-red-50 border-t border-red-100">
            <p className="text-xs text-red-600">
              ⚠️ Your cart is ₹{overBy.toFixed(0)} above your budget. Consider replacing some items.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 py-4 space-y-2">
          <button
            onClick={onConfirm}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            ✅ Confirm Order — ₹{cartTotal}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onReplace}
              className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              🔄 Replace Items
            </button>
            <button
              onClick={onAddMore}
              className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              ➕ Add More
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
