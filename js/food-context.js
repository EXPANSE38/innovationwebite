/**
 * Food-context helpers from Open Food Facts fields.
 * Nutri-Score, NOVA, and packaging parts — shown alongside microplastic rules.
 * Labels follow OFF/public explanations; we only format data we received.
 */

const NUTRI_TEXT = {
  a: { title: "Nutri-Score A", summary: "Highest nutritional quality on the Nutri-Score scale." },
  b: { title: "Nutri-Score B", summary: "Good nutritional quality." },
  c: { title: "Nutri-Score C", summary: "Average nutritional quality." },
  d: { title: "Nutri-Score D", summary: "Lower nutritional quality." },
  e: { title: "Nutri-Score E", summary: "Lowest nutritional quality on the Nutri-Score scale." },
};

const NOVA_TEXT = {
  1: {
    title: "NOVA 1 — Unprocessed / minimally processed",
    summary: "Foods that are unprocessed or only lightly processed.",
  },
  2: {
    title: "NOVA 2 — Culinary ingredients",
    summary: "Ingredients used in cooking (oils, sugar, salt, etc.).",
  },
  3: {
    title: "NOVA 3 — Processed foods",
    summary: "Foods made by adding salt, sugar, or oil to NOVA 1 foods.",
  },
  4: {
    title: "NOVA 4 — Ultra-processed foods",
    summary: "Industrial formulations with additives and/or little whole food.",
  },
};

/** Green Score = Open Food Facts Eco-Score (same A–E letter). */
const GREEN_TEXT = {
  a: {
    title: "Green Score A",
    summary: "Very low environmental impact.",
  },
  b: {
    title: "Green Score B",
    summary: "Low environmental impact.",
  },
  c: {
    title: "Green Score C",
    summary: "Moderate environmental impact.",
  },
  d: {
    title: "Green Score D",
    summary: "High environmental impact.",
  },
  e: {
    title: "Green Score E",
    summary: "Very high environmental impact.",
  },
};

/**
 * @param {string} tag en:plastic → Plastic
 */
export function humanizeTag(tag) {
  if (!tag) return "";
  return String(tag)
    .replace(/^[a-z]{2}:/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Map OFF material tags to broad families (same buckets OFF’s packaging materials table uses).
 * @param {string} tag
 */
export function materialFamily(tag) {
  const raw = String(tag?.id || tag || "").toLowerCase();
  if (!raw || raw.includes("unknown")) return "";
  if (raw.includes("glass")) return "Glass";
  if (
    raw.includes("plastic") ||
    raw.includes("polypropylene") ||
    raw.includes("polyethylene") ||
    raw.includes("polyester") ||
    raw.includes("polystyrene") ||
    raw.includes("pet") ||
    raw.includes("hdpe") ||
    raw.includes("ldpe") ||
    raw.includes("pvc") ||
    raw.includes(":pp") ||
    raw.includes("pp-") ||
    raw.includes("o-7") ||
    /(^|[^a-z])pp([^a-z]|$)/.test(raw)
  ) {
    return "Plastic";
  }
  if (
    raw.includes("paper") ||
    raw.includes("cardboard") ||
    raw.includes("paperboard") ||
    raw.includes("carton") ||
    raw.includes("-pap") ||
    raw.includes(":pap") ||
    /pap\b/.test(raw)
  ) {
    return "Paper or cardboard";
  }
  if (
    raw.includes("aluminium") ||
    raw.includes("aluminum") ||
    raw.includes("steel") ||
    raw.includes("metal") ||
    raw.includes("tin") ||
    raw.includes("iron")
  ) {
    return "Metal";
  }
  return humanizeTag(raw);
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build OFF-style packaging materials rows from packagings[].weight_measured.
 * @param {object[]} packagings
 * @param {number|null} productQuantityG
 */
export function buildMaterialsTableFromPackagings(packagings, productQuantityG) {
  /** @type {Map<string, number>} */
  const byFamily = new Map();
  let hasAnyWeight = false;

  for (const part of packagings || []) {
    const materialId = part.material?.id || part.material || "";
    const family = materialFamily(materialId);
    if (!family) continue;

    const weight = toNumber(part.weight_measured);
    if (weight === null) continue;
    hasAnyWeight = true;
    byFamily.set(family, (byFamily.get(family) || 0) + weight);
  }

  if (!hasAnyWeight || byFamily.size === 0) return [];

  const totalWeight = [...byFamily.values()].reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return [];

  const rows = [...byFamily.entries()]
    .map(([material, weight]) => {
      const percent = (weight / totalWeight) * 100;
      const per100 =
        productQuantityG && productQuantityG > 0
          ? (weight / productQuantityG) * 100
          : null;
      return {
        material,
        percent: `${percent.toFixed(1)}%`,
        percentValue: percent,
        weight: `${formatWeight(weight)} g`,
        weightValue: weight,
        weightPer100:
          per100 === null ? "—" : `${formatWeight(per100)} g`,
        weightPer100Value: per100,
      };
    })
    .sort((a, b) => b.weightValue - a.weightValue);

  const totalPer100 =
    productQuantityG && productQuantityG > 0
      ? (totalWeight / productQuantityG) * 100
      : null;

  rows.push({
    material: "Total",
    percent: "100%",
    percentValue: 100,
    weight: `${formatWeight(totalWeight)} g`,
    weightValue: totalWeight,
    weightPer100:
      totalPer100 === null ? "—" : `${formatWeight(totalPer100)} g`,
    weightPer100Value: totalPer100,
    isTotal: true,
  });

  return rows;
}

/** @param {number} n */
function formatWeight(n) {
  if (Math.abs(n) >= 100) return n.toFixed(1).replace(/\.0$/, "");
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(1);
}

/**
 * @param {object} product raw OFF product or normalized-ish object
 */
export function buildFoodContext(product = {}) {
  const gradeRaw =
    product.nutriscore_grade ||
    product.nutrition_grades ||
    product.nutriScoreGrade ||
    "";
  const grade = String(gradeRaw || "")
    .toLowerCase()
    .replace(/[^a-e]/g, "");

  const novaRaw = product.nova_group ?? product.nova_groups ?? product.novaGroup;
  const nova = Number.parseInt(String(novaRaw || ""), 10);

  const markers = product.nova_groups_markers || product.novaMarkers || null;
  let markerCount = 0;
  let markerLabels = [];
  if (markers && typeof markers === "object") {
    const bucket = markers[String(nova)] || markers[nova] || [];
    if (Array.isArray(bucket)) {
      markerCount = bucket.length;
      markerLabels = bucket
        .map((m) => {
          if (Array.isArray(m) && m[1]) return humanizeTag(m[1]);
          if (typeof m === "string") return humanizeTag(m);
          return null;
        })
        .filter(Boolean)
        .slice(0, 8);
    }
  }

  const packagings = Array.isArray(product.packagings)
    ? product.packagings
    : Array.isArray(product.packagingParts)
      ? product.packagingParts
      : [];

  const parts = packagings.map((p) => {
    const shape = humanizeTag(p.shape?.id || p.shape || "");
    const material = humanizeTag(p.material?.id || p.material || "");
    const qty = p.quantity_per_unit || "";
    const units = p.number_of_units || 1;
    const contact = p.food_contact === 1 || p.food_contact === true;
    const recycling = humanizeTag(p.recycling?.id || p.recycling || "");
    const bits = [
      `${units} × ${shape || "part"}`,
      qty ? `(${qty})` : null,
      material ? material : null,
      contact ? "in contact with food" : null,
      recycling ? `recycling: ${recycling}` : null,
    ].filter(Boolean);
    return {
      label: bits.join(" — "),
      material: material || "Unknown",
      shape: shape || "Unknown",
      foodContact: contact,
    };
  });

  const materialTags = [
    ...new Set(
      [...(product.packaging_materials_tags || [])].map((t) => String(t))
    ),
  ];

  const productQuantityG = toNumber(
    product.product_quantity ?? product.productQuantity
  );

  // Prefer weight-based materials table (matches Open Food Facts packaging materials).
  let materialsTable = buildMaterialsTableFromPackagings(
    packagings,
    productQuantityG
  );

  // Fallback: unique material list without inventing percentages
  if (!materialsTable.length) {
    const names = [
      ...new Set(
        [
          ...materialTags.map((t) => materialFamily(t) || humanizeTag(t)),
          ...parts.map((p) => materialFamily(p.material) || p.material),
        ].filter(Boolean)
      ),
    ];
    if (names.length === 1) {
      materialsTable = [
        {
          material: names[0],
          percent: "100%",
          weight: "—",
          weightPer100: "—",
        },
      ];
    } else if (names.length > 1) {
      materialsTable = names.map((m) => ({
        material: m,
        percent: "—",
        weight: "—",
        weightPer100: "—",
        note: "Weights not listed for this product",
      }));
    }
  }

  const packagingText =
    product.packaging ||
    product.packagingText ||
    parts.map((p) => p.label).join("; ") ||
    "";

  const hasPlastic = [
    ...materialTags.map((t) => materialFamily(t)),
    packagingText,
    ...parts.map((p) => p.material),
  ]
    .join(" ")
    .toLowerCase()
    .includes("plastic");

  let packagingImpact = {
    level: "unknown",
    label: "Packaging impact unknown",
    detail: "Little structured packaging data is available for this product.",
  };
  if (parts.length || materialTags.length || packagingText) {
    if (hasPlastic && (materialTags.length > 1 || parts.length > 1)) {
      packagingImpact = {
        level: "medium",
        label: "Packaging with a medium impact",
        detail: "Mixed or plastic-containing packaging is recorded for this product.",
      };
    } else if (hasPlastic) {
      packagingImpact = {
        level: "medium",
        label: "Packaging with a medium impact",
        detail: "Plastic packaging materials are listed.",
      };
    } else {
      packagingImpact = {
        level: "low",
        label: "Packaging with a lower plastic focus",
        detail: "Listed materials look non-plastic (e.g. glass, paper, metal) — still check lids/films.",
      };
    }
  }

  const nutri = grade && NUTRI_TEXT[grade]
    ? { grade, ...NUTRI_TEXT[grade], available: true }
    : {
        grade: "",
        title: "Nutri-Score unknown",
        summary: "No Nutri-Score available for this product.",
        available: false,
      };

  const novaInfo =
    nova >= 1 && nova <= 4 && NOVA_TEXT[nova]
      ? {
          group: nova,
          ...NOVA_TEXT[nova],
          markerCount,
          markerLabels,
          available: true,
        }
      : {
          group: null,
          title: "NOVA group unknown",
          summary: "No NOVA processing group available for this product.",
          markerCount: 0,
          markerLabels: [],
          available: false,
        };

  const ecoRaw =
    product.ecoscore_grade ||
    product.ecoscoreGrade ||
    product.green_score_grade ||
    "";
  const ecoGrade = String(ecoRaw || "")
    .toLowerCase()
    .replace(/[^a-e]/g, "");
  const green =
    ecoGrade && GREEN_TEXT[ecoGrade]
      ? { grade: ecoGrade, ...GREEN_TEXT[ecoGrade], available: true }
      : {
          grade: "",
          title: "Green Score unknown",
          summary:
            "No Green Score available for this product.",
          available: false,
        };

  const available =
    nutri.available ||
    novaInfo.available ||
    green.available ||
    parts.length > 0 ||
    materialsTable.length > 0 ||
    Boolean(packagingText);

  return {
    available,
    nutri,
    nova: novaInfo,
    green,
    packagingImpact,
    packagingParts: parts,
    materialsTable,
    packagingText,
    ecoscoreGrade: green.available ? green.grade : "",
  };
}

/**
 * Built-in example food context (educational, not from a live OFF call).
 */
export function exampleFoodContext(kind) {
  if (kind === "fresh apple") {
    return buildFoodContext({
      nutriscore_grade: "a",
      nova_group: 1,
      ecoscore_grade: "a",
      packaging: "unpackaged",
      packaging_materials_tags: [],
      packagings: [],
    });
  }
  if (kind === "potato chips") {
    return buildFoodContext({
      nutriscore_grade: "c",
      nova_group: 4,
      ecoscore_grade: "d",
      nova_groups_markers: {
        4: [
          ["additives", "en:flavouring"],
          ["ingredients", "en:vegetable-oil"],
        ],
      },
      packaging: "Plastic bag",
      packaging_materials_tags: ["en:plastic"],
      product_quantity: 160,
      packagings: [
        {
          shape: "en:bag",
          material: "en:plastic",
          number_of_units: 1,
          quantity_per_unit: "160 g",
          food_contact: 1,
          recycling: "en:discard",
          weight_measured: 8,
        },
      ],
    });
  }
  return buildFoodContext({});
}
