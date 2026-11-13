const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache'
};

const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; CPH2613) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8'
};

function buildFetchUrl(targetUrl, apiKey) {
  const key = apiKey || SCRAPERAPI_KEY;
  if (key) {
    return `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}&country_code=in`;
  }
  return targetUrl;
}

function parsePriceNumber(raw) {
  if (!raw) return 0;
  const str = String(raw).trim().split(/\r|\n/)[0];
  const m = str.match(/(?:₹|Rs\.?|INR)?\s*(\d[\d,]*(\.\d{1,2})?)/i);
  if (!m) return 0;
  const cleaned = m[1].replace(/,/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num >= 50 ? Math.round(num) : 0;
}

function detectStoreId(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h.includes('amazon') || h.includes('amzn')) return { id: 'amazon', name: 'Amazon India' };
  if (h.includes('flipkart') || h.includes('fkrt')) return { id: 'flipkart', name: 'Flipkart' };
  if (h.includes('croma')) return { id: 'croma', name: 'Croma' };
  if (h.includes('reliancedigital')) return { id: 'reliancedigital', name: 'Reliance Digital' };
  if (h.includes('vijaysales')) return { id: 'vijaysales', name: 'Vijay Sales' };
  if (h.includes('myntra') || h.includes('myntr')) return { id: 'myntra', name: 'Myntra' };
  if (h.includes('ajio')) return { id: 'ajio', name: 'AJIO' };
  if (h.includes('tatacliq')) return { id: 'tatacliq', name: 'Tata CLiQ' };
  if (h.includes('nykaa')) return { id: 'nykaa', name: 'Nykaa' };
  return { id: 'other', name: h.replace(/^www\./, '') || 'Online Store' };
}

// Convert long noisy Amazon/Flipkart product titles or URL slugs into a crisp 5-7 word search query
function normalizeSearchQuery(rawTitle) {
  let s = String(rawTitle || '').trim();
  if (!s) return '';

  // Remove store suffixes
  s = s.replace(/\s*[:|–-]\s*(Amazon\.in|Flipkart\.com|Croma|Reliance Digital|Buy Online.*).*$/i, '');

  // Extract key storage/RAM specs before stripping parentheticals (e.g., 8GB, 128GB, 256GB, 512GB, 1TB, 5G)
  const specs = [];
  const specMatches = s.match(/\b(\d+\s*(?:GB|TB)|5G|Wi-Fi|Cellular|ANC)\b/gi) || [];
  for (const sp of specMatches) {
    const cleanSp = sp.replace(/\s+/g, '').toUpperCase();
    if (!specs.includes(cleanSp) && specs.length < 3) specs.push(cleanSp);
  }

  // Strip parenthetical marketing blocks and pipe/comma clauses
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.split(/[|;]/)[0];
  // Keep only first 2 comma segments if second has storage/color, else first segment
  const commaParts = s.split(',');
  s = commaParts[0];

  // Strip marketing fluff phrases
  s = s.replace(/\b(with\s+.*|for\s+men.*|for\s+women.*|compatible\s+with.*|includes\s+.*|up\s+to\s+\d+.*|no\s+cost\s+emi.*|exchange\s+offer.*|free\s+delivery.*)\b/gi, ' ');
  s = s.replace(/[^a-zA-Z0-9\s+.-]/g, ' ').replace(/\s+/g, ' ').trim();

  // Take first 7 meaningful words
  const words = s.split(' ').filter(Boolean).slice(0, 7);
  let base = words.join(' ');

  // Re-append storage/5G specs if they were inside parentheses and got stripped
  for (const sp of specs) {
    if (!new RegExp(`\\b${sp}\\b`, 'i').test(base)) {
      base += ' ' + sp;
    }
  }
  return base.trim();
}

function extractTitleFromSlug(urlStr) {
  try {
    const u = new URL(urlStr);
    const qParam = u.searchParams.get('k') || u.searchParams.get('q');
    if (qParam && qParam.trim().length > 2) return normalizeSearchQuery(qParam);

    const stop = new Set(['dp', 'p', 's', 'gp', 'd', 'product', 'buy', 'shop', 'ref', 'itm', 'shoes', 'clothing', 'electronics', 'mobile', 'mobiles']);
    const parts = u.pathname.split('/').filter(p => {
      if (!p) return false;
      if (stop.has(p.toLowerCase())) return false;
      if (/^[A-Z0-9]{10}$/.test(p)) return false;
      if (/^itm[a-z0-9]+$/i.test(p)) return false;
      if (/^\d+$/.test(p)) return false;
      return true;
    });
    if (parts.length > 0) {
      const longest = parts.sort((a, b) => b.length - a.length)[0];
      const raw = decodeURIComponent(longest).replace(/[-_+]+/g, ' ').trim();
      return normalizeSearchQuery(raw);
    }
  } catch (e) {}
  return '';
}

function isRelevantCandidate(queryTitle, candidateTitle, candidatePrice, referencePrice) {
  const cand = (candidateTitle || '').toLowerCase();
  const q = (queryTitle || '').toLowerCase();

  const accessoryWords = [
    'case', 'cover', 'tempered', 'glass', 'screen guard', 'protector',
    'back cover', 'pouch', 'skin', 'strap', 'cable', 'adapter', 'stand',
    'holder', 'flip cover', 'bumper', 'hydrogel', 'lens protector', 'charger for'
  ];
  for (const w of accessoryWords) {
    if (cand.includes(w) && !q.includes(w)) return false;
  }

  if (referencePrice > 800 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.45 || candidatePrice > referencePrice * 1.8) {
      return false;
    }
  }

  const qTokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !['with', 'for', 'and', 'the', 'new', 'buy', 'online', 'black', 'white', 'blue', 'green', 'silver', 'gold', 'grey', 'gray'].includes(t));
  if (qTokens.length === 0) return true;

  // Brand token (first token) should almost always match
  if (qTokens[0].length >= 3 && !cand.includes(qTokens[0])) {
    return false;
  }

  let matched = 0;
  for (const t of qTokens) {
    if (cand.includes(t)) matched++;
  }
  return (matched / qTokens.length) >= 0.5;
}

function parseBankDiscountAmount(text, productPrice) {
  const t = String(text || '');
  // Match patterns like "Flat ₹2,000 Instant Discount", "₹1500 off on ICICI", "Up to ₹3,000 off"
  const m = t.match(/(?:flat|instant|extra|up\s*to|get|save)\s*(?:₹|rs\.?|inr)\s*([\d,]+)/i) ||
            t.match(/(?:₹|rs\.?|inr)\s*([\d,]+)\s*(?:instant\s*discount|off\s*on|cashback|bank\s*discount)/i);
  if (m) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 50 && val <= 15000 && (!productPrice || val < productPrice * 0.4)) {
      return val;
    }
  }
  return 0;
}

async function resolveAndExtractOriginProduct(inputUrl, scraperKey) {
  let finalUrl = inputUrl;
  let html = '';

  // Step 1: Follow shortlink redirects (amzn.in, fkrt.it, etc.) using mobile headers
  try {
    const resp = await axios.get(buildFetchUrl(inputUrl, scraperKey), {
      headers: MOBILE_HEADERS,
      maxRedirects: 8,
      timeout: 11000
    });
    html = typeof resp.data === 'string' ? resp.data : '';
    if (resp.request && resp.request.res && resp.request.res.responseUrl && !scraperKey) {
      finalUrl = resp.request.res.responseUrl;
    }
  } catch (err) {
    if (err.response && err.response.headers && err.response.headers.location) {
      finalUrl = err.response.headers.location;
    }
  }

  let hostname = '';
  try { hostname = new URL(finalUrl).hostname; } catch (e) {}
  const storeInfo = detectStoreId(hostname);

  let rawTitle = '';
  let price = 0;
  let bankOffers = [];
  let maxBankDiscount = 0;

  if (html) {
    const $ = cheerio.load(html);

    // 1. JSON-LD Product schema
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        for (const item of items) {
          if (item && (item['@type'] === 'Product' || item['@type'] === 'Book')) {
            if (!rawTitle && item.name) rawTitle = String(item.name).trim();
            const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (!price && offers && (offers.price || offers.lowPrice)) {
              price = parsePriceNumber(offers.price || offers.lowPrice);
            }
          }
        }
      } catch (e) {}
    });

    // 2. Store-specific main product title
    if (!rawTitle) {
      rawTitle = $('#productTitle').text().trim() ||
                 $('#title').text().trim() ||
                 $('span.VU-ZEz').text().trim() ||
                 $('h1.pd-title').text().trim() ||
                 $('meta[property="og:title"]').attr('content') ||
                 $('title').text().trim();
    }

    // 3. Store-specific main buybox price
    if (!price) {
      const amzOffscreen = $('#corePriceDisplay_desktop_feature_div .a-price.priceToPay .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #apex_desktop .a-price.priceToPay .a-offscreen, #priceblock_ourprice, #priceblock_dealprice').first().text();
      const amzWhole = $('#corePriceDisplay_desktop_feature_div .a-price-whole, #corePrice_feature_div .a-price-whole, .a-price.priceToPay .a-price-whole').first().text();
      const fkPrice = $('div.Nx9bqj.CxhGGd, div._30jeq3._16Jk6d, div.hl05eU .Nx9bqj').first().text();
      const metaPrice = $('meta[property="product:price:amount"], meta[property="og:price:amount"]').attr('content');
      price = parsePriceNumber(amzOffscreen) || parsePriceNumber(amzWhole) || parsePriceNumber(fkPrice) || parsePriceNumber(metaPrice);
    }

    // 4. Extract bank offers & sale discounts
    $('.offers-items-content, .vsx-offers-count, .WT_R32, ._3j4Zjq, .bank-offer, #itembox-InstantBankDiscount').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length > 10 && t.length < 200 && bankOffers.length < 4) {
        bankOffers.push(t);
        const d = parseBankDiscountAmount(t, price);
        if (d > maxBankDiscount) maxBankDiscount = d;
      }
    });
  }

  if (!rawTitle || /robot check|captcha|access denied|online shopping site/i.test(rawTitle)) {
    rawTitle = extractTitleFromSlug(finalUrl) || extractTitleFromSlug(inputUrl) || '';
  }

  const searchQuery = normalizeSearchQuery(rawTitle) || extractTitleFromSlug(finalUrl) || extractTitleFromSlug(inputUrl);

  return {
    title: rawTitle || searchQuery || inputUrl,
    searchQuery: searchQuery || rawTitle || inputUrl,
    originStore: storeInfo,
    originPrice: price,
    originSaleDiscount: maxBankDiscount,
    originUrl: finalUrl,
    bankOffers
  };
}

// Search engines & stores for multi-platform prices
async function searchCrossPlatformWeb(searchQuery, referencePrice, scraperKey) {
  const results = [];
  if (!searchQuery) return results;

  // Query Yahoo India Search / DuckDuckGo Lite for live indexed product pages across stores
  const storeTargets = [
    { id: 'amazon', name: 'Amazon India', site: 'amazon.in' },
    { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com' },
    { id: 'croma', name: 'Croma', site: 'croma.com' },
    { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in' },
    { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com' }
  ];

  await Promise.allSettled(storeTargets.map(async (st) => {
    try {
      const q = `${searchQuery} site:${st.site}`;
      const searchUrl = `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}`;
      const resp = await axios.get(buildFetchUrl(searchUrl, scraperKey), {
        headers: BROWSER_HEADERS,
        timeout: 9000
      });
      const $ = cheerio.load(resp.data || '');

      $('div.algo, div.dd.algo').each((_, el) => {
        if (results.some(r => r.merchantId === st.id)) return;
        const block = $(el);
        const title = block.find('h3.title').text().replace(/\s+/g, ' ').trim();
        const snippet = block.find('.compText, .fc-falcon').text().replace(/\s+/g, ' ').trim();
        let href = block.find('h3.title a').attr('href') || '';
        // Unwrap Yahoo redirect URL if present
        const ruMatch = href.match(/\/RU=([^/]+)\//);
        if (ruMatch) {
          try { href = decodeURIComponent(ruMatch[1]); } catch (e) {}
        }

        const combined = `${title} ${snippet}`;
        // Look for ₹ or Rs. price in title or snippet
        const priceMatches = combined.match(/(?:₹|Rs\.?|INR)\s*([\d,]{3,9})/gi) || [];
        for (const pm of priceMatches) {
          const pVal = parsePriceNumber(pm);
          if (pVal > 0 && isRelevantCandidate(searchQuery, title, pVal, referencePrice)) {
            const disc = parseBankDiscountAmount(combined, pVal);
            results.push({
              merchantId: st.id,
              storeName: st.name,
              price: pVal,
              saleDiscount: disc,
              productTitle: title.replace(/\s*[:|–-]\s*(Amazon\.in|Flipkart\.com|Croma|Reliance Digital).*$/i, '').trim(),
              url: href || `https://www.${st.site}`
            });
            break;
          }
        }
      });
    } catch (e) {}
  }));

  return results;
}

async function searchStorePrices(searchQuery, referencePrice, serpApiKey, scraperKey) {
  const cleanTitle = normalizeSearchQuery(searchQuery);
  if (!cleanTitle) return [];

  const results = [];
  const activeSerpKey = serpApiKey || SERPAPI_KEY;

  // 1. SerpApi Google Shopping India (if key configured)
  if (activeSerpKey) {
    try {
      const serpUrl = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(cleanTitle)}&gl=in&hl=en&api_key=${encodeURIComponent(activeSerpKey)}`;
      const resp = await axios.get(serpUrl, { timeout: 12000 });
      const shopping = (resp.data && resp.data.shopping_results) || [];
      for (const item of shopping) {
        const source = (item.source || '').toLowerCase();
        const price = parsePriceNumber(item.extracted_price || item.price);
        if (!price) continue;
        if (!isRelevantCandidate(cleanTitle, item.title || cleanTitle, price, referencePrice)) continue;

        let merchantId = '';
        let storeName = item.source;
        if (source.includes('amazon')) { merchantId = 'amazon'; storeName = 'Amazon India'; }
        else if (source.includes('flipkart')) { merchantId = 'flipkart'; storeName = 'Flipkart'; }
        else if (source.includes('croma')) { merchantId = 'croma'; storeName = 'Croma'; }
        else if (source.includes('reliance')) { merchantId = 'reliancedigital'; storeName = 'Reliance Digital'; }
        else if (source.includes('vijay sales')) { merchantId = 'vijaysales'; storeName = 'Vijay Sales'; }
        else if (source.includes('myntra')) { merchantId = 'myntra'; storeName = 'Myntra'; }
        else if (source.includes('ajio')) { merchantId = 'ajio'; storeName = 'AJIO'; }
        else if (source.includes('tata cliq') || source.includes('tatacliq')) { merchantId = 'tatacliq'; storeName = 'Tata CLiQ'; }
        else if (source.includes('nykaa')) { merchantId = 'nykaa'; storeName = 'Nykaa'; }

        if (merchantId && !results.some(r => r.merchantId === merchantId)) {
          results.push({
            merchantId,
            storeName,
            price,
            saleDiscount: 0,
            productTitle: item.title,
            url: item.link || item.product_link || ''
          });
        }
      }
      if (results.length >= 2) return results;
    } catch (e) {}
  }

  // 2. Direct Store Search + Cross-Platform Search Engine Fallback in parallel
  const enc = encodeURIComponent(cleanTitle);
  const directTargets = [
    {
      merchantId: 'amazon',
      storeName: 'Amazon India',
      searchUrl: `https://www.amazon.in/s?k=${enc}`,
      parse: ($) => {
        let match = null;
        $('div[data-component-type="s-search-result"]').each((_, el) => {
          if (match) return;
          const card = $(el);
          const title = card.find('h2 span').first().text().trim();
          const offscreen = card.find('.a-price .a-offscreen').first().text();
          const whole = card.find('.a-price-whole').first().text();
          const price = parsePriceNumber(offscreen) || parsePriceNumber(whole);
          if (price > 0 && title && isRelevantCandidate(cleanTitle, title, price, referencePrice)) {
            const href = card.find('h2 a').attr('href');
            const cardText = card.text();
            const disc = parseBankDiscountAmount(cardText, price);
            match = {
              price,
              saleDiscount: disc,
              productTitle: title,
              url: href ? (href.startsWith('http') ? href : `https://www.amazon.in${href}`) : `https://www.amazon.in/s?k=${enc}`
            };
          }
        });
        return match;
      }
    },
    {
      merchantId: 'flipkart',
      storeName: 'Flipkart',
      searchUrl: `https://www.flipkart.com/search?q=${enc}`,
      parse: ($) => {
        let match = null;
        $('div[data-id]').each((_, el) => {
          if (match) return;
          const card = $(el);
          const title = (
            card.find('div.KzDlHZ').first().text() ||
            card.find('a.wjcEIp').first().attr('title') ||
            card.find('a.wjcEIp').first().text() ||
            card.find('div._4rR01T').first().text() ||
            card.find('a.s1Q9rs').first().text()
          ).trim();
          const priceText = card.find('div.Nx9bqj, div._30jeq3').first().text();
          const price = parsePriceNumber(priceText);
          if (price > 0 && title && isRelevantCandidate(cleanTitle, title, price, referencePrice)) {
            const href = card.find('a[href*="/p/"]').first().attr('href');
            const disc = parseBankDiscountAmount(card.text(), price);
            match = {
              price,
              saleDiscount: disc,
              productTitle: title,
              url: href ? (href.startsWith('http') ? href : `https://www.flipkart.com${href}`) : `https://www.flipkart.com/search?q=${enc}`
            };
          }
        });
        return match;
      }
    },
    {
      merchantId: 'croma',
      storeName: 'Croma',
      searchUrl: `https://www.croma.com/searchB?q=${enc}`,
      parse: ($) => {
        let match = null;
        $('li.product-item, div.cp-product').each((_, el) => {
          if (match) return;
          const card = $(el);
          const title = card.find('h3.product-title, .product-title').first().text().trim();
          const price = parsePriceNumber(card.find('span.amount').first().text());
          if (price > 0 && title && isRelevantCandidate(cleanTitle, title, price, referencePrice)) {
            match = {
              price,
              saleDiscount: 0,
              productTitle: title,
              url: `https://www.croma.com/searchB?q=${enc}`
            };
          }
        });
        return match;
      }
    }
  ];

  const [directSettled, webResults] = await Promise.all([
    Promise.allSettled(directTargets.map(async (t) => {
      try {
        const resp = await axios.get(buildFetchUrl(t.searchUrl, scraperKey), {
          headers: BROWSER_HEADERS,
          timeout: 9500
        });
        const $ = cheerio.load(resp.data || '');
        const parsed = t.parse($);
        if (parsed && parsed.price > 0) {
          return {
            merchantId: t.merchantId,
            storeName: t.storeName,
            price: parsed.price,
            saleDiscount: parsed.saleDiscount || 0,
            productTitle: parsed.productTitle,
            url: parsed.url
          };
        }
      } catch (e) {}
      return null;
    })),
    searchCrossPlatformWeb(cleanTitle, referencePrice, scraperKey)
  ]);

  for (const item of directSettled) {
    if (item.status === 'fulfilled' && item.value) {
      results.push(item.value);
    }
  }

  for (const wr of webResults) {
    if (!results.some(r => r.merchantId === wr.merchantId)) {
      results.push(wr);
    }
  }

  return results;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CardPick Multi-Store Price & Card Backend v2.2',
    hasSerpApi: Boolean(SERPAPI_KEY),
    hasScraperApi: Boolean(SCRAPERAPI_KEY)
  });
});

app.post('/api/fetch-prices', async (req, res) => {
  try {
    const { queryOrUrl, serpApiKey, scraperApiKey } = req.body || {};
    if (!queryOrUrl || !String(queryOrUrl).trim()) {
      return res.status(400).json({ ok: false, error: 'Provide a product URL or product name' });
    }

    const input = String(queryOrUrl).trim();
    const isUrl = /^https?:\/\//i.test(input) || /\.(in|com|co|it)\//i.test(input);

    let searchQuery = normalizeSearchQuery(input);
    let originData = null;

    if (isUrl) {
      const normalizedUrl = /^https?:\/\//i.test(input) ? input : `https://${input}`;
      originData = await resolveAndExtractOriginProduct(normalizedUrl, scraperApiKey);
      if (originData && originData.searchQuery) {
        searchQuery = originData.searchQuery;
      }
    }

    const refPrice = originData && originData.originPrice > 0 ? originData.originPrice : 0;
    const stores = await searchStorePrices(searchQuery, refPrice, serpApiKey, scraperApiKey);

    if (originData && originData.originPrice > 0 && originData.originStore.id !== 'other') {
      const idx = stores.findIndex(s => s.merchantId === originData.originStore.id);
      const originEntry = {
        merchantId: originData.originStore.id,
        storeName: originData.originStore.name,
        price: originData.originPrice,
        saleDiscount: originData.originSaleDiscount || 0,
        productTitle: originData.title,
        url: originData.originUrl
      };
      if (idx >= 0) {
        stores[idx] = originEntry;
      } else {
        stores.unshift(originEntry);
      }
    }

    return res.json({
      ok: true,
      productTitle: searchQuery,
      fullTitle: (originData && originData.title) || searchQuery,
      originData,
      stores
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to fetch multi-store prices'
    });
  }
});

app.listen(PORT, () => {
  console.log(`CardPick Full-Stack Server v2.2 running on http://localhost:${PORT}`);
});
