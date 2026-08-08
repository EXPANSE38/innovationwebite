#!/usr/bin/env python3
"""
Local static server + Open Food Facts proxy.

Browsers cannot call OFF full-text search reliably (CORS / anonymous 503s).
This proxy:
  - serves the site from this folder
  - searches via search.openfoodfacts.org (fallback: legacy cgi/search.pl)
  - loads products via world.openfoodfacts.org with a proper User-Agent

Usage:
  python server.py
  open http://127.0.0.1:8765/
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765

USER_AGENT = (
    "MicroplasticChecker/1.0 (educational; contact=local-dev@example.com)"
)
SEARCH_ALICIOUS = "https://search.openfoodfacts.org/search"
SEARCH_CGI = "https://world.openfoodfacts.org/cgi/search.pl"
PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"

FIELDS = ",".join(
    [
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
    ]
)


def off_get(url: str, timeout: float = 30.0) -> tuple[int, bytes, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read(), res.headers.get("Content-Type", "")
    except urllib.error.HTTPError as err:
        body = err.read() if err.fp else b""
        ct = err.headers.get("Content-Type", "") if err.headers else ""
        return err.code, body, ct
    except Exception as err:
        return 0, str(err).encode("utf-8", errors="replace"), ""


def parse_json_body(body: bytes) -> dict | None:
    text = body.decode("utf-8", errors="replace").strip()
    if not text or text.startswith("<"):
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def off_get_json(url: str, attempts: int = 3) -> tuple[int, dict | None, str]:
    """GET with short retries; returns (status, json_or_none, detail)."""
    last_status = 0
    last_detail = "no response"
    for i in range(attempts):
        status, body, _ct = off_get(url)
        last_status = status
        data = parse_json_body(body)
        if status == 200 and data is not None:
            return status, data, "ok"
        if data is not None and status != 200:
            # JSON error payload from upstream
            last_detail = f"HTTP {status}"
        elif body.strip().startswith(b"<") or (body and not data):
            last_detail = f"HTML/non-JSON from upstream (HTTP {status or 'error'})"
        else:
            last_detail = f"HTTP {status or 'error'}"
        if i < attempts - 1:
            time.sleep(0.7 * (i + 1))
    return last_status, None, last_detail


def pick_image_url(hit: dict) -> tuple[str, str]:
    """Return (display_url, small_url) from common OFF image fields."""
    small = (
        hit.get("image_front_small_url")
        or hit.get("image_small_url")
        or hit.get("image_thumb_url")
        or ""
    )
    large = (
        hit.get("image_front_url")
        or hit.get("image_url")
        or small
        or ""
    )
    selected = hit.get("selected_images") or {}
    front = selected.get("front") if isinstance(selected, dict) else None
    if isinstance(front, dict):
        small = (
            (front.get("small") or {}).get("en")
            or (front.get("thumb") or {}).get("en")
            or small
        )
        large = (
            (front.get("display") or {}).get("en")
            or (front.get("large") or {}).get("en")
            or large
            or small
        )
    if isinstance(small, str) and small.startswith("http://"):
        small = "https://" + small[len("http://") :]
    if isinstance(large, str) and large.startswith("http://"):
        large = "https://" + large[len("http://") :]
    return str(large or ""), str(small or large or "")


def normalize_hit(hit: dict) -> dict:
    brands = hit.get("brands")
    if isinstance(brands, list):
        brands = ", ".join(str(b) for b in brands if b)
    elif brands is None:
        brands = ""

    image_front_url, image_front_small_url = pick_image_url(hit)

    return {
        "code": str(hit.get("code") or ""),
        "product_name": hit.get("product_name") or "",
        "brands": brands,
        "packaging": hit.get("packaging") or "",
        "packaging_tags": hit.get("packaging_tags") or [],
        "packaging_materials_tags": hit.get("packaging_materials_tags") or [],
        "packaging_text": hit.get("packaging_text") or "",
        "ingredients_text": hit.get("ingredients_text") or "",
        "categories": hit.get("categories") or "",
        "categories_tags": hit.get("categories_tags") or [],
        "ecoscore_grade": hit.get("ecoscore_grade") or "",
        "nutriscore_grade": hit.get("nutriscore_grade")
        or hit.get("nutrition_grades")
        or "",
        "nutrition_grades": hit.get("nutrition_grades") or "",
        "nova_group": hit.get("nova_group") or hit.get("nova_groups") or "",
        "nova_groups": hit.get("nova_groups") or "",
        "nova_groups_markers": hit.get("nova_groups_markers") or {},
        "packagings": hit.get("packagings") or [],
        "product_quantity": hit.get("product_quantity") or "",
        "product_quantity_unit": hit.get("product_quantity_unit") or "",
        "quantity": hit.get("quantity") or "",
        "image_front_url": image_front_url,
        "image_front_small_url": image_front_small_url,
    }


def search_alicious(q: str, page_size: str) -> tuple[list[dict], str | None]:
    url = (
        f"{SEARCH_ALICIOUS}?"
        f"{urllib.parse.urlencode({'q': q, 'page_size': page_size, 'fields': FIELDS})}"
    )
    status, data, detail = off_get_json(url, attempts=3)
    if not data:
        return [], f"search.openfoodfacts.org: {detail}"
    hits = data.get("hits") or []
    products = [normalize_hit(h) for h in hits if h]
    products = [p for p in products if p.get("product_name") or p.get("code")]
    return products, None


def search_cgi(q: str, page_size: str) -> tuple[list[dict], str | None]:
    params = {
        "search_terms": q,
        "search_simple": "1",
        "action": "process",
        "json": "1",
        "page_size": page_size,
        "fields": FIELDS,
    }
    url = f"{SEARCH_CGI}?{urllib.parse.urlencode(params)}"
    status, data, detail = off_get_json(url, attempts=2)
    if not data:
        return [], f"cgi/search.pl: {detail}"
    products = [normalize_hit(p) for p in (data.get("products") or []) if p]
    products = [p for p in products if p.get("product_name") or p.get("code")]
    return products, None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/api/health":
            return self.json_response(
                200,
                {
                    "ok": True,
                    "service": "MicroplasticChecker",
                    "proxy": True,
                },
            )

        if path == "/api/off/search":
            return self.handle_search(parsed.query)

        if path.startswith("/api/off/product/"):
            code = path[len("/api/off/product/") :].strip("/")
            return self.handle_product(code, parsed.query)

        # Prevent accidental HTML 404 for unknown /api/* routes
        if path.startswith("/api/"):
            return self.json_response(404, {"error": f"Unknown API route: {path}"})

        return super().do_GET()

    def handle_search(self, query: str):
        params = urllib.parse.parse_qs(query)
        q = (params.get("q") or params.get("search_terms") or [""])[0].strip()
        page_size = (params.get("page_size") or ["5"])[0]
        if not q:
            return self.json_response(400, {"error": "Missing q", "products": []})

        # Barcode shortcut: skip text search
        if q.isdigit() and len(q) >= 8:
            status, data, detail = off_get_json(
                f"{PRODUCT_URL.format(code=urllib.parse.quote(q))}?fields={urllib.parse.quote(FIELDS)}"
            )
            if data and data.get("status") == 1 and data.get("product"):
                product = normalize_hit(data["product"])
                return self.json_response(
                    200,
                    {
                        "count": 1,
                        "products": [product],
                        "source": "openfoodfacts-product",
                    },
                )
            # fall through to text search if barcode miss

        products, err1 = search_alicious(q, page_size)
        if products:
            return self.json_response(
                200,
                {
                    "count": len(products),
                    "products": products,
                    "source": "search.openfoodfacts.org",
                },
            )

        products, err2 = search_cgi(q, page_size)
        if products:
            return self.json_response(
                200,
                {
                    "count": len(products),
                    "products": products,
                    "source": "cgi/search.pl",
                },
            )

        return self.json_response(
            502,
            {
                "error": (
                    "Open Food Facts search overloaded or unavailable. "
                    f"({err1 or ''} | {err2 or ''})".strip(" |")
                ),
                "products": [],
            },
        )

    def handle_product(self, code: str, query: str):
        code = urllib.parse.unquote(code).strip()
        if not code:
            return self.json_response(400, {"status": 0, "error": "Missing code"})

        params = urllib.parse.parse_qs(query)
        fields = (params.get("fields") or [FIELDS])[0]
        url = (
            f"{PRODUCT_URL.format(code=urllib.parse.quote(code))}"
            f"?fields={urllib.parse.quote(fields)}"
        )
        status, data, detail = off_get_json(url, attempts=3)
        if not data:
            return self.json_response(
                502,
                {
                    "status": 0,
                    "error": f"Product read failed: {detail}",
                },
            )
        return self.json_response(200, data)

    def json_response(self, status: int, payload: dict):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args):
        msg = fmt % args
        if "/api/" in msg:
            super().log_message(fmt, *args)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Microplastic Checker -> http://{HOST}:{PORT}/")
    print("Require this process (not python -m http.server).")
    print("Health: /api/health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
