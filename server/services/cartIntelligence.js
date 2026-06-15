/**
 * cartIntelligence.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cart Intelligence Layer for QuickCart AI.
 *
 * FEATURE 1 — Smart Replacements  (budget-conscious users: avg_order_value < 500)
 *   For each cart item → find 3-5 cheaper alternatives in same category/subcategory.
 *   Score = (similarity * 0.7) + (price_saving_pct * 0.3)
 *
 * FEATURE 2 — Premium Upgrades    (premium users: avg_order_value >= 500)
 *   For each cart item → find higher-rated alternatives in same category/subcategory.
 *   Score = (similarity * 0.5) + (avg_rating * 0.3) + (review_count_weight * 0.2)
 *
 * FEATURE 3 — High Demand Products (global selling-fast)
 *   demand_score = (orders_last_30d * 0.5) + (unique_customers_last_30d * 0.3)
 *                + (repeat_purchase_count * 0.2)
 *
 * FEATURE 4 — Personalized Demand  (filtered by user preferences + cart context)
 *
 * FEATURE 5 — All SQL lives here, optimised for PostgreSQL.
 */

const pool = require("../db");

// Extracts numeric portion from product_code (e.g., "P0083" → 83)
function extractNumericId(productCode) {
  if (!productCode) return null;
  const match = String(productCode).match(/\d+/);
  return match ? Number(match[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — get user's avg_order_value to decide budget vs premium mode
// ─────────────────────────────────────────────────────────────────────────────
async function getUserAvgOrderValue(userId) {
  const result = await pool.query(
    `SELECT avg_order_value FROM users WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length ? Number(result.rows[0].avg_order_value) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — Smart Replacements (budget-conscious: avg_order_value < 500)
//
// Similarity is approximated as:
//   100% if same category + subcategory
//   80%  if same category only
// We only return results with similarity >= 90 (i.e., same subcategory).
//
// Score formula: (similarity * 0.7) + (price_saving_pct * 0.3)
// ─────────────────────────────────────────────────────────────────────────────
async function getSmartReplacements(cartItems, userId, limit = 5) {
  const replacements = {};

  for (const item of cartItems) {
    const productId = item.id || item.product_id;
    if (!productId) continue;

    // Get original product details
    const origResult = await pool.query(
      `SELECT p.product_id, p.name, p.price, p.category, p.subcategory,
              COALESCE(cr.avg_rating, 0) AS avg_rating,
              COALESCE(cr.review_count, 0) AS review_count
       FROM products p
       LEFT JOIN (
         SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM reviews GROUP BY product_id
       ) cr ON p.product_id = cr.product_id
       WHERE p.product_id = $1`,
      [productId]
    );
    if (!origResult.rows.length) continue;
    const orig = origResult.rows[0];

    // Find cheaper alternatives in same category + subcategory (similarity = 100)
    const altResult = await pool.query(
      `SELECT
         p.product_id,
         p.name,
         p.price,
         p.category,
         p.subcategory,
         p.brand,
         p.stock,
         100.0                             AS similarity_score,
         COALESCE(cr.avg_rating, 0)        AS rating,
         COALESCE(cr.review_count, 0)      AS review_count,
         ($2 - p.price)                    AS price_saving,
         CASE WHEN $2 > 0
              THEN ROUND((($2 - p.price) / $2 * 100)::numeric, 1)
              ELSE 0 END                   AS price_saving_pct,
         -- Score = (similarity * 0.7) + (price_saving_pct * 0.3)
         ROUND((
           100.0 * 0.7
           + CASE WHEN $2 > 0
                  THEN (($2 - p.price) / $2 * 100) * 0.3
                  ELSE 0 END
         )::numeric, 2)                    AS score
       FROM products p
       LEFT JOIN (
         SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM reviews GROUP BY product_id
       ) cr ON p.product_id = cr.product_id
       WHERE p.category    = $3
         AND p.subcategory = $4
         AND p.price       < $2
         AND p.product_id != $1
         AND p.stock       > 0
       ORDER BY score DESC
       LIMIT $5`,
      [productId, orig.price, orig.category, orig.subcategory, limit]
    );

    if (!altResult.rows.length) continue;

    replacements[productId] = {
      original: {
        product_id:   orig.product_id,
        id:           extractNumericId(orig.product_id),
        product_code: orig.product_id,
        name:         orig.name,
        price:        Number(orig.price),
        category:     orig.category,
        subcategory:  orig.subcategory,
        avg_rating:   Number(orig.avg_rating),
        review_count: Number(orig.review_count),
      },
      reason:       "Similar product at lower cost",
      label:        "Save Money On This Item",
      alternatives: altResult.rows.map((a) => ({
        product_id:       a.product_id,
        id:               extractNumericId(a.product_id),
        product_code:     a.product_id,
        name:             a.name,
        price:            Number(a.price),
        category:         a.category,
        brand:            a.brand,
        similarity_score: Number(a.similarity_score),
        rating:           Number(a.rating),
        review_count:     Number(a.review_count),
        price_saving:     Number(a.price_saving),
        price_saving_pct: Number(a.price_saving_pct),
        score:            Number(a.score),
        demand_score:     null,
      })),
    };
  }

  return replacements;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 2 — Premium Upgrades (avg_order_value >= 500)
//
// Finds higher-rated alternatives in same category + subcategory.
// Only considers products with price >= current (no cheaper alternatives).
// Score = (similarity * 0.5) + (avg_rating * 0.3) + (review_count_weight * 0.2)
// review_count_weight = LEAST(review_count / 100, 5) — normalised to 0-5 range
// ─────────────────────────────────────────────────────────────────────────────
async function getPremiumUpgrades(cartItems, userId, limit = 5) {
  const premiumAlts = {};

  for (const item of cartItems) {
    const productId = item.id || item.product_id;
    if (!productId) continue;

    const origResult = await pool.query(
      `SELECT p.product_id, p.name, p.price, p.category, p.subcategory,
              COALESCE(cr.avg_rating, 0) AS avg_rating,
              COALESCE(cr.review_count, 0) AS review_count
       FROM products p
       LEFT JOIN (
         SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM reviews GROUP BY product_id
       ) cr ON p.product_id = cr.product_id
       WHERE p.product_id = $1`,
      [productId]
    );
    if (!origResult.rows.length) continue;
    const orig = origResult.rows[0];

    const altResult = await pool.query(
      `SELECT
         p.product_id,
         p.name,
         p.price,
         p.category,
         p.subcategory,
         p.brand,
         p.stock,
         100.0                                                  AS similarity_score,
         ROUND(cr.avg_rating::numeric, 2)                      AS rating,
         cr.review_count,
         -- review_count_weight normalised to 0–5
         LEAST(cr.review_count / 100.0, 5.0)                   AS review_count_weight,
         -- Score = (similarity*0.5) + (avg_rating*0.3) + (review_count_weight*0.2)
         ROUND((
           100.0 * 0.5
           + cr.avg_rating * 0.3
           + LEAST(cr.review_count / 100.0, 5.0) * 0.2
         )::numeric, 2)                                        AS score
       FROM products p
       JOIN (
         SELECT product_id,
                AVG(rating)  AS avg_rating,
                COUNT(*)     AS review_count
         FROM reviews
         GROUP BY product_id
       ) cr ON p.product_id = cr.product_id
       WHERE p.category    = $2
         AND p.subcategory = $3
         AND p.product_id != $1
         AND p.stock       > 0
         AND cr.avg_rating > $4          -- must be rated higher than current
       ORDER BY score DESC
       LIMIT $5`,
      [productId, orig.category, orig.subcategory, orig.avg_rating, limit]
    );

    if (!altResult.rows.length) continue;

    premiumAlts[productId] = {
      original: {
        product_id:   orig.product_id,
        id:           extractNumericId(orig.product_id),
        product_code: orig.product_id,
        name:         orig.name,
        price:        Number(orig.price),
        category:     orig.category,
        subcategory:  orig.subcategory,
        avg_rating:   Number(orig.avg_rating),
        review_count: Number(orig.review_count),
      },
      reason: "Higher ratings and stronger customer reviews",
      label:  "Customers Prefer These",
      alternatives: altResult.rows.map((a) => ({
        product_id:       a.product_id,
        id:               extractNumericId(a.product_id),
        product_code:     a.product_id,
        name:             a.name,
        price:            Number(a.price),
        category:         a.category,
        brand:            a.brand,
        similarity_score: Number(a.similarity_score),
        rating:           Number(a.rating),
        review_count:     Number(a.review_count),
        price_saving:     null,
        price_saving_pct: null,
        score:            Number(a.score),
        demand_score:     null,
      })),
    };
  }

  return premiumAlts;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — High Demand Products (global 🔥 Selling Fast)
//
// demand_score = (orders_last_30d * 0.5)
//              + (unique_customers_last_30d * 0.3)
//              + (repeat_purchase_count * 0.2)
//
// repeat_purchase_count = users who ordered the same product >= 2 times
// ─────────────────────────────────────────────────────────────────────────────
async function getSellingFastProducts(limit = 5) {
  const result = await pool.query(
    `WITH order_stats AS (
       SELECT
         oi.product_id,
         COUNT(DISTINCT oi.order_id)          AS orders_last_30d,
         COUNT(DISTINCT o.user_id)            AS unique_customers_last_30d
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.order_id
       WHERE o.order_time >= NOW() - INTERVAL '30 days'
       GROUP BY oi.product_id
     ),
     repeat_stats AS (
       -- count distinct users who have ordered the same product 2+ times
       SELECT product_id, COUNT(*) AS repeat_purchase_count
       FROM (
         SELECT oi.product_id, o.user_id
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.order_id
         GROUP BY oi.product_id, o.user_id
         HAVING COUNT(*) >= 2
       ) repeated_buyers
       GROUP BY product_id
     ),
     community_ratings AS (
       SELECT product_id,
              ROUND(AVG(rating)::numeric, 2) AS avg_rating,
              COUNT(*)                       AS review_count
       FROM reviews
       GROUP BY product_id
     )
     SELECT
       p.product_id,
       p.name,
       p.category,
       p.subcategory,
       p.brand,
       p.price,
       p.stock,
       COALESCE(os.orders_last_30d,          0) AS orders_last_30d,
       COALESCE(os.unique_customers_last_30d, 0) AS unique_customers_last_30d,
       COALESCE(rs.repeat_purchase_count,     0) AS repeat_purchase_count,
       COALESCE(cr.avg_rating,                0) AS rating,
       COALESCE(cr.review_count,              0) AS review_count,
       ROUND((
         COALESCE(os.orders_last_30d,          0) * 0.5
         + COALESCE(os.unique_customers_last_30d, 0) * 0.3
         + COALESCE(rs.repeat_purchase_count,     0) * 0.2
       )::numeric, 2)                            AS demand_score
     FROM products p
     LEFT JOIN order_stats       os ON p.product_id = os.product_id
     LEFT JOIN repeat_stats      rs ON p.product_id = rs.product_id
     LEFT JOIN community_ratings cr ON p.product_id = cr.product_id
     WHERE p.stock > 0
     ORDER BY demand_score DESC
     LIMIT $1`,
    [limit]
  );

  console.log(`[selling_fast] top ${result.rows.length} high-demand products`);
  return result.rows.map((r) => ({
    product_id:                  r.product_id,
    id:                          extractNumericId(r.product_id),
    product_code:                r.product_id,
    name:                        r.name,
    category:                    r.category,
    price:                       Number(r.price),
    rating:                      Number(r.rating),
    review_count:                Number(r.review_count),
    demand_score:                Number(r.demand_score),
    orders_last_30d:             Number(r.orders_last_30d),
    unique_customers_last_30d:   Number(r.unique_customers_last_30d),
    repeat_purchase_count:       Number(r.repeat_purchase_count),
    similarity_score:            null,
    price_saving:                null,
    reason:                      buildDemandReason(r),
  }));
}

function buildDemandReason(row) {
  if (Number(row.repeat_purchase_count) > 50) return "High repeat purchases";
  if (Number(row.unique_customers_last_30d) > 100)
    return `Ordered by ${row.unique_customers_last_30d} customers this month`;
  if (Number(row.orders_last_30d) > 30) return "Trending this week";
  return "Popular right now";
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 4 — Personalized Demand
// Filters the selling-fast pool by:
//   • user's favourite categories
//   • categories present in the current cart
//   • products the user has purchased before (repeat signal)
// ─────────────────────────────────────────────────────────────────────────────
async function getPersonalizedSellingFast(userId, cartItems, limit = 5) {
  // Gather user's favourite categories
  const favResult = await pool.query(
    `SELECT category FROM user_favorite_categories WHERE user_id = $1`,
    [userId]
  );
  const favCategories = favResult.rows.map((r) => r.category);

  // Categories currently in cart
  const cartCategories = [...new Set(cartItems.map((i) => i.category).filter(Boolean))];

  // Union of relevant categories
  const relevantCategories = [...new Set([...favCategories, ...cartCategories])];

  // Products user has ordered before (repeat boost)
  const historyResult = await pool.query(
    `SELECT DISTINCT oi.product_id
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.order_id
     WHERE o.user_id = $1`,
    [userId]
  );
  const purchasedIds = historyResult.rows.map((r) => r.product_id);

  const result = await pool.query(
    `WITH order_stats AS (
       SELECT
         oi.product_id,
         COUNT(DISTINCT oi.order_id)   AS orders_last_30d,
         COUNT(DISTINCT o.user_id)     AS unique_customers_last_30d
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.order_id
       WHERE o.order_time >= NOW() - INTERVAL '30 days'
       GROUP BY oi.product_id
     ),
     repeat_stats AS (
       SELECT product_id, COUNT(*) AS repeat_purchase_count
       FROM (
         SELECT oi.product_id, o.user_id
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.order_id
         GROUP BY oi.product_id, o.user_id
         HAVING COUNT(*) >= 2
       ) rb
       GROUP BY product_id
     ),
     community_ratings AS (
       SELECT product_id,
              ROUND(AVG(rating)::numeric, 2) AS avg_rating,
              COUNT(*)                       AS review_count
       FROM reviews GROUP BY product_id
     )
     SELECT
       p.product_id,
       p.name,
       p.category,
       p.subcategory,
       p.brand,
       p.price,
       p.stock,
       COALESCE(os.orders_last_30d,          0) AS orders_last_30d,
       COALESCE(os.unique_customers_last_30d, 0) AS unique_customers_last_30d,
       COALESCE(rs.repeat_purchase_count,     0) AS repeat_purchase_count,
       COALESCE(cr.avg_rating,                0) AS rating,
       COALESCE(cr.review_count,              0) AS review_count,
       ROUND((
         COALESCE(os.orders_last_30d,          0) * 0.5
         + COALESCE(os.unique_customers_last_30d, 0) * 0.3
         + COALESCE(rs.repeat_purchase_count,     0) * 0.2
         -- boost for user's own purchase history
         + CASE WHEN p.product_id = ANY($3::text[]) THEN 10 ELSE 0 END
       )::numeric, 2)                            AS demand_score
     FROM products p
     LEFT JOIN order_stats       os ON p.product_id = os.product_id
     LEFT JOIN repeat_stats      rs ON p.product_id = rs.product_id
     LEFT JOIN community_ratings cr ON p.product_id = cr.product_id
     WHERE p.stock > 0
       AND (
         cardinality($2::text[]) = 0          -- no category filter when array is empty
         OR p.category = ANY($2::text[])
       )
     ORDER BY demand_score DESC
     LIMIT $1`,
    [limit, relevantCategories, purchasedIds.length ? purchasedIds : []]
  );

  console.log(`[personalized_selling_fast] user=${userId} categories=${JSON.stringify(relevantCategories)} → ${result.rows.length} rows`);

  return result.rows.map((r) => ({
    product_id:                r.product_id,
    id:                        extractNumericId(r.product_id),
    product_code:              r.product_id,
    name:                      r.name,
    category:                  r.category,
    price:                     Number(r.price),
    rating:                    Number(r.rating),
    review_count:              Number(r.review_count),
    demand_score:              Number(r.demand_score),
    orders_last_30d:           Number(r.orders_last_30d),
    unique_customers_last_30d: Number(r.unique_customers_last_30d),
    repeat_purchase_count:     Number(r.repeat_purchase_count),
    similarity_score:          null,
    price_saving:              null,
    reason:                    buildDemandReason(r),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 5 — Cart Insights
// Textual insights computed from the cart state:
//   • budget health
//   • category diversity
//   • demand alerts for cart items
// ─────────────────────────────────────────────────────────────────────────────
async function getCartInsights(cartItems, budget, userId) {
  const insights = [];
  if (!cartItems.length) return insights;

  const cartTotal = cartItems.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const categories = [...new Set(cartItems.map((i) => i.category).filter(Boolean))];
  const productIds = cartItems.map((i) => i.id || i.product_id).filter(Boolean);

  // Budget insight
  if (budget) {
    const pct = Math.round((cartTotal / budget) * 100);
    if (pct >= 100) {
      insights.push({ type: "warning", message: `You're ${pct - 100}% over your ₹${budget} budget. Consider swapping some items.` });
    } else if (pct >= 80) {
      insights.push({ type: "alert", message: `You've used ${pct}% of your ₹${budget} budget. Only ₹${budget - cartTotal} left.` });
    } else {
      insights.push({ type: "info", message: `Great! You're within budget — ₹${budget - cartTotal} remaining.` });
    }
  }

  // Category diversity
  if (categories.length === 1) {
    insights.push({ type: "tip", message: `All items are from ${categories[0]}. Want to add something from another category?` });
  } else if (categories.length >= 4) {
    insights.push({ type: "positive", message: `Nice variety! Your cart covers ${categories.length} categories.` });
  }

  // Low stock alerts for cart items
  if (productIds.length > 0) {
    const stockResult = await pool.query(
      `SELECT product_id, name, stock FROM products
       WHERE product_id = ANY($1::text[]) AND stock <= 10`,
      [productIds]
    );
    stockResult.rows.forEach((p) => {
      insights.push({ type: "urgency", message: `⚠️ Only ${p.stock} left of "${p.name}". Add more before it sells out!` });
    });
  }

  return insights;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR — getCartIntelligence
// Called from the route. Returns the full Feature 1–5 response object.
// ─────────────────────────────────────────────────────────────────────────────
async function getCartIntelligence({ cartItems = [], userId = "U0001", budget = null }) {
  if (!cartItems.length) {
    return {
      selling_fast:       [],
      cart_items:         [],
      replacements:       {},
      premium_alternatives: {},
      cart_insights:      [],
    };
  }

  // Determine mode: budget-conscious vs premium
  const avgOrderValue = await getUserAvgOrderValue(userId);
  const isBudgetUser  = avgOrderValue < 500;

  console.log(`[cart_intelligence] user=${userId} avg_order_value=${avgOrderValue} mode=${isBudgetUser ? "budget" : "premium"}`);

  // Run all features in parallel
  const [
    replacements,
    premiumAlts,
    sellingFast,
    personalizedFast,
    insights,
  ] = await Promise.all([
    isBudgetUser  ? getSmartReplacements(cartItems, userId)   : Promise.resolve({}),
    !isBudgetUser ? getPremiumUpgrades(cartItems, userId)     : Promise.resolve({}),
    getSellingFastProducts(5),
    getPersonalizedSellingFast(userId, cartItems, 5),
    getCartInsights(cartItems, budget, userId),
  ]);

  // Merge global + personalised selling-fast, deduplicate, keep top 5
  const seen = new Map();
  for (const p of [...personalizedFast, ...sellingFast]) {
    if (!seen.has(p.product_id)) seen.set(p.product_id, p);
  }
  const mergedSellingFast = [...seen.values()]
    .sort((a, b) => b.demand_score - a.demand_score)
    .slice(0, 5);

  return {
    mode:                 isBudgetUser ? "budget" : "premium",
    selling_fast:         mergedSellingFast,
    cart_items:           cartItems,
    replacements:         isBudgetUser  ? replacements : {},
    premium_alternatives: !isBudgetUser ? premiumAlts  : {},
    cart_insights:        insights,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 6 — Post-Add-To-Cart Suggestions
//
// Triggered every time a user adds a product to their cart.
// Strategy depends on the user's avg_order_value:
//
//   Budget user  (avg_order_value < 500):
//     → Find items with ≥ 90% similarity (same category + subcategory, cheaper
//       or similarly-priced).  Similarity is set to 90 when the subcategory
//       matches but the price is not lower (same tier), 95+ for cheaper ones.
//       Sorted by similarity DESC.
//
//   Premium user (avg_order_value >= 500):
//     → Find items in the same category with avg_rating > current product's
//       avg_rating, ordered by (avg_rating DESC, review_count DESC).
//       Messaging: "Customers who bought similar items highly rated these"
//
// Returns: { mode, added_product, suggestions: [...], label, message }
// ─────────────────────────────────────────────────────────────────────────────
async function getPostAddSuggestions(productId, userId, limit = 5) {
  if (!productId || !userId) return null;

  // 1. Resolve the just-added product
  const origResult = await pool.query(
    `SELECT p.product_id, p.name, p.price, p.category, p.subcategory, p.brand, p.stock,
            COALESCE(cr.avg_rating,   0) AS avg_rating,
            COALESCE(cr.review_count, 0) AS review_count
     FROM products p
     LEFT JOIN (
       SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
       FROM reviews GROUP BY product_id
     ) cr ON p.product_id = cr.product_id
     WHERE p.product_id = $1`,
    [productId]
  );
  if (!origResult.rows.length) return null;
  const orig = origResult.rows[0];

  // 2. Determine user tier
  const avgOrderValue = await getUserAvgOrderValue(userId);
  const isBudgetUser  = avgOrderValue < 500;

  console.log(`[post_add_suggestions] product=${productId} user=${userId} avg_order_value=${avgOrderValue} mode=${isBudgetUser ? "budget" : "premium"}`);

  if (isBudgetUser) {
    // ── BUDGET: suggest items with ≥ 90% similarity ──────────────────────
    // Similarity definition:
    //   100 = same subcategory + cheaper price
    //    90 = same subcategory + similar price (within 20% higher)
    // We treat both as "≥ 90" and sort by similarity then price_saving.
    const altResult = await pool.query(
      `SELECT
         p.product_id,
         p.name,
         p.price,
         p.category,
         p.subcategory,
         p.brand,
         p.stock,
         COALESCE(cr.avg_rating,   0)   AS avg_rating,
         COALESCE(cr.review_count, 0)   AS review_count,
         -- similarity score: 100 if cheaper, 90 if within 20% higher price
         CASE
           WHEN p.price < $2
             THEN 100.0
           WHEN p.price <= $2 * 1.20
             THEN 90.0
           ELSE NULL                    -- exclude anything more than 20% pricier
         END                            AS similarity_score,
         ROUND(($2 - p.price)::numeric, 2) AS price_saving
       FROM products p
       LEFT JOIN (
         SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM reviews GROUP BY product_id
       ) cr ON p.product_id = cr.product_id
       WHERE p.category    = $3
         AND p.subcategory = $4
         AND p.product_id != $1
         AND p.stock       > 0
         AND (p.price < $2 OR p.price <= $2 * 1.20)
       ORDER BY similarity_score DESC, price_saving DESC
       LIMIT $5`,
      [productId, orig.price, orig.category, orig.subcategory, limit]
    );

    const suggestions = altResult.rows
      .filter((r) => r.similarity_score !== null)
      .map((r) => ({
        product_id:       r.product_id,
        id:               extractNumericId(r.product_id),
        product_code:     r.product_id,
        name:             r.name,
        price:            Number(r.price),
        category:         r.category,
        subcategory:      r.subcategory,
        brand:            r.brand,
        stock:            r.stock,
        avg_rating:       Number(r.avg_rating),
        review_count:     Number(r.review_count),
        similarity_score: Number(r.similarity_score),
        price_saving:     Number(r.price_saving),
      }));

    return {
      mode:          "budget",
      added_product: { product_id: orig.product_id, id: extractNumericId(orig.product_id), product_code: orig.product_id, name: orig.name, price: Number(orig.price) },
      label:         "Similar Items You Might Prefer",
      message:       `We found ${suggestions.length} similar product${suggestions.length !== 1 ? "s" : ""} to "${orig.name}".`,
      suggestions,
    };

  } else {
    // ── PREMIUM: suggest better-rated items in same category ─────────────
    const altResult = await pool.query(
      `SELECT
         p.product_id,
         p.name,
         p.price,
         p.category,
         p.subcategory,
         p.brand,
         p.stock,
         ROUND(cr.avg_rating::numeric,   2) AS avg_rating,
         cr.review_count,
         -- Score = avg_rating * 0.6 + LEAST(review_count/100, 5) * 0.4
         ROUND((
           cr.avg_rating * 0.6
           + LEAST(cr.review_count / 100.0, 5.0) * 0.4
         )::numeric, 3)                    AS quality_score
       FROM products p
       JOIN (
         SELECT product_id,
                AVG(rating)  AS avg_rating,
                COUNT(*)     AS review_count
         FROM reviews
         GROUP BY product_id
         HAVING AVG(rating) > $2           -- must beat current product's rating
       ) cr ON p.product_id = cr.product_id
       WHERE p.category    = $3
         AND p.product_id != $1
         AND p.stock       > 0
       ORDER BY quality_score DESC
       LIMIT $4`,
      [productId, orig.avg_rating, orig.category, limit]
    );

    const suggestions = altResult.rows.map((r) => ({
      product_id:       r.product_id,
      id:               extractNumericId(r.product_id),
      product_code:     r.product_id,
      name:             r.name,
      price:            Number(r.price),
      category:         r.category,
      subcategory:      r.subcategory,
      brand:            r.brand,
      stock:            r.stock,
      avg_rating:       Number(r.avg_rating),
      review_count:     Number(r.review_count),
      quality_score:    Number(r.quality_score),
      similarity_score: null,
      price_saving:     null,
    }));

    return {
      mode:          "premium",
      added_product: { product_id: orig.product_id, id: extractNumericId(orig.product_id), product_code: orig.product_id, name: orig.name, price: Number(orig.price) },
      label:         "Customers Who Bought Similar Items Also Loved",
      message:       `People who bought "${orig.name}" also highly rated these — top picks based on customer reviews.`,
      suggestions,
    };
  }
}

module.exports = {
  getCartIntelligence,
  getSmartReplacements,
  getPremiumUpgrades,
  getSellingFastProducts,
  getPersonalizedSellingFast,
  getCartInsights,
  getPostAddSuggestions,
};
