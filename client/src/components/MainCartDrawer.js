import React from 'react';

/**
 * MainCartDrawer
 * Slides in from the right when the user clicks the cart icon in the header.
 * Shows the confirmed (main) cart items and the real Checkout button.
 */
export default function MainCartDrawer({ cart, cartTotal, budget, remaining, isOverBudget, onUpdateCart, onCheckout, onClose }) {
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="bg-gray-900 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-orange-400">
              <path d="M2.25 2.25a.75.75 0 000 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 00-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 000-1.5H5.378A2.25 2.25 0 017.5 15h11.218a.75.75 0 00.674-.421 60.358 60.358 0 002.96-7.228.75.75 0 00-.525-.965A60.864 60.864 0 005.68 4.509l-.232-.867A1.875 1.875 0 003.636 2.25H2.25z" />
            </svg>
            <div>
              <p className="text-white font-semibold text-sm">My Cart</p>
              <p className="text-gray-400 text-xs">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
            aria-label="Close cart"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Budget bar */}
        {budget && (
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500 font-medium">Budget</span>
              <span className={`font-bold ${isOverBudget ? 'text-red-500' : 'text-green-600'}`}>
                ₹{cartTotal} / ₹{budget}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  isOverBudget ? 'bg-red-500' : cartTotal / budget > 0.8 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, (cartTotal / budget) * 100)}%` }}
              />
            </div>
            {isOverBudget
              ? <p className="text-xs text-red-500 mt-0.5">⚠️ ₹{Math.abs(remaining)} over budget</p>
              : <p className="text-xs text-green-600 mt-0.5">₹{remaining} remaining</p>
            }
          </div>
        )}

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-gray-300">
                  <path d="M2.25 2.25a.75.75 0 000 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 00-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 000-1.5H5.378A2.25 2.25 0 017.5 15h11.218a.75.75 0 00.674-.421 60.358 60.358 0 002.96-7.228.75.75 0 00-.525-.965A60.864 60.864 0 005.68 4.509l-.232-.867A1.875 1.875 0 003.636 2.25H2.25z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-400">Your cart is empty</p>
              <p className="text-xs text-gray-300 mt-1">Add items from the chat panel</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 px-2 py-1">
              {cart.map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-2 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">₹{item.price} each</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onUpdateCart(item.id, -1)}
                      className="w-6 h-6 rounded-full bg-gray-100 hover:bg-red-100 hover:text-red-500 text-gray-600 flex items-center justify-center text-sm transition-colors"
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
                      onClick={() => onUpdateCart(item.id, 1)}
                      className="w-6 h-6 rounded-full bg-gray-100 hover:bg-orange-100 hover:text-orange-500 text-gray-600 flex items-center justify-center text-sm transition-colors"
                      aria-label="Increase"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-xs font-bold text-gray-700 w-12 text-right">₹{item.price * item.qty}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 bg-white flex-shrink-0">
            <div className="flex justify-between items-center mb-3">
              <div>
                <p className="text-xs text-gray-400">Order Total</p>
                <p className="text-xl font-bold text-gray-900">₹{cartTotal}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Est. Delivery</p>
                <p className="text-sm font-semibold text-green-600">~18 mins 🚀</p>
              </div>
            </div>
            <button
              onClick={() => { onClose(); onCheckout(); }}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Checkout → ₹{cartTotal}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
