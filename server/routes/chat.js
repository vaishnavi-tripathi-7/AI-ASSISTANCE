const express = require("express");
const router  = express.Router();
const { extractIntent, generateCheckoutReply } = require("../services/gemini");
const {
  getMainRecommendations,
  getAffinityProducts,
  getNearestWarehouseForProduct,
  getPopularProducts,
  getNearestWarehouseEta,
  buildNudge,
  buildRecommendations,
  buildAffinityItems,
  scoreAndRankProducts,
} = require("../services/recommender");
const {
  suggestBudgetOptimizations,
  createOrderFromCart,
  buildCartContext,
} = require("../services/cartService");

// ─── IST TIME-OF-DAY HELPER ───────────────────────────────────────────────────
// Reads the current India Standard Time (UTC+5:30) from the Node.js runtime
// and buckets the hour into: morning | afternoon | evening | night
// Used as a fallback when Gemini does not extract an explicit time_of_day.
//
//  05:00 – 11:59  →  morning
//  12:00 – 16:59  →  afternoon
//  17:00 – 20:59  →  evening
//  21:00 – 04:59  →  night

function getISTTimeOfDay() {
  const istHour = Number(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour:     "numeric",
      hour12:   false,
    }).format(new Date())
  );

  if (istHour >= 5  && istHour < 12) return "morning";
  if (istHour >= 12 && istHour < 17) return "afternoon";
  if (istHour >= 17 && istHour < 21) return "evening";
  return "night";
}

// ─── LOCAL FALLBACK (when Gemini is down) ────────────────────────────────────

function localFallbackIntents(message) {
  const msg = message.toLowerCase();
  const rules = [
    // Personal care — must come BEFORE generic food rules to avoid misclassification
    { keys: ["skin","pimple","acne","fairness","glow","serum","moisturizer","sunscreen","face wash","facewash","toner","cleanser","face"],
                                                        intent: "skin_care_routine" },
    { keys: ["hair","shampoo","conditioner","hairfall","dandruff","scalp","hair oil"],
                                                        intent: "hair_care" },
    { keys: ["beard","shave","razor","men grooming","grooming"],
                                                        intent: "men_grooming" },
    // Health & wellness
    { keys: ["diabetic","diabetes","sugar free","low sugar"],
                                                        intent: "diabetic_care" },
    { keys: ["vegan","plant based","plant-based"],       intent: "vegan_lifestyle" },
    { keys: ["protein","whey","creatine","supplement","bcaa"],
                                                        intent: "sports_nutrition" },
    { keys: ["immunity","vitamin","zinc","probiotic"],   intent: "immunity_boost" },
    // Food & meal
    { keys: ["breakfast","oats","cereal","idli","dosa","poha","upma"],
                                                        intent: "breakfast" },
    { keys: ["biryani"],                                 intent: "biryani_night" },
    { keys: ["pizza"],                                   intent: "pizza_night" },
    { keys: ["dinner","sabzi","dal","roti","curry"],      intent: "family_dinner" },
    { keys: ["lunch","lunchbox","tiffin"],                intent: "lunchbox_prep" },
    { keys: ["late night","midnight","2am","3am"],        intent: "midnight_hunger" },
    { keys: ["movie","film","netflix","binge"],           intent: "movie_night" },
    { keys: ["snack","chips","biscuit","chai","namkeen"], intent: "office_snacks" },
    // Fitness
    { keys: ["gym","workout","fitness","post workout"],   intent: "gym" },
    // Occasions
    { keys: ["party","celebration","drinks"],             intent: "party" },
    { keys: ["gift","birthday","present"],                intent: "gifting" },
    { keys: ["camping","trek","hiking"],                  intent: "camping" },
    { keys: ["road trip","road_trip","travel snack"],     intent: "road_trip" },
    { keys: ["festival","diwali","holi","eid","puja"],    intent: "festival_shopping" },
    { keys: ["sweet","mithai","ladoo","barfi","halwa"],   intent: "festive_sweets" },
    // Household
    { keys: ["clean","mop","detergent","disinfect","toilet","bathroom"],
                                                        intent: "house_cleaning" },
    { keys: ["eco","green","organic","sustainable"],      intent: "eco_friendly_shopping" },
    { keys: ["school","stationery","notebook","pencil"],  intent: "back_to_school" },
    { keys: ["baby","diaper","infant","formula"],         intent: "baby_care" },
    { keys: ["pet","dog","cat","kibble","pet food"],      intent: "pet_care" },
    { keys: ["grocery","groceries","weekly","monthly"],   intent: "weekly_grocery" },
    { keys: ["study","exam","homework"],                  intent: "exam_preparation" },
    { keys: ["work from home","wfh","office"],            intent: "work_from_home" },
    { keys: ["monsoon","rain","rainy"],                   intent: "monsoon_essentials" },
    { keys: ["summer","heat","hydrat","cold drink","juice"],
                                                        intent: "summer_hydration" },
    { keys: ["winter","warm","hot drink"],                intent: "winter_comfort" },
  ];

  for (const rule of rules) {
    if (rule.keys.some((k) => msg.includes(k))) {
      // If confidence is effectively certain (single dominant intent), return only 1
      return [ { intent: rule.intent, confidence: 0.92 } ];
    }
  }

  // Generic fallback — two low-confidence guesses
  return [
    { intent: "quick_meal",   confidence: 0.50 },
    { intent: "office_snacks",confidence: 0.30 },
  ];
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  try {
    const {
      message,
      history  = [],
      cart     = [],
      budget   = null,
      userLat  = null,
      userLon  = null,
      urgency  = null,
      userId   = null,
    } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({ error: "message is required" });
    }

    const trimmed     = message.trim();
    const cartContext = buildCartContext(cart, budget);
    const cartTotal   = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const remaining   = budget ? budget - cartTotal : null;

    // ── STEP 1: Extract intent via new Gemini prompt ──────────────────
    let intentResult;
    let candidateIntents = [];
    let detectedBudget   = null;
    let people_count     = null;
    let duration_days    = null;
    let urgency_level    = null;
    let search_tags      = [];
    let constraints      = [];
    let reply            = "";
    let checkout_requested = false;

    try {
      intentResult = await extractIntent(trimmed, history, cartContext);
    } catch (aiErr) {
      console.error("Gemini extractIntent error:", aiErr.message);
      intentResult = {
        type: "SHOPPING_REQUEST",
        data: {
          candidate_intents: localFallbackIntents(trimmed),
          budget: null, people_count: null, duration_days: null,
          urgency_level: null, search_tags: [], constraints: [],
          explicit_categories: [],
        },
      };
    }

    // ── STEP 2: Handle GREETING / NON_SHOPPING ────────────────────────
    if (intentResult.type === "GREETING" || intentResult.type === "NON_SHOPPING_REQUEST") {
      return res.json({
        reply:            intentResult.reply,
        top_intents:      [],
        budget:           null,
        people_count:     null,
        recommendations:  [],
        nudge:            null,
        urgency_required: false,
        eta:              null,
        cart_total:       cartTotal,
        remaining_budget: remaining,
        checkout_pending: false,
        budget_suggestions: [],
        intent_data:      null,
      });
    }

    // ── STEP 3: SHOPPING_REQUEST — unpack structured JSON ─────────────
    const intentData = intentResult.data;
    candidateIntents = intentData.candidate_intents || [];
    detectedBudget   = intentData.budget   || null;
    people_count     = intentData.people_count || null;
    duration_days    = intentData.duration_days || null;
    urgency_level    = intentData.urgency_level || null;
    search_tags      = intentData.search_tags   || [];
    constraints      = intentData.constraints   || [];

    const effectiveBudget = budget || detectedBudget || null;
    const topNewIntent    = candidateIntents[0]?.intent || null;

    // Detect checkout intent from message keywords
    const checkoutKeywords = ["checkout","place order","confirm order","order now","finalize","buy now"];
    checkout_requested = checkoutKeywords.some((kw) => trimmed.toLowerCase().includes(kw));

    // Build a cart-aware reply from the extracted data
    const budgetLine   = effectiveBudget ? ` Your budget is ₹${effectiveBudget}.` : "";
    const remainLine   = (effectiveBudget && remaining !== null)
      ? (remaining >= 0 ? ` You have ₹${remaining} remaining.` : ` You're ₹${Math.abs(remaining)} over budget.`)
      : "";
    const cartLine     = cart.length > 0
      ? ` Your cart has ${cart.reduce((s,i)=>s+i.qty,0)} items totalling ₹${cartTotal}.`
      : "";
    const durationLine = duration_days ? ` Planning for ${duration_days} day${duration_days > 1 ? "s" : ""}.` : "";
    const peopleTag    = people_count   ? ` For ${people_count} people.` : "";

    reply = `On it! Here are the best picks for your request.${cartLine}${budgetLine}${remainLine}${durationLine}${peopleTag}`;

    // ── STEP 4: Checkout flow ─────────────────────────────────────────
    if (checkout_requested && cart.length > 0) {
      try {
        const checkoutReply = await generateCheckoutReply(cart, effectiveBudget);
        return res.json({
          reply:            checkoutReply,
          top_intents:      candidateIntents,
          budget:           effectiveBudget,
          people_count,
          recommendations:  [],
          nudge:            null,
          urgency_required: false,
          eta:              null,
          cart_total:       cartTotal,
          remaining_budget: remaining,
          checkout_pending: true,
          budget_suggestions: [],
          intent_data:      intentData,
        });
      } catch (e) {
        console.error("Checkout reply error:", e.message);
      }
    }

    // ── STEP 5: Budget over-run suggestions ───────────────────────────
    let budget_suggestions = [];
    if (effectiveBudget && cartTotal > effectiveBudget && cart.length > 0) {
      try {
        budget_suggestions = await suggestBudgetOptimizations(cart, cartTotal - effectiveBudget);
      } catch (e) { console.error("Budget opt error:", e.message); }
    }

    // ── STEP 6: Recommendations via pipeline (Q1→Q2→Q3→Q4→Q5→Q6) ────

    // ── FINAL ENRICHED JSON (logged before SQL search) ────────────────
    console.log("\n══ FINAL ENRICHED JSON (pre-SQL) ══════════════════════");
    console.log(JSON.stringify({
      user_id:           intentData.user_id,
      candidate_intents: candidateIntents,
      budget:            effectiveBudget,
      people_count,
      duration_days,
      urgency_level,
      time_of_day:       intentData.time_of_day      || getISTTimeOfDay(),
      explicit_categories: intentData.explicit_categories || [],
      dietary_preferences: intentData.dietary_preferences || [],
      search_tags,
      constraints,
      // runtime context
      cart_total:        cartTotal,
      remaining_budget:  remaining,
      checkout_requested,
    }, null, 2));
    console.log("═══════════════════════════════════════════════════════\n");

    // ── STEP 6: Recommendations via new 6-query pipeline ─────────────
    const timeOfDay      = intentData.time_of_day || getISTTimeOfDay();
    const intentNames    = candidateIntents.map((ci) => ci.intent);
    const topIntent      = intentNames[0] || null;
    const cartProductIds = cart.map((i) => i.product_id || i.id).filter(Boolean);

    let products = [];
    let affinityProducts = [];

    try {
      // Q1 + Q2 + Q3 → union → Q5 scored ranking (Q6 orchestrator)
      products = await getMainRecommendations({
        intentNames,
        timeOfDay,
        searchTags:  search_tags,
        userId:      intentData.user_id || "U0001",
        budget:      effectiveBudget,
        limit:       12,
      });

      // Q4 — Frequently Bought Together handled below after recommendations are built

      if (products.length === 0) {
        // Fallback: score popular products through the same ranking pipeline
        const popularRows = await getPopularProducts(20);
        const popularIds  = popularRows.map((p) => p.product_id);
        if (popularIds.length > 0) {
          products = await scoreAndRankProducts(popularIds, intentData.user_id || "U0001", 12);
        }
      }
    } catch (dbErr) {
      console.error("Recommender error:", dbErr.message);
    }

    const recommendations = buildRecommendations(products, cart.length, topIntent);

    // ── STEP 7–9: Per-product warehouse assignment + ETA (Q7) ─────────
    // Runs in parallel for all recommended products when user location known.
    // Results merged flat onto each recommendation (spec STEP 10 shape).
    if (userLat !== null && userLon !== null && products.length > 0) {
      try {
        const warehouseResults = await Promise.all(
          recommendations.map((r) => getNearestWarehouseForProduct(r.product_id, userLat, userLon))
        );
        recommendations.forEach((r, idx) => {
          const wh = warehouseResults[idx];
          if (wh) {
            r.warehouse_id               = wh.warehouse_id;
            r.warehouse_name             = wh.warehouse_name;
            r.distance_km                = wh.distance_km;
            r.estimated_delivery_minutes = wh.estimated_delivery_minutes;
            r.available_stock            = wh.available_stock;
          }
        });
      } catch (whErr) {
        console.error("Warehouse lookup error:", whErr.message);
      }
    }

    // ── OPTIONAL CROSS-SELL: only when cart has items or checkout pending ──
    // Per spec: Do NOT run when cart_total = 0 AND checkout_requested = false.
    if ((cartTotal > 0 || checkout_requested) && cartProductIds.length > 0) {
      try {
        const affinityRows = await getAffinityProducts(cartProductIds, 8);
        affinityProducts   = buildAffinityItems(affinityRows);
      } catch (e) {
        console.error("Affinity error:", e.message);
      }
    }

    // ── STEP 7: Urgency + ETA ─────────────────────────────────────────
    const urgency_required = !urgency && userLat === null;
    let eta = null;
    if (!urgency_required && userLat !== null && userLon !== null) {
      try { eta = await getNearestWarehouseEta(userLat, userLon); }
      catch (e) { console.error("ETA error:", e.message); }
    }

    // ── STEP 8: Primary nudge ─────────────────────────────────────────
    let nudge = null;
    if (products.length > 0) nudge = buildNudge(products[0], cart.length, topIntent);

    return res.json({
      reply,
      top_intents:      candidateIntents,   // new format: { intent, confidence }
      budget:           effectiveBudget,
      people_count,
      duration_days,
      urgency_level,
      time_of_day:      intentData.time_of_day || getISTTimeOfDay(),
      search_tags,
      constraints,
      recommendations:  recommendations,
      nudge,
      urgency_required,
      eta,
      cart_total:       cartTotal,
      remaining_budget: remaining,
      checkout_pending: false,
      budget_suggestions,
      affinity_products: affinityProducts,  // Q4 — Frequently Bought Together (cart sidebar)
      intent_data:      intentData,         // full raw JSON from Gemini
    });

  } catch (err) {
    console.error("Unexpected chat error:", err.message);
    return res.json({
      reply:            "I'm having a moment! Please try again.",
      top_intents:      [],
      recommendations:  [],
      nudge:            null,
      urgency_required: false,
      eta:              null,
      cart_total:       0,
      remaining_budget: null,
      checkout_pending: false,
      budget_suggestions: [],
      intent_data:      null,
    });
  }
});

// ─── POST /api/chat/checkout ──────────────────────────────────────────────────

router.post("/checkout", async (req, res) => {
  try {
    const { cart, userId, warehouseId, intent, budget } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: "Cart is empty" });

    const order = await createOrderFromCart({
      cartItems:   cart,
      userId:      userId || "U001",
      warehouseId: warehouseId || "WH001",
      intent:      intent || "general",
      budgetRange: null,
    });

    return res.json({
      success: true,
      order,
      message: `Order placed! ₹${order.total_amount} for ${order.item_count} items. Estimated delivery: ~18 mins.`,
    });
  } catch (err) {
    console.error("Checkout error:", err.message);
    return res.status(500).json({ error: "Could not create order: " + err.message });
  }
});

// ─── POST /api/chat/suggest-replacements ─────────────────────────────────────

router.post("/suggest-replacements", async (req, res) => {
  try {
    const { cart, budget } = req.body;
    if (!cart || cart.length === 0) return res.json({ suggestions: [] });

    const cartTotal   = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const overBy      = budget ? Math.max(0, cartTotal - budget) : cartTotal * 0.3;
    const suggestions = await suggestBudgetOptimizations(cart, overBy);

    return res.json({ suggestions });
  } catch (err) {
    console.error("Replacements error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
