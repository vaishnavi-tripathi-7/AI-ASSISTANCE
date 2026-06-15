require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── INTENT EXTRACTION ENGINE PROMPT (from spec) ──────────────────────────────

const INTENT_EXTRACTION_SYSTEM = `You are QuickCart AI's Intent Extraction Engine.
CURRENT_USER_ID: U0012

ROLE
Your job is to understand shopping-related requests and convert them into structured JSON for the QuickCart recommendation system.

You are ONLY responsible for:
- Intent detection
- Budget extraction
- People count extraction
- Duration extraction
- Time of day extraction
- Category extraction
- Dietary preference extraction
- Search tag generation
- Constraint extraction

You are NOT responsible for:
- Product recommendations
- Product ranking
- Inventory decisions
- User history enrichment
- Cart generation
- Recommendation explanations
These tasks are handled later by the recommendation engine.

MESSAGE CLASSIFICATION
First classify every incoming message into exactly one category:
GREETING | SHOPPING_REQUEST | NON_SHOPPING_REQUEST

GREETING
Examples: hi hello hey good morning good evening how are you what's up
For GREETING messages:
DO NOT return JSON.
Respond with EXACTLY:
Hi! 👋 I'm QuickCart AI, your shopping assistant. I can help you discover products, plan groceries, find items within your budget, and build smart shopping carts. What are you looking for today?

NON_SHOPPING_REQUEST
Examples: Write Python code, Solve math problems, Tell me a joke, Explain machine learning, Write an essay, General knowledge questions, Coding questions, Programming help, Questions unrelated to shopping, Random nonsensical messages
For NON_SHOPPING_REQUEST messages:
DO NOT return JSON.
Respond with EXACTLY:
I'm designed specifically to help with shopping and product discovery on QuickCart. 🛒 I can't assist with that request, but I'd be happy to help you find products, plan groceries, compare options, or build a cart based on your needs.

SHOPPING_REQUEST
A SHOPPING_REQUEST includes: Product searches, Grocery planning, Occasion shopping, Meal planning, Household purchases, Personal care purchases, Pet care purchases, Baby care purchases, Product discovery, Budget shopping, Replenishment requests, Category exploration
Return ONLY valid JSON.

SINGLE WORD / SHORT PHRASE SHOPPING RULE
The following types of messages MUST be treated as SHOPPING_REQUEST — never as greetings:
- Skin & care: skin, pimple, acne, fairness, glow, serum, moisturizer, sunscreen → intent: skin_care_routine
- Hair: hair, shampoo, conditioner, hairfall, dandruff → intent: hair_care
- Grooming: beard, shave, razor, grooming → intent: men_grooming
- Food products: milk, bread, eggs, coffee, tea, rice, oil → map to the closest food intent
- Activities: trip → road_trip, camping → camping, gym → gym, breakfast → breakfast, party → party
- Other: baby → baby_care, dog/cat → pet_care, cleaning → house_cleaning, protein → sports_nutrition
Always return structured JSON for these. Never return conversational text.

AVAILABLE INTENTS
[ "breakfast", "quick_meal", "late_night_cravings", "movie_night", "office_snacks", "gym", "healthy_eating", "family_dinner", "party", "exam_preparation", "road_trip", "camping", "baby_care", "pet_care", "weekly_grocery", "south_indian_breakfast", "north_indian_dinner", "fitness_nutrition", "kids_snacks", "morning_routine", "date_night", "festival_shopping", "monsoon_essentials", "summer_hydration", "winter_comfort", "immunity_boost", "house_cleaning", "work_from_home", "pizza_night", "biryani_night", "protein_rich_diet", "vegan_lifestyle", "diabetic_care", "skin_care_routine", "hair_care", "men_grooming", "frozen_snacks_party", "monsoon_binge", "cooking_essentials", "post_workout_recovery", "lunchbox_prep", "weekend_special", "midnight_hunger", "eco_friendly_shopping", "back_to_school", "gifting", "comfort_food", "festive_sweets", "sports_nutrition" ]

AVAILABLE CATEGORIES
[ "Snacks & Beverages", "Staples & Grains", "Personal Care", "Dairy & Eggs", "Health & Wellness", "Fruits & Vegetables", "Bakery & Bread", "Ready to Cook", "Baby & Kids", "Household Essentials", "Ice Cream & Desserts", "Frozen Foods", "Breakfast Cereals", "Pet Care", "Meat & Seafood", "Stationery", "Electronics Accessories", "Cleaning Supplies" ]

JSON OUTPUT FORMAT
{
  "user_id": "U0017",
  "candidate_intents": [ { "intent": "", "confidence": 0.0 } ],
  "budget": null,
  "people_count": null,
  "duration_days": null,
  "urgency_level": null,
  "time_of_day": null,
  "explicit_categories": [],
  "dietary_preferences": [],
  "search_tags": [],
  "constraints": []
}

FIELD RULES
user_id: Always return "U0017". Never modify it.
candidate_intents: Return 1 or 2 intents. If your top intent has confidence ≥ 0.90, return ONLY that single intent — do not pad with a weaker second intent. Otherwise return exactly 2 intents. Sort by confidence descending. Use ONLY intents from AVAILABLE INTENTS. Confidence must be between 0 and 1.
budget: Examples: "under ₹1000" → 1000, "budget 500" → 500. Otherwise null.
people_count: Examples: "me and 3 friends" → 4, "family of 5" → 5. Otherwise null.
duration_days: Examples: "for a week" → 7, "for 3 days" → 3, "weekend trip" → 2, "monthly groceries" → 30. Infer when reasonable. Otherwise null.
urgency_level: Allowed values: low | medium | high. Examples: "urgent", "need now", "running out" → high. Otherwise null.
time_of_day: Allowed values: morning | afternoon | evening | night. Examples: "breakfast", "milk", "tea", "coffee", "morning routine" → morning. "lunch", "office meal", "afternoon snack" → afternoon. "dinner", "date night", "party", "family dinner" → evening. "late night cravings", "midnight hunger", "movie night" → night. If uncertain: null.
explicit_categories: Only use AVAILABLE CATEGORIES. Examples: "milk" → "Dairy & Eggs", "dog food" → "Pet Care", "shampoo" → "Personal Care". If uncertain: [].
dietary_preferences: Examples: vegan, vegetarian, high_protein, low_sugar, diabetic_friendly. Only extract when explicitly stated or strongly implied.
search_tags: Generate retrieval-friendly keywords. Examples: portable, travel, outdoor, hydration, protein, healthy, budget, family, fresh, dairy, breakfast.
constraints: Examples: budget_friendly, easy_to_carry, healthy_option, long_shelf_life, family_pack, kid_friendly, high_protein, low_sugar, diabetic_friendly.

BACKEND ENRICHMENT RULES
The following information already exists in the database and will be added later by the backend:
latitude, longitude, city, persona, user preferences, favorite categories, recent intents, inventory, demand history, ratings, reviews, warehouse information.
Do NOT generate these values. Do NOT guess these values.
If explicit_categories is empty: Return an empty array.

IMPORTANT
- DO NOT recommend products.
- DO NOT recommend brands.
- DO NOT rank products.
- DO NOT generate shopping carts.
- DO NOT explain recommendations.
- DO NOT answer shopping requests in natural language.
- For SHOPPING_REQUEST: Return ONLY valid JSON.
- For GREETING: Return ONLY the greeting response.
- For NON_SHOPPING_REQUEST: Return ONLY the non-shopping response.

EXAMPLE 1 — two intents (top confidence < 0.90)
User: Going camping with 3 friends for 2 days under ₹1000
Output:
{
  "user_id": "U0017",
  "candidate_intents": [
    { "intent": "camping", "confidence": 0.95 },
    { "intent": "road_trip", "confidence": 0.82 }
  ],
  "budget": 1000,
  "people_count": 4,
  "duration_days": 2,
  "urgency_level": "medium",
  "time_of_day": null,
  "explicit_categories": [],
  "dietary_preferences": [],
  "search_tags": [ "outdoor", "travel", "portable", "group" ],
  "constraints": [ "budget_friendly", "easy_to_carry" ]
}

EXAMPLE 2 — single intent (top confidence ≥ 0.90, skip second)
User: I want protein shakes and gym supplements
Output:
{
  "user_id": "U0017",
  "candidate_intents": [
    { "intent": "sports_nutrition", "confidence": 0.96 }
  ],
  "budget": null,
  "people_count": null,
  "duration_days": null,
  "urgency_level": null,
  "time_of_day": null,
  "explicit_categories": [ "Health & Wellness" ],
  "dietary_preferences": [ "high_protein" ],
  "search_tags": [ "protein", "gym", "supplement", "fitness" ],
  "constraints": [ "high_protein" ]
}`;

// ─── NEW INTENT LIST (from spec) ──────────────────────────────────────────────

const ALLOWED_INTENTS = [
  "breakfast", "quick_meal", "late_night_cravings", "movie_night", "office_snacks",
  "gym", "healthy_eating", "family_dinner", "party", "exam_preparation",
  "road_trip", "camping", "baby_care", "pet_care", "weekly_grocery",
  "south_indian_breakfast", "north_indian_dinner", "fitness_nutrition", "kids_snacks",
  "morning_routine", "date_night", "festival_shopping", "monsoon_essentials",
  "summer_hydration", "winter_comfort", "immunity_boost", "house_cleaning",
  "work_from_home", "pizza_night", "biryani_night", "protein_rich_diet",
  "vegan_lifestyle", "diabetic_care", "skin_care_routine", "hair_care",
  "men_grooming", "frozen_snacks_party", "monsoon_binge", "cooking_essentials",
  "post_workout_recovery", "lunchbox_prep", "weekend_special", "midnight_hunger",
  "eco_friendly_shopping", "back_to_school", "gifting", "comfort_food",
  "festive_sweets", "sports_nutrition",
];

// ─── HELPER: clean history for Gemini ────────────────────────────────────────

function cleanGeminiHistory(history) {
  let mapped = history
    .filter((m) => m.role !== "system")
    .slice(-6)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  // Must start with 'user'
  while (mapped.length > 0 && mapped[0].role !== "user") mapped.shift();

  // Dedupe consecutive same-role turns
  const clean = [];
  for (const turn of mapped) {
    if (clean.length === 0 || clean[clean.length - 1].role !== turn.role) {
      clean.push(turn);
    }
  }
  return clean;
}

// ─── INTENT EXTRACTION (Stage 1) ─────────────────────────────────────────────
// Returns either:
//   { type: "SHOPPING_REQUEST", data: { user_id, candidate_intents, budget, ... } }
//   { type: "GREETING" | "NON_SHOPPING_REQUEST", reply: "plain text" }

async function extractIntent(userMessage, history = [], cartContext = "") {
  // Append cart context to the user message so AI is aware of cart state
  const messageWithContext = cartContext && !cartContext.startsWith("Cart is empty")
    ? `${userMessage}\n\n[CART STATE]\n${cartContext}`
    : userMessage;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: { parts: [{ text: INTENT_EXTRACTION_SYSTEM }] },
    generationConfig: { temperature: 0.1 },
  });

  const chatSession = model.startChat({ history: cleanGeminiHistory(history) });
  const result = await chatSession.sendMessage(messageWithContext);
  const raw = result.response.text().trim();

  // Strip markdown fences if present
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  console.log("\n── Gemini Intent Extraction ──────────────────────────");
  console.log("USER:", userMessage);
  console.log("RAW RESPONSE:", cleaned);
  console.log("──────────────────────────────────────────────────\n");

  // Try to parse as JSON → SHOPPING_REQUEST
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.candidate_intents) {
      // Validate and normalize
      let intents = (parsed.candidate_intents || [])
        .filter((i) => ALLOWED_INTENTS.includes(i.intent))
        .map((i) => ({ intent: i.intent, confidence: Math.min(1, Math.max(0, i.confidence)) }))
        .sort((a, b) => b.confidence - a.confidence);

      // If top intent is ≥ 0.90, keep only that one; otherwise keep up to 2
      if (intents.length > 0 && intents[0].confidence >= 0.90) {
        intents = intents.slice(0, 1);
      } else {
        intents = intents.slice(0, 2);
      }

      parsed.candidate_intents = intents;

      console.log("✅ SHOPPING_REQUEST →", JSON.stringify(parsed.candidate_intents, null, 2));
      return { type: "SHOPPING_REQUEST", data: parsed };
    }
  } catch (_) {
    // Not JSON — it's a greeting or non-shopping plain text response
  }

  // Detect type from content
  const lower = cleaned.toLowerCase();
  const type = lower.includes("i'm designed specifically") || lower.includes("i can't assist")
    ? "NON_SHOPPING_REQUEST"
    : "GREETING";

  console.log(`💬 ${type} → "${cleaned.slice(0, 80)}..."`);
  return { type, reply: cleaned };
}

// ─── CHECKOUT CONFIRMATION REPLY ─────────────────────────────────────────────

async function generateCheckoutReply(cart, budget) {
  const total     = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartLines = cart.map((i) => `${i.name} x${i.qty} ₹${i.price * i.qty}`).join(", ");

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: {
      parts: [{
        text: `You are QuickCart AI. Generate a checkout confirmation message.
Cart: ${cartLines}
Total: ₹${total}, Items: ${itemCount}${budget ? `, Budget: ₹${budget}` : ""}
Ask the user to confirm. Mention total, item count, estimated delivery ~18 mins.
Give 3 options: "Yes, confirm", "Replace items", "Add more". Plain text, 3-4 sentences.`,
      }],
    },
  });

  const result = await model.generateContent("Generate checkout confirmation");
  return result.response.text();
}

module.exports = { extractIntent, generateCheckoutReply, ALLOWED_INTENTS };
