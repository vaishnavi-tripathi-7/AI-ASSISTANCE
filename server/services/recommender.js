const pool = require("../db");

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Intent Catalog Search
// Pulls products mapped to detected intents via intents → intent_products.
// Priority follows intent confidence (higher-confidence intents listed first).
// ─────────────────────────────────────────────────────────────────────────────
async function searchByIntentCatalog(intentNames = [], limit = 20) {
  if (!intentNames.length) return [];

  const result = await pool.query(
    `SELECT DISTINCT ON (p.product_id)
            p.product_id, p.name, p.category, p.subcategory,
            p.brand, p.price, p.stock, p.urgency_score,
            ip.rank AS intent_rank
     FROM intents i
     JOIN intent_products ip ON i.intent_id  = ip.intent_id
     JOIN products p         ON ip.product_id = p.product_id
     WHERE i.intent_name = ANY($1::text[])
     ORDER BY p.product_id, ip.rank ASC
     LIMIT $2`,
    [intentNames, limit]
  );

  console.log(`[STEP 1 intent_catalog] intents=${JSON.stringify(intentNames)} → ${result.rows.length} rows`);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Time-of-Day Affinity Search
// Retrieves products from product_time_affinity matching the detected time.
// ─────────────────────────────────────────────────────────────────────────────
async function searchByTimeOfDay(timeOfDay, limit = 20) {
  if (!timeOfDay) return [];

  const result = await pool.query(
    `SELECT DISTINCT
            p.product_id, p.name, p.category, p.subcategory,
            p.brand, p.price, p.stock, p.urgency_score
     FROM products p
     JOIN product_time_affinity pta ON p.product_id = pta.product_id
     WHERE pta.time_of_day = $1
     LIMIT $2`,
    [timeOfDay, limit]
  );

  console.log(`[STEP 2 time_affinity] time_of_day=${timeOfDay} → ${result.rows.length} rows`);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Tag Search
// Matches search_tags from Gemini JSON against product_tags table.
// Also falls back to ILIKE on name / category / subcategory.
// ─────────────────────────────────────────────────────────────────────────────
async function searchByTags(tags = [], limit = 20) {
  if (!tags.length) return [];

  const likePatterns = tags.map((t) => `%${t.toLowerCase()}%`);

  const result = await pool.query(
    `SELECT DISTINCT
            p.product_id, p.name, p.category, p.subcategory,
            p.brand, p.price, p.stock, p.urgency_score
     FROM products p
     JOIN product_tags pt ON p.product_id = pt.product_id
     WHERE pt.tag            ILIKE ANY($1::text[])
        OR LOWER(p.name)        ILIKE ANY($1::text[])
        OR LOWER(p.category)    ILIKE ANY($1::text[])
        OR LOWER(p.subcategory) ILIKE ANY($1::text[])
     LIMIT $2`,
    [likePatterns, limit]
  );

  console.log(`[STEP 3 tag_search] tags=${JSON.stringify(tags)} → ${result.rows.length} rows`);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 + 5 — Build Candidate Pool, then Inventory Filter
// Unions results from STEP 1/2/3, deduplicates, applies budget filter,
// then removes products with no live inventory (inventory.quantity = 0).
// ─────────────────────────────────────────────────────────────────────────────
async function filterByInventory(candidateIds = []) {
  if (!candidateIds.length) return [];

  const result = await pool.query(
    `SELECT DISTINCT product_id
     FROM inventory
     WHERE product_id = ANY($1::text[])
       AND quantity   > 0`,
    [candidateIds]
  );

  const inStock = new Set(result.rows.map((r) => r.product_id));
  console.log(`[STEP 5 inventory_filter] ${candidateIds.length} candidates → ${inStock.size} in-stock`);
  return [...inStock];
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — Product Ranking (Score & Rank)
// For every candidate product computes recommendation_score using:
//   • user_rating   : rating the current user gave this product
//   • avg_rating    : community average rating
//   • total_views   : sum of views from demand_history
//   • total_revenue : sum of revenue from demand_history
//
// Score formula (per spec):
//   CASE WHEN user_rating > 3 THEN 10 ELSE 0 END
//   + COALESCE(user_rating,   0) * 10
//   + COALESCE(avg_rating,    0) * 5
//   + COALESCE(total_views,   0) * 0.1
//   + COALESCE(total_revenue, 0) * 0.001
// ─────────────────────────────────────────────────────────────────────────────
async function scoreAndRankProducts(productIds = [], userId, limit = 12) {
  if (!productIds.length) return [];

  const result = await pool.query(
    `WITH candidate_products AS (
       SELECT * FROM products WHERE product_id = ANY($1::text[])
     ),
     user_ratings AS (
       SELECT product_id, MAX(rating) AS user_rating
       FROM   reviews
       WHERE  user_id = $2
       GROUP  BY product_id
     ),
     community_ratings AS (
       SELECT product_id, AVG(rating) AS avg_rating
       FROM   reviews
       GROUP  BY product_id
     ),
     product_metrics AS (
       SELECT product_id,
              SUM(views)   AS total_views,
              SUM(revenue) AS total_revenue
       FROM   demand_history
       GROUP  BY product_id
     )
     SELECT
       cp.product_id,
       cp.name,
       cp.category,
       cp.subcategory,
       cp.brand,
       cp.price,
       cp.stock,
       cp.urgency_score,
       ur.user_rating,
       ROUND(cr.avg_rating::numeric, 2)    AS avg_rating,
       COALESCE(pm.total_views,   0)       AS total_views,
       COALESCE(pm.total_revenue, 0)       AS total_revenue,
       (
         CASE WHEN ur.user_rating > 3 THEN 10 ELSE 0 END
         + COALESCE(ur.user_rating,   0) * 10
         + COALESCE(cr.avg_rating,    0) * 5
         + COALESCE(pm.total_views,   0) * 0.1
         + COALESCE(pm.total_revenue, 0) * 0.001
       ) AS recommendation_score
     FROM candidate_products cp
     LEFT JOIN user_ratings      ur ON cp.product_id = ur.product_id
     LEFT JOIN community_ratings cr ON cp.product_id = cr.product_id
     LEFT JOIN product_metrics   pm ON cp.product_id = pm.product_id
     ORDER BY recommendation_score DESC
     LIMIT $3`,
    [productIds, userId || "U0001", limit]
  );

  console.log(`[STEP 6 scoring] ${productIds.length} candidates → ${result.rows.length} ranked rows`);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 + 8 + 9 — Warehouse Assignment, Capacity Check, Delivery Estimation
// For a single product, finds the nearest warehouse where:
//   • inventory.quantity > 0                     (product is stocked)
//   • (capacity - current_load) > 50             (headroom check — STEP 8)
// current_load is derived as SUM(inventory.quantity) since it is not stored.
//
// Distance via Haversine (in-DB).
// ETA formula (STEP 9):  eta_hours = distance_km / 10
//                        eta_minutes = distance_km * 6
// ─────────────────────────────────────────────────────────────────────────────
async function getNearestWarehouseForProduct(productId, userLat, userLon) {
  if (!productId || userLat == null || userLon == null) return null;

  const result = await pool.query(
    `WITH warehouse_load AS (
       SELECT warehouse_id, SUM(quantity) AS current_load
       FROM   inventory
       GROUP  BY warehouse_id
     ),
     warehouse_distances AS (
       SELECT
         w.warehouse_id,
         w.name,
         w.capacity,
         COALESCE(wl.current_load, 0)   AS current_load,
         i.quantity,
         (6371 * ACOS(
           LEAST(1.0,
             COS(RADIANS($2)) * COS(RADIANS(w.lat))
             * COS(RADIANS(w.lon) - RADIANS($3))
             + SIN(RADIANS($2)) * SIN(RADIANS(w.lat))
           )
         ))                             AS distance_km
       FROM warehouses w
       JOIN inventory i
         ON w.warehouse_id = i.warehouse_id
       LEFT JOIN warehouse_load wl
         ON w.warehouse_id = wl.warehouse_id
       WHERE i.product_id = $1
         AND i.quantity   > 0
     )
     SELECT
       warehouse_id,
       name,
       quantity                                        AS available_stock,
       ROUND(distance_km::numeric, 2)                 AS distance_km,
       ROUND((distance_km / 10.0)::numeric, 2)        AS eta_hours,
       ROUND((distance_km * 6)::numeric,  0)          AS eta_minutes,
       (capacity - current_load)                      AS available_capacity
     FROM warehouse_distances
     WHERE (capacity - current_load) > 50
     ORDER BY distance_km ASC
     LIMIT 1`,
    [productId, userLat, userLon]
  );

  if (!result.rows.length) {
    console.log(`[STEP 7 warehouse] no eligible warehouse for product=${productId}`);
    return null;
  }

  const row = result.rows[0];
  console.log(`[STEP 7 warehouse] product=${productId} → ${row.name} (${row.distance_km} km, ~${row.eta_minutes} min)`);
  return {
    warehouse_id:                row.warehouse_id,
    warehouse_name:              row.name,
    available_stock:             Number(row.available_stock),
    distance_km:                 Number(row.distance_km),
    eta_hours:                   Number(row.eta_hours),
    estimated_delivery_minutes:  Number(row.eta_minutes),
    available_capacity:          Number(row.available_capacity),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONAL CROSS-SELL — Frequently Bought Together (STEP 4 affinity)
// Only called when cart_total > 0 OR checkout_requested = true.
// Returns related products NOT already in the cart, ordered by affinity rank.
// ─────────────────────────────────────────────────────────────────────────────
async function getAffinityProducts(cartProductIds = [], limit = 8) {
  if (!cartProductIds.length) return [];

  const result = await pool.query(
    `SELECT DISTINCT
            p.product_id, p.name, p.category, p.subcategory,
            p.brand, p.price, p.stock, p.urgency_score,
            pa.rank AS affinity_rank
     FROM product_affinity pa
     JOIN products p ON pa.related_product_id = p.product_id
     WHERE pa.product_id = ANY($1::text[])
       AND p.product_id  <> ALL($1::text[])
     ORDER BY pa.rank ASC
     LIMIT $2`,
    [cartProductIds, limit]
  );

  console.log(`[cross_sell affinity] cart_ids=${JSON.stringify(cartProductIds)} → ${result.rows.length} rows`);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE ORCHESTRATOR
// Executes STEP 1 → 2 → 3 in parallel (candidate gathering),
// then STEP 4 (union + dedup), STEP 5 (inventory filter),
// STEP 6 (score & rank).
// Warehouse assignment (STEP 7–9) is handled per-product in chat.js
// because it needs userLat/userLon from the request.
// ─────────────────────────────────────────────────────────────────────────────
async function getMainRecommendations({
  intentNames = [],
  timeOfDay   = null,
  searchTags  = [],
  userId      = "U0001",
  budget      = null,
  limit       = 12,
} = {}) {
  // STEP 1 + 2 + 3 — gather candidates in parallel
  const [intentRows, timeRows, tagRows] = await Promise.all([
    searchByIntentCatalog(intentNames, 20),
    searchByTimeOfDay(timeOfDay, 20),
    searchByTags(searchTags, 20),
  ]);

  // STEP 4 — union + deduplicate by product_id
  const seen = new Map();
  for (const row of [...intentRows, ...timeRows, ...tagRows]) {
    if (!seen.has(row.product_id)) seen.set(row.product_id, row);
  }

  let candidates = [...seen.values()];
  console.log(`[STEP 4 candidate_pool] ${candidates.length} unique products`);

  // Budget filter (pre-inventory — cheap JS filter)
  if (budget) {
    candidates = candidates.filter((p) => Number(p.price) <= budget + 50);
    console.log(`[budget_filter] ≤ ₹${budget + 50} → ${candidates.length} products`);
  }

  if (!candidates.length) return [];

  // STEP 5 — inventory filter (only keep products with live stock)
  const inStockIds = await filterByInventory(candidates.map((p) => p.product_id));
  if (!inStockIds.length) return [];

  // STEP 6 — score & rank the in-stock candidates
  const scored = await scoreAndRankProducts(inStockIds, userId, limit);
  console.log(`[STEP 6 final] ${scored.length} ranked products returned`);
  return scored;
}

// ─────────────────────────────────────────────────────────────────────────────
// POPULAR PRODUCTS — global fallback when no intent context is available
// ─────────────────────────────────────────────────────────────────────────────
async function getPopularProducts(limit = 12) {
  const result = await pool.query(
    `SELECT p.product_id, p.name, p.price, p.category, p.subcategory,
            p.brand, p.stock, p.urgency_score,
            COUNT(oi.product_id) AS order_count
     FROM products p
     LEFT JOIN order_items oi ON p.product_id = oi.product_id
     GROUP BY p.product_id
     ORDER BY order_count DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD SEARCH — legacy fallback for direct product search queries
// ─────────────────────────────────────────────────────────────────────────────
async function searchProducts(keyword, limit = 5) {
  const result = await pool.query(
    `SELECT DISTINCT p.product_id, p.name, p.price, p.category,
            p.subcategory, p.brand, p.stock, p.urgency_score
     FROM products p
     LEFT JOIN product_tags pt ON p.product_id = pt.product_id
     WHERE p.name        ILIKE $1
        OR p.category    ILIKE $1
        OR p.subcategory ILIKE $1
        OR p.brand       ILIKE $1
        OR pt.tag        ILIKE $1
     ORDER BY p.stock DESC
     LIMIT $2`,
    [`%${keyword}%`, limit]
  );
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAREHOUSE ETA — simple nearest-warehouse lookup (no product filter)
// Used as a general ETA estimate when per-product warehouse isn't needed.
// ─────────────────────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getNearestWarehouseEta(userLat, userLon) {
  const result = await pool.query("SELECT warehouse_id, name, lat, lon FROM warehouses");
  if (!result.rows.length) return null;

  let nearest = null, minDist = Infinity;
  result.rows.forEach((w) => {
    const dist = haversineKm(userLat, userLon, w.lat, w.lon);
    if (dist < minDist) { minDist = dist; nearest = w; }
  });

  return {
    warehouse_name: nearest.name,
    distance_km:    Math.round(minDist * 10) / 10,
    eta_minutes:    Math.round(minDist * 6),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NUDGE LOGIC
// ─────────────────────────────────────────────────────────────────────────────
const BUNDLE_INTENTS = new Set([
  "movie_night", "late_night_cravings", "office_snacks", "party", "exam_preparation",
  "kids_snacks", "road_trip", "camping", "festival_shopping", "gifting",
  "back_to_school", "work_from_home", "frozen_snacks_party", "monsoon_binge",
  "weekend_special",
]);
const COMPARE_INTENTS = new Set([
  "weekly_grocery", "family_dinner", "cooking_essentials", "eco_friendly_shopping",
  "diabetic_care", "vegan_lifestyle", "protein_rich_diet", "sports_nutrition",
]);

function determineNudgeType(product, cartSize, topIntent) {
  if (product.stock <= 20 || product.urgency_score >= 8) return "substitute";
  if (topIntent && BUNDLE_INTENTS.has(topIntent))        return "bundle";
  if (topIntent && COMPARE_INTENTS.has(topIntent))       return "compare";
  if (cartSize <= 2)                                     return "bundle";
  return "social_proof";
}

function buildNudge(product, cartSize, topIntent = null) {
  return {
    nudge_type:    determineNudgeType(product, cartSize, topIntent),
    product_id:    product.product_id,
    id:            extractNumericId(product.product_id),
    product_code:  product.product_id,
    product_name:  product.name,
    product_price: Number(product.price),
    category:      product.category,
    stock:         product.stock,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE BUILDERS
// buildRecommendations  — main rec list (warehouse fields merged in chat.js)
// buildAffinityItems    — cross-sell sidebar items
// ─────────────────────────────────────────────────────────────────────────────

// Builds a flat recommendation object matching STEP 10 response format.
// warehouse data (warehouse_id, warehouse_name, distance_km,
// estimated_delivery_minutes, available_stock) is merged in by chat.js
// after the per-product Q7 lookup.
function buildRecommendations(products, cartSize, topIntent = null) {
  return products.map((p) => ({
    product_id:           p.product_id,
    id:                   extractNumericId(p.product_id),
    product_code:         p.product_id,
    name:                 p.name,
    category:             p.category,
    price:                Number(p.price),
    recommendation_score: p.recommendation_score ? Number(p.recommendation_score) : null,
    user_rating:          p.user_rating  ? Number(p.user_rating)  : null,
    avg_rating:           p.avg_rating   ? Number(p.avg_rating)   : null,
    views:                p.total_views  ? Number(p.total_views)  : 0,
    revenue:              p.total_revenue ? Number(p.total_revenue) : 0,
    // warehouse fields — filled by chat.js after Q7
    warehouse_id:                null,
    warehouse_name:              null,
    distance_km:                 null,
    estimated_delivery_minutes:  null,
    available_stock:             null,
    // internal nudge
    nudge_type:           determineNudgeType(p, cartSize, topIntent),
  }));
}

// Extracts numeric portion from product_code (e.g., "P0083" → 83)
function extractNumericId(productCode) {
  if (!productCode) return null;
  const match = String(productCode).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function buildAffinityItems(products) {
  return products.map((p) => ({
    product_id:    p.product_id,
    id:            extractNumericId(p.product_id),
    product_code:  p.product_id,
    product_name:  p.name,
    product_price: Number(p.price),
    category:      p.category,
    brand:         p.brand,
    stock:         p.stock,
    affinity_rank: p.affinity_rank,
    label:         "Frequently Bought Together",
  }));
}

module.exports = {
  // main pipeline
  getMainRecommendations,
  getAffinityProducts,
  getNearestWarehouseForProduct,
  // individual steps (for debugging / direct use)
  searchByIntentCatalog,
  searchByTimeOfDay,
  searchByTags,
  filterByInventory,
  scoreAndRankProducts,
  // utilities
  getPopularProducts,
  searchProducts,
  getNearestWarehouseEta,
  buildNudge,
  buildRecommendations,
  buildAffinityItems,
};
