/**
 * Microplastic Checker — UI glue.
 * Flow: user submit → (optional local-only) → OFF search → local processor → render.
 */

import {
  searchProducts,
  normalizeOffProduct,
  enrichProduct,
  enrichAndRankProducts,
  resolveProductImage,
} from "./off-api.js";
import { reportFromOffProduct } from "./processor.js";
import {
  buildLocalReport,
  findLocalItem,
  prefersLocalOnly,
  normalizeQueryKey,
} from "./fallbacks.js";
import {
  shouldRecommendAlternatives,
  findAlternativeProducts,
} from "./alternatives.js";

const form = document.getElementById("check-form");
const itemInput = document.getElementById("item-input");
const imageInput = document.getElementById("image-input");
const imagePreviewName = document.getElementById("image-preview-name");
const checkBtn = document.getElementById("check-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status");
const candidatesSection = document.getElementById("candidates");
const candidateList = document.getElementById("candidate-list");
const useLocalBtn = document.getElementById("use-local-btn");
const resultsSection = document.getElementById("results");
const reportEl = document.getElementById("report");

/** @type {string} */
let lastQuery = "";

/** Bumps on each render so stale alternative fetches are ignored. */
let reportGeneration = 0;

/** @type {Map<string, import('./off-api.js').OffProduct>} */
const altProductByCode = new Map();

function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

function hideResults() {
  resultsSection.hidden = true;
  reportEl.innerHTML = "";
}

function hideCandidates() {
  candidatesSection.hidden = true;
  candidateList.innerHTML = "";
}

/**
 * @param {import('./processor.js').MicroplasticReport} report
 */
function renderReport(report) {
  hideCandidates();
  resultsSection.hidden = false;

  const plasticClass = `plastic-${report.containsPlastic}`;
  const riskClass = `risk-${String(report.risk).toLowerCase()}`;
  const fc = report.foodContext;
  const conf = report.confidence;
  const confClass = conf
    ? `confidence-${String(conf.level).toLowerCase()}`
    : "confidence-low";

  const brandLine = report.brand
    ? `<p class="muted">Brand: ${escapeHtml(report.brand)}</p>`
    : "";

  const exampleNote = report.isExample
    ? `<p class="muted">Sample example report for learning.</p>`
    : "";

  const confidenceBadge = conf
    ? `<span class="badge ${confClass}" title="${escapeHtml(conf.summary)}">${escapeHtml(conf.label)}</span>`
    : "";

  const productImage = report.imageUrl
    ? `<div class="product-image-wrap">
         <img
           class="product-image"
           src="${escapeHtml(report.imageUrl)}"
           alt="Photo of ${escapeHtml(report.displayName)}"
           loading="lazy"
           decoding="async"
           referrerpolicy="no-referrer"
           onerror="this.closest('.product-image-wrap')?.classList.add('is-missing'); this.remove();"
         />
       </div>`
    : `<div class="product-image-wrap is-missing" aria-hidden="true">
         <span class="product-image-fallback">No photo</span>
       </div>`;

  reportEl.innerHTML = `
    <div class="dashboard">
      <div class="report-header report-header-with-image">
        ${productImage}
        <div class="report-header-text">
          <h3>${escapeHtml(report.displayName)}</h3>
          ${brandLine}
          ${exampleNote}
          <div class="verdict-row">
            <span class="badge ${plasticClass}">${escapeHtml(report.containsPlasticLabel)}</span>
            <span class="badge ${riskClass}">Microplastic risk: ${escapeHtml(report.risk)}</span>
            ${confidenceBadge}
          </div>
          ${
            conf
              ? `<div class="confidence-meter" aria-label="Confidence ${conf.score} percent">
                   <div class="confidence-meter-track">
                     <div class="confidence-meter-fill ${confClass}" style="width:${conf.score}%"></div>
                   </div>
                   <p class="confidence-summary">${escapeHtml(conf.summary)}</p>
                 </div>`
              : ""
          }
          <p class="source-line">${escapeHtml(report.sourceLabel)}</p>
        </div>
      </div>

      <div>
        <p class="dash-section-title">At a glance</p>
        <div class="overview-grid">
          ${overviewTile(
            "Microplastics",
            `Risk: ${report.risk}`,
            report.containsPlasticLabel,
            toneFromPlastic(report.containsPlastic, report.risk)
          )}
          ${overviewTile(
            "Confidence",
            conf ? `${conf.score}% · ${conf.level}` : "—",
            conf?.note || "Score from data completeness, not a lab test.",
            toneFromConfidence(conf?.level)
          )}
          ${overviewTile(
            "Nutri-Score",
            fc?.nutri?.available ? fc.nutri.title : "Unknown",
            fc?.nutri?.summary || "Not available for this item.",
            toneFromNutri(fc?.nutri)
          )}
          ${overviewTile(
            "NOVA",
            fc?.nova?.available ? `Group ${fc.nova.group}` : "Unknown",
            fc?.nova?.available
              ? fc.nova.markerCount
                ? `${fc.nova.markerCount} processing marker(s)`
                : fc.nova.summary
              : "Not available for this item.",
            toneFromNova(fc?.nova)
          )}
          ${overviewTile(
            "Green Score",
            fc?.green?.available ? fc.green.title : "Unknown",
            fc?.green?.summary || "Not available for this item.",
            toneFromGreen(fc?.green)
          )}
        </div>
      </div>

      <div class="dash-columns">
        <div class="dash-panel">
          <h4>Packaging log</h4>
          ${renderPackagingLog(fc)}
        </div>
        <div class="dash-panel">
          <h4>Food &amp; environment log</h4>
          ${renderFoodQualityLog(fc)}
        </div>
      </div>

      <div>
        <p class="dash-section-title">Microplastic education</p>
        <div class="education-grid">
          ${eduCard("Risk summary", report.riskSummary)}
          ${eduCard("Better alternatives", report.betterAlternatives)}
          ${eduCard("How long it lasts", report.howLongItLasts)}
          ${eduCard("Environmental impact", report.environmentalImpact)}
          ${eduCard("Potential impact", report.potentialImpact)}
          ${eduCard("Fun fact", report.funFact)}
        </div>
      </div>

      <div id="alt-recommender" class="alt-recommender" hidden></div>

      ${renderEvidencePanel(report)}
    </div>
  `;

  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  loadAlternativesSection(report);
}

/**
 * Async Alternatives Recommender — fills #alt-recommender after the static education cards.
 * @param {import('./processor.js').MicroplasticReport} report
 */
async function loadAlternativesSection(report) {
  const gen = ++reportGeneration;
  altProductByCode.clear();

  const host = document.getElementById("alt-recommender");
  if (!host) return;

  if (!shouldRecommendAlternatives(report)) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }

  host.hidden = false;
  host.innerHTML = `
    <p class="dash-section-title">Lower-plastic product ideas</p>
    <p class="muted alt-lead">Suggested products with lower packaging-plastic risk. More general tips are in “Better alternatives” above.</p>
    <p class="alt-loading">Searching for substitutes…</p>
  `;

  try {
    const { items, skipped } = await findAlternativeProducts(report, { limit: 3 });
    if (gen !== reportGeneration) return;

    if (!items.length) {
      const rateNote =
        skipped === "rate_limit"
          ? " (busy right now — try again in a minute)"
          : skipped === "no_query"
            ? " for this item type"
            : "";
      host.innerHTML = `
        <p class="dash-section-title">Lower-plastic product ideas</p>
        <p class="muted alt-lead">No product substitutes found right now${rateNote}. Use the tips in “Better alternatives” above.</p>
      `;
      return;
    }

    items.forEach((alt) => {
      if (alt.code) altProductByCode.set(alt.code, alt.product);
    });

    const cards = items
      .map((alt) => {
        const riskClass = `risk-${String(alt.risk).toLowerCase()}`;
        const img = alt.imageUrl
          ? `<img src="${escapeHtml(alt.imageUrl)}" alt="" width="56" height="56" loading="lazy" referrerpolicy="no-referrer" />`
          : `<span class="alt-img-fallback">—</span>`;
        const meta = [alt.brand, alt.code].filter(Boolean).join(" · ");
        return `
          <li>
            <button type="button" class="alt-card" data-code="${escapeHtml(alt.code)}">
              ${img}
              <span class="alt-card-body">
                <strong>${escapeHtml(alt.name)}</strong>
                ${meta ? `<span class="alt-meta">${escapeHtml(meta)}</span>` : ""}
                <span class="badge ${riskClass}">Risk: ${escapeHtml(alt.risk)}</span>
                <span class="alt-why">${escapeHtml(alt.whyBetter)}</span>
              </span>
            </button>
          </li>
        `;
      })
      .join("");

    host.innerHTML = `
      <p class="dash-section-title">Lower-plastic product ideas</p>
      <p class="muted alt-lead">Suggested products with lower packaging-plastic risk. Tap one for a full report. More general tips are in “Better alternatives” above.</p>
      <ul class="alt-list">${cards}</ul>
    `;

    host.querySelectorAll(".alt-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-code") || "";
        const product = altProductByCode.get(code);
        if (!product) {
          setStatus("Could not load that alternative.", true);
          return;
        }
        openAlternativeProduct(product);
      });
    });
  } catch (err) {
    if (gen !== reportGeneration) return;
    host.innerHTML = `
      <p class="dash-section-title">Lower-plastic product ideas</p>
      <p class="muted alt-lead">Could not load live substitutes (${escapeHtml(
        err.message || "error"
      )}). See “Better alternatives” above for general tips.</p>
    `;
  }
}

/**
 * @param {import('./off-api.js').OffProduct} product
 */
async function openAlternativeProduct(product) {
  setStatus("Loading alternative product…");
  checkBtn.disabled = true;
  try {
    const enriched = await enrichProduct(product);
    const report = reportFromOffProduct(normalizeOffProduct(enriched));
    if (product.product_name) {
      itemInput.value = product.product_name;
      lastQuery = product.product_name;
    }
    setStatus("Opened a lower-plastic alternative.");
    renderReport(report);
  } catch (err) {
    setStatus(err.message || "Could not open alternative.", true);
  } finally {
    checkBtn.disabled = false;
  }
}

/**
 * Evidence Panel 2.0 — shows score factors, what drove the verdict, and gaps.
 * @param {import('./processor.js').MicroplasticReport} report
 */
function renderEvidencePanel(report) {
  const conf = report.confidence;
  if (!conf) {
    const evidenceItems = (report.evidence || [])
      .map((e) => `<li>${escapeHtml(e)}</li>`)
      .join("");
    return `
      <div class="evidence">
        <strong>How we got this</strong>
        <p>${escapeHtml(report.confidenceNote)}</p>
        <ul>${evidenceItems}</ul>
      </div>
    `;
  }

  const factorRows = (conf.factors || [])
    .map((f) => {
      const pct = f.max ? Math.round((f.points / f.max) * 100) : 0;
      return `
        <li class="factor-row ${f.present ? "factor-present" : "factor-missing"}">
          <div class="factor-head">
            <span class="factor-label">${escapeHtml(f.label)}</span>
            <span class="factor-pts">${f.points}/${f.max}</span>
          </div>
          <div class="factor-bar" aria-hidden="true">
            <span class="factor-bar-fill" style="width:${pct}%"></span>
          </div>
          <p class="factor-detail">${escapeHtml(f.detail)}</p>
        </li>
      `;
    })
    .join("");

  const supporting = (conf.drivers || []).filter((d) => d.kind === "supporting");
  const gaps = (conf.drivers || []).filter((d) => d.kind === "gap");
  const notes = (conf.drivers || []).filter((d) => d.kind === "note");

  const supportingList = supporting.length
    ? supporting.map((d) => `<li>${escapeHtml(d.text)}</li>`).join("")
    : `<li class="muted">No rule drivers recorded.</li>`;

  const gapsList = gaps.length
    ? gaps.map((d) => `<li>${escapeHtml(d.text)}</li>`).join("")
    : `<li class="muted">No major gaps flagged.</li>`;

  const usedChips = (conf.used || [])
    .map((u) => `<span class="evidence-chip used">${escapeHtml(u)}</span>`)
    .join("");
  const missingChips = (conf.missing || [])
    .map((m) => `<span class="evidence-chip missing">${escapeHtml(m)}</span>`)
    .join("");

  const noteLines = notes
    .map((d) => `<p class="evidence-note">${escapeHtml(d.text)}</p>`)
    .join("");

  return `
    <div class="evidence evidence-v2">
      <div class="evidence-header">
        <strong>Evidence Panel</strong>
        <span class="badge ${`confidence-${String(conf.level).toLowerCase()}`}">${escapeHtml(conf.label)}</span>
      </div>
      <p class="evidence-lead">${escapeHtml(conf.summary)}</p>

      <div class="evidence-grid">
        <div class="evidence-col">
          <h4>Score breakdown</h4>
          <ul class="factor-list">${factorRows}</ul>
        </div>
        <div class="evidence-col">
          <h4>What drove the verdict</h4>
          <ul class="driver-list supporting">${supportingList}</ul>
          <h4 class="evidence-subhead">Gaps &amp; limits</h4>
          <ul class="driver-list gaps">${gapsList}</ul>
        </div>
      </div>

      <div class="evidence-chips">
        ${usedChips ? `<p class="chip-label">Used</p><div class="chip-row">${usedChips}</div>` : ""}
        ${missingChips ? `<p class="chip-label">Missing</p><div class="chip-row">${missingChips}</div>` : ""}
      </div>
      ${noteLines}
    </div>
  `;
}

function toneFromConfidence(level) {
  if (level === "High") return "low";
  if (level === "Medium") return "medium";
  return "unknown";
}

function overviewTile(label, value, note, tone) {
  return `
    <div class="overview-tile tone-${escapeHtml(tone)}">
      <p class="tile-label">${escapeHtml(label)}</p>
      <p class="tile-value">${escapeHtml(value)}</p>
      <p class="tile-note">${escapeHtml(note)}</p>
    </div>
  `;
}

function eduCard(title, body) {
  return `
    <div class="edu-card">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function renderPackagingLog(fc) {
  if (!fc || (!fc.available && !fc.packagingText && !(fc.packagingParts || []).length)) {
    return `<p class="muted">No detailed packaging list for this item yet. The microplastic verdict still uses the packaging clues we have.</p>`;
  }

  const impactClass = `impact-${fc.packagingImpact?.level || "unknown"}`;
  const partsList = (fc.packagingParts || [])
    .map((p) => `<li>${escapeHtml(p.label)}</li>`)
    .join("");
  const materialsRows = (fc.materialsTable || [])
    .map((row) => {
      const rowClass = row.isTotal ? ' class="pack-total"' : "";
      return `<tr${rowClass}><td>${escapeHtml(row.material)}</td><td>${escapeHtml(row.percent)}</td><td>${escapeHtml(row.weight || "—")}</td><td>${escapeHtml(row.weightPer100 || "—")}</td></tr>`;
    })
    .join("");

  return `
    <p class="packaging-impact ${impactClass}">${escapeHtml(fc.packagingImpact?.label || "Packaging")}</p>
    <p class="muted">${escapeHtml(fc.packagingImpact?.detail || "")}</p>
    ${
      partsList
        ? `<p class="pack-label">Parts</p><ul class="pack-parts">${partsList}</ul>`
        : fc.packagingText
          ? `<p class="pack-label">Text</p><p>${escapeHtml(fc.packagingText)}</p>`
          : ""
    }
    ${
      materialsRows
        ? `<p class="pack-label">Packaging materials</p>
           <table class="pack-table">
             <thead><tr><th>Material</th><th>%</th><th>Packaging weight</th><th>Per 100 g product</th></tr></thead>
             <tbody>${materialsRows}</tbody>
           </table>
           ${
             (fc.materialsTable || []).some((r) => r.percent === "—")
               ? `<p class="muted pack-note">Percentages appear when packaging weights are listed for the product.</p>`
               : ""
           }`
        : ""
    }
  `;
}

function renderFoodQualityLog(fc) {
  if (!fc) {
    return `<p class="muted">Food quality fields unavailable for this item.</p>`;
  }

  const nutri = fc.nutri || {};
  const nova = fc.nova || {};
  const green = fc.green || {};
  const markers =
    nova.markerLabels && nova.markerLabels.length
      ? nova.markerLabels.join(", ")
      : nova.markerCount
        ? `${nova.markerCount} marker(s)`
        : "None listed";

  return `
    <ul class="log-list">
      <li>
        <span class="log-key">Nutri-Score</span>
        <p class="log-val">${escapeHtml(nutri.title || "Unknown")} — ${escapeHtml(nutri.summary || "")}</p>
      </li>
      <li>
        <span class="log-key">NOVA processing</span>
        <p class="log-val">${escapeHtml(nova.title || "Unknown")}</p>
      </li>
      <li>
        <span class="log-key">Processing markers</span>
        <p class="log-val">${escapeHtml(markers)}</p>
      </li>
      <li>
        <span class="log-key">Green Score</span>
        <p class="log-val">${escapeHtml(
          green.available
            ? `${green.title} — ${green.summary}`
            : "Not available for this product"
        )}</p>
      </li>
    </ul>
  `;
}

function toneFromPlastic(verdict, risk) {
  if (verdict === "no" || risk === "Low") return "low";
  if (verdict === "yes" || risk === "High") return "high";
  if (risk === "Medium" || verdict === "possible" || risk === "Possible") return "medium";
  return "unknown";
}

function toneFromNutri(nutri) {
  if (!nutri?.available) return "unknown";
  if (nutri.grade === "a" || nutri.grade === "b") return "low";
  if (nutri.grade === "c") return "medium";
  return "high";
}

function toneFromNova(nova) {
  if (!nova?.available) return "unknown";
  if (nova.group <= 2) return "low";
  if (nova.group === 3) return "medium";
  return "high";
}

function toneFromGreen(green) {
  if (!green?.available) return "unknown";
  if (green.grade === "a" || green.grade === "b") return "low";
  if (green.grade === "c") return "medium";
  return "high";
}

function toneFromImpact(level) {
  if (level === "low") return "low";
  if (level === "medium") return "medium";
  if (level === "high") return "high";
  return "unknown";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Queries that always use the fully filled built-in example reports. */
const BUILTIN_EXAMPLE_QUERIES = new Set([
  "fresh apple",
  "apple",
  "potato chips",
  "chips",
  "crisps",
  "potato crisps",
]);

/**
 * Built-in examples: fully filled local mapping (skip OFF).
 * @param {string} query
 */
function tryBuiltInExample(query) {
  const q = normalizeQueryKey(query);
  if (!BUILTIN_EXAMPLE_QUERIES.has(q)) return null;
  const found = findLocalItem(q);
  if (found?.item?.isExample) return buildLocalReport(q);
  return null;
}

/**
 * @param {import('./off-api.js').OffProduct[]} products
 * @param {string} query
 * @param {{ selectedCode?: string, autoPicked?: boolean }} [opts]
 */
function showCandidates(products, query, opts = {}) {
  const { selectedCode = "", autoPicked = false } = opts;
  candidatesSection.hidden = false;
  candidateList.innerHTML = "";

  const heading = document.getElementById("candidates-heading");
  const lead = candidatesSection.querySelector("p.muted");
  if (heading) {
    heading.textContent = autoPicked ? "Other matches" : "Select a match";
  }
  if (lead) {
    lead.textContent = autoPicked
      ? "We opened the product with the most complete data. Pick another below if that isn’t the right one."
      : "Several matching products were found. Pick one, or continue with a general estimate.";
  }

  products.forEach((product, index) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "candidate-btn";
    btn.dataset.index = String(index);
    const isSelected =
      selectedCode && String(product.code || "") === String(selectedCode);
    if (isSelected) {
      btn.classList.add("candidate-selected");
      btn.setAttribute("aria-current", "true");
    }

    const thumb = resolveProductImage(product, "small");
    const imgHtml = thumb
      ? `<img class="candidate-thumb" src="${escapeHtml(thumb)}" alt="" width="48" height="48" loading="lazy" referrerpolicy="no-referrer" decoding="async" />`
      : `<span class="muted candidate-img-fallback">No photo</span>`;

    const title = product.product_name || "Unnamed product";
    const meta = [product.brands, product.code].filter(Boolean).join(" · ");
    const rankNote =
      index === 0
        ? ` <span class="candidate-picked">Most complete</span>`
        : isSelected
          ? ` <span class="candidate-picked">Selected</span>`
          : "";

    btn.innerHTML = `${imgHtml}<span><strong>${escapeHtml(title)}</strong>${rankNote}<span class="candidate-meta">${escapeHtml(meta)}</span></span>`;
    const thumbEl = btn.querySelector("img.candidate-thumb");
    if (thumbEl) {
      thumbEl.addEventListener("error", () => {
        thumbEl.replaceWith(
          Object.assign(document.createElement("span"), {
            className: "muted candidate-img-fallback",
            textContent: "No photo",
          })
        );
      });
    }
    btn.addEventListener("click", async () => {
      setStatus("Loading details…");
      checkBtn.disabled = true;
      try {
        // Already enriched when ranked; refresh once more if needed
        const enriched = await enrichProduct(product);
        const report = reportFromOffProduct(normalizeOffProduct(enriched));
        setStatus("Report ready.");
        renderReport(report);
        showCandidates(products, query, {
          selectedCode: enriched.code || product.code,
          autoPicked: true,
        });
      } catch (err) {
        setStatus(err.message || "Could not load product details.", true);
      } finally {
        checkBtn.disabled = false;
      }
    });

    li.appendChild(btn);
    candidateList.appendChild(li);
  });

  useLocalBtn.onclick = () => {
    const report = buildLocalReport(query);
    setStatus("Showing a general estimate.");
    renderReport(report);
  };
}

async function runCheck(query) {
  const q = query.trim();
  if (!q) {
    setStatus("Enter an item name to check.", true);
    return;
  }

  lastQuery = q;
  hideResults();
  hideCandidates();
  setStatus("Working…");
  checkBtn.disabled = true;

  try {
    // 1) Exact built-in examples → fully filled local reports
    const exampleReport = tryBuiltInExample(q);
    if (exampleReport) {
      setStatus("Showing example report.");
      renderReport(exampleReport);
      return;
    }

    // 2) Non-food → local only
    if (prefersLocalOnly(q)) {
      const report = buildLocalReport(q);
      setStatus("Showing an estimate for this non-food item.");
      renderReport(report);
      return;
    }

    // 3) Open Food Facts search (explicit submit only)
    setStatus("Searching…");
    let products = [];
    try {
      products = await searchProducts(q, { pageSize: 5 });
    } catch (err) {
      if (err.name === "RateLimitError") {
        setStatus(err.message, true);
        const report = buildLocalReport(q);
        renderReport(report);
        return;
      }
      console.warn(err);
      if (err.name === "ProxyMissingError") {
        setStatus(err.message, true);
      } else {
        setStatus(
          "Product search is temporarily unavailable. Showing a general estimate.",
          true
        );
      }
      renderReport(buildLocalReport(q));
      return;
    }

    if (!products.length) {
      setStatus("No exact product match — showing a general estimate.");
      renderReport(buildLocalReport(q));
      return;
    }

    if (products.length === 1) {
      setStatus("Loading details…");
      const enriched = await enrichProduct(products[0]);
      const report = reportFromOffProduct(normalizeOffProduct(enriched));
      setStatus("Report ready.");
      renderReport(report);
      return;
    }

    // Several hits → enrich, rank by completeness, auto-open the richest
    setStatus("Comparing matches for the most complete product…");
    const ranked = await enrichAndRankProducts(products);
    const best = ranked[0];
    const report = reportFromOffProduct(normalizeOffProduct(best));
    setStatus(
      "Opened the match with the most complete data. Other matches are listed below."
    );
    renderReport(report);
    showCandidates(ranked, q, {
      selectedCode: best.code || "",
      autoPicked: true,
    });
  } finally {
    checkBtn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runCheck(itemInput.value);
});

clearBtn.addEventListener("click", () => {
  form.reset();
  imagePreviewName.hidden = true;
  imagePreviewName.textContent = "";
  lastQuery = "";
  setStatus("");
  hideCandidates();
  hideResults();
  itemInput.focus();
});

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (file) {
    imagePreviewName.hidden = false;
    imagePreviewName.textContent = `Photo selected: ${file.name} (not uploaded — recognition planned for a later free-tier step).`;
    if (!itemInput.value.trim()) {
      // Soft hint only; do not invent a product name from the image yet
      setStatus("Add an item name — photo recognition isn’t available yet.");
    }
  } else {
    imagePreviewName.hidden = true;
    imagePreviewName.textContent = "";
  }
});

document.querySelectorAll(".example-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const example = btn.getAttribute("data-example") || "";
    itemInput.value = example;
    runCheck(example);
  });
});
