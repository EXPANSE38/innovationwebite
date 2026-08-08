/**
 * Confidence Score System + Evidence Panel 2.0 signals.
 * Scores how complete/reliable the packaging evidence is — not lab certainty.
 */
/**
 * @typedef {"High"|"Medium"|"Low"} ConfidenceLevel
 *
 * @typedef {object} ConfidenceFactor
 * @property {string} id
 * @property {string} label
 * @property {number} points
 * @property {number} max
 * @property {boolean} present
 * @property {string} detail
 *
 * @typedef {object} EvidenceDriver
 * @property {"supporting"|"gap"|"note"} kind
 * @property {string} text
 *
 * @typedef {object} ConfidenceResult
 * @property {number} score
 * @property {ConfidenceLevel} level
 * @property {string} label
 * @property {string} summary
 * @property {string} note
 * @property {ConfidenceFactor[]} factors
 * @property {EvidenceDriver[]} drivers
 * @property {string[]} used
 * @property {string[]} missing
 */
/**
 * @param {object} input
 * @returns {ConfidenceResult}
 */
export function computeConfidence(input = {}) {
  const {
    source = "local_unknown",
    hasBarcode = false,
    packagingText = "",
    packagingTags = [],
    packagingMaterialsTags = [],
    packagings = [],
    categories = "",
    categoriesTags = [],
    nutriscoreGrade = "",
    novaGroup = "",
    ecoscoreGrade = "",
    verdict = "unknown",
    mappingReasons = [],
    extraEvidence = [],
    isExample = false,
    customNote = "",
  } = input;
  const factors = [];
  const used = [];
  const missing = [];
  const drivers = [];
  // --- 1) Data source (max 25) ---
  let sourcePoints = 0;
  let sourceDetail = "";
  if (source === "open_food_facts" && hasBarcode) {
    sourcePoints = 25;
    sourceDetail = "Matched a specific product in the food database.";
    used.push("Product match with barcode");
  } else if (source === "open_food_facts") {
    sourcePoints = 18;
    sourceDetail = "Matched from a product search.";
    used.push("Product search match");
    missing.push("Full product record with barcode details");
  } else if (source === "local_example" || isExample) {
    sourcePoints = 22;
    sourceDetail = "Sample example report for learning.";
    used.push("Example item profile");
  } else if (source === "local_fallback") {
    sourcePoints = 15;
    sourceDetail = "General estimate for a known item type.";
    used.push("Known item profile");
    missing.push("Exact product match from the food database");
  } else {
    sourcePoints = 5;
    sourceDetail = "General estimate — no specific product profile.";
    missing.push("Product database match");
    missing.push("Known item profile");
  }
  factors.push({
    id: "source",
    label: "Data source",
    points: sourcePoints,
    max: 25,
    present: sourcePoints >= 15,
    detail: sourceDetail,
  });
  // --- 2) Packaging evidence (max 40) ---
  const hasStructured = Array.isArray(packagings) && packagings.length > 0;
  const hasMaterialTags =
    Array.isArray(packagingMaterialsTags) && packagingMaterialsTags.length > 0;
  const hasPackTags = Array.isArray(packagingTags) && packagingTags.length > 0;
  const hasPackText = Boolean(String(packagingText || "").trim());
  let packPoints = 0;
  const packBits = [];
  if (hasStructured) {
    packPoints += 18;
    packBits.push(`${packagings.length} structured packaging part(s)`);
    used.push("Structured packagings (parts/materials)");
  } else {
    missing.push("Structured packaging parts");
  }
  if (hasMaterialTags) {
    packPoints += 12;
    packBits.push(`material tags: ${packagingMaterialsTags.slice(0, 4).join(", ")}`);
    used.push("Packaging material tags");
  } else {
    missing.push("Packaging material tags");
  }
  if (hasPackTags) {
    packPoints += 10;
    packBits.push(`packaging tags (${packagingTags.length})`);
    used.push("Packaging tags");
  } else {
    missing.push("Packaging tags");
  }
  if (hasPackText) {
    packPoints += 8;
    packBits.push("packaging text");
    used.push("Packaging text");
  } else {
    missing.push("Packaging text");
  }
  packPoints = Math.min(40, packPoints);
  factors.push({
    id: "packaging",
    label: "Packaging evidence",
    points: packPoints,
    max: 40,
    present: packPoints > 0,
    detail: packBits.length
      ? packBits.join("; ")
      : "No packaging fields available.",
  });
  // --- 3) Verdict clarity (max 20) ---
  const hasAnyPackaging = hasStructured || hasMaterialTags || hasPackTags || hasPackText;
  let verdictPoints = 0;
  let verdictDetail = "";
  if ((verdict === "yes" || verdict === "no") && hasAnyPackaging) {
    verdictPoints = 20;
    verdictDetail = `Clear ${verdict === "yes" ? "plastic" : "non-plastic"} verdict backed by packaging fields.`;
    used.push(`Plastic verdict: ${verdict}`);
  } else if (verdict === "yes" || verdict === "no") {
    verdictPoints = 10;
    verdictDetail = `Clear ${verdict} verdict from category/profile rules (limited packaging fields).`;
    used.push(`Plastic verdict: ${verdict} (category/profile)`);
  } else if (verdict === "possible") {
    verdictPoints = 6;
    verdictDetail = "Possible plastic — packaging ambiguous or inferred from category.";
    used.push("Plastic verdict: possible");
  } else {
    verdictPoints = 2;
    verdictDetail = "Unknown verdict — not enough material signals to classify.";
    missing.push("Classifiable packaging materials");
  }
  factors.push({
    id: "verdict",
    label: "Verdict clarity",
    points: verdictPoints,
    max: 20,
    present: verdictPoints >= 10,
    detail: verdictDetail,
  });
  // --- 4) Supporting context (max 15) ---
  let ctxPoints = 0;
  const ctxBits = [];
  const nutriOk = Boolean(
    String(nutriscoreGrade || "")
      .toLowerCase()
      .replace(/[^a-e]/g, "")
  );
  const novaNum = Number.parseInt(String(novaGroup || ""), 10);
  const novaOk = novaNum >= 1 && novaNum <= 4;
  const ecoOk =
    Boolean(ecoscoreGrade) && String(ecoscoreGrade).toLowerCase() !== "unknown";
  const catsOk =
    (Array.isArray(categoriesTags) && categoriesTags.length > 0) ||
    Boolean(String(categories || "").trim());
  if (nutriOk) {
    ctxPoints += 5;
    ctxBits.push(`Nutri-Score ${String(nutriscoreGrade).toUpperCase()}`);
    used.push("Nutri-Score");
  } else {
    missing.push("Nutri-Score");
  }
  if (novaOk) {
    ctxPoints += 5;
    ctxBits.push(`NOVA ${novaNum}`);
    used.push("NOVA group");
  } else {
    missing.push("NOVA group");
  }
  if (ecoOk) {
    ctxPoints += 3;
    ctxBits.push(`Green Score ${String(ecoscoreGrade).toUpperCase()}`);
    used.push("Green Score");
  } else {
    missing.push("Green Score");
  }
  if (catsOk) {
    ctxPoints += 2;
    ctxBits.push("categories");
    used.push("Categories");
  } else {
    missing.push("Categories");
  }
  ctxPoints = Math.min(15, ctxPoints);
  factors.push({
    id: "context",
    label: "Supporting food data",
    points: ctxPoints,
    max: 15,
    present: ctxPoints > 0,
    detail: ctxBits.length
      ? ctxBits.join(", ")
      : "No Nutri-Score / NOVA / Green Score / categories.",
  });
  const score = Math.min(
    100,
    Math.round(sourcePoints + packPoints + verdictPoints + ctxPoints)
  );
  const level = levelFromScore(score);
  const label = `${level} confidence (${score}%)`;
  for (const reason of mappingReasons || []) {
    if (reason) drivers.push({ kind: "supporting", text: String(reason) });
  }
  for (const e of extraEvidence || []) {
    if (e) drivers.push({ kind: "supporting", text: String(e) });
  }
  const missingUnique = [...new Set(missing)].slice(0, 8);
  const usedUnique = [...new Set(used)].slice(0, 10);
  for (const m of missingUnique.slice(0, 5)) {
    drivers.push({ kind: "gap", text: `Missing: ${m}` });
  }
  drivers.push({
    kind: "note",
    text:
      customNote ||
      "Educational estimate from packaging rules — not a laboratory microplastic measurement.",
  });
  const summary = summaryFor(level, score, verdict, hasAnyPackaging, source);
  return {
    score,
    level,
    label,
    summary,
    note:
      customNote ||
      "Based on available product and packaging data. Not a lab assay.",
    factors,
    drivers: dedupeDrivers(drivers),
    used: usedUnique,
    missing: missingUnique,
  };
}
/**
 * @param {number} score
 * @returns {ConfidenceLevel}
 */
export function levelFromScore(score) {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}
/**
 * @param {ConfidenceLevel} level
 * @param {number} score
 * @param {string} verdict
 * @param {boolean} hasPackaging
 * @param {string} source
 */
function summaryFor(level, score, verdict, hasPackaging, source) {
  if (level === "High") {
    return `Confidence ${score}%: packaging evidence is relatively complete and the plastic verdict is well supported.`;
  }
  if (level === "Medium") {
    if (!hasPackaging) {
      return `Confidence ${score}%: verdict leans on category or profile rules because packaging fields are thin.`;
    }
    return `Confidence ${score}%: some packaging data is present, but gaps remain — treat as a solid estimate, not certainty.`;
  }
  if (verdict === "unknown" || source === "local_unknown") {
    return `Confidence ${score}%: too little packaging data to trust a firm plastic call.`;
  }
  return `Confidence ${score}%: limited evidence — prefer barcode lookup or a clearer product match when you can.`;
}
/**
 * @param {EvidenceDriver[]} drivers
 */
function dedupeDrivers(drivers) {
  const seen = new Set();
  const out = [];
  for (const d of drivers) {
    const key = `${d.kind}:${d.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
