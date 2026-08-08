/**
 * Alternatives Recommender — live Open Food Facts picks with lower packaging plastic risk.
 * Complements the static “Better alternatives” education text; does not replace it.
 */

import { searchProducts, enrichProduct, normalizeOffProduct, getProduct } from "./off-api.js";
import { mapPackagingToPlastic } from "./processor.js";
import { searchLimiter, productLimiter } from "./rate-limit.js";

/** Curated glass-packaged OFF products used when live search is thin or rate-limited. */
const CURATED_CODES = {
  snack: ["3305111062112", "3770019087015", "3375801867013", "12167330"],
  water: ["3305111062112", "3770019087015"],
  default: ["3305111062112", "3770019087015", "3375801867013"],
};

/** @type {Record<string, number>} */
const RISK_RANK = {
  Low: 1,
  Medium: 2,
  Possible: 3,
  Unknown: 3,
  High: 4,
};

/**
 * @typedef {object} AlternativeSuggestion
 * @property {string} code
 * @property {string} name
 * @property {string} brand
 * @property {string} imageUrl
 * @property {string} risk
 * @property {string} containsPlastic
 * @property {string} whyBetter
 * @property {import('./off-api.js').OffProduct} product
 */

/**
 * High / medium plastic risk (or uncertain) items get live substitutes.
 * @param {import('./processor.js').MicroplasticReport} report
 */
export function shouldRecommendAlternatives(report) {
  if (!report) return false;
  if (report.containsPlastic === "no" && report.risk === "Low") return false;
  return true;
}

/**
 * Build 1–3 OFF search queries biased toward lower-plastic packaging.
 * @param {import('./processor.js').MicroplasticReport} report
 * @returns {string[]}
 */
export function buildAlternativeQueries(report) {
  const name = String(report.displayName || "").toLowerCase();
  const cats = String(report.categories || "").toLowerCase();
  const tags = (report.categoriesTags || []).join(" ").toLowerCase();
  const blob = `${name} ${cats} ${tags}`;

  /** @type {string[]} */
  const queries = [];

  if (/chip|crisp|salty.?snack|snack/.test(blob)) {
    // Broad food searches; glass packaging is confirmed after product enrich.
    queries.push("honey", "peanut butter", "strawberry jam");
  } else if (/water|bottle|pet/.test(blob)) {
    queries.push("san pellegrino", "perrier", "evian");
  } else if (/yoghurt|yogurt/.test(blob)) {
    queries.push("yogurt", "greek yogurt");
  } else if (/juice|soft.?drink|soda|cola/.test(blob)) {
    queries.push("orange juice", "apple juice");
  } else if (/chocolate|candy|sweet|biscuit|cookie/.test(blob)) {
    queries.push("dark chocolate", "chocolate bar");
  } else if (/polyester|clothing|textile|shirt|fleece/.test(blob)) {
    queries.push("cotton t-shirt");
  } else {
    const term = categorySearchTerm(report) || simplifyName(report.displayName);
    if (term) queries.push(term);
  }

  // Deduplicate and drop empties
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 3);
}

/**
 * @param {import('./processor.js').MicroplasticReport} report
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ items: AlternativeSuggestion[], queryUsed: string, skipped?: string }>}
 */
export async function findAlternativeProducts(report, opts = {}) {
  const limit = opts.limit ?? 3;

  if (!shouldRecommendAlternatives(report)) {
    return { items: [], queryUsed: "", skipped: "already_low_risk" };
  }

  const queries = buildAlternativeQueries(report);
  if (!queries.length) {
    return { items: [], queryUsed: "", skipped: "no_query" };
  }

  /** @type {import('./off-api.js').OffProduct[]} */
  let hits = [];
  let queryUsed = "";

  for (const q of queries) {
    if (!searchLimiter.canProceed()) break;
    try {
      const batch = await searchProducts(q, { pageSize: 8 });
      queryUsed = queryUsed || q;
      hits.push(...batch);
      if (hits.length >= 16) break;
    } catch (err) {
      if (err.name === "RateLimitError") break;
      // try next query
    }
  }

  const excludeCode = String(report.productCode || "").trim();
  const excludeName = normalizeName(report.displayName);
  const seen = new Set();

  const unique = [];
  for (const p of hits) {
    const code = String(p.code || "").trim();
    const key = code || normalizeName(p.product_name);
    if (!key || seen.has(key)) continue;
    if (excludeCode && code === excludeCode) continue;
    if (excludeName && normalizeName(p.product_name) === excludeName) continue;
    if (!isPlausibleFoodHit(p)) continue;
    seen.add(key);
    unique.push(p);
  }

  const currentRank = RISK_RANK[report.risk] ?? 3;

  // Prefer likely substitutes for enrichment (do not hard-filter on sparse search packaging).
  const candidates = unique
    .map((product) => {
      const preview = scoreProduct(product);
      return {
        product,
        ...preview,
        boost: relevanceBoost(product),
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.boost - a.boost ||
        b.packagingSignal - a.packagingSignal
    );

  /** @type {AlternativeSuggestion[]} */
  const items = [];
  let hitRateLimit = false;

  for (const row of candidates.slice(0, Math.max(12, limit * 4))) {
    if (items.length >= limit) break;
    if (!productLimiter.canProceed()) {
      hitRateLimit = true;
      break;
    }
    let product = row.product;
    try {
      product = await enrichProduct(product);
    } catch {
      // keep search hit
    }
    const suggestion = toSuggestion(product, report, currentRank);
    if (suggestion) items.push(suggestion);
  }

  if (items.length < limit) {
    const curated = await loadCuratedAlternatives(report, {
      limit: limit - items.length,
      excludeCodes: new Set([
        excludeCode,
        ...items.map((i) => i.code).filter(Boolean),
      ]),
      currentRank,
    });
    items.push(...curated);
  }

  return {
    items: items.slice(0, limit),
    queryUsed,
    skipped: items.length
      ? undefined
      : hitRateLimit
        ? "rate_limit"
        : "none_found",
  };
}

/**
 * @param {import('./off-api.js').OffProduct} product
 * @param {import('./processor.js').MicroplasticReport} report
 * @param {number} currentRank
 * @returns {AlternativeSuggestion|null}
 */
function toSuggestion(product, report, currentRank) {
  if (!isPlausibleFoodHit(product)) return null;
  const scoredFull = scoreProduct(product);
  if (!isMeaningfullyBetter(scoredFull, currentRank)) return null;
  const normalized = normalizeOffProduct(product);
  return {
    code: normalized.code || String(product.code || ""),
    name: normalized.name,
    brand: normalized.brand,
    imageUrl: normalized.imageUrlSmall || normalized.imageUrl || "",
    risk: scoredFull.risk,
    containsPlastic: scoredFull.verdict,
    whyBetter: whyBetterText(scoredFull, report),
    product,
  };
}

/**
 * @param {import('./processor.js').MicroplasticReport} report
 * @param {{ limit: number, excludeCodes: Set<string>, currentRank: number }} opts
 */
async function loadCuratedAlternatives(report, opts) {
  const codes = curatedCodesFor(report);
  /** @type {AlternativeSuggestion[]} */
  const out = [];
  for (const code of codes) {
    if (out.length >= opts.limit) break;
    if (opts.excludeCodes.has(code)) continue;
    if (!productLimiter.canProceed()) break;
    try {
      const product = await getProduct(code);
      if (!product) continue;
      const suggestion = toSuggestion(product, report, opts.currentRank);
      if (suggestion) out.push(suggestion);
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * @param {import('./processor.js').MicroplasticReport} report
 */
function curatedCodesFor(report) {
  const blob = `${report.displayName || ""} ${report.categories || ""}`.toLowerCase();
  if (/chip|crisp|snack|honey|jam|butter/.test(blob)) return CURATED_CODES.snack;
  if (/water|bottle|drink|juice|cola/.test(blob)) {
    return [...CURATED_CODES.water, ...CURATED_CODES.default];
  }
  return CURATED_CODES.default;
}

/**
 * Soft ranking for which sparse search hits to enrich first.
 * @param {import('./off-api.js').OffProduct} product
 */
function relevanceBoost(product) {
  const blob = `${product.product_name || ""} ${product.brands || ""} ${
    product.packaging || ""
  } ${(product.packaging_tags || []).join(" ")}`.toLowerCase();
  let score = 0;
  if (/en:glass|glass jar|glass bottle|in glass/.test(blob)) score += 8;
  if (/en:paper|en:cardboard|en:metal|en:aluminium|en:aluminum/.test(blob)) {
    score += 5;
  }
  if (/honey|peanut butter|jam|marmalade|preserve/.test(blob)) score += 3;
  if (/san pellegrino|perrier|evian|mineral water/.test(blob)) score += 3;
  if (/plastic bottle|plastic bag|sachet|en:plastic/.test(blob) && !/en:glass/.test(blob)) {
    score -= 6;
  }
  if (product.image_front_small_url || product.image_front_url) score += 1;
  return score;
}

/**
 * Only keep clear packaging wins — not vague “Possible” search noise.
 * @param {{ verdict: string, risk: string, packagingSignal: number, rank: number }} scored
 * @param {number} currentRank
 */
function isMeaningfullyBetter(scored, currentRank) {
  if (scored.rank >= currentRank) return false;
  // Only clear packaging wins — Low / non-plastic.
  return scored.verdict === "no" || scored.risk === "Low";
}

/**
 * Drop packaging-material stubs and non-food noise from OFF search.
 * @param {import('./off-api.js').OffProduct} product
 */
function isPlausibleFoodHit(product) {
  const name = String(product.product_name || "").trim();
  if (name.length < 6) return false;
  const nameNorm = name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (
    /^(paper|glass|plastic|cardboard|metal|aluminium|aluminum|unknown|packaging|kraft|film)$/.test(
      nameNorm
    )
  ) {
    return false;
  }
  // Prefer items that look like food (categories or a multi-word grocery name)
  const cats = String(product.categories || "");
  const tags = product.categories_tags || [];
  if (cats || tags.length) return true;
  return name.split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * @param {import('./off-api.js').OffProduct} product
 */
function scoreProduct(product) {
  const packagingTags = [
    ...(product.packaging_tags || []),
    ...(product.packaging_materials_tags || []),
  ].map((t) => String(t).toLowerCase());

  const packagingText = [product.packaging, product.packaging_text]
    .filter(Boolean)
    .join(" · ");

  const mapping = mapPackagingToPlastic({
    packagingText,
    packagingTags,
    categoriesTags: (product.categories_tags || []).map((t) =>
      String(t).toLowerCase()
    ),
    categories: product.categories || "",
    name: product.product_name || "",
  });

  const nameOnly = String(product.product_name || "").toLowerCase();
  const packBlob = `${packagingText} ${packagingTags.join(" ")}`.toLowerCase();
  const nameBlob = `${nameOnly} ${packBlob}`;

  let packagingSignal = packagingTags.length + (packagingText ? 2 : 0);
  if (hasNonPlasticPackagingCue(nameOnly, packBlob)) {
    packagingSignal += 4;
  }
  if (/plastic|pet|sachet|film/.test(packBlob) && !hasNonPlasticPackagingCue(nameOnly, packBlob)) {
    packagingSignal -= 2;
  }

  // Name-bias only with a real packaging cue (not “glass noodles”).
  let { verdict, risk, reasons } = mapping;
  if (
    (verdict === "unknown" || verdict === "possible") &&
    hasNonPlasticPackagingCue(nameOnly, packBlob) &&
    !/\bplastic\b/.test(packBlob)
  ) {
    verdict = "no";
    risk = "Low";
    reasons = [
      ...reasons,
      "Name/packaging wording suggests glass, paper, or unpackaged — pending full materials.",
    ];
  }

  return {
    verdict,
    risk,
    reasons,
    rank: RISK_RANK[risk] ?? 3,
    packagingSignal,
  };
}

/**
 * True packaging cues — avoids food names like “glass noodles”.
 * @param {string} nameOnly
 * @param {string} packBlob
 */
function hasNonPlasticPackagingCue(nameOnly, packBlob) {
  if (/en:glass|verre|bocal-verre|pot-en-verre|glass jar|glass bottle|in glass|unpackaged/.test(packBlob)) {
    return true;
  }
  if (/\b(glass jar|glass bottle|in glass|paper bag|paper box|cardboard|metal can|tin can|aluminium can|aluminum can)\b/.test(`${nameOnly} ${packBlob}`)) {
    return true;
  }
  // bare “glass” only if jar/bottle and not noodle/vermicelli
  if (
    /\bglass\b/.test(nameOnly) &&
    /\b(jar|bottle|container)\b/.test(nameOnly) &&
    !/noodle|vermicelli|cellophane/.test(nameOnly)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {{ verdict: string, risk: string }} scored
 * @param {import('./processor.js').MicroplasticReport} report
 */
function whyBetterText(scored, report) {
  if (scored.verdict === "no" || scored.risk === "Low") {
    return `Lower packaging plastic risk than ${report.displayName || "this item"} (${scored.risk}).`;
  }
  return `Estimated microplastic packaging risk: ${scored.risk} (better than ${report.risk}).`;
}

/**
 * @param {import('./processor.js').MicroplasticReport} report
 */
function categorySearchTerm(report) {
  const tags = report.categoriesTags || [];
  if (tags.length) {
    // Prefer a mid-specificity tag (skip ultra-generic)
    const cleaned = tags
      .map((t) =>
        String(t)
          .replace(/^[a-z]{2}:/, "")
          .replace(/-/g, " ")
      )
      .filter((t) => t && !["foods", "plant based foods", "snacks"].includes(t));
    if (cleaned.length) {
      return cleaned.sort((a, b) => a.length - b.length)[Math.min(1, cleaned.length - 1)];
    }
  }
  const cats = String(report.categories || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  return cats[0] || "";
}

function simplifyName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(fresh|plastic|organic|the|a|an)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

