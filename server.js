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

const BRAND_STORES = {
  oppo: { id: 'oppo', name: 'OPPO India Store', site: 'oppo.com/in', searchUrl: (q) => `https://www.oppo.com/in/search/?q=${encodeURIComponent(q)}` },
  oneplus: { id: 'oneplus', name: 'OnePlus Store India', site: 'oneplus.in', searchUrl: (q) => `https://www.oneplus.in/search?keyword=${encodeURIComponent(q)}` },
  samsung: { id: 'samsung', name: 'Samsung Shop India', site: 'samsung.com/in', searchUrl: (q) => `https://www.samsung.com/in/search/?searchvalue=${encodeURIComponent(q)}` },
  apple: { id: 'apple', name: 'Apple Store India', site: 'apple.com/in', searchUrl: (q) => `https://www.apple.com/in/search/${encodeURIComponent(q)}?src=globalnav` },
  iphone: { id: 'apple', name: 'Apple Store India', site: 'apple.com/in', searchUrl: (q) => `https://www.apple.com/in/search/${encodeURIComponent(q)}?src=globalnav` },
  xiaomi: { id: 'xiaomi', name: 'Xiaomi Store (Mi.com)', site: 'mi.com/in', searchUrl: (q) => `https://www.mi.com/in/search/${encodeURIComponent(q)}` },
  redmi: { id: 'xiaomi', name: 'Xiaomi Store (Mi.com)', site: 'mi.com/in', searchUrl: (q) => `https://www.mi.com/in/search/${encodeURIComponent(q)}` },
  vivo: { id: 'vivo', name: 'Vivo India Store', site: 'vivo.com/in', searchUrl: (q) => `https://shop.vivo.com/in/sp/search?searchKey=${encodeURIComponent(q)}` },
  iqoo: { id: 'iqoo', name: 'iQOO India Store', site: 'iqoo.com/in', searchUrl: (q) => `https://shop.iqoo.com/in/sp/search?searchKey=${encodeURIComponent(q)}` },
  realme: { id: 'realme', name: 'Realme Store India', site: 'realme.com/in', searchUrl: (q) => `https://buy.realme.com/in/search?keyword=${encodeURIComponent(q)}` }
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
  const bareMatch = str.match(/\b(?:(?:www|dl|shop|buy)\.)?(?:amazon\.in|amzn\.in|amzn\.to|flipkart\.com|fkrt\.it|fkrt\.cc|croma\.com|reliancedigital\.in|vijaysales\.com|myntra\.com|myntr\.it|ajio\.com|tatacliq\.com|nykaa\.com|oppo\.com|oneplus\.in|samsung\.com|mi\.com|vivo\.com|realme\.com)\/[^\s"'<>]*/i);
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

function detectStoreFromNameOrUrl(raw) {
  const h = String(raw || '').toLowerCase();
  if (h.includes('amazon') || h.includes('amzn')) return { id: 'amazon', name: 'Amazon India', site: 'amazon.in' };
  if (h.includes('flipkart') || h.includes('fkrt')) return { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com' };
  if (h.includes('croma')) return { id: 'croma', name: 'Croma', site: 'croma.com' };
  if (h.includes('reliance')) return { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in' };
  if (h.includes('vijay sales') || h.includes('vijaysales')) return { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com' };
  if (h.includes('tata cliq') || h.includes('tatacliq')) return { id: 'tatacliq', name: 'Tata CLiQ', site: 'tatacliq.com' };
  if (h.includes('myntra') || h.includes('myntr')) return { id: 'myntra', name: 'Myntra', site: 'myntra.com' };
  if (h.includes('ajio')) return { id: 'ajio', name: 'AJIO', site: 'ajio.com' };
  if (h.includes('nykaa')) return { id: 'nykaa', name: 'Nykaa', site: 'nykaa.com' };
  if (h.includes('oppo')) return { id: 'oppo', name: 'OPPO India Store', site: 'oppo.com/in' };
  if (h.includes('oneplus')) return { id: 'oneplus', name: 'OnePlus Store India', site: 'oneplus.in' };
  if (h.includes('samsung')) return { id: 'samsung', name: 'Samsung Shop India', site: 'samsung.com/in' };
  if (h.includes('apple')) return { id: 'apple', name: 'Apple Store India', site: 'apple.com/in' };
  if (h.includes('xiaomi') || h.includes('mi.com')) return { id: 'xiaomi', name: 'Xiaomi Store (Mi.com)', site: 'mi.com/in' };
  if (h.includes('vivo')) return { id: 'vivo', name: 'Vivo India Store', site: 'vivo.com/in' };
  if (h.includes('iqoo')) return { id: 'iqoo', name: 'iQOO India Store', site: 'iqoo.com/in' };
  if (h.includes('realme')) return { id: 'realme', name: 'Realme Store India', site: 'realme.com/in' };
  return { id: 'other', name: raw || 'Online Store', site: '' };
}

// Stage 1: Canonical Product & Spec Fingerprinting
function buildProductFingerprint(rawTitle) {
  let s = String(rawTitle || '').trim();
  if (!s) return { cleanQuery: '', brand: '', modelTokens: [], storageGb: 0, ramGb: 0 };

  s = s.replace(/https?:\/\/[^\s]+/gi, ' ');
  s = s.replace(/^(?:take a look at this|check out this|buy)\s+/i, '');
  s = s.replace(/\s+on\s+(?:flipkart|amazon|myntra|croma|ajio).*$/i, '');
  s = s.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Smartprix|91mobiles|Buy Online|Price in India.*).*$/i, '');
  s = s.replace(/\b(?:Price in India|Buy Online|Specifications|Features|Review|Online at Best Price|Full Specs)\b.*$/i, '');

  const gbMatches = [...s.matchAll(/\b(\d+)\s*GB\b/gi)].map(m => parseInt(m[1], 10));
  const storageGb = gbMatches.find(n => n >= 64) || 0;
  const ramGb = gbMatches.find(n => n >= 4 && n <= 32 && n !== storageGb) || 0;

  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.split(/[|;]/)[0].split(',')[0];
  s = s.replace(/\b(smartphone|mobile\s+phone|with\s+.*|for\s+men.*|for\s+women.*|compatible\s+with.*|includes\s+.*|no\s+cost\s+emi.*|exchange\s+offer.*)\b/gi, ' ');
  s = s.replace(/[^a-zA-Z0-9\s+.-]/g, ' ').replace(/\s+/g, ' ').trim();

  const colorStop = new Set(['mist', 'grey', 'gray', 'black', 'white', 'silver', 'gold', 'blue', 'green', 'titanium', 'pink', 'purple', 'red', 'orange', 'yellow', 'starlight', 'midnight', 'teal', 'ultramarine', 'desert', 'natural']);
  const words = s.split(' ').filter(w => w && !colorStop.has(w.toLowerCase()) && !/^\d+gb$/i.test(w)).slice(0, 5);

  const brand = (words[0] || '').toLowerCase();
  let cleanQuery = words.join(' ');
  if (storageGb && !new RegExp(`\\b${storageGb}\\s*GB\\b`, 'i').test(cleanQuery)) {
    cleanQuery += ` ${storageGb}GB`;
  }

  const modelTokens = words.map(w => w.toLowerCase()).filter(w => w.length >= 2 && !['5g', '4g', 'ram', 'rom', 'the', 'new'].includes(w));
  return { cleanQuery: cleanQuery.trim(), brand, modelTokens, storageGb, ramGb };
}

function normalizeSearchQuery(rawTitle) {
  return buildProductFingerprint(rawTitle).cleanQuery;
}

function isRelevantCandidate(queryTitle, candidateTitle, candidatePrice, referencePrice) {
  const fp = buildProductFingerprint(queryTitle);
  const cand = String(candidateTitle || '').toLowerCase();
  const q = String(queryTitle || '').toLowerCase();

  const accessoryWords = [
    'case', 'cover', 'tempered', 'glass', 'screen guard', 'protector',
    'back cover', 'pouch', 'skin', 'strap', 'cable', 'adapter', 'stand',
    'holder', 'flip cover', 'bumper', 'hydrogel', 'lens protector', 'charger for', 'dummy'
  ];
  for (const w of accessoryWords) {
    if (cand.includes(w) && !q.includes(w)) return false;
  }

  // Storage check: if query has a specific storage (e.g. 256GB) and candidate explicitly names a DIFFERENT storage (e.g. 512GB), reject
  if (fp.storageGb) {
    const candGbs = [...cand.matchAll(/\b(64|128|256|512|1024)\s*gb\b/gi)].map(m => parseInt(m[1], 10));
    if (candGbs.length > 0 && !candGbs.includes(fp.storageGb)) {
      return false;
    }
  }

  if (referencePrice > 800 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.48 || candidatePrice > referencePrice * 1.65) {
      return false;
    }
  }

  if (fp.modelTokens.length === 0) return true;
  // Require brand token + model number token match
  for (const token of fp.modelTokens) {
    // If token has digits (like "x10", "16", "s24", "nord"), it MUST appear in candidate title
    if (/\d/.test(token) && !cand.includes(token)) {
      return false;
    }
  }

  let matched = 0;
  for (const t of fp.modelTokens) {
    if (cand.includes(t)) matched++;
  }
  return (matched / fp.modelTokens.length) >= 0.65;
}

// Stage 3: Deal & Offer Breakdown Parser (Separates Coupon/WOW Deal vs Bank Card Instant Offers)
function extractStructuredDealInfo(text, listedPrice) {
  const t = String(text || '').replace(/\s+/g, ' ');
  let couponDiscount = 0;
  let wowDealPrice = 0;
  let wowDealDiscount = 0;
  let bankInstantDiscount = 0;
  const matchedBanks = [];
  const offerSnippets = [];

  // 1. Check for "Buy at ₹1,18,999" / "WOW! DEAL" / "Effective Price ₹..."
  const buyAtMatches = [...t.matchAll(/(?:buy\s+at|wow!?\s*deal[^₹]*|effective\s+price[^₹]*|net\s+effective\s+price[^₹]*|special\s+deal\s+price[^₹]*)(?:₹|rs\.?|inr)\s*([\d,]{3,9})/gi)];
  for (const m of buyAtMatches) {
    const dealP = parseInt(m[1].replace(/,/g, ''), 10);
    if (listedPrice > 500 && dealP > listedPrice * 0.55 && dealP < listedPrice) {
      const diff = listedPrice - dealP;
      if (diff > wowDealDiscount) {
        wowDealDiscount = diff;
        wowDealPrice = dealP;
      }
    }
  }

  // 2. Check for Amazon/Store Coupon ("Apply ₹2,000 coupon", "Save ₹1,500 with coupon")
  const couponMatches = [
    ...t.matchAll(/(?:apply|save|extra)\s*(?:₹|rs\.?|inr)\s*([\d,]{2,6})\s*(?:with\s+)?coupon/gi),
    ...t.matchAll(/coupon\s*(?:discount)?\s*(?:of|:)?\s*(?:₹|rs\.?|inr)\s*([\d,]{2,6})/gi)
  ];
  for (const m of couponMatches) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 50 && val <= 25000 && (!listedPrice || val <= listedPrice * 0.35)) {
      if (val > couponDiscount) couponDiscount = val;
    }
  }

  // 3. Check for Bank Instant Discounts & identify which banks qualify (ICICI, HDFC, Axis, SBI, IndusInd, Kotak)
  const bankRegexes = [
    /(?:flat|instant|extra|up\s*to|get|save|additional)\s*(?:₹|rs\.?|inr)\s*([\d,]{2,7})\s*(?:off|instant\s*discount|discount|cashback)[^.]{0,90}?(icici|hdfc|axis|sbi|indusind|kotak|all\s+bank|credit\s+card)/gi,
    /(icici|hdfc|axis|sbi|indusind|kotak)\s*(?:bank)?\s*(?:credit\s*cards?)?[^.]{0,60}?(?:flat|instant|up\s*to|off|discount)\s*(?:of\s*)?(?:₹|rs\.?|inr)\s*([\d,]{2,7})/gi
  ];

  for (const m of t.matchAll(bankRegexes[0])) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    const bankRaw = (m[2] || '').toLowerCase();
    if (val >= 100 && val <= 30000 && (!listedPrice || val <= listedPrice * 0.35)) {
      if (val > bankInstantDiscount) bankInstantDiscount = val;
      if (bankRaw && !matchedBanks.includes(bankRaw)) matchedBanks.push(bankRaw);
      offerSnippets.push(m[0].trim().slice(0, 140));
    }
  }
  for (const m of t.matchAll(bankRegexes[1])) {
    const bankRaw = (m[1] || '').toLowerCase();
    const val = parseInt(m[2].replace(/,/g, ''), 10);
    if (val >= 100 && val <= 30000 && (!listedPrice || val <= listedPrice * 0.35)) {
      if (val > bankInstantDiscount) bankInstantDiscount = val;
      if (bankRaw && !matchedBanks.includes(bankRaw)) matchedBanks.push(bankRaw);
      offerSnippets.push(m[0].trim().slice(0, 140));
    }
  }

  // Generic instant discount fallback if bank name wasn't in same clause
  if (!bankInstantDiscount) {
    const genMatches = [...t.matchAll(/(?:flat|instant)\s*(?:₹|rs\.?|inr)\s*([\d,]{3,6})\s*(?:instant\s*)?(?:discount|off)\s*(?:on\s*(?:credit|bank)\s*cards?)?/gi)];
    for (const m of genMatches) {
      const val = parseInt(m[1].replace(/,/g, ''), 10);
      if (val >= 250 && val <= 25000 && (!listedPrice || val <= listedPrice * 0.35)) {
        if (val > bankInstantDiscount) bankInstantDiscount = val;
      }
    }
  }

  // Combine total upfront sale/deal discount without double-counting (WOW! Deal already bundles coupon + bank/exchange)
  const totalSaleDiscount = wowDealDiscount > 0
    ? wowDealDiscount
    : (couponDiscount + bankInstantDiscount);

  let dealSummary = '';
  if (wowDealDiscount > 0) {
    dealSummary = `WOW! Deal: Buy at ₹${wowDealPrice.toLocaleString('en-IN')} (−₹${wowDealDiscount.toLocaleString('en-IN')} bundle/bank/exchange deal)`;
  } else {
    const parts = [];
    if (couponDiscount > 0) parts.push(`Coupon −₹${couponDiscount.toLocaleString('en-IN')}`);
    if (bankInstantDiscount > 0) {
      const bLabel = matchedBanks.length > 0 ? ` (${matchedBanks.map(b => b.toUpperCase()).join('/')})` : '';
      parts.push(`Bank Instant Off −₹${bankInstantDiscount.toLocaleString('en-IN')}${bLabel}`);
    }
    dealSummary = parts.join(' + ');
  }

  return {
    couponDiscount,
    wowDealPrice,
    wowDealDiscount,
    bankInstantDiscount,
    matchedBanks,
    totalSaleDiscount,
    dealSummary,
    offerSnippets: offerSnippets.slice(0, 3)
  };
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

function parseProductHtml(html) {
  let title = '';
  let price = 0;
  let bankOffers = [];

  if (!html) return { title, price, bankOffers, dealInfo: extractStructuredDealInfo('', 0) };
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

  $('.offers-items-content, .vsx-offers-count, .WT_R32, ._3j4Zjq, .bank-offer, #itembox-InstantBankDiscount, #promoPriceBlockMessage_feature_div').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && t.length > 10 && t.length < 220 && bankOffers.length < 5) {
      bankOffers.push(t);
    }
  });

  const bodyText = $.root().text() + ' ' + bankOffers.join(' ');
  const dealInfo = extractStructuredDealInfo(bodyText, price);
  if (dealInfo.dealSummary && !bankOffers.includes(dealInfo.dealSummary)) {
    bankOffers.unshift(dealInfo.dealSummary);
  }

  if (/robot check|captcha|access denied|online shopping site in india|something went wrong/i.test(title)) {
    title = '';
  }

  return { title, price, bankOffers, dealInfo };
}

// Layer 1: Scrape Indian Price Comparison Aggregators (Smartprix & 91mobiles) via Web Index & Direct Page Parse
async function fetchFromIndianPriceAggregators(cleanQuery, referencePrice, scraperKey) {
  const storeResults = [];
  try {
    // Search Yahoo India for Smartprix or 91mobiles product page for this exact model
    const q = `${cleanQuery} price in india (site:smartprix.com OR site:91mobiles.com OR site:mysmartprice.com)`;
    const searchUrl = `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}`;
    const resp = await axios.get(buildFetchUrl(searchUrl, scraperKey), {
      headers: DESKTOP_HEADERS,
      timeout: 8000
    });
    const $ = cheerio.load(resp.data || '');

    const aggUrls = [];
    $('div.algo, div.dd.algo').each((_, el) => {
      const block = $(el);
      const rawTitle = block.find('h3.title').text().replace(/\s+/g, ' ').trim();
      const snippet = block.find('.compText, .fc-falcon').text().replace(/\s+/g, ' ').trim();
      let href = block.find('h3.title a').attr('href') || '';
      const ruMatch = href.match(/\/RU=([^/]+)\//);
      if (ruMatch) {
        try { href = decodeURIComponent(ruMatch[1]); } catch (e) {}
      }
      if (href && (href.includes('smartprix.com') || href.includes('91mobiles.com') || href.includes('mysmartprice.com')) && aggUrls.length < 2) {
        aggUrls.push({ href, rawTitle, snippet });
      }
    });

    // Fetch top aggregator page and parse its store price table
    await Promise.allSettled(aggUrls.map(async (agg) => {
      try {
        const pageResp = await axios.get(buildFetchUrl(agg.href, scraperKey), {
          headers: DESKTOP_HEADERS,
          timeout: 8000
        });
        const $p = cheerio.load(pageResp.data || '');
        const pageTitle = $p('h1').first().text().trim() || agg.rawTitle;

        // Parse Smartprix / 91mobiles price table rows
        $p('li.sm-store-item, div.pg-prc-tbl-row, tr.store_row, div.store_pricelist, .prc-grid, .store-row').each((_, rowEl) => {
          const rowText = $p(rowEl).text().replace(/\s+/g, ' ').trim();
          const imgAlt = $p(rowEl).find('img').attr('alt') || '';
          const combinedStoreHint = `${imgAlt} ${rowText}`;
          const store = detectStoreFromNameOrUrl(combinedStoreHint);
          if (store.id === 'other') return;

          const prices = extractAllRupeePrices(rowText);
          if (prices.length === 0) return;
          const pVal = prices[0];
          if (!isRelevantCandidate(cleanQuery, pageTitle, pVal, referencePrice)) return;

          const dealInfo = extractStructuredDealInfo(rowText, pVal);
          if (!storeResults.some(r => r.merchantId === store.id)) {
            storeResults.push({
              merchantId: store.id,
              storeName: store.name,
              price: pVal,
              saleDiscount: dealInfo.totalSaleDiscount || 0,
              dealSummary: dealInfo.dealSummary || '',
              matchedBanks: dealInfo.matchedBanks || [],
              productTitle: pageTitle.replace(/\s*Price in India.*$/i, '').trim(),
              url: `https://www.${store.site}/search?q=${encodeURIComponent(cleanQuery)}`
            });
          }
        });
      } catch (e) {}
    }));
  } catch (e) {}
  return storeResults;
}

// Layer 2 & 3: Multi-Engine Web Index Lookup + Deep Product Page (PDP) Deal Inspection
async function lookupProductViaWebIndex(query, targetSite, referencePrice, scraperKey) {
  const q = targetSite ? `${query} site:${targetSite}` : query;

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
        const cleanTitle = c.rawTitle.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|OPPO|OnePlus|Samsung|Buy Online|Price in India.*).*$/i, '').trim();
        const combined = `${c.rawTitle} ${c.snippet}`;
        const prices = extractAllRupeePrices(combined);

        if (prices.length > 0) {
          const validPrices = prices.filter(p => isRelevantCandidate(query, cleanTitle, p, referencePrice));
          if (validPrices.length > 0) {
            const maxP = Math.max(...validPrices);
            const minP = Math.min(...validPrices);
            let listedPrice = validPrices[0];
            const dealInfo = extractStructuredDealInfo(combined, listedPrice);
            let saleDisc = dealInfo.totalSaleDiscount;
            let dealSummary = dealInfo.dealSummary;

            if (validPrices.length >= 2 && maxP <= (referencePrice ? referencePrice * 1.15 : maxP) && minP >= maxP * 0.72 && minP < maxP) {
              listedPrice = maxP;
              const gap = maxP - minP;
              if (gap > saleDisc) {
                saleDisc = gap;
                dealSummary = `Deal Price ₹${minP.toLocaleString('en-IN')} (−₹${gap.toLocaleString('en-IN')} off listed ₹${maxP.toLocaleString('en-IN')})`;
              }
            }

            return {
              title: cleanTitle,
              price: listedPrice,
              saleDiscount: saleDisc,
              dealSummary,
              matchedBanks: dealInfo.matchedBanks || [],
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
      if (parsed2.dealInfo.totalSaleDiscount > parsed.dealInfo.totalSaleDiscount) {
        parsed.dealInfo = parsed2.dealInfo;
      }
    } catch (e) {}
  }

  let hostname = '';
  try { hostname = new URL(finalUrl).hostname; } catch (e) {}
  const storeInfo = detectStoreFromNameOrUrl(hostname);
  const { slugTitle, productId } = extractInfoFromUrl(finalUrl);

  let bestTitle = parsed.title || textBeforeUrl || slugTitle;
  let bestPrice = parsed.price;
  let bestDiscount = parsed.dealInfo.totalSaleDiscount;
  let bestDealSummary = parsed.dealInfo.dealSummary;

  if (!bestPrice || !bestTitle) {
    const lookupQ = productId ? `${slugTitle} ${productId}`.trim() : slugTitle;
    if (lookupQ) {
      const indexed = await lookupProductViaWebIndex(lookupQ, storeInfo.site || '', 0, scraperKey);
      if (indexed) {
        if (!bestTitle && indexed.title) bestTitle = indexed.title;
        if (!bestPrice && indexed.price > 0) bestPrice = indexed.price;
        if (!bestDiscount && indexed.saleDiscount > 0) {
          bestDiscount = indexed.saleDiscount;
          bestDealSummary = indexed.dealSummary || '';
        }
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
    originDealSummary: bestDealSummary,
    originUrl: finalUrl,
    bankOffers: parsed.bankOffers
  };
}

async function searchStorePrices(searchQuery, referencePrice, serpApiKey, scraperKey) {
  const fp = buildProductFingerprint(searchQuery);
  const cleanTitle = fp.cleanQuery;
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
        const store = detectStoreFromNameOrUrl(item.source || '');
        const price = parsePriceNumber(item.extracted_price || item.price);
        if (!price || store.id === 'other') continue;
        if (!isRelevantCandidate(cleanTitle, item.title || cleanTitle, price, referencePrice)) continue;

        if (!results.some(r => r.merchantId === store.id)) {
          results.push({
            merchantId: store.id,
            storeName: store.name,
            price,
            saleDiscount: 0,
            dealSummary: '',
            matchedBanks: [],
            productTitle: item.title,
            url: item.link || item.product_link || ''
          });
        }
      }
    } catch (e) {}
  }

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
            const dealInfo = extractStructuredDealInfo(card.text(), price);
            match = {
              price,
              saleDiscount: dealInfo.totalSaleDiscount,
              dealSummary: dealInfo.dealSummary,
              matchedBanks: dealInfo.matchedBanks,
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
            const dealInfo = extractStructuredDealInfo(card.text(), price);
            match = {
              price,
              saleDiscount: dealInfo.totalSaleDiscount,
              dealSummary: dealInfo.dealSummary,
              matchedBanks: dealInfo.matchedBanks,
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
            const dealInfo = extractStructuredDealInfo(card.text(), price);
            match = {
              price,
              saleDiscount: dealInfo.totalSaleDiscount,
              dealSummary: dealInfo.dealSummary,
              matchedBanks: dealInfo.matchedBanks,
              productTitle: title,
              url: `https://www.croma.com/searchB?q=${enc}`
            };
          }
        });
        return match;
      }
    }
  ];

  // Run Layer 1 (Indian Price Aggregators) and Layer 2 (Direct Store Scraping) in parallel
  const [aggResults, directSettled] = await Promise.all([
    fetchFromIndianPriceAggregators(cleanTitle, referencePrice, scraperKey),
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
            dealSummary: parsed.dealSummary || '',
            matchedBanks: parsed.matchedBanks || [],
            productTitle: parsed.productTitle,
            url: parsed.url
          };
        }
      } catch (e) {}
      return null;
    }))
  ]);

  for (const item of directSettled) {
    if (item.status === 'fulfilled' && item.value && !results.some(r => r.merchantId === item.value.merchantId)) {
      results.push(item.value);
    }
  }
  for (const agg of aggResults) {
    if (!results.some(r => r.merchantId === agg.merchantId)) {
      results.push(agg);
    }
  }

  const effectiveRefPrice = referencePrice || (results[0] && results[0].price) || 0;

  // Build list of stores + Official Brand Store to check via Web Index + Deep PDP Inspection
  const webTargets = [
    { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com', fallbackUrl: `https://www.flipkart.com/search?q=${enc}` },
    { id: 'amazon', name: 'Amazon India', site: 'amazon.in', fallbackUrl: `https://www.amazon.in/s?k=${enc}` },
    { id: 'croma', name: 'Croma', site: 'croma.com', fallbackUrl: `https://www.croma.com/searchB?q=${enc}` },
    { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in', fallbackUrl: `https://www.reliancedigital.in/search?q=${enc}` },
    { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com', fallbackUrl: `https://www.vijaysales.com/search/${enc}` }
  ];

  if (fp.brand && BRAND_STORES[fp.brand]) {
    const bs = BRAND_STORES[fp.brand];
    webTargets.push({
      id: bs.id,
      name: bs.name,
      site: bs.site,
      fallbackUrl: bs.searchUrl(cleanTitle)
    });
  }

  const missingTargets = webTargets.filter(wt => !results.some(r => r.merchantId === wt.id));

  const webSettled = await Promise.allSettled(missingTargets.map(async (wt) => {
    const found = await lookupProductViaWebIndex(cleanTitle, wt.site, effectiveRefPrice, scraperKey);
    if (found && found.price > 0) {
      let finalPrice = found.price;
      let finalDisc = found.saleDiscount || 0;
      let finalSummary = found.dealSummary || '';
      let finalBanks = found.matchedBanks || [];

      // Layer 3: Deep PDP Deal Inspection for discovered product URLs
      if (found.url && (found.url.includes('/p/') || found.url.includes('/dp/') || found.url.includes('/product'))) {
        try {
          const pResp = await axios.get(buildFetchUrl(found.url, scraperKey), {
            headers: BOT_PREVIEW_HEADERS,
            timeout: 6500
          });
          const pParsed = parseProductHtml(typeof pResp.data === 'string' ? pResp.data : '');
          if (pParsed.price > 0) finalPrice = pParsed.price;
          if (pParsed.dealInfo.totalSaleDiscount > finalDisc) {
            finalDisc = pParsed.dealInfo.totalSaleDiscount;
            finalSummary = pParsed.dealInfo.dealSummary;
            finalBanks = pParsed.dealInfo.matchedBanks;
          }
        } catch (e) {}
      }
      return {
        merchantId: wt.id,
        storeName: wt.name,
        price: finalPrice,
        saleDiscount: finalDisc,
        dealSummary: finalSummary,
        matchedBanks: finalBanks,
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

  // Also run Deep PDP Deal Inspection on any direct-search result (like Amazon) whose saleDiscount is still 0
  await Promise.allSettled(results.map(async (r) => {
    if (r.saleDiscount === 0 && r.url && (r.url.includes('/dp/') || r.url.includes('/p/'))) {
      try {
        const pResp = await axios.get(buildFetchUrl(r.url, scraperKey), {
          headers: BOT_PREVIEW_HEADERS,
          timeout: 6000
        });
        const pParsed = parseProductHtml(typeof pResp.data === 'string' ? pResp.data : '');
        if (pParsed.dealInfo.totalSaleDiscount > 0) {
          r.saleDiscount = pParsed.dealInfo.totalSaleDiscount;
          r.dealSummary = pParsed.dealInfo.dealSummary;
          r.matchedBanks = pParsed.dealInfo.matchedBanks;
        }
      } catch (e) {}
    }
  }));

  return results;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CardPick Multi-Store Live Engine v4.0',
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
          dealSummary: originData.originDealSummary || '',
          matchedBanks: [],
          productTitle: originData.title,
          url: originData.originUrl
        };
        if (idx >= 0) {
          stores[idx].url = originData.originUrl;
          if (!stores[idx].price) stores[idx].price = originData.originPrice;
          if (originData.originSaleDiscount > (stores[idx].saleDiscount || 0)) {
            stores[idx].saleDiscount = originData.originSaleDiscount;
            stores[idx].dealSummary = originData.originDealSummary || '';
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
  console.log(`CardPick Full-Stack Server v4.0 running on http://localhost:${PORT}`);
});
