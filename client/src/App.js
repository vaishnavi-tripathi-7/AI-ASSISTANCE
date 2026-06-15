import React, { useState, useRef, useEffect, useCallback } from 'react';
import ChatPanel from './components/ChatPanel';
import LiveCartPanel from './components/LiveCartPanel';
import MainCartDrawer from './components/MainCartDrawer';
import CheckoutModal from './components/CheckoutModal';

const WELCOME = {
  role: 'assistant',
  content: "Hi! I'm QuickCart AI 🛒 I'll help you build your cart as we chat. What are you shopping for today? You can also tell me your budget!",
  recommendations: [],
  intents: [],
  eta: null,
  urgency_required: false,
  budget_suggestions: [],
  checkout_pending: false,
};

export default function App() {
  const [messages, setMessages]           = useState([WELCOME]);
  const [input, setInput]                 = useState('');
  const [loading, setLoading]             = useState(false);
  const [cart, setCart]                   = useState([]);          // main cart (right panel)
  const [stagingCart, setStagingCart]     = useState([]);          // items added from chat recommendations
  const [budget, setBudget]               = useState(null);
  const [urgency, setUrgency]             = useState(null);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [orderResult, setOrderResult]     = useState(null);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [showCartDrawer, setShowCartDrawer]   = useState(false);

  const [cartIntelligence, setCartIntelligence] = useState(null);
  // Map of product_id → post-add suggestion data, shown inline below each NudgeCard
  const [inlineSuggestions, setInlineSuggestions] = useState({});

  const cartTotal    = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const remaining    = budget ? budget - cartTotal : null;
  const isOverBudget = budget && cartTotal > budget;

  // ── Fetch cart intelligence whenever cart changes ─────────────────────────
  useEffect(() => {
    if (cart.length === 0) { setCartIntelligence(null); return; }
    const controller = new AbortController();
    fetch("/api/cart/intelligence", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ cart: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, category: i.category || "" })), userId: "U0017", budget }),
      signal:  controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setCartIntelligence(data))
      .catch((e) => { if (e.name !== "AbortError") console.error("Cart intelligence error:", e); });
    return () => controller.abort();
  }, [cart, budget]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (overrideMessage = null) => {
    const text = (overrideMessage || input).trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text, recommendations: [], intents: [], eta: null, urgency_required: false, budget_suggestions: [], checkout_pending: false };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    if (!overrideMessage) setInput('');
    setLoading(true);

    try {
      const history = updatedMessages
        .slice(-7, -1)
        .map(({ role, content }) => ({ role, content }))
        // Drop leading assistant messages — Gemini requires history to start with user
        .filter((_, idx, arr) => {
          const firstUserIdx = arr.findIndex(m => m.role === 'user');
          return idx >= firstUserIdx;
        });

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
          cart: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, category: i.category || '' })),
          budget,
          urgency,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();

      // Detect budget from AI response
      if (data.budget && !budget) {
        setBudget(data.budget);
      }

      if (data.checkout_pending) setCheckoutPending(true);

      setMessages((prev) => [
        ...prev,
        {
          role:               'assistant',
          content:            data.reply || "Here are some options for you!",
          recommendations:    data.recommendations || [],
          intents:            data.top_intents || [],
          eta:                data.eta || null,
          urgency_required:   data.urgency_required || false,
          budget_suggestions: data.budget_suggestions || [],
          checkout_pending:   data.checkout_pending || false,
          cart_total:         data.cart_total,
          remaining_budget:   data.remaining_budget,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Sorry, I couldn't reach the server. Please try again.", recommendations: [], intents: [], eta: null, urgency_required: false, budget_suggestions: [], checkout_pending: false },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, cart, budget, urgency]);

  // ── Cart actions ──────────────────────────────────────────────────────────
  // All cart additions go through /api/cart/add — the backend DB is the single source of truth.
  // No synthetic/fallback product objects are created on the frontend.
  const handleAddToCart = useCallback(async (item) => {
    // Determine the backend product_id (product_code like "P0083")
    console.log("RECOMMENDATION:", item);
    const productId = item.product_code || item.product_id;
    if (!productId) {
      console.error('Cannot add to cart: no product_id available', item);
      return;
    }

    console.log("SENDING TO /api/cart/add:", { productId });

    try {
      // Validate and fetch canonical product data from the backend
      const res = await fetch('/api/cart/add', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ productId }),
      });

      const responseBody = await res.json();
      console.log("RESPONSE FROM /api/cart/add:", res.status, responseBody);

      if (!res.ok) {
        console.error('Backend rejected cart add:', responseBody.error || res.status);
        return;
      }

      const { product } = responseBody;

      // Add the backend-validated product to staging cart
      setStagingCart((prev) => {
        const existing = prev.find((i) => i.id === product.id);
        if (existing) return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
        return [...prev, {
          id:           product.id,
          product_code: product.product_code,
          name:         product.name,
          price:        product.price,
          qty:          1,
          category:     product.category,
        }];
      });

      // Fetch inline suggestion for this product
      fetch('/api/cart/post-add-suggestion', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ productId: product.product_code, userId: 'U0017' }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.suggestions && data.suggestions.length > 0) {
            setInlineSuggestions((prev) => ({ ...prev, [product.product_code]: data }));
          }
        })
        .catch((e) => console.error('Post-add suggestion error:', e));
    } catch (e) {
      console.error('Cart add network error:', e);
    }
  }, []);

  // Moves all staging items into the main cart, then clears staging
  const handleMoveToCart = useCallback(() => {
    if (stagingCart.length === 0) return;
    setCart((prev) => {
      const merged = [...prev];
      stagingCart.forEach((stagingItem) => {
        const existing = merged.find((i) => i.id === stagingItem.id);
        if (existing) {
          existing.qty += stagingItem.qty;
        } else {
          merged.push({ ...stagingItem });
        }
      });
      return merged;
    });
    setStagingCart([]);
  }, [stagingCart]);

  const handleUpdateCart = useCallback((id, delta) => {
    setCart((prev) => {
      if (delta === 0) return prev.filter((i) => i.id !== id);
      return prev.map((i) => i.id === id ? { ...i, qty: i.qty + delta } : i).filter((i) => i.qty > 0);
    });
  }, []);

  const handleApplyReplacement = useCallback(async (original, replacement) => {
    // Validate the replacement product through the backend before modifying cart
    const productId = replacement.product_code || replacement.product_id;
    if (!productId) {
      console.error('Cannot apply replacement: no product_id', replacement);
      return;
    }

    try {
      const res = await fetch('/api/cart/add', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ productId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Backend rejected replacement:', err.error || res.status);
        return;
      }

      const { product } = await res.json();
      const originalId = original.id || original.product_id;

      setCart((prev) => {
        const existing = prev.find((i) => i.id === originalId || i.product_code === (original.product_code || original.product_id));
        if (!existing) return prev;
        return prev.map((i) =>
          (i.id === originalId || i.product_code === (original.product_code || original.product_id))
            ? { id: product.id, product_code: product.product_code, name: product.name, price: product.price, qty: i.qty, category: product.category }
            : i
        );
      });

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Done! Replaced "${original.name}" with "${product.name}" and saved ₹${(original.price - product.price).toFixed(0)}.`,
        recommendations: [],
        intents: [],
        eta: null,
        urgency_required: false,
        budget_suggestions: [],
        checkout_pending: false,
      }]);
    } catch (e) {
      console.error('Replacement network error:', e);
    }
  }, []);

  const handleUrgency = (val) => {
    setUrgency(val);
    sendMessage(`My urgency: ${val}`);
  };

  // ── Checkout ──────────────────────────────────────────────────────────────
  // Cart icon in header → opens the main cart drawer
  const handleOpenCartDrawer = () => setShowCartDrawer(true);

  // Checkout inside the drawer → opens the confirmation modal
  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setShowCartDrawer(false);
    setCheckoutModal(true);
  };

  const handleConfirmOrder = async () => {
    try {
      const res = await fetch('/api/chat/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })), budget }),
      });
      const data = await res.json();
      if (data.success) {
        setOrderResult(data.order);
        setCart([]);
        setCheckoutPending(false);
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `🎉 Order confirmed! Order #${data.order.order_id} — ₹${data.order.total_amount} for ${data.order.item_count} items. Estimated delivery: ~18 mins. Thank you for shopping!`,
          recommendations: [],
          intents: [],
          eta: null,
          urgency_required: false,
          budget_suggestions: [],
          checkout_pending: false,
        }]);
      }
    } catch (err) {
      console.error('Checkout failed:', err);
    }
  };

  const handleSetBudget = (val) => {
    if (val === null) {
      setBudget(null);
      return;
    }
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) {
      setBudget(n);
      sendMessage(`My budget is ₹${n}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div
        className="w-full bg-white rounded-3xl shadow-2xl overflow-hidden flex"
        style={{ maxWidth: '1100px', height: '700px' }}
      >
        {/* ── LEFT: Chat Panel ─────────────────────────────────────── */}
        <ChatPanel
          messages={messages}
          input={input}
          loading={loading}
          urgency={urgency}
          onInputChange={setInput}
          onSend={sendMessage}
          onAddToCart={handleAddToCart}
          onUrgency={handleUrgency}
          onSetBudget={handleSetBudget}
          onApplyReplacement={handleApplyReplacement}
          onOpenCartDrawer={handleOpenCartDrawer}
          cart={cart}
          stagingCart={stagingCart}
          onMoveToCart={handleMoveToCart}
          budget={budget}
          inlineSuggestions={inlineSuggestions}
          onDismissInline={(id) => setInlineSuggestions((prev) => { const n = { ...prev }; delete n[id]; return n; })}
        />

        {/* ── RIGHT: Live Cart Panel (chat staging area) ───────────── */}
        <LiveCartPanel
          cart={stagingCart}
          cartTotal={stagingCart.reduce((s, i) => s + i.price * i.qty, 0)}
          budget={budget}
          remaining={budget ? budget - stagingCart.reduce((s, i) => s + i.price * i.qty, 0) : null}
          isOverBudget={budget && stagingCart.reduce((s, i) => s + i.price * i.qty, 0) > budget}
          onUpdateCart={(id, delta) => {
            setStagingCart((prev) => {
              if (delta === 0) return prev.filter((i) => i.id !== id);
              return prev.map((i) => i.id === id ? { ...i, qty: i.qty + delta } : i).filter((i) => i.qty > 0);
            });
          }}
          onAddToCart={handleAddToCart}
          onMoveToCart={handleMoveToCart}
          onSetBudget={handleSetBudget}
          checkoutPending={checkoutPending}
          intelligence={cartIntelligence}
          inlineSuggestions={inlineSuggestions}
          onDismissInline={(id) => setInlineSuggestions((prev) => { const n = { ...prev }; delete n[id]; return n; })}
        />
      </div>

      {/* ── Main Cart Drawer (opens from header cart icon) ──────────── */}
      {showCartDrawer && (
        <MainCartDrawer
          cart={cart}
          cartTotal={cartTotal}
          budget={budget}
          remaining={remaining}
          isOverBudget={isOverBudget}
          onUpdateCart={handleUpdateCart}
          onCheckout={handleCheckout}
          onClose={() => setShowCartDrawer(false)}
        />
      )}

      {/* ── Checkout Modal ───────────────────────────────────────────── */}
      {checkoutModal && (
        <CheckoutModal
          cart={cart}
          budget={budget}
          cartTotal={cartTotal}
          orderResult={orderResult}
          onConfirm={handleConfirmOrder}
          onClose={() => { setCheckoutModal(false); setOrderResult(null); }}
          onAddMore={() => { setCheckoutModal(false); sendMessage("I want to add more items"); }}
          onReplace={() => { setCheckoutModal(false); sendMessage("I want to replace some expensive items with cheaper ones"); }}
        />
      )}
    </div>
  );
}
