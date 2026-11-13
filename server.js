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

// Standard desktop browser headers to minimize blocks
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
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
  const cleaned = String(raw).replace(/[^0-9.]/g, '');
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
    const stop = new Set(['dp', 'p', 's', 'gp', 'd', 'product', 'buy', 'shop', 'ref', 'itm']);
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
  } catch (err) {
    // Fallback to slug extraction if blocked
  }

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

    // 2. Store-specific DOM selectors (Amazon / Flipkart / Croma / Meta tags)
    if (!title) {
      title = $('#productTitle').text().trim() ||
              $('span.VU-ZEz').text().trim() ||
              $('h1.pd-title').text().trim() ||
              $('meta[property="og:title"]').attr('content') ||
              $('title').text().trim();
    }

    if (!price) {
      const amzWhole = $('.a-price.priceToPay .a-price-whole, #corePriceDisplay_desktop_feature_div .a-price-whole, #corePrice_feature_div .a-price-whole').first().text();
      const fkPrice = $('div.Nx9bqj.CxhGGd, div._30jeq3._16Jk6d').first().text();
      const metaPrice = $('meta[property="product:price:amount"], meta[property="og:price:amount"]').attr('content');
      price = parsePriceNumber(amzWhole) || parsePriceNumber(fkPrice) || parsePriceNumber(metaPrice);
    }

    // 3. Extract visible bank offer / sale snippets
    $('.offers-items-content, .vsx-offers-count, .WT_R32, ._3j4Zjq, .bank-offer').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length > 10 && t.length < 180 && bankOffers.length < 4) {
        bankOffers.push(t);
      }
    });
  }

  if (!title) {
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

async function searchStorePrices(productTitle, serpApiKey, scraperKey) {
  const cleanTitle = (productTitle || '').split(/[(|,]/)[0].trim().slice(0, 90);
  if (!cleanTitle) return [];

  const results = [];
  const activeSerpKey = serpApiKey || SERPAPI_KEY;

  // Route A: SerpApi Google Shopping India (if API key provided)
  if (activeSerpKey) {
    try {
      const serpUrl = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(cleanTitle)}&gl=in&hl=en&api_key=${encodeURIComponent(activeSerpKey)}`;
      const resp = await axios.get(serpUrl, { timeout: 12000 });
      const shopping = (resp.data && resp.data.shopping_results) || [];
      for (const item of shopping) {
        const source = (item.source || '').toLowerCase();
        const price = parsePriceNumber(item.extracted_price || item.price);
        if (!price) continue;

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
            url: item.link || item.product_link || '',
            delivery: item.delivery || ''
          });
        }
      }
      if (results.length > 0) return results;
    } catch (e) {}
  }

  // Route B: Concurrent direct search across Amazon.in, Flipkart, and Croma
  const enc = encodeURIComponent(cleanTitle);
  const targets = [
    {
      merchantId: 'amazon',
      storeName: 'Amazon India',
      searchUrl: `https://www.amazon.in/s?k=${enc}`,
      parse: ($) => {
        const first = $('div[data-component-type="s-search-result"]').first();
        const price = parsePriceNumber(first.find('.a-price-whole').first().text());
        const title = first.find('h2 span').first().text().trim();
        const href = first.find('h2 a').attr('href');
        return price ? { price, productTitle: title, url: href ? `https://www.amazon.in${href}` : `https://www.amazon.in/s?k=${enc}` } : null;
      }
    },
    {
      merchantId: 'flipkart',
      storeName: 'Flipkart',
      searchUrl: `https://www.flipkart.com/search?q=${enc}`,
      parse: ($) => {
        const priceText = $('div.Nx9bqj, div._30jeq3').first().text();
        const price = parsePriceNumber(priceText);
        const title = $('div.KzDlHZ, a.wjcEIp, div._4rR01T').first().text().trim();
        return price ? { price, productTitle: title || cleanTitle, url: `https://www.flipkart.com/search?q=${enc}` } : null;
      }
    },
    {
      merchantId: 'croma',
      storeName: 'Croma',
      searchUrl: `https://www.croma.com/searchB?q=${enc}`,
      parse: ($) => {
        const priceText = $('span.amount').first().text();
        const price = parsePriceNumber(priceText);
        const title = $('h3.product-title').first().text().trim();
        return price ? { price, productTitle: title || cleanTitle, url: `https://www.croma.com/searchB?q=${enc}` } : null;
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CardPick Multi-Store Price & Card Backend',
    hasSerpApi: Boolean(SERPAPI_KEY),
    hasScraperApi: Boolean(SCRAPERAPI_KEY)
  });
});

// Main endpoint: POST /api/fetch-prices
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

    const stores = await searchStorePrices(productTitle, serpApiKey, scraperApiKey);

    // Ensure origin store price is included if scraped directly from product URL
    if (originData && originData.originPrice > 0 && originData.originStore.id !== 'other') {
      const existing = stores.find(s => s.merchantId === originData.originStore.id);
      if (!existing) {
        stores.unshift({
          merchantId: originData.originStore.id,
          storeName: originData.originStore.name,
          price: originData.originPrice,
          saleDiscount: 0,
          productTitle: originData.title,
          url: originData.originUrl
        });
      }
    }

    return res.json({
      ok: true,
      productTitle,
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
  console.log(`CardPick Full-Stack Server running on http://localhost:${PORT}`);
});
