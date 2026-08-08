/**
 * Local educational report processor.
 * Converts packaging / category evidence into report sections.
 * All verdicts come from these rules — not from an external AI.
 */

import { buildFoodContext, exampleFoodContext } from "./food-context.js";
import { computeConfidence } from "./confidence.js";

/** Plastic-related packaging tags / keywords (OFF uses en:plastic, etc.). */
const PLASTIC_POSITIVE = [
  "en:plastic",
  "plastic",
  "pet",
  "en:pet",
  "en:pet-polyethylene-terephthalate",
  "hdpe",
  "ldpe",
  "pp",
  "en:pp",
  "en:pp-polypropylene",
  "ps",
  "en:ps",
  "pvc",
  "en:pvc",
  "polyethylene",
  "polypropylene",
  "polystyrene",
  "cellophane",
  "film",
  "en:plastic-film",
  "en:plastic-bag",
  "en:plastic-bottle",
  "en:sachet",
  "sachet",
  "wrapper",
  "blister",
  "tetra", // often multilayer with plastic
  "en:multilayer",
  "metallized",
  "en:metalized-film",
];

const PLASTIC_NEGATIVE_PACKAGING = [
  "en:glass",
  "glass",
  "verre",
  "en:paper",
  "paper",
  "en:cardboard",
  "cardboard",
  "en:metal",
  "en:aluminium",
  "aluminum",
  "aluminium",
  "en:steel",
  "en:tin",
  "en:wood",
  "en:cork",
  "en:unpackaged",
  "unpackaged",
  "en:fresh",
  "bulk",
];

/** Fresh produce categories that are typically unpackaged when bought loose. */
const FRESH_PRODUCE_TAGS = [
  "en:fresh-fruits",
  "en:fruits",
  "en:apples",
  "en:fresh-vegetables",
  "en:vegetables",
  "en:potatoes",
  "en:bananas",
  "en:citrus",
];

const SNACK_TAGS = [
  "en:chips",
  "en:crisps",
  "en:potato-crisps",
  "en:salty-snacks",
  "en:snacks",
  "en:biscuits",
  "en:cookies",
  "en:candies",
  "en:chocolate",
  "en:energy-bars",
];

/**
 * @typedef {"yes"|"no"|"possible"|"unknown"} PlasticVerdict
 * @typedef {"Low"|"Medium"|"High"|"Possible"|"Unknown"} RiskLevel
 *
 * @typedef {object} MicroplasticReport
 * @property {string} displayName
 * @property {string} brand
 * @property {PlasticVerdict} containsPlastic
 * @property {string} containsPlasticLabel
 * @property {RiskLevel} risk
 * @property {string} riskSummary
 * @property {string} betterAlternatives
 * @property {string} howLongItLasts
 * @property {string} environmentalImpact
 * @property {string} potentialImpact
 * @property {string} funFact
 * @property {string} sourceLabel
 * @property {string[]} evidence
 * @property {string} confidenceNote
 * @property {import('./confidence.js').ConfidenceResult|null} confidence
 * @property {string} [imageUrl]
 * @property {string} [productCode]
 * @property {string} [categories]
 * @property {string[]} [categoriesTags]
 * @property {boolean} isExample
 */

/**
 * @param {string} text
 * @param {string[]} needles
 */
function textHasAny(text, needles) {
  const t = text.toLowerCase();
  return needles.some((n) => {
    const needle = n.toLowerCase();
    if (!needle) return false;
    // Short polymer codes (pp, ps, pet) must not match inside "capsule", "pepper", etc.
    if (needle.length <= 3) {
      return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:[^a-z0-9]|$)`).test(
        t
      );
    }
    return t.includes(needle);
  });
}

/**
 * @param {string[]} tags
 * @param {string[]} needles
 */
function tagsHaveAny(tags, needles) {
  const set = tags.map((t) => t.toLowerCase());
  return needles.some((n) => {
    const needle = n.toLowerCase();
    if (!needle) return false;
    return set.some((t) => {
      if (t === needle) return true;
      if (needle.length <= 3) {
        return (
          t === `en:${needle}` ||
          t.endsWith(`-${needle}`) ||
          t.includes(`:${needle}-`) ||
          t.includes(`-${needle}-`) ||
          t.endsWith(`:${needle}`)
        );
      }
      return t.includes(needle);
    });
  });
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Core packaging → plastic mapping used by OFF products and fallbacks.
 * @param {{ packagingText?: string, packagingTags?: string[], categoriesTags?: string[], categories?: string, name?: string }} evidence
 * @returns {{ verdict: PlasticVerdict, risk: RiskLevel, reasons: string[] }}
 */
export function mapPackagingToPlastic(evidence) {
  const packagingText = evidence.packagingText || "";
  const packagingTags = evidence.packagingTags || [];
  const categoriesTags = evidence.categoriesTags || [];
  const categories = evidence.categories || "";
  const name = evidence.name || "";
  const reasons = [];

  const hasPlasticTag = tagsHaveAny(packagingTags, PLASTIC_POSITIVE);
  const hasPlasticText = textHasAny(packagingText, PLASTIC_POSITIVE);
  const hasNonPlasticOnly =
    (tagsHaveAny(packagingTags, PLASTIC_NEGATIVE_PACKAGING) ||
      textHasAny(packagingText, PLASTIC_NEGATIVE_PACKAGING)) &&
    !hasPlasticTag &&
    !hasPlasticText;

  const looksFreshProduce =
    tagsHaveAny(categoriesTags, FRESH_PRODUCE_TAGS) ||
    textHasAny(categories, ["fresh fruit", "fresh vegetable", "apples"]) ||
    textHasAny(name, ["fresh apple", "loose apple"]);

  const looksSnack =
    tagsHaveAny(categoriesTags, SNACK_TAGS) ||
    textHasAny(categories, ["chip", "crisp", "snack"]) ||
    textHasAny(name, ["chip", "crisp"]);

  const hasPackagingSignal =
    packagingTags.length > 0 || packagingText.trim().length > 0;

  if (hasPlasticTag || hasPlasticText) {
    reasons.push(
      hasPlasticTag
        ? `Packaging tags indicate plastic: ${packagingTags.filter((t) => textHasAny(t, PLASTIC_POSITIVE)).slice(0, 4).join(", ") || "plastic-related"}`
        : `Packaging text mentions plastic materials: “${packagingText.slice(0, 80)}”`
    );

    if (looksSnack) {
      reasons.push("Salty snacks are commonly sold in multilayer plastic/metallized film bags.");
      return { verdict: "yes", risk: "High", reasons };
    }

    if (textHasAny(packagingText + packagingTags.join(" "), ["bottle", "en:plastic-bottle", "pet"])) {
      reasons.push("Bottle-shaped plastic packaging sheds and persists if littered.");
      return { verdict: "yes", risk: "High", reasons };
    }

    return { verdict: "yes", risk: "Medium", reasons };
  }

  if (hasNonPlasticOnly) {
    reasons.push("Packaging signals point to glass, paper, metal, or unpackaged — not plastic film/bottle.");
    return { verdict: "no", risk: "Low", reasons };
  }

  if (looksFreshProduce && !hasPackagingSignal) {
    reasons.push("Fresh produce category with no packaging data — treat as unpackaged produce when bought loose.");
    return { verdict: "no", risk: "Low", reasons };
  }

  if (looksSnack && !hasPackagingSignal) {
    reasons.push("Snack category but packaging fields are missing — bags are usually plastic/multilayer.");
    return { verdict: "possible", risk: "Possible", reasons };
  }

  if (!hasPackagingSignal) {
    reasons.push("No packaging or materials data available from the product record.");
    return { verdict: "unknown", risk: "Unknown", reasons };
  }

  reasons.push("Packaging listed, but materials could not be classified as clearly plastic or non-plastic.");
  return { verdict: "possible", risk: "Possible", reasons };
}

/**
 * Fill report section templates from verdict + context.
 * @param {object} ctx
 * @returns {MicroplasticReport}
 */
export function buildReport(ctx) {
  const {
    displayName,
    brand = "",
    mapping,
    ecoscoreGrade = "",
    ingredientsText = "",
    categories = "",
    categoriesTags = [],
    sourceLabel,
    extraEvidence = [],
    confidenceNote = "",
    isExample = false,
    templateOverrides = null,
    foodContext = null,
    confidenceInput = null,
    imageUrl = "",
    productCode = "",
  } = ctx;

  const { verdict, risk, reasons } = mapping;

  const evidence = [
    ...reasons,
    ...extraEvidence,
      ecoscoreGrade && ecoscoreGrade !== "unknown"
        ? `Green Score: ${String(ecoscoreGrade).toUpperCase()}`
        : null,
    ingredientsText
      ? "Ingredient list present (food contact / processing context only — not a microplastic assay)."
      : null,
  ].filter(Boolean);

  const confidence = computeConfidence({
    ...(confidenceInput || {}),
    verdict: templateOverrides?.containsPlastic ?? verdict,
    mappingReasons: reasons,
    extraEvidence,
    isExample,
    customNote:
      templateOverrides?.confidenceNote || confidenceNote || "",
    ecoscoreGrade:
      confidenceInput?.ecoscoreGrade ?? ecoscoreGrade,
    categories: confidenceInput?.categories ?? categories,
    categoriesTags: confidenceInput?.categoriesTags ?? categoriesTags,
    nutriscoreGrade:
      confidenceInput?.nutriscoreGrade ||
      foodContext?.nutri?.grade ||
      "",
    novaGroup:
      confidenceInput?.novaGroup || foodContext?.nova?.group || "",
  });

  const noteText =
    templateOverrides?.confidenceNote ||
    confidenceNote ||
    confidence.summary ||
    defaultConfidence(verdict);

  if (templateOverrides) {
    return {
      displayName,
      brand,
      containsPlastic: templateOverrides.containsPlastic ?? verdict,
      containsPlasticLabel:
        templateOverrides.containsPlasticLabel ?? plasticLabel(verdict),
      risk: templateOverrides.risk ?? risk,
      riskSummary: templateOverrides.riskSummary,
      betterAlternatives: templateOverrides.betterAlternatives,
      howLongItLasts: templateOverrides.howLongItLasts,
      environmentalImpact: templateOverrides.environmentalImpact,
      potentialImpact: templateOverrides.potentialImpact,
      funFact: templateOverrides.funFact,
      sourceLabel,
      evidence,
      confidenceNote: noteText,
      confidence,
      isExample,
      foodContext: foodContext || templateOverrides.foodContext || null,
      imageUrl: imageUrl || "",
      productCode: productCode || "",
      categories: categories || "",
      categoriesTags: categoriesTags || [],
    };
  }

  return {
    displayName,
    brand,
    containsPlastic: verdict,
    containsPlasticLabel: plasticLabel(verdict),
    risk,
    riskSummary: riskSummaryFor(risk, displayName),
    betterAlternatives: alternativesFor(verdict, risk, displayName, categories),
    howLongItLasts: longevityFor(verdict, risk),
    environmentalImpact: environmentFor(verdict, risk, ecoscoreGrade),
    potentialImpact: potentialImpactFor(verdict, risk),
    funFact: funFactFor(verdict, risk, displayName),
    sourceLabel,
    evidence,
    confidenceNote: noteText,
    confidence,
    isExample,
    foodContext,
    imageUrl: imageUrl || "",
    productCode: productCode || "",
    categories: categories || "",
    categoriesTags: categoriesTags || [],
  };
}

function plasticLabel(verdict) {
  switch (verdict) {
    case "yes":
      return "Likely contains plastic packaging";
    case "no":
      return "No plastic packaging indicated";
    case "possible":
      return "Possible plastic packaging";
    default:
      return "Unknown — not enough packaging data";
  }
}

function defaultConfidence(verdict) {
  if (verdict === "yes" || verdict === "no") {
    return "Based on packaging tags/text and category rules on this site. Not a laboratory microplastic measurement.";
  }
  return "Honest uncertainty: packaging data is missing or ambiguous. Prefer reusable/unpackaged options when unsure.";
}

function riskSummaryFor(risk, name) {
  const n = name || "This item";
  switch (risk) {
    case "Low":
      return `${n}: low microplastic exposure risk from packaging when bought unpackaged or in non-plastic materials.`;
    case "Medium":
      return `${n}: moderate packaging-related microplastic risk — plastic is present but less film-heavy than typical snack bags.`;
    case "High":
      return `${n}: higher packaging-related microplastic risk — common plastic or multilayer film packaging.`;
    case "Possible":
      return `${n}: possible plastic packaging — treat as a caution, not a confirmed lab result.`;
    default:
      return `${n}: risk unknown until packaging materials are identified.`;
  }
}

function alternativesFor(verdict, risk, name, categories) {
  if (verdict === "no" || risk === "Low") {
    return "Keep choosing loose produce or items in glass, paper, or metal. Bring a reusable bag; skip cling film at home when possible.";
  }
  if (textHasAny(name + " " + categories, ["chip", "crisp", "snack"])) {
    return "Try homemade oven chips in a reusable container, bulk popcorn in paper, or snacks from a deli counter into your own box. Avoid single-use metallized bags when you can.";
  }
  if (textHasAny(name, ["bottle", "water"])) {
    return "Use a reusable bottle and tap or filtered water. If you need single-serve, prefer glass returnables where available.";
  }
  return "Prefer unpackaged, refill, or glass/metal/paper packaging. Reduce single-use plastic film and sachets.";
}

function longevityFor(verdict, risk) {
  if (verdict === "no" || risk === "Low") {
    return "Unprocessed produce and paper/glass packaging don’t leave plastic fragments the way plastic film does. Food itself biodegrades on normal timescales; keep peels in compost where accepted.";
  }
  if (risk === "High") {
    return "Conventional plastics in snack bags and bottles can persist for decades to centuries in the environment, breaking into smaller microplastics rather than truly disappearing.";
  }
  if (risk === "Possible" || risk === "Unknown") {
    return "If the packaging is plastic, fragments can persist for many decades. If it is paper/glass/metal, persistence is much lower for the packaging material itself.";
  }
  return "Mixed or lighter plastic packaging still fragments slowly; expect long environmental lifetimes compared with organic waste.";
}

function environmentFor(verdict, risk, ecoscore) {
  const eco =
    ecoscore && ecoscore !== "unknown"
      ? ` Green Score ${String(ecoscore).toUpperCase()} (broader environmental footprint, not microplastics alone).`
      : "";
  if (verdict === "no" || risk === "Low") {
    return `Lower packaging plastic burden when sold loose or in non-plastic materials.${eco}`;
  }
  if (risk === "High") {
    return `Film bags and PET bottles contribute to litter and microplastic pathways if not recycled properly; multilayer snack films are often hard to recycle.${eco}`;
  }
  return `Packaging may add plastic waste and fragmentation risk depending on material and disposal.${eco}`;
}

function potentialImpactFor(verdict, risk) {
  if (verdict === "no" || risk === "Low") {
    return "Main gains are avoided packaging waste and lower chance of plastic fragments entering soil/water from this purchase. Diet quality is separate from packaging risk.";
  }
  if (risk === "High") {
    return "Potential pathways include packaging abrasion, heat, and litter → environmental microplastics. Food-contact transfer is an active research area; this tool flags packaging risk, not a personal exposure dose.";
  }
  return "Potential impact is uncertain without clear materials. Reducing single-use plastic remains a robust precaution while science on food-contact microplastics continues.";
}

function funFactFor(verdict, risk, name) {
  if (textHasAny(name, ["apple"])) {
    return "An apple’s “packaging” is its peel — no barcode required for a low-plastic snack.";
  }
  if (textHasAny(name, ["chip", "crisp"])) {
    return "Many chip bags are multilayer plastic + aluminum — great for shelf life, tough for recycling.";
  }
  if (risk === "Low") {
    return "Buying loose produce is one of the simplest everyday ways to skip plastic film.";
  }
  if (risk === "High") {
    return "Microplastics are plastic pieces smaller than 5 mm — often from larger items breaking down, not only from fancy lab sources.";
  }
  return "Product databases are volunteer-filled: packaging details are sometimes empty, which is why this checker can say “Unknown” on purpose.";
}

/**
 * Build a report from normalized OFF product evidence.
 * @param {import('./off-api.js').normalizeOffProduct extends Function ? any : object} normalized
 */
export function reportFromOffProduct(normalized) {
  const mapping = mapPackagingToPlastic({
    packagingText: normalized.packagingText,
    packagingTags: normalized.packagingTags,
    categoriesTags: normalized.categoriesTags,
    categories: normalized.categories,
    name: normalized.name,
  });

  const evidence = [];
  if (normalized.packagingText) {
    evidence.push(`Packaging text: ${normalized.packagingText}`);
  }
  if (normalized.packagingTags?.length) {
    evidence.push(`Packaging tags: ${normalized.packagingTags.slice(0, 8).join(", ")}`);
  }
  if (normalized.categories) {
    evidence.push(`Categories: ${normalized.categories}`);
  }

  return buildReport({
    displayName: normalized.name,
    brand: normalized.brand,
    mapping,
    ecoscoreGrade: normalized.ecoscoreGrade,
    ingredientsText: normalized.ingredientsText,
    categories: normalized.categories,
    categoriesTags: normalized.categoriesTags || [],
    sourceLabel: normalized.code
      ? `Product data · code ${normalized.code}`
      : "Product data from the food database",
    extraEvidence: evidence,
    foodContext: buildFoodContext(normalized),
    imageUrl: normalized.imageUrl || normalized.imageUrlSmall || "",
    productCode: normalized.code || "",
    confidenceInput: {
      source: "open_food_facts",
      hasBarcode: Boolean(normalized.code),
      packagingText: normalized.packagingText || "",
      packagingTags: normalized.packagingTags || [],
      packagingMaterialsTags: normalized.packagingMaterialsTags || [],
      packagings: normalized.packagings || [],
      categories: normalized.categories || "",
      categoriesTags: normalized.categoriesTags || [],
      nutriscoreGrade: normalized.nutriscoreGrade || "",
      novaGroup: normalized.novaGroup || "",
      ecoscoreGrade: normalized.ecoscoreGrade || "",
    },
  });
}

/**
 * Build from a local fallback / example definition.
 * @param {object} item
 */
export function reportFromLocalItem(item) {
  const mapping = item.mapping ||
    mapPackagingToPlastic({
      packagingText: item.packagingText || "",
      packagingTags: item.packagingTags || [],
      categoriesTags: item.categoriesTags || [],
      categories: item.categories || "",
      name: item.name,
    });

  let foodContext = item.foodContext || null;
  if (!foodContext && item.isExample) {
    const key = String(item.name || "").toLowerCase();
    if (key.includes("apple")) foodContext = exampleFoodContext("fresh apple");
    else if (key.includes("chip") || key.includes("crisp")) {
      foodContext = exampleFoodContext("potato chips");
    }
  }
  if (!foodContext && (item.nutriscoreGrade || item.novaGroup || item.packagings)) {
    foodContext = buildFoodContext({
      nutriscore_grade: item.nutriscoreGrade,
      nova_group: item.novaGroup,
      nova_groups_markers: item.novaMarkers,
      packaging: item.packagingText,
      packaging_materials_tags: item.packagingMaterialsTags || [],
      packagings: item.packagings || [],
      ecoscore_grade: item.ecoscoreGrade,
    });
  }

  const sourceKind =
    item.confidenceSource ||
    (item.isExample ? "local_example" : "local_fallback");

  return buildReport({
    displayName: item.name,
    brand: item.brand || "",
    mapping,
    ecoscoreGrade: item.ecoscoreGrade || "",
    ingredientsText: item.ingredientsText || "",
    categories: item.categories || "",
    categoriesTags: item.categoriesTags || [],
    sourceLabel: item.sourceLabel || "General estimate",
    extraEvidence: item.evidence || [],
    confidenceNote: item.confidenceNote,
    isExample: Boolean(item.isExample),
    templateOverrides: item.report || null,
    foodContext,
    imageUrl: item.imageUrl || "",
    productCode: item.code || "",
    confidenceInput: {
      source: sourceKind,
      hasBarcode: false,
      packagingText: item.packagingText || "",
      packagingTags: item.packagingTags || [],
      packagingMaterialsTags: item.packagingMaterialsTags || [],
      packagings: item.packagings || [],
      categories: item.categories || "",
      categoriesTags: item.categoriesTags || [],
      nutriscoreGrade: item.nutriscoreGrade || foodContext?.nutri?.grade || "",
      novaGroup: item.novaGroup || foodContext?.nova?.group || "",
      ecoscoreGrade: item.ecoscoreGrade || "",
    },
  });
}
