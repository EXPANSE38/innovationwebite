# Cloudflare Worker setup (Open Food Facts proxy)

This Worker replaces `server.py` when you host the site on **GitHub Pages**.

## 1. Create the Worker (Dashboard)

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. Click **Create** → **Create Worker**
3. Name it e.g. `microplastic-checker`
4. Click **Deploy**, then **Edit code**
5. Delete the default code and paste everything from `worker.js` in this folder
6. Click **Deploy**
7. Copy your Worker URL, like:  
   `https://microplastic-checker.YOUR_SUBDOMAIN.workers.dev`

## 2. Quick test

Open these in a browser (replace with your URL):

- `https://YOUR_WORKER.workers.dev/api/health`  
  → should show `{"ok":true,"service":"MicroplasticChecker","proxy":true}`
- `https://YOUR_WORKER.workers.dev/api/off/search?q=chips&page_size=3`  
  → should return JSON with `products`

## 3. Connect the website

In `js/config.js`, set:

```js
export const API_BASE = "https://microplastic-checker.YOUR_SUBDOMAIN.workers.dev";
```

Leave `API_BASE = ""` when using local `python server.py`.

## 4. GitHub Pages

1. Push this repo to GitHub
2. Settings → Pages → Deploy from branch (`main` / `/ root`)
3. Open your Pages URL and try a search

Local demos can still use `python server.py` with `API_BASE` left empty.
