/**
 * Open Food Facts client.
 * All OFF traffic goes through a proxy:
 *   - local: python server.py (/api/off/*)
 *   - production: Cloudflare Worker (set API_BASE in config.js)
 * Do not open this site via plain http.server or file:// without a proxy.
 */

import { searchLimiter, productLimiter } from "./rate-limit.js";
import { API_BASE } from "./config.js";

/** @param {string} path e.g. "/api/health" */
function apiUrl(path) {
  const base = String(API_BASE || "").replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export const OFF_USER_AGENT =
  "MicroplasticChecker/1.0 (educational; contact=local-dev@example.com)";

const SEARCH_FIELDS = [
  "code",
  "product_name",
  "brands",
  "packaging",
  "packaging_tags",
  "packaging_materials_tags",
  "packaging_text",
  "packagings",
  "product_quantity",
  "product_quantity_unit",
  "quantity",
  "ingredients_text",
  "categories",
  "categories_tags",
  "ecoscore_grade",
  "nutriscore_grade",
  "nutrition_grades",
  "nova_group",
  "nova_groups",
  "nova_groups_markers",
  "image_front_url",
  "image_front_small_url",
  "image_url",
  "image_small_url",
  "selected_images",
].join(",");

/**
 * @typedef {object} OffProduct
 * @property {string} [code]
 * @property {string} [product_name]
 * @property {string} [brands]
 * @property {string} [packaging]
 * @property {string[]} [packaging_tags]
 * @property {string[]} [packaging_materials_tags]
 * @property {string} [packaging_text]
 * @property {string} [ingredients_text]
 * @property {string} [categories]
 * @property {string[]} [categories_tags]
 * @property {string} [ecoscore_grade]
 * @property {string} [nutriscore_grade]
 * @property {string} [nutrition_grades]
 * @property {number|string} [nova_group]
 * @property {string} [nova_groups]
 * @property {object} [nova_groups_markers]
 * @property {object[]} [packagings]
 * @property {string} [image_front_url]
 * @property {string} [image_front_small_url]
 */

/**
 * @param {number} waitMs
 * @param {"search"|"product"} kind
 */
function rateLimitError(waitMs, kind) {
  const sec = Math.ceil(waitMs / 1000);
  const err = new Error(
    `Too many searches right now — please wait about ${sec}s and try again.`
  );
  err.name = "RateLimitError";
  err.waitMs = waitMs;
  return err;
}

const PROXY_HINT =
  "Product search is temporarily unavailable. You can still try an example or a general estimate.";

/**
 * @param {Response} res
 */
async function readJson(res) {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) {
    const err = new Error(
      "Product search is temporarily unavailable. Please try again shortly."
    );
    err.name = "ProxyMissingError";
    throw err;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("Product search returned an unexpected response.");
  }
}

/** @returns {Promise<boolean>} */
export async function proxyIsHealthy() {
  try {
    const res = await fetch(apiUrl("/api/health"), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.ok && data.proxy);
  } catch {
    return false;
  }
}

/**
 * Full-text search via local proxy.
 * Call only on explicit user submit — never search-as-you-type.
 * @param {string} query
 * @param {{ pageSize?: number }} [opts]
 * @returns {Promise<OffProduct[]>}
 */
export async function searchProducts(query, opts = {}) {
  const pageSize = opts.pageSize ?? 5;
  const wait = searchLimiter.waitMs();
  if (wait > 0) throw rateLimitError(wait, "search");

  if (!(await proxyIsHealthy())) {
    const err = new Error(PROXY_HINT);
    err.name = "ProxyMissingError";
    throw err;
  }

  const params = new URLSearchParams({
    q: query.trim(),
    page_size: String(pageSize),
  });

  const url = apiUrl(`/api/off/search?${params}`);
  searchLimiter.record();

  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    const err = new Error(PROXY_HINT);
    err.name = "ProxyMissingError";
    throw err;
  }

  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(data.error || `Search failed (${res.status}).`);
  }

  const products = Array.isArray(data.products) ? data.products : [];
  return products.filter((p) => p && (p.product_name || p.code));
}

/**
 * Fetch a single product by barcode (packaging fields, etc.).
 * @param {string} barcode
 * @returns {Promise<OffProduct|null>}
 */
export async function getProduct(barcode) {
  const wait = productLimiter.waitMs();
  if (wait > 0) throw rateLimitError(wait, "product");

  const code = encodeURIComponent(String(barcode).trim());
  const url = apiUrl(
    `/api/off/product/${code}?fields=${encodeURIComponent(SEARCH_FIELDS)}`
  );
  productLimiter.record();

  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    return null;
  }

  try {
    const data = await readJson(res);
    if (!res.ok) return null;
    if (data.status !== 1 || !data.product) return null;
    return data.product;
  } catch {
    return null;
  }
}

/**
 * Enrich a search hit with packaging + Nutri-Score / NOVA / packagings.
 * Always tries a product read when a barcode exists (search hits are sparse).
 * Failures are ignored — search hit + local rules still produce a report.
 * @param {OffProduct} product
 * @returns {Promise<OffProduct>}
 */
export async function enrichProduct(product) {
  if (!product?.code) return product;

  try {
    const full = await getProduct(product.code);
    if (!full) return product;
    return {
      ...product,
      ...full,
      product_name: full.product_name || product.product_name,
      brands: full.brands || product.brands,
      image_front_url:
        full.image_front_url ||
        full.image_url ||
        product.image_front_url ||
        product.image_url,
      image_front_small_url:
        full.image_front_small_url ||
        full.image_small_url ||
        product.image_front_small_url ||
        product.image_small_url,
      selected_images: full.selected_images || product.selected_images,
    };
  } catch {
    return product;
  }
}

/**
 * Score how complete an OFF product record is (higher = more useful for our report).
 * Prefers items with packaging parts, Nutri-Score, NOVA, Green Score, etc.
 * @param {OffProduct} product
 * @returns {number}
 */
export function scoreProductCompleteness(product) {
  if (!product) return 0;
  let score = 0;

  if (product.product_name) score += 4;
  if (product.brands) score += 4;
  if (product.code) score += 3;

  if (product.image_front_url || product.image_front_small_url) score += 6;
  if (product.ingredients_text) score += 8;

  const cats = product.categories_tags || [];
  if (product.categories || cats.length) score += 5;

  const nutri = String(
    product.nutriscore_grade || product.nutrition_grades || ""
  ).toLowerCase();
  if (nutri && !["", "unknown", "not-applicable", "not_applicable"].includes(nutri)) {
    score += 16;
  }

  const nova = product.nova_group ?? product.nova_groups;
  if (nova !== undefined && nova !== null && String(nova).trim() !== "") {
    const n = Number(nova);
    if (!Number.isNaN(n) && n >= 1 && n <= 4) score += 14;
  }

  const eco = String(product.ecoscore_grade || "").toLowerCase();
  if (eco && !["", "unknown", "not-applicable", "not_applicable"].includes(eco)) {
    score += 16;
  }

  if (product.packaging || product.packaging_text) score += 8;
  if (Array.isArray(product.packaging_tags) && product.packaging_tags.length) {
    score += 8 + Math.min(4, product.packaging_tags.length);
  }
  if (
    Array.isArray(product.packaging_materials_tags) &&
    product.packaging_materials_tags.length
  ) {
    score += 10 + Math.min(4, product.packaging_materials_tags.length);
  }
  if (Array.isArray(product.packagings) && product.packagings.length) {
    score += 14 + Math.min(10, product.packagings.length * 3);
  }

  return score;
}

/**
 * Enrich several hits, then return them sorted richest-first.
 * @param {OffProduct[]} products
 * @returns {Promise<OffProduct[]>}
 */
export async function enrichAndRankProducts(products) {
  const list = Array.isArray(products) ? products : [];
  const enriched = await Promise.all(list.map((p) => enrichProduct(p)));
  return enriched
    .map((p) => ({ product: p, score: scoreProductCompleteness(p) }))
    .sort((a, b) => b.score - a.score || String(a.product.code).localeCompare(String(b.product.code)))
    .map((row) => row.product);
}

/**
 * OFF image hosts sometimes return http:// — prefer https for mixed-content safety.
 * @param {string} url
 */
export function preferHttps(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("http://")) return `https://${u.slice("http://".length)}`;
  return u;
}

/**
 * Best available product image URL (small preferred for thumbnails).
 * @param {OffProduct & Record<string, any>} product
 * @param {"small"|"large"} [size]
 */
export function resolveProductImage(product, size = "small") {
  if (!product) return "";
  const selected = product.selected_images?.front;
  const fromSelected =
    size === "large"
      ? selected?.display?.en || selected?.large?.en || selected?.small?.en
      : selected?.small?.en || selected?.thumb?.en || selected?.display?.en;

  const ordered =
    size === "large"
      ? [
          product.image_front_url,
          product.image_url,
          fromSelected,
          product.image_front_small_url,
          product.image_small_url,
        ]
      : [
          product.image_front_small_url,
          product.image_small_url,
          fromSelected,
          product.image_front_url,
          product.image_url,
        ];

  for (const candidate of ordered) {
    const url = preferHttps(candidate);
    if (url) return url;
  }
  return "";
}

/**
 * Normalize OFF / search product into evidence for the local processor.
 * @param {OffProduct} product
 */
export function normalizeOffProduct(product) {
  let brands = product.brands || "";
  if (Array.isArray(brands)) brands = brands.filter(Boolean).join(", ");

  const packagingTags = [
    ...(product.packaging_tags || []),
    ...(product.packaging_materials_tags || []),
  ].map((t) => String(t).toLowerCase());

  const imageUrl = resolveProductImage(product, "large");
  const imageUrlSmall = resolveProductImage(product, "small") || imageUrl;

  return {
    source: "open_food_facts",
    code: product.code || "",
    name: product.product_name || "Unknown product",
    brand: brands,
    packagingText: [product.packaging, product.packaging_text]
      .filter(Boolean)
      .join(" · "),
    packagingTags,
    packagingMaterialsTags: (product.packaging_materials_tags || []).map((t) =>
      String(t).toLowerCase()
    ),
    packagings: Array.isArray(product.packagings) ? product.packagings : [],
    productQuantity: product.product_quantity ?? "",
    productQuantityUnit: product.product_quantity_unit || "g",
    quantityLabel: product.quantity || "",
    ingredientsText: product.ingredients_text || "",
    categories: product.categories || "",
    categoriesTags: (product.categories_tags || []).map((t) =>
      String(t).toLowerCase()
    ),
    ecoscoreGrade: product.ecoscore_grade || "",
    nutriscoreGrade:
      product.nutriscore_grade || product.nutrition_grades || "",
    novaGroup: product.nova_group ?? product.nova_groups ?? "",
    novaMarkers: product.nova_groups_markers || {},
    imageUrl,
    imageUrlSmall,
    // Keep raw-ish fields for food-context builder
    nutriscore_grade:
      product.nutriscore_grade || product.nutrition_grades || "",
    nutrition_grades: product.nutrition_grades || "",
    nova_group: product.nova_group ?? product.nova_groups ?? "",
    nova_groups_markers: product.nova_groups_markers || {},
    packaging_materials_tags: product.packaging_materials_tags || [],
    packaging: product.packaging || "",
    product_quantity: product.product_quantity ?? "",
    product_quantity_unit: product.product_quantity_unit || "g",
    quantity: product.quantity || "",
  };
}
