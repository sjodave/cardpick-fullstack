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

const DESKTOP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache'
};

const BOT_PREVIEW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/2.23.20.0; +http://www.whatsapp.com/)',
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

// Extract clean product URL from messy share text (e.g. "Take a look at this ... on Flipkart https://dl.flipkart.com/s/...")
function extractCleanUrlFromText(raw) {
  const str = String(raw || '').trim();
  const urlMatch = str.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    return urlMatch[0].replace(/[.,;!?)]+$/, '');
  }
  const bareMatch = str.match(/\b(?:(?:www|dl)\.)?(?:amazon\.in|amzn\.in|amzn\.to|flipkart\.com|fkrt\.it|fkrt\.cc|croma\.com|reliancedigital\.in|vijaysales\.com|myntra\.com|myntr\.it|ajio\.com|tatacliq\.com|nykaa\.com)\/[^\s"'<>]*/i);
  if (bareMatch) {
    return 'https://' + bareMatch[0].replace(/[.,;!?)]+$/, '');
  }
  return '';
}

function parsePriceNumber(raw) {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw >= 50 && raw <= 2000000 ? Math.round(raw) : 0;
  const str = String(raw).trim().split(/\r|\n/)[0];
  const m = str.match(/(?:₹|Rs\.?|INR)?\s*(\d[\d,]*(\.\d{1,2})?)/i);
  if (!m) return 0;
  const cleaned = m[1].replace(/,/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num >= 50 && num <= 2000000 ? Math.round(num) : 0;
}

// Parse Indian prices from search snippets / titles (must have ₹, Rs., or INR prefix)
function parseExplicitRupeePrice(text) {
  if (!text) return 0;
  const matches = [...String(text).matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]{3,9}(?:\.\d{1,2})?)/gi)];
  for (const m of matches) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 100 && val <= 1500000) return val;
  }
  return 0;
}

function parseBankDiscountAmount(text, productPrice) {
  const t = String(text || '');
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

function detectStoreId(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h.includes('amazon') || h.includes('amzn')) return { id: 'amazon', name: 'Amazon India', site: 'amazon.in' };
  if (h.includes('flipkart') || h.includes('fkrt')) return { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com' };
  if (h.includes('croma')) return { id: 'croma', name: 'Croma', site: 'croma.com' };
  if (h.includes('reliancedigital')) return { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in' };
  if (h.includes('vijaysales')) return { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com' };
  if (h.includes('myntra') || h.includes('myntr')) return { id: 'myntra', name: 'Myntra', site: 'myntra.com' };
  if (h.includes('ajio')) return { id: 'ajio', name: 'AJIO', site: 'ajio.com' };
  if (h.includes('tatacliq')) return { id: 'tatacliq', name: 'Tata CLiQ', site: 'tatacliq.com' };
  if (h.includes('nykaa')) return { id: 'nykaa', name: 'Nykaa', site: 'nykaa.com' };
  return { id: 'other', name: h.replace(/^www\./, '') || 'Online Store', site: h };
}

function normalizeSearchQuery(rawTitle) {
  let s = String(rawTitle || '').trim();
  if (!s) return '';

  // Remove URLs if any leaked in
  s = s.replace(/https?:\/\/[^\s]+/gi, ' ');
  // Remove Flipkart/Amazon share prefixes & suffixes
  s = s.replace(/^(?:take a look at this|check out this|buy)\s+/i, '');
  s = s.replace(/\s+on\s+(?:flipkart|amazon|myntra|croma|ajio).*$/i, '');
  s = s.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Buy Online|Price in India.*).*$/i, '');
  s = s.replace(/\b(?:Price in India|Buy Online|Specifications|Features|Review|Online at Best Price)\b.*$/i, '');

  // Preserve key specs like 128GB, 256GB, 512GB, 8GB, 12GB, 5G
  const specs = [];
  const specMatches = s.match(/\b(\d+\s*(?:GB|TB)|5G|Wi-Fi|ANC)\b/gi) || [];
  for (const sp of specMatches) {
    const cleanSp = sp.replace(/\s+/g, '').toUpperCase();
    if (!specs.includes(cleanSp) && specs.length < 3) specs.push(cleanSp);
  }

  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.split(/[|;]/)[0].split(',')[0];
  s = s.replace(/\b(with\s+.*|for\s+men.*|for\s+women.*|compatible\s+with.*|includes\s+.*|no\s+cost\s+emi.*|exchange\s+offer.*)\b/gi, ' ');
  s = s.replace(/[^a-zA-Z0-9\s+.-]/g, ' ').replace(/\s+/g, ' ').trim();

  const words = s.split(' ').filter(Boolean).slice(0, 7);
  let base = words.join(' ');
  for (const sp of specs) {
    if (!new RegExp(`\\b${sp}\\b`, 'i').test(base)) {
      base += ' ' + sp;
    }
  }
  return base.trim();
}

function extractInfoFromUrl(urlStr) {
  let slugTitle = '';
  let productId = '';
  try {
    const u = new URL(urlStr);
    const pidParam = u.searchParams.get('pid');
    if (pidParam) productId = pidParam;

    const qParam = u.searchParams.get('k') || u.searchParams.get('q');
    if (qParam && qParam.trim().length > 2) {
      return { slugTitle: normalizeSearchQuery(qParam), productId };
    }

    const parts = u.pathname.split('/').filter(Boolean);
    for (const p of parts) {
      if (/^B0[A-Z0-9]{8}$/i.test(p)) productId = p;
      if (/^itm[a-z0-9]{8,}$/i.test(p) && !productId) productId = p;
    }

    const stop = new Set(['dp', 'p', 's', 'gp', 'd', 'product', 'buy', 'shop', 'ref', 'itm', 'dl']);
    const slugParts = parts.filter(p => {
      const lp = p.toLowerCase();
      if (stop.has(lp)) return false;
      if (/^B0[A-Z0-9]{8}$/i.test(p)) return false;
      if (/^itm[a-z0-9]+$/i.test(p)) return false;
      if (/^\d+$/.test(p)) return false;
      return p.length >= 3;
    });

    if (slugParts.length > 0) {
      const longest = slugParts.sort((a, b) => b.length - a.length)[0];
      const raw = decodeURIComponent(longest).replace(/[-_+]+/g, ' ').trim();
      slugTitle = normalizeSearchQuery(raw);
    }
  } catch (e) {}
  return { slugTitle, productId };
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
    if (candidatePrice < referencePrice * 0.48 || candidatePrice > referencePrice * 1.75) {
      return false;
    }
  }

  const qTokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !['with', 'for', 'and', 'the', 'new', 'buy', 'online', 'black', 'white', 'blue', 'green', 'silver', 'gold', 'grey', 'gray', 'gb', 'tb', '5g', 'ram', 'rom'].includes(t));
  if (qTokens.length === 0) return true;

  if (qTokens[0].length >= 3 && !cand.includes(qTokens[0])) {
    return false;
  }

  let matched = 0;
  for (const t of qTokens) {
    if (cand.includes(t)) matched++;
  }
  return (matched / qTokens.length) >= 0.5;
}

// Parse Flipkart / Amazon / Croma product HTML including embedded JSON state
function parseProductHtml(html) {
  let title = '';
  let price = 0;
  let bankOffers = [];
  let maxBankDiscount = 0;

  if (!html) return { title, price, bankOffers, maxBankDiscount };
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

  // 2. OpenGraph / Meta tags & DOM selectors
  if (!title) {
    title = $('#productTitle').text().trim() ||
            $('span.VU-ZEz').text().trim() ||
            $('h1.yhB1nd').text().trim() ||
            $('h1.pd-title').text().trim() ||
            $('meta[property="og:title"]').attr('content') ||
            $('meta[name="twitter:title"]').attr('content') ||
            $('title').text().trim();
  }

  if (!price) {
    const amzOffscreen = $('#corePriceDisplay_desktop_feature_div .a-price.priceToPay .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #apex_desktop .a-price.priceToPay .a-offscreen').first().text();
    const amzWhole = $('#corePriceDisplay_desktop_feature_div .a-price-whole, #corePrice_feature_div .a-price-whole').first().text();
    const fkPrice = $('div.Nx9bqj.CxhGGd, div._30jeq3._16Jk6d, div.hl05eU .Nx9bqj').first().text();
    const metaPrice = $('meta[property="product:price:amount"], meta[property="og:price:amount"], meta[name="twitter:data1"]').attr('content');
    price = parsePriceNumber(amzOffscreen) || parsePriceNumber(amzWhole) || parsePriceNumber(fkPrice) || parsePriceNumber(metaPrice);
  }

  // 3. Regex scan inside embedded Flipkart/Next/React hydration state if price is still 0
  if (!price) {
    const stateMatch =
      html.match(/"finalPrice"\s*:\s*\{[^}]*"value"\s*:\s*(\d+)/) ||
      html.match(/"sellingPrice"\s*:\s*(\d+)/) ||
      html.match(/"specialPrice"\s*:\s*(\d+)/) ||
      html.match(/"price"\s*:\s*"(\d+)"/) ||
      html.match(/₹\s*([\d,]{3,8})/);
    if (stateMatch) {
      price = parsePriceNumber(stateMatch[1]);
    }
  }

  // 4. Check OpenGraph description for price if still 0
  if (!price) {
    const desc = $('meta[property="og:description"], meta[name="description"]').attr('content') || '';
    price = parseExplicitRupeePrice(desc) || parseExplicitRupeePrice(title);
  }

  // 5. Extract bank offers
  $('.offers-items-content, .vsx-offers-count, .WT_R32, ._3j4Zjq, .bank-offer, #itembox-InstantBankDiscount').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && t.length > 10 && t.length < 200 && bankOffers.length < 4) {
      bankOffers.push(t);
      const d = parseBankDiscountAmount(t, price);
      if (d > maxBankDiscount) maxBankDiscount = d;
    }
  });

  if (/robot check|captcha|access denied|online shopping site in india|something went wrong/i.test(title)) {
    title = '';
  }

  return { title, price, bankOffers, maxBankDiscount };
}

// Search Yahoo India for a specific URL, Product ID (pid / ASIN), or store query
async function lookupProductViaWebIndex(query, targetSite, referencePrice, scraperKey) {
  try {
    const q = targetSite ? `${query} site:${targetSite}` : query;
    const searchUrl = `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}`;
    const resp = await axios.get(buildFetchUrl(searchUrl, scraperKey), {
      headers: DESKTOP_HEADERS,
      timeout: 9000
    });
    const $ = cheerio.load(resp.data || '');

    let best = null;
    $('div.algo, div.dd.algo').each((_, el) => {
      if (best) return;
      const block = $(el);
      const rawTitle = block.find('h3.title').text().replace(/\s+/g, ' ').trim();
      const snippet = block.find('.compText, .fc-falcon').text().replace(/\s+/g, ' ').trim();
      let href = block.find('h3.title a').attr('href') || '';
      const ruMatch = href.match(/\/RU=([^/]+)\//);
      if (ruMatch) {
        try { href = decodeURIComponent(ruMatch[1]); } catch (e) {}
      }

      // Skip generic search pages; require actual product page or clear title
      if (!rawTitle) return;
      const cleanTitle = rawTitle.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Buy Online|Price in India.*).*$/i, '').trim();

      const combined = `${rawTitle} ${snippet}`;
      const pVal = parseExplicitRupeePrice(combined);
      const disc = parseBankDiscountAmount(combined, pVal);

      if (pVal > 0 && isRelevantCandidate(query, cleanTitle, pVal, referencePrice)) {
        best = {
          title: cleanTitle,
          price: pVal,
          saleDiscount: disc,
          url: href,
          snippet
        };
      } else if (!best && !targetSite && cleanTitle.length > 5) {
        // Even if snippet didn't have price, we can still recover the exact product title for a blocked Flipkart URL
        best = {
          title: cleanTitle,
          price: pVal || 0,
          saleDiscount: disc,
          url: href,
          snippet
        };
      }
    });
    return best;
  } catch (e) {
    return null;
  }
}

async function resolveAndExtractOriginProduct(rawInput, inputUrl, scraperKey) {
  let finalUrl = inputUrl;
  let html = '';

  // Also check if user pasted share text that already has the product title before the URL!
  const textBeforeUrl = String(rawInput || '').replace(/https?:\/\/[^\s]+/gi, '').replace(/^(?:take a look at this|check out this)\s+/i, '').replace(/\s+on\s+(?:flipkart|amazon).*$/i, '').trim();

  // Attempt 1: Bot/Preview User-Agent (often bypasses Flipkart/Amazon datacenter blocks and returns full OG tags)
  try {
    const resp = await axios.get(buildFetchUrl(inputUrl, scraperKey), {
      headers: BOT_PREVIEW_HEADERS,
      maxRedirects: 8,
      timeout: 9000
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

  let parsed = parseProductHtml(html);

  // Attempt 2: Desktop User-Agent if Bot UA didn't yield price
  if (!parsed.price || !parsed.title) {
    try {
      const resp2 = await axios.get(buildFetchUrl(finalUrl, scraperKey), {
        headers: DESKTOP_HEADERS,
        maxRedirects: 5,
        timeout: 9000
      });
      if (resp2.request && resp2.request.res && resp2.request.res.responseUrl && !scraperKey) {
        finalUrl = resp2.request.res.responseUrl;
      }
      const parsed2 = parseProductHtml(typeof resp2.data === 'string' ? resp2.data : '');
      if (!parsed.title && parsed2.title) parsed.title = parsed2.title;
      if (!parsed.price && parsed2.price) parsed.price = parsed2.price;
      if (parsed2.bankOffers.length > 0) parsed.bankOffers = parsed2.bankOffers;
      if (parsed2.maxBankDiscount > parsed.maxBankDiscount) parsed.maxBankDiscount = parsed2.maxBankDiscount;
    } catch (e) {}
  }

  let hostname = '';
  try { hostname = new URL(finalUrl).hostname; } catch (e) {}
  const storeInfo = detectStoreId(hostname);
  const { slugTitle, productId } = extractInfoFromUrl(finalUrl);

  let bestTitle = parsed.title || textBeforeUrl || slugTitle;
  let bestPrice = parsed.price;
  let bestDiscount = parsed.maxBankDiscount;

  // Attempt 3: If Flipkart/Amazon blocked Render's IP (so price or title is still missing), query Yahoo India by productId or slugTitle!
  if (!bestPrice || !bestTitle) {
    const lookupQ = productId ? `${slugTitle} ${productId}`.trim() : slugTitle;
    if (lookupQ) {
      const indexed = await lookupProductViaWebIndex(lookupQ, storeInfo.site !== 'other' ? storeInfo.site : '', 0, scraperKey);
      if (indexed) {
        if (!bestTitle && indexed.title) bestTitle = indexed.title;
        if (!bestPrice && indexed.price > 0) bestPrice = indexed.price;
        if (!bestDiscount && indexed.saleDiscount > 0) bestDiscount = indexed.saleDiscount;
        if (indexed.url && finalUrl.includes('/s/')) finalUrl = indexed.url;
      }
    }
  }

  const searchQuery = normalizeSearchQuery(bestTitle) || slugTitle || normalizeSearchQuery(rawInput);

  return {
    title: bestTitle || searchQuery || inputUrl,
    searchQuery: searchQuery || bestTitle || inputUrl,
    productId,
    originStore: storeInfo,
    originPrice: bestPrice,
    originSaleDiscount: bestDiscount,
    originUrl: finalUrl,
    bankOffers: parsed.bankOffers
  };
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
      if (results.length >= 3) return results;
    } catch (e) {}
  }

  // 2. Direct Store Scraping + Yahoo India Cross-Platform Search in parallel
  const enc = encodeURIComponent(cleanTitle);
  const directTargets = [
    {
      merchantId: 'amazon',
      storeName: 'Amazon India',
      site: 'amazon.in',
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
            const disc = parseBankDiscountAmount(card.text(), price);
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
      site: 'flipkart.com',
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
      site: 'croma.com',
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

  const webTargets = [
    { id: 'amazon', name: 'Amazon India', site: 'amazon.in', fallbackUrl: `https://www.amazon.in/s?k=${enc}` },
    { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com', fallbackUrl: `https://www.flipkart.com/search?q=${enc}` },
    { id: 'croma', name: 'Croma', site: 'croma.com', fallbackUrl: `https://www.croma.com/searchB?q=${enc}` },
    { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in', fallbackUrl: `https://www.reliancedigital.in/search?q=${enc}` },
    { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com', fallbackUrl: `https://www.vijaysales.com/search/${enc}` }
  ];

  const [directSettled, webSettled] = await Promise.all([
    Promise.allSettled(directTargets.map(async (t) => {
      try {
        const resp = await axios.get(buildFetchUrl(t.searchUrl, scraperKey), {
          headers: DESKTOP_HEADERS,
          timeout: 8500
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
    Promise.allSettled(webTargets.map(async (wt) => {
      const found = await lookupProductViaWebIndex(cleanTitle, wt.site, referencePrice, scraperKey);
      if (found && found.price > 0) {
        return {
          merchantId: wt.id,
          storeName: wt.name,
          price: found.price,
          saleDiscount: found.saleDiscount || 0,
          productTitle: found.title,
          url: found.url || wt.fallbackUrl
        };
      }
      return null;
    }))
  ]);

  for (const item of directSettled) {
    if (item.status === 'fulfilled' && item.value && !results.some(r => r.merchantId === item.value.merchantId)) {
      results.push(item.value);
    }
  }

  for (const item of webSettled) {
    if (item.status === 'fulfilled' && item.value && !results.some(r => r.merchantId === item.value.merchantId)) {
      results.push(item.value);
    }
  }

  return results;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CardPick Multi-Store Live Engine v3.0',
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

    const rawInput = String(queryOrUrl).trim();
    const extractedUrl = extractCleanUrlFromText(rawInput);

    let searchQuery = normalizeSearchQuery(rawInput);
    let originData = null;

    if (extractedUrl) {
      originData = await resolveAndExtractOriginProduct(rawInput, extractedUrl, scraperApiKey);
      if (originData && originData.searchQuery) {
        searchQuery = originData.searchQuery;
      }
    }

    const refPrice = originData && originData.originPrice > 0 ? originData.originPrice : 0;
    const stores = await searchStorePrices(searchQuery, refPrice, serpApiKey, scraperApiKey);

    // Guarantee origin store is present if we resolved a product URL
    if (originData && originData.originStore && originData.originStore.id !== 'other') {
      const idx = stores.findIndex(s => s.merchantId === originData.originStore.id);
      if (originData.originPrice > 0) {
        const originEntry = {
          merchantId: originData.originStore.id,
          storeName: originData.originStore.name,
          price: originData.originPrice,
          saleDiscount: originData.originSaleDiscount || 0,
          productTitle: originData.title,
          url: originData.originUrl
        };
        if (idx >= 0) {
          // Keep direct product URL from user's pasted link!
          stores[idx].url = originData.originUrl;
          if (!stores[idx].price) stores[idx].price = originData.originPrice;
        } else {
          stores.unshift(originEntry);
        }
      } else if (idx >= 0) {
        // Even if direct origin scrape had no price, overwrite the Flipkart/Amazon URL with the exact pasted URL!
        stores[idx].url = originData.originUrl;
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
  console.log(`CardPick Full-Stack Server v3.0 running on http://localhost:${PORT}`);
});
