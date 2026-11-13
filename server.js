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

function buildFetchUrl(targetUrl, apiKey) {
  const key = apiKey || SCRAPERAPI_KEY;
  if (key) {
    return `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}&country_code=in`;
  }
  return targetUrl;
}

function parsePriceNumber(raw) {
  if (!raw) return 0;
  // Take first integer/decimal group before any newline or extra rupee symbol
  const str = String(raw).trim().split(/\r|\n/)[0];
  const m = str.match(/(\d[\d,]*(\.\d{1,2})?)/);
  if (!m) return 0;
  const cleaned = m[1].replace(/,/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

function detectStoreId(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h.includes('amazon') || h.includes('amzn')) return { id: 'amazon', name: 'Amazon India' };
  if (h.includes('flipkart') || h.includes('fkrt')) return { id: 'flipkart', name: 'Flipkart' };
  if (h.includes('croma')) return { id: 'croma', name: 'Croma' };
  if (h.includes('reliancedigital')) return { id: 'reliancedigital', name: 'Reliance Digital' };
  if (h.includes('vijaysales')) return { id: 'vijaysales', name: 'Vijay Sales' };
  if (h.includes('myntra')) return { id: 'myntra', name: 'Myntra' };
  if (h.includes('ajio')) return { id: 'ajio', name: 'AJIO' };
  if (h.includes('tatacliq')) return { id: 'tatacliq', name: 'Tata CLiQ' };
  if (h.includes('nykaa')) return { id: 'nykaa', name: 'Nykaa' };
  return { id: 'other', name: h.replace(/^www\./, '') || 'Online Store' };
}

function extractTitleFromSlug(urlStr) {
  try {
    const u = new URL(urlStr);
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
      return decodeURIComponent(longest).replace(/[-_+]+/g, ' ').trim();
    }
  } catch (e) {}
  return '';
}

// Compute token overlap & guard against matching a ₹299 case/cover for a ₹50,000 phone
function isRelevantCandidate(queryTitle, candidateTitle, candidatePrice, referencePrice) {
  const cand = (candidateTitle || '').toLowerCase();
  const q = (queryTitle || '').toLowerCase();

  // If query is not an accessory, reject obvious accessory words
  const accessoryWords = ['case', 'cover', 'tempered', 'glass', 'screen guard', 'protector', 'back cover', 'pouch', 'skin', 'strap', 'cable', 'adapter', 'stand', 'holder'];
  for (const w of accessoryWords) {
    if (cand.includes(w) && !q.includes(w)) {
      return false;
    }
  }

  // If we know the origin product price, reject items outside 0.45x – 1.85x of origin price
  if (referencePrice > 500 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.45 || candidatePrice > referencePrice * 1.85) {
      return false;
    }
  }

  // Token overlap check
  const qTokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !['with', 'for', 'and', 'the', 'new', 'buy', 'online'].includes(t));
  if (qTokens.length === 0) return true;
  let matched = 0;
  for (const t of qTokens) {
    if (cand.includes(t)) matched++;
  }
  const ratio = matched / qTokens.length;
  return ratio >= 0.45;
}

async function resolveAndExtractOriginProduct(inputUrl, scraperKey) {
  let finalUrl = inputUrl;
  let html = '';

  try {
    const resp = await axios.get(buildFetchUrl(inputUrl, scraperKey), {
      headers: BROWSER_HEADERS,
      maxRedirects: 5,
      timeout: 12000
    });
    html = typeof resp.data === 'string' ? resp.data : '';
    if (resp.request && resp.request.res && resp.request.res.responseUrl && !scraperKey) {
      finalUrl = resp.request.res.responseUrl;
    }
  } catch (err) {}

  let hostname = '';
  try { hostname = new URL(finalUrl).hostname; } catch (e) {}
  const storeInfo = detectStoreId(hostname);

  let title = '';
  let price = 0;
  let bankOffers = [];

  if (html) {
    const $ = cheerio.load(html);

    // 1. JSON-LD Product schema
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        for (const item of items) {
          if (item && (item['@type'] === 'Product' || item['@type'] === 'Book')) {
            if (!title && item.name) title = String(item.name).trim();
            const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (!price && offers && (offers.price || offers.lowPrice)) {
              price = parsePriceNumber(offers.price || offers.lowPrice);
            }
          }
        }
      } catch (e) {}
    });

    // 2. Store-specific main product block selectors (scoped strictly to main buybox, never carousels)
    if (!title) {
      title = $('#productTitle').text().trim() ||
              $('span.VU-ZEz').text().trim() ||
              $('h1.pd-title').text().trim() ||
              $('meta[property="og:title"]').attr('content') ||
              $('title').text().trim();
    }

    if (!price) {
      const amzOffscreen = $('#corePriceDisplay_desktop_feature_div .a-price.priceToPay .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #apex_desktop .a-price.priceToPay .a-offscreen').first().text();
      const amzWhole = $('#corePriceDisplay_desktop_feature_div .a-price-whole, #corePrice_feature_div .a-price-whole').first().text();
      const fkPrice = $('div.Nx9bqj.CxhGGd, div._30jeq3._16Jk6d').first().text();
      const metaPrice = $('meta[property="product:price:amount"], meta[property="og:price:amount"]').attr('content');
      price = parsePriceNumber(amzOffscreen) || parsePriceNumber(amzWhole) || parsePriceNumber(fkPrice) || parsePriceNumber(metaPrice);
    }

    // 3. Extract visible bank offer / sale snippets
    $('.offers-items-content, .vsx-offers-count, .WT_R32, ._3j4Zjq, .bank-offer').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length > 10 && t.length < 180 && bankOffers.length < 4) {
        bankOffers.push(t);
      }
    });
  }

  if (!title || /robot check|captcha|access denied/i.test(title)) {
    title = extractTitleFromSlug(finalUrl) || extractTitleFromSlug(inputUrl) || inputUrl;
  }
  title = title.replace(/\s*[:|–-]\s*(Amazon\.in|Flipkart\.com|Buy Online.*).*$/i, '').trim();

  return {
    title,
    originStore: storeInfo,
    originPrice: price,
    originUrl: finalUrl,
    bankOffers
  };
}

async function searchStorePrices(productTitle, referencePrice, serpApiKey, scraperKey) {
  const cleanTitle = (productTitle || '').split(/[(|]/)[0].replace(/\s+/g, ' ').trim().slice(0, 95);
  if (!cleanTitle) return [];

  const results = [];
  const activeSerpKey = serpApiKey || SERPAPI_KEY;

  // Route A: SerpApi Google Shopping India (most reliable from cloud IPs like Render)
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
      if (results.length > 0) return results;
    } catch (e) {}
  }

  // Route B: Direct store search with strict non-sponsored & title/price relevance filtering
  const enc = encodeURIComponent(cleanTitle);
  const targets = [
    {
      merchantId: 'amazon',
      storeName: 'Amazon India',
      searchUrl: `https://www.amazon.in/s?k=${enc}`,
      parse: ($) => {
        let match = null;
        $('div[data-component-type="s-search-result"]').each((_, el) => {
          if (match) return;
          const card = $(el);
          // Skip sponsored cards if organic results exist
          const title = card.find('h2 span').first().text().trim();
          const offscreen = card.find('.a-price .a-offscreen').first().text();
          const whole = card.find('.a-price-whole').first().text();
          const price = parsePriceNumber(offscreen) || parsePriceNumber(whole);
          if (price > 0 && title && isRelevantCandidate(cleanTitle, title, price, referencePrice)) {
            const href = card.find('h2 a').attr('href');
            match = {
              price,
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
            match = {
              price,
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
              productTitle: title,
              url: `https://www.croma.com/searchB?q=${enc}`
            };
          }
        });
        return match;
      }
    }
  ];

  await Promise.allSettled(targets.map(async (t) => {
    try {
      const resp = await axios.get(buildFetchUrl(t.searchUrl, scraperKey), {
        headers: BROWSER_HEADERS,
        timeout: 10000
      });
      const $ = cheerio.load(resp.data || '');
      const parsed = t.parse($);
      if (parsed && parsed.price > 0) {
        results.push({
          merchantId: t.merchantId,
          storeName: t.storeName,
          price: parsed.price,
          saleDiscount: 0,
          productTitle: parsed.productTitle,
          url: parsed.url
        });
      }
    } catch (e) {}
  }));

  return results;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CardPick Multi-Store Price & Card Backend v2.1',
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
    const isUrl = /^https?:\/\//i.test(input) || /\.(in|com|co)\//i.test(input);

    let productTitle = input;
    let originData = null;

    if (isUrl) {
      const normalizedUrl = /^https?:\/\//i.test(input) ? input : `https://${input}`;
      originData = await resolveAndExtractOriginProduct(normalizedUrl, scraperApiKey);
      if (originData && originData.title) {
        productTitle = originData.title;
      }
    }

    const refPrice = originData && originData.originPrice > 0 ? originData.originPrice : 0;
    const stores = await searchStorePrices(productTitle, refPrice, serpApiKey, scraperApiKey);

    if (originData && originData.originPrice > 0 && originData.originStore.id !== 'other') {
      const idx = stores.findIndex(s => s.merchantId === originData.originStore.id);
      const originEntry = {
        merchantId: originData.originStore.id,
        storeName: originData.originStore.name,
        price: originData.originPrice,
        saleDiscount: 0,
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
      productTitle,
      originData,
      stores,
      usedSerpApi: Boolean(serpApiKey || SERPAPI_KEY)
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to fetch multi-store prices'
    });
  }
});

app.listen(PORT, () => {
  console.log(`CardPick Full-Stack Server v2.1 running on http://localhost:${PORT}`);
});
