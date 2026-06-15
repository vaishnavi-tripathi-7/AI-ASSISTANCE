/**
 * cartService.js
 * Handles all cart logic: replacements, budget checks, checkout creation.
 */

const pool = require("../db");

// ─── FIND CHEAPER REPLACEMENT ─────────────────────────────────────────────────

async function findCheaperAlternative(productId, maxPrice) {
  const original = await pool.query(
    "SELECT product_id, name, price, category, subcategory FROM products WHERE product_id = $1",
    [productId]
  );
  if (!original.rows.length) return null;

  const orig = original.rows[0];

  const result = await pool.query(
    `SELECT p.product_id, p.name, p.price, p.category, p.subcategory, p.brand, p.stock
     FROM products p
     LEFT JOIN product_tags pt ON p.product_id = pt.product_id
     WHERE p.category = $1
       AND p.price < $2
       AND p.product_id != $3
       AND p.stock > 0
     GROUP BY p.product_id
     ORDER BY p.price DESC
     LIMIT 3`,
    [orig.category, maxPrice, productId]
  );

  if (!result.rows.length) return null;

  const alt = result.rows[0];
  return {
    original: { product_id: orig.product_id, name: orig.name, price: Number(orig.price) },
    replacement: {
      product_id: alt.product_id,
      name: alt.name,
      price: Number(alt.price),
      category: alt.category,
      brand: alt.brand,
      stock: alt.stock,
    },
    savings: Number(orig.price) - Number(alt.price),
  };
}

// ─── GET CART ALTERNATIVES (for budget over-run) ──────────────────────────────

async function suggestBudgetOptimizations(cartItems, targetSaving) {
  const suggestions = [];
  // Sort by price descending — replace most expensive first
  const sorted = [...cartItems].sort((a, b) => b.price - a.price);

  let remainingSaving = targetSaving;
  for (const item of sorted) {
    if (remainingSaving <= 0) break;
    const alt = await findCheaperAlternative(item.id, item.price - 1);
    if (alt && alt.savings > 0) {
      suggestions.push(alt);
      remainingSaving -= alt.savings * item.qty;
    }
  }
  return suggestions;
}

// ─── CREATE ORDER FROM CART ───────────────────────────────────────────────────

async function createOrderFromCart({ cartItems, userId, warehouseId, intent, budgetRange }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const totalAmount = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    const orderId = "ORD" + Date.now();

    // Determine budget_range label
    let budgetRangeLabel = "1000+";
    if (totalAmount <= 200) budgetRangeLabel = "0-200";
    else if (totalAmount <= 400) budgetRangeLabel = "200-400";
    else if (totalAmount <= 700) budgetRangeLabel = "400-700";
    else if (totalAmount <= 1000) budgetRangeLabel = "700-1000";
    const finalBudgetRange = budgetRange || budgetRangeLabel;

    // Validate warehouse
    const whCheck = await client.query(
      "SELECT warehouse_id FROM warehouses WHERE warehouse_id = $1",
      [warehouseId]
    );
    const finalWarehouseId = whCheck.rows.length ? warehouseId : null;

    if (!finalWarehouseId) {
      // Pick first warehouse
      const anyWh = await client.query("SELECT warehouse_id FROM warehouses LIMIT 1");
      if (!anyWh.rows.length) throw new Error("No warehouses available");
      warehouseId = anyWh.rows[0].warehouse_id;
    }

    // Insert order
    await client.query(
      `INSERT INTO orders (order_id, user_id, warehouse_id, intent, total_amount, order_time, delivery_time_minutes, order_status, budget_range)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, 'pending', $7)`,
      [orderId, userId || "U001", finalWarehouseId || warehouseId, intent || "general", totalAmount, 18, finalBudgetRange]
    );

    // Insert order items
    for (const item of cartItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_id, product_id) DO NOTHING`,
        [orderId, item.id, item.qty, item.price]
      );
    }

    await client.query("COMMIT");

    return {
      order_id: orderId,
      total_amount: totalAmount,
      item_count: cartItems.reduce((s, i) => s + i.qty, 0),
      warehouse_id: finalWarehouseId || warehouseId,
      status: "pending",
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── BUILD CART CONTEXT STRING (for AI system prompt) ─────────────────────────

function buildCartContext(cart, budget) {
  if (!cart || cart.length === 0) {
    return budget
      ? `Cart is empty. Budget: ₹${budget}.`
      : "Cart is empty.";
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);
  const categories = [...new Set(cart.map((i) => i.category).filter(Boolean))];
  const remaining = budget ? budget - total : null;

  const lines = [
    `CURRENT CART (${itemCount} items, ₹${total} total):`,
    ...cart.map((i) => `  - ${i.name} x${i.qty} = ₹${i.price * i.qty} (₹${i.price} each)`),
    `Categories covered: ${categories.length ? categories.join(", ") : "none"}`,
  ];

  if (budget) {
    lines.push(`Budget: ₹${budget}`);
    if (remaining >= 0) {
      lines.push(`Remaining budget: ₹${remaining}`);
    } else {
      lines.push(`OVER BUDGET by ₹${Math.abs(remaining)}`);
    }
  }

  return lines.join("\n");
}

module.exports = {
  findCheaperAlternative,
  suggestBudgetOptimizations,
  createOrderFromCart,
  buildCartContext,
};
