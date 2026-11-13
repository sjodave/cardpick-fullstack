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
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
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

// Extract all rupee prices mentioned in a text block and sort ascending
function extractAllRupeePrices(text) {
  if (!text) return [];
  const matches = [...String(text).matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]{3,9}(?:\.\d{1,2})?)/gi)];
  const nums = [];
  for (const m of matches) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 100 && val <= 1500000 && !nums.includes(val)) {
      nums.push(val);
    }
  }
  return nums;
}

// Parse WOW! DEAL ("Buy at ₹1,18,999"), net effective prices, or instant bank discount amounts
function parseSaleAndWowDeal(text, listedPrice) {
  const t = String(text || '').replace(/\s+/g, ' ');
  let bestDiscount = 0;

  // 1. Check for "Buy at ₹1,18,999" / "Effective Price ₹..." / "Net Effective Price ₹..." / "Deal Price ₹..."
  const buyAtMatches = [...t.matchAll(/(?:buy\s+at|wow!?\s*deal[^₹]*|effective\s+price[^₹]*|net\s+price[^₹]*|special\s+offer\s+price[^₹]*)(?:₹|rs\.?|inr)\s*([\d,]{3,9})/gi)];
  for (const m of buyAtMatches) {
    const dealPrice = parseInt(m[1].replace(/,/g, ''), 10);
    if (listedPrice > 500 && dealPrice > listedPrice * 0.55 && dealPrice < listedPrice) {
      const diff = listedPrice - dealPrice;
      if (diff > bestDiscount) bestDiscount = diff;
    }
  }

  // 2. Check for explicit "Flat ₹4,000 Off", "₹2,000 Instant Discount", etc.
  const discMatches = [
    ...t.matchAll(/(?:flat|instant|extra|up\s*to|get|save|additional)\s*(?:₹|rs\.?|inr)\s*([\d,]{2,7})\s*(?:off|instant|discount|cashback|on\s+bank|on\s+icici|on\s+hdfc|on\s+axis|on\s+sbi|on\s+credit)?/gi),
    ...t.matchAll(/(?:₹|rs\.?|inr)\s*([\d,]{2,7})\s*(?:instant\s*discount|off\s*on|bank\s*discount|off\s*with)/gi)
  ];
  for (const m of discMatches) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 50 && val <= 35000 && (!listedPrice || val <= listedPrice * 0.4)) {
      if (val > bestDiscount) bestDiscount = val;
    }
  }

  return bestDiscount;
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

  s = s.replace(/https?:\/\/[^\s]+/gi, ' ');
  s = s.replace(/^(?:take a look at this|check out this|buy)\s+/i, '');
  s = s.replace(/\s+on\s+(?:flipkart|amazon|myntra|croma|ajio).*$/i, '');
  s = s.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Buy Online|Price in India.*).*$/i, '');
  s = s.replace(/\b(?:Price in India|Buy Online|Specifications|Features|Review|Online at Best Price)\b.*$/i, '');

  // Preserve storage (e.g. 256GB, 512GB) — skip RAM if two GB specs exist so search isn't over-constrained
  const gbMatches = [...s.matchAll(/\b(\d+)\s*GB\b/gi)].map(m => parseInt(m[1], 10));
  const storageGb = gbMatches.find(n => n >= 64) || gbMatches[0] || 0;

  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.split(/[|;]/)[0].split(',')[0];
  s = s.replace(/\b(smartphone|mobile\s+phone|with\s+.*|for\s+men.*|for\s+women.*|compatible\s+with.*|includes\s+.*|no\s+cost\s+emi.*|exchange\s+offer.*)\b/gi, ' ');
  s = s.replace(/[^a-zA-Z0-9\s+.-]/g, ' ').replace(/\s+/g, ' ').trim();

  const colorStop = new Set(['mist', 'grey', 'gray', 'black', 'white', 'silver', 'gold', 'blue', 'green', 'titanium', 'pink', 'purple', 'red', 'orange', 'yellow']);
  const words = s.split(' ').filter(w => w && !colorStop.has(w.toLowerCase())).slice(0, 5);
  let base = words.join(' ');
  if (storageGb && !new RegExp(`\\b${storageGb}\\s*GB\\b`, 'i').test(base)) {
    base += ` ${storageGb}GB`;
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

  // Reject wrong storage variant if both specify storage (e.g. 256GB vs 512GB)
  const qStorage = (q.match(/\b(64|128|256|512|1024)\s*gb\b/i) || [])[1];
  const cStorage = (cand.match(/\b(64|128|256|512|1024)\s*gb\b/i) || [])[1];
  if (qStorage && cStorage && qStorage !== cStorage) {
    return false;
  }

  if (referencePrice > 800 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.48 || candidatePrice > referencePrice * 1.65) {
      return false;
    }
  }

  const qTokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !['with', 'for', 'and', 'the', 'new', 'buy', 'online', 'black', 'white', 'blue', 'green', 'silver', 'gold', 'grey', 'gray', 'gb', 'tb', '5g', 'ram', 'rom', 'smartphone'].includes(t));
  if (qTokens.length === 0) return true;

  // Every core model token (like "oppo", "find", "x10") should match
  let matched = 0;
  for (const t of qTokens) {
    if (cand.includes(t)) matched++;
  }
  return (matched / qTokens.length) >= 0.6;
}

function parseProductHtml(html) {
  let title = '';
  let price = 0;
  let bankOffers = [];
  let maxBankDiscount = 0;

  if (!html) return { title, price, bankOffers, maxBankDiscount };
  const $ = cheerio.load(html);

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

  if (!price) {
    const stateMatch =
      html.match(/"finalPrice"\s*:\s*\{[^}]*"value"\s*:\s*(\d+)/) ||
      html.match(/"sellingPrice"\s*:\s*(\d+)/) ||
      html.match(/"specialPrice"\s*:\s*(\d+)/) ||
      html.match(/"price"\s*:\s*"(\d+)"/);
    if (stateMatch) {
      price = parsePriceNumber(stateMatch[1]);
    }
  }

  if (!price) {
    const desc = $('meta[property="og:description"], meta[name="description"]').attr('content') || '';
    const descPrices = extractAllRupeePrices(desc);
    if (descPrices.length > 0) price = descPrices[0];
  }

  // Scan visible text and embedded state for WOW! DEAL ("Buy at ₹1,18,999") or bank offers
  const bodyText = $.root().text();
  const wowDisc = parseSaleAndWowDeal(bodyText, price);
  if (wowDisc > maxBankDiscount) {
    maxBankDiscount = wowDisc;
    bankOffers.push(`Deal / Bank Offer: Save ₹${wowDisc.toLocaleString('en-IN')} (Buy at ₹${(price - wowDisc).toLocaleString('en-IN')})`);
  }

  $('.offers-items-content, .vsx-offers-count, .WT_R32, ._3j4Zjq, .bank-offer, #itembox-InstantBankDiscount').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && t.length > 10 && t.length < 200 && bankOffers.length < 4) {
      bankOffers.push(t);
      const d = parseSaleAndWowDeal(t, price);
      if (d > maxBankDiscount) maxBankDiscount = d;
    }
  });

  if (/robot check|captcha|access denied|online shopping site in india|something went wrong/i.test(title)) {
    title = '';
  }

  return { title, price, bankOffers, maxBankDiscount };
}

// Multi-Engine Web Index Lookup (Yahoo India + DuckDuckGo HTML) so Flipkart/Croma are found even when direct store scraping is blocked
async function lookupProductViaWebIndex(query, targetSite, referencePrice, scraperKey) {
  const q = targetSite ? `${query} site:${targetSite}` : query;

  // Try Yahoo India first, then DuckDuckGo HTML
  const engines = [
    {
      url: `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}`,
      parse: ($) => {
        const items = [];
        $('div.algo, div.dd.algo').each((_, el) => {
          const block = $(el);
          const rawTitle = block.find('h3.title').text().replace(/\s+/g, ' ').trim();
          const snippet = block.find('.compText, .fc-falcon').text().replace(/\s+/g, ' ').trim();
          let href = block.find('h3.title a').attr('href') || '';
          const ruMatch = href.match(/\/RU=([^/]+)\//);
          if (ruMatch) {
            try { href = decodeURIComponent(ruMatch[1]); } catch (e) {}
          }
          if (rawTitle) items.push({ rawTitle, snippet, href });
        });
        return items;
      }
    },
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      parse: ($) => {
        const items = [];
        $('.result, .web-result').each((_, el) => {
          const block = $(el);
          const rawTitle = block.find('.result__title').text().replace(/\s+/g, ' ').trim();
          const snippet = block.find('.result__snippet').text().replace(/\s+/g, ' ').trim();
          let href = block.find('.result__url').attr('href') || block.find('.result__a').attr('href') || '';
          const uddg = href.match(/uddg=([^&]+)/);
          if (uddg) {
            try { href = decodeURIComponent(uddg[1]); } catch (e) {}
          }
          if (rawTitle) items.push({ rawTitle, snippet, href });
        });
        return items;
      }
    }
  ];

  for (const eng of engines) {
    try {
      const resp = await axios.get(buildFetchUrl(eng.url, scraperKey), {
        headers: DESKTOP_HEADERS,
        timeout: 8500
      });
      const $ = cheerio.load(resp.data || '');
      const candidates = eng.parse($);

      for (const c of candidates) {
        const cleanTitle = c.rawTitle.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Buy Online|Price in India.*).*$/i, '').trim();
        const combined = `${c.rawTitle} ${c.snippet}`;
        const prices = extractAllRupeePrices(combined);

        if (prices.length > 0) {
          // Pick primary listed price that passes relevance check
          const validPrices = prices.filter(p => isRelevantCandidate(query, cleanTitle, p, referencePrice));
          if (validPrices.length > 0) {
            // If multiple valid prices appear in snippet (e.g. Listed ₹1,39,999 and WOW Deal Buy at ₹1,18,999), detect deal discount!
            const maxP = Math.max(...validPrices);
            const minP = Math.min(...validPrices);
            let listedPrice = validPrices[0];
            let saleDisc = parseSaleAndWowDeal(combined, listedPrice);

            if (validPrices.length >= 2 && maxP <= (referencePrice ? referencePrice * 1.15 : maxP) && minP >= maxP * 0.72 && minP < maxP) {
              listedPrice = maxP;
              const gap = maxP - minP;
              if (gap > saleDisc) saleDisc = gap;
            }

            return {
              title: cleanTitle,
              price: listedPrice,
              saleDiscount: saleDisc,
              url: c.href,
              snippet: c.snippet
            };
          }
        }
      }
    } catch (e) {}
  }

  return null;
}

async function resolveAndExtractOriginProduct(rawInput, inputUrl, scraperKey) {
  let finalUrl = inputUrl;
  let html = '';

  const textBeforeUrl = String(rawInput || '').replace(/https?:\/\/[^\s]+/gi, '').replace(/^(?:take a look at this|check out this)\s+/i, '').replace(/\s+on\s+(?:flipkart|amazon).*$/i, '').trim();

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

  // 2. Direct Store Scraping + Multi-Engine Web Index Lookup in parallel
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
            const disc = parseSaleAndWowDeal(card.text(), price);
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
            const disc = parseSaleAndWowDeal(card.text(), price);
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
              saleDiscount: parseSaleAndWowDeal(card.text(), price),
              productTitle: title,
              url: `https://www.croma.com/searchB?q=${enc}`
            };
          }
        });
        return match;
      }
    }
  ];

  // Phase A: Run direct store searches first so we can establish a reference price (e.g. Amazon ₹1,39,999) if none was known yet
  const directSettled = await Promise.allSettled(directTargets.map(async (t) => {
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
  }));

  for (const item of directSettled) {
    if (item.status === 'fulfilled' && item.value && !results.some(r => r.merchantId === item.value.merchantId)) {
      results.push(item.value);
    }
  }

  const effectiveRefPrice = referencePrice || (results[0] && results[0].price) || 0;

  // Phase B: For any store still missing (like Flipkart or Croma when datacenter IP is blocked), query Yahoo + DuckDuckGo web index
  const webTargets = [
    { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com', fallbackUrl: `https://www.flipkart.com/search?q=${enc}` },
    { id: 'amazon', name: 'Amazon India', site: 'amazon.in', fallbackUrl: `https://www.amazon.in/s?k=${enc}` },
    { id: 'croma', name: 'Croma', site: 'croma.com', fallbackUrl: `https://www.croma.com/searchB?q=${enc}` },
    { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in', fallbackUrl: `https://www.reliancedigital.in/search?q=${enc}` },
    { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com', fallbackUrl: `https://www.vijaysales.com/search/${enc}` }
  ].filter(wt => !results.some(r => r.merchantId === wt.id));

  const webSettled = await Promise.allSettled(webTargets.map(async (wt) => {
    const found = await lookupProductViaWebIndex(cleanTitle, wt.site, effectiveRefPrice, scraperKey);
    if (found && found.price > 0) {
      // If we got a direct Flipkart/Croma product URL from web search, also try fetching that product page to check for WOW! DEAL ("Buy at ₹...")
      let finalPrice = found.price;
      let finalDisc = found.saleDiscount || 0;
      if (found.url && (found.url.includes('/p/') || found.url.includes('/dp/'))) {
        try {
          const pResp = await axios.get(buildFetchUrl(found.url, scraperKey), {
            headers: BOT_PREVIEW_HEADERS,
            timeout: 6500
          });
          const pParsed = parseProductHtml(typeof pResp.data === 'string' ? pResp.data : '');
          if (pParsed.price > 0) finalPrice = pParsed.price;
          if (pParsed.maxBankDiscount > finalDisc) finalDisc = pParsed.maxBankDiscount;
        } catch (e) {}
      }
      return {
        merchantId: wt.id,
        storeName: wt.name,
        price: finalPrice,
        saleDiscount: finalDisc,
        productTitle: found.title,
        url: found.url || wt.fallbackUrl
      };
    }
    return null;
  }));

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
    service: 'CardPick Multi-Store Live Engine v3.2',
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
          stores[idx].url = originData.originUrl;
          if (!stores[idx].price) stores[idx].price = originData.originPrice;
          if (originData.originSaleDiscount > (stores[idx].saleDiscount || 0)) {
            stores[idx].saleDiscount = originData.originSaleDiscount;
          }
        } else {
          stores.unshift(originEntry);
        }
      } else if (idx >= 0) {
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
  console.log(`CardPick Full-Stack Server v3.2 running on http://localhost:${PORT}`);
});
