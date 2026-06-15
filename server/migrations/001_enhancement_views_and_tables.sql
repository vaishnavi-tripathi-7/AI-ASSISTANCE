-- ============================================================
-- QuickCart AI — Recommendation Enhancement Migration
-- Migration: 001_enhancement_views_and_tables.sql
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE)
-- Does NOT drop any existing tables or data
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- SECTION 1: New tables (only if they don't exist)
-- ────────────────────────────────────────────────────────────

-- 1a. recommendation_feedback — tracks thumbs up/down on recommendations
CREATE TABLE IF NOT EXISTS recommendation_feedback (
    feedback_id     BIGSERIAL PRIMARY KEY,
    user_id         VARCHAR NOT NULL REFERENCES users(user_id),
    product_id      VARCHAR NOT NULL REFERENCES products(product_id),
    session_intent  VARCHAR,
    action          VARCHAR NOT NULL CHECK (action IN ('accepted','rejected','ignored')),
    feedback_time   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_user    ON recommendation_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_product ON recommendation_feedback(product_id);

-- 1b. smart_bundles — curated product bundles
CREATE TABLE IF NOT EXISTS smart_bundles (
    bundle_id       VARCHAR PRIMARY KEY,
    bundle_name     VARCHAR NOT NULL,
    intent_tags     TEXT[],
    total_price     NUMERIC(10,2),
    discount_pct    NUMERIC(5,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 1c. bundle_items — products in each bundle
CREATE TABLE IF NOT EXISTS bundle_items (
    bundle_id   VARCHAR NOT NULL REFERENCES smart_bundles(bundle_id),
    product_id  VARCHAR NOT NULL REFERENCES products(product_id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (bundle_id, product_id)
);

-- 1d. category_affinity_scores — pre-computed user × category affinity
CREATE TABLE IF NOT EXISTS category_affinity_scores (
    user_id         VARCHAR NOT NULL REFERENCES users(user_id),
    category        VARCHAR NOT NULL,
    affinity_score  NUMERIC(8,4) DEFAULT 0,
    last_updated    TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, category)
);
CREATE INDEX IF NOT EXISTS idx_cat_affinity_user ON category_affinity_scores(user_id);

-- ────────────────────────────────────────────────────────────
-- SECTION 2: Populate product_affinity from co-purchase data
-- (table exists but has 0 rows — build from order_items)
-- ────────────────────────────────────────────────────────────

-- Clear and repopulate product_affinity from co-purchase signals
-- Uses orders placed within the same session as affinity signal
INSERT INTO product_affinity (product_id, related_product_id, rank)
SELECT
    a.product_id,
    b.product_id              AS related_product_id,
    ROW_NUMBER() OVER (
        PARTITION BY a.product_id
        ORDER BY COUNT(*) DESC
    )                         AS rank
FROM order_items a
JOIN order_items b
    ON a.order_id = b.order_id
    AND a.product_id <> b.product_id
GROUP BY a.product_id, b.product_id
HAVING COUNT(*) >= 1
ON CONFLICT (product_id, related_product_id) DO UPDATE
    SET rank = EXCLUDED.rank;

-- ────────────────────────────────────────────────────────────
-- SECTION 3: Populate category_affinity_scores from interactions + orders
-- ────────────────────────────────────────────────────────────

INSERT INTO category_affinity_scores (user_id, category, affinity_score, last_updated)
SELECT
    source.user_id,
    source.category,
    SUM(source.score) AS affinity_score,
    NOW()
FROM (
    -- Signal 1: purchases (weight 5)
    SELECT o.user_id, p.category, 5.0 AS score
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p     ON oi.product_id = p.product_id

    UNION ALL

    -- Signal 2: add_to_cart interactions (weight 2)
    SELECT i.user_id, p.category, 2.0 AS score
    FROM interactions i
    JOIN products p ON i.product_id = p.product_id
    WHERE i.action = 'add_to_cart'

    UNION ALL

    -- Signal 3: view interactions (weight 0.5)
    SELECT i.user_id, p.category, 0.5 AS score
    FROM interactions i
    JOIN products p ON i.product_id = p.product_id
    WHERE i.action = 'view'

    UNION ALL

    -- Signal 4: wishlist (weight 1.5)
    SELECT i.user_id, p.category, 1.5 AS score
    FROM interactions i
    JOIN products p ON i.product_id = p.product_id
    WHERE i.action = 'wishlist'

    UNION ALL

    -- Signal 5: user_favorite_categories (weight 10 — explicit preference)
    SELECT ufc.user_id, ufc.category, 10.0 AS score
    FROM user_favorite_categories ufc
) source
GROUP BY source.user_id, source.category
ON CONFLICT (user_id, category) DO UPDATE
    SET affinity_score = EXCLUDED.affinity_score,
        last_updated   = NOW();

-- ────────────────────────────────────────────────────────────
-- SECTION 4: SQL VIEWS (create only if they don't exist via
--            CREATE OR REPLACE — safe, never drops data)
-- ────────────────────────────────────────────────────────────

-- 4a. user_persona_view — extends user_profile matview with computed segments
CREATE OR REPLACE VIEW user_persona_view AS
SELECT
    up.user_id,
    up.name,
    up.age,
    up.city,
    up.persona,
    up.primary_intent,
    up.avg_order_value,
    up.loyalty_tier,
    up.total_orders,
    up.preferences,
    up.favorite_categories,
    up.recent_intents,
    -- budget segment derived from avg_order_value
    CASE
        WHEN up.avg_order_value < 300  THEN 'budget'
        WHEN up.avg_order_value < 700  THEN 'mid_range'
        WHEN up.avg_order_value < 1200 THEN 'premium'
        ELSE 'luxury'
    END AS budget_segment,
    -- shopping frequency from order count
    CASE
        WHEN up.total_orders >= 50 THEN 'frequent'
        WHEN up.total_orders >= 20 THEN 'regular'
        WHEN up.total_orders >= 5  THEN 'occasional'
        ELSE 'new'
    END AS shopping_frequency
FROM user_profile up;

-- 4b. product_similarity_view — products grouped by subcategory for similarity scoring
CREATE OR REPLACE VIEW product_similarity_view AS
SELECT
    a.product_id,
    b.product_id             AS similar_product_id,
    a.category,
    a.subcategory,
    -- similarity = 1.0 if same subcategory, 0.8 if same category only
    CASE WHEN a.subcategory = b.subcategory THEN 1.0 ELSE 0.8 END AS similarity_score,
    ABS(a.price - b.price)   AS price_diff,
    b.price                  AS similar_price
FROM products a
JOIN products b
    ON a.category = b.category
    AND a.product_id <> b.product_id;

-- 4c. demand_score_view — rolling 30-day demand signals per product
CREATE OR REPLACE VIEW demand_score_view AS
WITH order_stats AS (
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
    ) repeated
    GROUP BY product_id
),
view_stats AS (
    SELECT product_id, COUNT(*) AS view_count
    FROM interactions
    WHERE action = 'view'
      AND interaction_time >= NOW() - INTERVAL '30 days'
    GROUP BY product_id
)
SELECT
    p.product_id,
    p.name,
    p.category,
    p.price,
    COALESCE(os.orders_last_30d,           0) AS orders_last_30d,
    COALESCE(os.unique_customers_last_30d,  0) AS unique_customers_last_30d,
    COALESCE(rs.repeat_purchase_count,      0) AS repeat_purchase_count,
    COALESCE(vs.view_count,                 0) AS view_count_30d,
    ROUND((
        COALESCE(os.orders_last_30d,          0) * 0.5
        + COALESCE(os.unique_customers_last_30d, 0) * 0.3
        + COALESCE(rs.repeat_purchase_count,     0) * 0.2
    )::NUMERIC, 4) AS demand_score
FROM products p
LEFT JOIN order_stats  os ON p.product_id = os.product_id
LEFT JOIN repeat_stats rs ON p.product_id = rs.product_id
LEFT JOIN view_stats   vs ON p.product_id = vs.product_id;

-- 4d. feedback_score_view — interaction-based feedback signals per product
CREATE OR REPLACE VIEW feedback_score_view AS
SELECT
    p.product_id,
    p.name,
    p.category,
    COALESCE(add_cart.cnt,   0) AS add_to_cart_count,
    COALESCE(wishlist.cnt,   0) AS wishlist_count,
    COALESCE(views.cnt,      0) AS view_count,
    COALESCE(removed.cnt,    0) AS remove_from_cart_count,
    COALESCE(purchased.cnt,  0) AS purchase_count,
    COALESCE(rec_acc.cnt,    0) AS rec_accepted_count,
    COALESCE(rec_rej.cnt,    0) AS rec_rejected_count,
    -- Feedback score: positive signals minus penalty for removes/rejections
    ROUND((
        COALESCE(purchased.cnt,  0) * 5.0
        + COALESCE(add_cart.cnt, 0) * 2.0
        + COALESCE(wishlist.cnt, 0) * 1.5
        + COALESCE(rec_acc.cnt,  0) * 3.0
        + COALESCE(views.cnt,    0) * 0.3
        - COALESCE(removed.cnt,  0) * 1.5
        - COALESCE(rec_rej.cnt,  0) * 2.0
    )::NUMERIC, 4) AS feedback_score
FROM products p
LEFT JOIN (SELECT product_id, COUNT(*) AS cnt FROM interactions WHERE action = 'add_to_cart'      GROUP BY product_id) add_cart  ON p.product_id = add_cart.product_id
LEFT JOIN (SELECT product_id, COUNT(*) AS cnt FROM interactions WHERE action = 'wishlist'          GROUP BY product_id) wishlist  ON p.product_id = wishlist.product_id
LEFT JOIN (SELECT product_id, COUNT(*) AS cnt FROM interactions WHERE action = 'view'             GROUP BY product_id) views     ON p.product_id = views.product_id
LEFT JOIN (SELECT product_id, COUNT(*) AS cnt FROM interactions WHERE action = 'remove_from_cart' GROUP BY product_id) removed   ON p.product_id = removed.product_id
LEFT JOIN (SELECT product_id, COUNT(*) AS cnt FROM interactions WHERE action = 'purchase'         GROUP BY product_id) purchased ON p.product_id = purchased.product_id
LEFT JOIN (SELECT product_id, COUNT(*) AS cnt FROM recommendation_feedback WHERE action = 'accepted' GROUP BY product_id) rec_acc ON p.product_id = rec_acc.product_id
LEFT JOIN (SELECT product_id, COUNT(*) AS cnt FROM recommendation_feedback WHERE action = 'rejected' GROUP BY product_id) rec_rej ON p.product_id = rec_rej.product_id;

-- 4e. category_affinity_view — per-user per-category affinity score
CREATE OR REPLACE VIEW category_affinity_view AS
SELECT
    cas.user_id,
    cas.category,
    cas.affinity_score,
    -- normalised rank within user's own categories
    RANK() OVER (PARTITION BY cas.user_id ORDER BY cas.affinity_score DESC) AS affinity_rank
FROM category_affinity_scores cas;

-- 4f. frequently_bought_together_view — enriched version of product_affinity
CREATE OR REPLACE VIEW frequently_bought_together_view AS
SELECT
    pa.product_id,
    pa.related_product_id,
    pa.rank                          AS affinity_rank,
    p.name                           AS product_name,
    p.category                       AS product_category,
    rp.name                          AS related_name,
    rp.category                      AS related_category,
    rp.price                         AS related_price,
    rp.stock                         AS related_stock,
    -- co-purchase count derived from order_items
    co_count.co_purchase_count
FROM product_affinity pa
JOIN products p  ON pa.product_id         = p.product_id
JOIN products rp ON pa.related_product_id = rp.product_id
LEFT JOIN (
    SELECT a.product_id, b.product_id AS related_product_id, COUNT(*) AS co_purchase_count
    FROM order_items a
    JOIN order_items b ON a.order_id = b.order_id AND a.product_id <> b.product_id
    GROUP BY a.product_id, b.product_id
) co_count
ON pa.product_id = co_count.product_id
AND pa.related_product_id = co_count.related_product_id
WHERE rp.stock > 0;

-- 4g. trending_products_view — products gaining momentum in the last 7 days vs prior 7 days
CREATE OR REPLACE VIEW trending_products_view AS
WITH recent AS (
    SELECT oi.product_id, COUNT(*) AS recent_orders
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.order_id
    WHERE o.order_time >= NOW() - INTERVAL '7 days'
    GROUP BY oi.product_id
),
prior AS (
    SELECT oi.product_id, COUNT(*) AS prior_orders
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.order_id
    WHERE o.order_time >= NOW() - INTERVAL '14 days'
      AND o.order_time  < NOW() - INTERVAL '7 days'
    GROUP BY oi.product_id
),
view_trend AS (
    SELECT product_id, COUNT(*) AS recent_views
    FROM interactions
    WHERE action = 'view'
      AND interaction_time >= NOW() - INTERVAL '7 days'
    GROUP BY product_id
)
SELECT
    p.product_id,
    p.name,
    p.category,
    p.subcategory,
    p.price,
    p.stock,
    COALESCE(r.recent_orders,  0) AS recent_orders,
    COALESCE(pr.prior_orders,  0) AS prior_orders,
    COALESCE(vt.recent_views,  0) AS recent_views,
    -- trend_score: growth ratio weighted with absolute volume
    ROUND((
        COALESCE(r.recent_orders, 0) * 1.0
        / GREATEST(COALESCE(pr.prior_orders, 0) + 1, 1)
        * GREATEST(COALESCE(r.recent_orders, 0), 1)
        + COALESCE(vt.recent_views, 0) * 0.1
    )::NUMERIC, 4) AS trend_score,
    -- label for UI
    CASE
        WHEN COALESCE(r.recent_orders, 0) > COALESCE(pr.prior_orders, 0) * 2 THEN '🚀 Trending Fast'
        WHEN COALESCE(r.recent_orders, 0) > COALESCE(pr.prior_orders, 0)     THEN '📈 Rising'
        ELSE '📊 Steady'
    END AS trend_label
FROM products p
LEFT JOIN recent    r  ON p.product_id = r.product_id
LEFT JOIN prior     pr ON p.product_id = pr.product_id
LEFT JOIN view_trend vt ON p.product_id = vt.product_id
WHERE p.stock > 0
ORDER BY trend_score DESC;

-- 4h. bundle_analysis_view — enriched bundle view with item details
CREATE OR REPLACE VIEW bundle_analysis_view AS
SELECT
    sb.bundle_id,
    sb.bundle_name,
    sb.intent_tags,
    sb.total_price,
    sb.discount_pct,
    COUNT(bi.product_id)                           AS item_count,
    STRING_AGG(p.name, ', ')                       AS product_names,
    STRING_AGG(p.category, ', ')                   AS categories,
    ROUND(SUM(p.price * bi.quantity)::NUMERIC, 2)  AS computed_price
FROM smart_bundles sb
JOIN bundle_items bi ON sb.bundle_id = bi.bundle_id
JOIN products p      ON bi.product_id = p.product_id
GROUP BY sb.bundle_id, sb.bundle_name, sb.intent_tags, sb.total_price, sb.discount_pct;

-- ────────────────────────────────────────────────────────────
-- SECTION 5: Performance indexes for new queries
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_interactions_user_action   ON interactions(user_id, action);
CREATE INDEX IF NOT EXISTS idx_interactions_product_action ON interactions(product_id, action);
CREATE INDEX IF NOT EXISTS idx_interactions_time          ON interactions(interaction_time);
CREATE INDEX IF NOT EXISTS idx_orders_time                ON orders(order_time);
CREATE INDEX IF NOT EXISTS idx_orders_user               ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product       ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product           ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user              ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_product_affinity_product  ON product_affinity(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category         ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_subcategory      ON products(subcategory);
