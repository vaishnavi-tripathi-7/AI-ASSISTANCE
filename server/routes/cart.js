/**
 * routes/cart.js
 * Cart Intelligence API endpoints.
 *
 * POST /api/cart/add
 *   Body: { productId }
 *   Returns: validated product from the database (single source of truth)
 *
 * POST /api/cart/intelligence
 *   Body: { cart, userId, budget }
 *   Returns: { selling_fast, cart_items, replacements, premium_alternatives, cart_insights }
 */

const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const { getCartIntelligence, getPostAddSuggestions } = require("../services/cartIntelligence");

// ─── POST /api/cart/add ──────────────────────────────────────────────────────
// Single source of truth: validates product exists in the backend database
// and returns its canonical representation for the frontend cart.
// The frontend MUST NOT construct product objects on its own.

router.post("/add", async (req, res) => {
  try {
    console.log("REQUEST BODY:", req.body);

    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    console.log("PRODUCT LOOKUP QUERY INPUT:", productId);

    // Look up the product in the database — the single source of truth
    const result = await pool.query(
      `SELECT product_id, name, price, category, subcategory, brand, stock
       FROM products
       WHERE product_id = $1`,
      [productId]
    );

    console.log("PRODUCT LOOKUP RESULT:", result.rows);

    if (!result.rows.length) {
      const response = { error: `Product not found: ${productId}` };
      console.log("HTTP RESPONSE (404):", response);
      return res.status(404).json(response);
    }

    const product = result.rows[0];
    console.log("PRODUCT FOUND:", product);

    // Extract numeric ID from product_code (e.g., "P0083" → 83)
    const numericId = (() => {
      const match = String(product.product_id).match(/\d+/);
      return match ? Number(match[0]) : null;
    })();

    return res.json({
      success: true,
      product: {
        id:           numericId,
        product_id:   product.product_id,
        product_code: product.product_id,
        name:         product.name,
        price:        Number(product.price),
        category:     product.category || "",
        subcategory:  product.subcategory || "",
        brand:        product.brand || "",
        stock:        product.stock,
      },
    });
  } catch (err) {
    console.error("Cart add error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/cart/intelligence ─────────────────────────────────────────────

router.post("/intelligence", async (req, res) => {
  try {
    const {
      cart   = [],
      userId = "U0001",
      budget = null,
    } = req.body;

    if (!Array.isArray(cart)) {
      return res.status(400).json({ error: "cart must be an array" });
    }

    // Normalise cart items — frontend sends { id, name, price, qty, category }
    const cartItems = cart.map((i) => ({
      id:          i.id || i.product_id,
      product_id:  i.id || i.product_id,
      name:        i.name || i.product_name,
      price:       Number(i.price ?? i.product_price ?? 0),
      qty:         Number(i.qty ?? 1),
      category:    i.category || "",
    }));

    console.log(`\n══ CART INTELLIGENCE REQUEST ══════════════════════════`);
    console.log(`user=${userId}  cart_items=${cartItems.length}  budget=${budget}`);
    console.log(`══════════════════════════════════════════════════════\n`);

    const result = await getCartIntelligence({ cartItems, userId, budget });

    return res.json(result);
  } catch (err) {
    console.error("Cart intelligence error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/cart/post-add-suggestion ───────────────────────────────────────
// Called by the frontend every time a product is added to the cart.
// Body: { productId, userId }
// Returns: { mode, added_product, label, message, suggestions }

router.post("/post-add-suggestion", async (req, res) => {
  try {
    const { productId, userId = "U0001" } = req.body;

    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    console.log(`\n══ POST-ADD SUGGESTION ════════════════════════════════`);
    console.log(`product=${productId}  user=${userId}`);
    console.log(`══════════════════════════════════════════════════════\n`);

    const result = await getPostAddSuggestions(productId, userId, 5);

    if (!result) {
      return res.json({ mode: null, suggestions: [], label: "", message: "" });
    }

    return res.json(result);
  } catch (err) {
    console.error("Post-add suggestion error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
