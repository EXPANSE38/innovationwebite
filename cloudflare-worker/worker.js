/**
 * Microplastic Checker — Open Food Facts proxy (Cloudflare Worker)
 * Same routes as local server.py:
 *   GET /api/health
 *   GET /api/off/search?q=&page_size=
 *   GET /api/off/product/{code}?fields=
 *
 * Deploy: Cloudflare Dashboard → Workers & Pages → Create → paste this file.
 */

const USER_AGENT =
  "MicroplasticChecker/1.0 (educational; contact=local-dev@example.com)";

const SEARCH_ALICIOUS = "https://search.openfoodfacts.org/search";
const SEARCH_CGI = "https://world.openfoodfacts.org/cgi/search.pl";
const PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json";

const FIELDS = [
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

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== "GET") {
      return json(405, { error: "Method not allowed" }, request);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/api/health" || path === "/health") {
        return json(
          200,
          { ok: true, service: "MicroplasticChecker", proxy: true },
          request
        );
      }

      if (path === "/api/off/search" || path === "/off/search") {
        return handleSearch(url, request);
      }

      const productMatch = path.match(
        /^\/(?:api\/)?off\/product\/([^/]+)$/
      );
      if (productMatch) {
        return handleProduct(decodeURIComponent(productMatch[1]), url, request);
      }

      if (path.startsWith("/api/") || path.startsWith("/off/")) {
        return json(404, { error: `Unknown API route: ${path}` }, request);
      }

      return json(
        200,
        {
          ok: true,
          service: "MicroplasticChecker",
          hint: "Use /api/health, /api/off/search?q=, /api/off/product/{code}",
        },
        request
      );
    } catch (err) {
      return json(
        502,
        { error: err?.message || "Proxy error", products: [] },
        request
      );
    }
  },
};

async function handleSearch(url, request) {
  const q = (url.searchParams.get("q") || url.searchParams.get("search_terms") || "")
    .trim();
  const pageSize = url.searchParams.get("page_size") || "5";

  if (!q) {
    return json(400, { error: "Missing q", products: [] }, request);
  }

  // Barcode shortcut
  if (/^\d{8,}$/.test(q)) {
    const data = await offGetJson(
      `${PRODUCT_URL.replace("{code}", encodeURIComponent(q))}?fields=${encodeURIComponent(FIELDS)}`
    );
    if (data && data.status === 1 && data.product) {
      return json(
        200,
        {
          count: 1,
          products: [normalizeHit(data.product)],
          source: "openfoodfacts-product",
        },
        request
      );
    }
  }

  const { products: alicious, error: err1 } = await searchAlicious(q, pageSize);
  if (alicious.length) {
    return json(
      200,
      {
        count: alicious.length,
        products: alicious,
        source: "search.openfoodfacts.org",
      },
      request
    );
  }

  const { products: cgi, error: err2 } = await searchCgi(q, pageSize);
  if (cgi.length) {
    return json(
      200,
      {
        count: cgi.length,
        products: cgi,
        source: "cgi/search.pl",
      },
      request
    );
  }

  return json(
    502,
    {
      error: `Open Food Facts search overloaded or unavailable. (${err1 || ""} | ${err2 || ""})`.trim(),
      products: [],
    },
    request
  );
}

async function handleProduct(code, url, request) {
  const clean = String(code || "").trim();
  if (!clean) {
    return json(400, { status: 0, error: "Missing code" }, request);
  }

  const fields = url.searchParams.get("fields") || FIELDS;
  const productUrl = `${PRODUCT_URL.replace("{code}", encodeURIComponent(clean))}?fields=${encodeURIComponent(fields)}`;
  const data = await offGetJson(productUrl);

  if (!data) {
    return json(
      502,
      { status: 0, error: "Product read failed" },
      request
    );
  }

  return json(200, data, request);
}

async function searchAlicious(q, pageSize) {
  const params = new URLSearchParams({
    q,
    page_size: String(pageSize),
    fields: FIELDS,
  });
  const data = await offGetJson(`${SEARCH_ALICIOUS}?${params}`);
  if (!data) {
    return { products: [], error: "search.openfoodfacts.org unavailable" };
  }
  const hits = data.hits || [];
  const products = hits
    .map(normalizeHit)
    .filter((p) => p.product_name || p.code);
  return { products, error: null };
}

async function searchCgi(q, pageSize) {
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(pageSize),
    fields: FIELDS,
  });
  const data = await offGetJson(`${SEARCH_CGI}?${params}`);
  if (!data) {
    return { products: [], error: "cgi/search.pl unavailable" };
  }
  const products = (data.products || [])
    .map(normalizeHit)
    .filter((p) => p.product_name || p.code);
  return { products, error: null };
}

async function offGetJson(url, attempts = 3) {
  let lastDetail = "no response";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });
      const text = await res.text();
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith("<")) {
        lastDetail = `HTML/non-JSON (HTTP ${res.status})`;
      } else {
        try {
          const data = JSON.parse(trimmed);
          if (res.ok) return data;
          lastDetail = `HTTP ${res.status}`;
        } catch {
          lastDetail = `Invalid JSON (HTTP ${res.status})`;
        }
      }
    } catch (err) {
      lastDetail = err?.message || "fetch failed";
    }
    if (i < attempts - 1) {
      await sleep(700 * (i + 1));
    }
  }
  console.log("offGetJson failed:", lastDetail, url);
  return null;
}

function pickImageUrl(hit) {
  let small =
    hit.image_front_small_url ||
    hit.image_small_url ||
    hit.image_thumb_url ||
    "";
  let large = hit.image_front_url || hit.image_url || small || "";

  const selected = hit.selected_images || {};
  const front = selected.front;
  if (front && typeof front === "object") {
    small =
      front.small?.en || front.thumb?.en || small;
    large =
      front.display?.en || front.large?.en || large || small;
  }

  if (typeof small === "string" && small.startsWith("http://")) {
    small = "https://" + small.slice("http://".length);
  }
  if (typeof large === "string" && large.startsWith("http://")) {
    large = "https://" + large.slice("http://".length);
  }
  return { large: String(large || ""), small: String(small || large || "") };
}

function normalizeHit(hit) {
  let brands = hit.brands;
  if (Array.isArray(brands)) {
    brands = brands.filter(Boolean).join(", ");
  } else if (brands == null) {
    brands = "";
  }

  const { large, small } = pickImageUrl(hit);

  return {
    code: String(hit.code || ""),
    product_name: hit.product_name || "",
    brands,
    packaging: hit.packaging || "",
    packaging_tags: hit.packaging_tags || [],
    packaging_materials_tags: hit.packaging_materials_tags || [],
    packaging_text: hit.packaging_text || "",
    ingredients_text: hit.ingredients_text || "",
    categories: hit.categories || "",
    categories_tags: hit.categories_tags || [],
    ecoscore_grade: hit.ecoscore_grade || "",
    nutriscore_grade: hit.nutriscore_grade || hit.nutrition_grades || "",
    nutrition_grades: hit.nutrition_grades || "",
    nova_group: hit.nova_group || hit.nova_groups || "",
    nova_groups: hit.nova_groups || "",
    nova_groups_markers: hit.nova_groups_markers || {},
    packagings: hit.packagings || [],
    product_quantity: hit.product_quantity || "",
    product_quantity_unit: hit.product_quantity_unit || "",
    quantity: hit.quantity || "",
    image_front_url: large,
    image_front_small_url: small,
    selected_images: hit.selected_images || undefined,
  };
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status, payload, request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
