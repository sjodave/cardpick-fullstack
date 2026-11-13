# CardPick Full-Stack (Node.js + Express + PWA)

CardPick is a mobile-first Progressive Web App (PWA) and Node.js backend that:
1. **Resolves any pasted e-commerce link** (including shortlinks like `amzn.in` and `fkrt.it`) and extracts the product title, price, and visible bank offers.
2. **Automatically fetches multi-store prices** across Amazon.in, Flipkart, Croma, Reliance Digital, Vijay Sales, Myntra, AJIO, Tata CLiQ, and Nykaa (via direct scraping or SerpApi Google Shopping India).
3. **Calculates the lowest net price** across all stores using your 12 credit cards + 1 debit card (`HDFC Millennia Debit Card`).
4. **Installs as a native-like app on Android** (`Add to Home screen` / `Install app`) via `manifest.json` and Service Worker (`sw.js`).

## Quick Start (Local PC / Termux on Android)

```bash
npm install
npm start
```

Open `http://localhost:3000` in Chrome.

## Optional Environment Variables (For 100% Captcha-Free Live Prices)

Amazon and Flipkart occasionally rate-limit server IPs. For rock-solid accuracy across all Indian stores, you can pass a free-tier **SerpApi** key (Google Shopping India) or **ScraperAPI** key either in the app's **Backend Settings** modal or via environment variables:

```bash
SERPAPI_KEY=your_serpapi_key SCRAPERAPI_KEY=your_scraperapi_key npm start
```

## Free 1-Click Cloud Hosting (For Android "Add to Home Screen")

1. Push this folder to a GitHub repository.
2. Connect the repository on **Render.com** (New → Web Service):
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. Open your `https://your-app.onrender.com` URL in Chrome on your OnePlus phone and tap **⋮ → Install app / Add to Home screen**.
