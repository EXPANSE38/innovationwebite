/**
 * Local fallbacks & fully filled example reports.
 * Used when OFF has no useful hit, for non-food items, or for demo examples.
 */

import { reportFromLocalItem } from "./processor.js";

/** @type {Record<string, object>} */
const LOCAL_ITEMS = {
  "fresh apple": {
    name: "Fresh apple",
    brand: "",
    isExample: true,
    packagingText: "unpackaged / produce",
    packagingTags: ["en:unpackaged"],
    categoriesTags: ["en:fresh-fruits", "en:apples"],
    categories: "Fresh fruits, Apples",
    sourceLabel: "Example report",
    evidence: [
      "Example mapping: loose fresh produce with no plastic packaging assumed.",
      "If your apple came in a plastic clamshell or bag, risk would rise — re-check with that packaging in mind.",
    ],
    confidenceNote:
      "Example report for unpackaged fruit. Not a lab test. Plastic stickers on fruit are tiny but real — peel them off for recycling where accepted.",
    mapping: {
      verdict: "no",
      risk: "Low",
      reasons: [
        "Treated as loose fresh fruit (unpackaged).",
        "No plastic bottle, film bag, or multilayer sachet in this example scenario.",
      ],
    },
    report: {
      containsPlastic: "no",
      containsPlasticLabel: "No plastic packaging indicated",
      risk: "Low",
      riskSummary:
        "Fresh apple (loose): low microplastic risk from packaging — the fruit itself isn’t wrapped in plastic in this example.",
      betterAlternatives:
        "Already a strong choice. Buy loose (not bagged) apples, skip plastic produce bags, and use a reusable tote. Compost the core if your local rules allow.",
      howLongItLasts:
        "An apple biodegrades on the order of weeks to months in compost/soil conditions. There is no multi-decade plastic film left behind from the fruit itself.",
      environmentalImpact:
        "Minimal packaging waste when sold loose. Farming and transport still matter for climate, but packaging-related plastic litter risk is low compared with bagged snacks.",
      potentialImpact:
        "Choosing unpackaged fruit avoids film and tray plastics that can fragment into microplastics. Wash fruit; remove any plastic PLU sticker before eating or composting.",
      funFact:
        "Apples have natural peel ‘packaging.’ A single plastic produce bag used every shopping trip adds up faster than people expect — skip it when you can.",
      confidenceNote:
        "Example for education. If your apple was sold in plastic packaging, treat this Low rating as outdated for that purchase.",
    },
  },

  "potato chips": {
    name: "Potato chips",
    brand: "",
    isExample: true,
    packagingText: "plastic / metallized film bag",
    packagingTags: ["en:plastic", "en:plastic-film", "en:bag"],
    categoriesTags: ["en:chips", "en:potato-crisps", "en:salty-snacks"],
    categories: "Chips, Potato crisps, Salty snacks",
    ingredientsText: "potatoes, oil, salt (typical)",
    sourceLabel: "Example report",
    evidence: [
      "Example: typical single-use multilayer snack bag (plastic ± metallized layer).",
      "Real brand products may include more specific packaging details when available.",
    ],
    mapping: {
      verdict: "yes",
      risk: "High",
      reasons: [
        "Snack bags are commonly plastic or multilayer plastic/metal film.",
        "Category: potato crisps / salty snacks — high packaging plastic likelihood.",
      ],
    },
    report: {
      containsPlastic: "yes",
      containsPlasticLabel: "Likely contains plastic packaging",
      risk: "High",
      riskSummary:
        "Potato chips: higher microplastic-related packaging risk because most retail bags use plastic or metallized multilayer film.",
      betterAlternatives:
        "Make oven or air-fryer chips and store in a reusable container; buy from a bulk/deli counter into your own box; choose brands with paper-based or clearly recyclable packaging when you find them; or swap for unsalted nuts from a refill shop.",
      howLongItLasts:
        "The chips are eaten in minutes; the bag can persist for decades to centuries, fragmenting into microplastics instead of fully breaking down.",
      environmentalImpact:
        "Multilayer chip bags are lightweight litter that travel easily and are often not recyclable in curbside streams. Improper disposal increases environmental microplastic load.",
      potentialImpact:
        "Main concern here is packaging waste and environmental fragmentation. Food-contact microplastic transfer from bags is researched but not quantified by this tool — we flag packaging risk, not a personal dose.",
      funFact:
        "That shiny chip bag is often plastic plus a thin metal layer — excellent moisture barrier, poor match for most recycling bins.",
      confidenceNote:
        "Example for education. Real brand products may include more specific packaging details when available.",
    },
  },

  "plastic water bottle": {
    name: "Plastic water bottle",
    brand: "",
    packagingText: "PET plastic bottle",
    packagingTags: ["en:plastic", "en:pet", "en:plastic-bottle", "en:bottle"],
    categoriesTags: ["en:waters", "en:plastic-bottles"],
    categories: "Bottled water",
    sourceLabel: "General estimate for common packaging",
    evidence: [
      "Estimate for common PET single-use bottles (food or drink).",
      "Searching a brand name may find a more specific product record.",
    ],
    mapping: {
      verdict: "yes",
      risk: "High",
      reasons: [
        "PET / plastic bottle packaging is assumed for this common item type.",
        "Single-use bottles are a common source of plastic waste and fragmentation.",
      ],
    },
  },

  "polyester t-shirt": {
    name: "Polyester t-shirt",
    brand: "",
    packagingText: "n/a (textile)",
    packagingTags: [],
    categoriesTags: ["en:clothing", "polyester"],
    categories: "Clothing, synthetic textile",
    sourceLabel: "General estimate for clothing / textiles",
    evidence: [
      "Clothing isn’t a packaged food product, so this uses a textile estimate.",
      "Polyester is a plastic fiber (PET-based); washing sheds microfibers.",
    ],
    confidenceNote:
      "Non-food estimate. Microfiber shedding depends on wash settings and fabric quality — this is educational, not a lab assay.",
    mapping: {
      verdict: "yes",
      risk: "High",
      reasons: [
        "Polyester is a synthetic plastic fiber.",
        "Laundry can release microplastic microfibers into wastewater.",
      ],
    },
    report: {
      containsPlastic: "yes",
      containsPlasticLabel: "Yes — item is plastic-based fiber",
      risk: "High",
      riskSummary:
        "Polyester t-shirt: high microplastic relevance because the fabric itself is plastic fiber, especially during washing.",
      betterAlternatives:
        "Prefer natural fibers (cotton, linen, wool) when practical; wash less often in cold water; use a microfiber catch bag or filter; buy durable clothes and wear longer.",
      howLongItLasts:
        "Polyester garments can last years in use and much longer as waste; fibers shed during the garment’s life don’t biodegrade like natural fibers.",
      environmentalImpact:
        "Synthetic textiles are a documented source of microplastic pollution via laundry effluent and wear.",
      potentialImpact:
        "Potential impact is mainly environmental microfiber pollution; personal exposure science is still evolving. Reducing wash frequency and capturing lint helps.",
      funFact:
        "A single polyester wash can release thousands of microfibers — one reason synthetics matter for microplastic awareness beyond snack packaging.",
    },
  },

  "glass jar": {
    name: "Glass jar (food)",
    packagingText: "glass jar",
    packagingTags: ["en:glass", "en:jar"],
    categoriesTags: ["en:groceries"],
    categories: "Packaged food in glass",
    sourceLabel: "General packaging estimate",
    mapping: {
      verdict: "no",
      risk: "Low",
      reasons: [
        "Glass packaging — not plastic film or PET.",
        "Lids may still be metal/plastic; this fallback rates the primary jar material.",
      ],
    },
  },
};

/** Alias keys → canonical LOCAL_ITEMS keys */
const ALIASES = {
  apple: "fresh apple",
  "an apple": "fresh apple",
  "loose apple": "fresh apple",
  chips: "potato chips",
  crisps: "potato chips",
  "potato crisps": "potato chips",
  "bag of chips": "potato chips",
  "water bottle": "plastic water bottle",
  "pet bottle": "plastic water bottle",
  "bottled water": "plastic water bottle",
  polyester: "polyester t-shirt",
  "polyester shirt": "polyester t-shirt",
  "synthetic shirt": "polyester t-shirt",
};

/**
 * @param {string} query
 * @returns {string} normalized key or ""
 */
export function normalizeQueryKey(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Find a local item definition (exact or alias), or null.
 * @param {string} query
 */
export function findLocalItem(query) {
  const key = normalizeQueryKey(query);
  if (!key) return null;
  if (LOCAL_ITEMS[key]) return { key, item: LOCAL_ITEMS[key] };
  if (ALIASES[key] && LOCAL_ITEMS[ALIASES[key]]) {
    return { key: ALIASES[key], item: LOCAL_ITEMS[ALIASES[key]] };
  }
  // Soft match: query contains a known key
  for (const k of Object.keys(LOCAL_ITEMS)) {
    if (key.includes(k) || k.includes(key)) {
      return { key: k, item: LOCAL_ITEMS[k] };
    }
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (key.includes(alias)) {
      return { key: target, item: LOCAL_ITEMS[target] };
    }
  }
  return null;
}

/**
 * @param {string} query
 */
export function buildLocalReport(query) {
  const found = findLocalItem(query);
  if (!found) {
    return reportFromLocalItem({
      name: query.trim() || "Unknown item",
      sourceLabel: "General estimate — limited product data",
      confidenceSource: "local_unknown",
      packagingText: "",
      packagingTags: [],
      categoriesTags: [],
      evidence: [
        "No close product match and no specific profile for this name.",
        "Try a packaged food name, or examples: Fresh apple, Potato chips, Plastic water bottle, Polyester t-shirt.",
      ],
      mapping: {
        verdict: "unknown",
        risk: "Unknown",
        reasons: ["Could not classify packaging materials from the name alone."],
      },
      confidenceNote:
        "Unknown on purpose — we won’t invent a plastic verdict without packaging or a known item profile.",
    });
  }
  return reportFromLocalItem(found.item);
}

/**
 * Whether this query should prefer local fallback over OFF (non-food).
 * @param {string} query
 */
export function prefersLocalOnly(query) {
  const key = normalizeQueryKey(query);
  const nonFood = [
    "polyester",
    "t-shirt",
    "tshirt",
    "clothing",
    "shirt",
    "fleece",
    "nylon",
    "acrylic",
  ];
  return nonFood.some((w) => key.includes(w));
}

export function listExampleKeys() {
  return Object.keys(LOCAL_ITEMS).filter((k) => LOCAL_ITEMS[k].isExample);
}
