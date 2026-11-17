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
  realme: { id: 'realme', name: 'Realme Store India', site: 'realme.com/in', searchUrl: (q) => `https://buy.realme.com/in/search?keyword=${encodeURIComponent(q)}` },
  bodywise: { id: 'bebodywise', name: 'Be Bodywise Official', site: 'bebodywise.com', searchUrl: (q) => `https://bebodywise.com/search?q=${encodeURIComponent(q)}` },
  bebodywise: { id: 'bebodywise', name: 'Be Bodywise Official', site: 'bebodywise.com', searchUrl: (q) => `https://bebodywise.com/search?q=${encodeURIComponent(q)}` },
  minimalist: { id: 'minimalist', name: 'Minimalist Official', site: 'beminimalist.co', searchUrl: (q) => `https://beminimalist.co/search?q=${encodeURIComponent(q)}` },
  mamaearth: { id: 'mamaearth', name: 'Mamaearth Official', site: 'mamaearth.in', searchUrl: (q) => `https://mamaearth.in/product-search?search=${encodeURIComponent(q)}` },
  dermaco: { id: 'dermaco', name: 'The Derma Co Official', site: 'thedermaco.com', searchUrl: (q) => `https://thedermaco.com/product-search?search=${encodeURIComponent(q)}` }
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
  const bareMatch = str.match(/\b(?:(?:www|dl|shop|buy)\.)?(?:amazon\.in|amzn\.in|amzn\.to|flipkart\.com|fkrt\.it|fkrt\.cc|croma\.com|reliancedigital\.in|vijaysales\.com|myntra\.com|myntr\.it|ajio\.com|tatacliq\.com|nykaa\.com|nykaaman\.com|nykaafashion\.com|meesho\.com|pharmeasy\.in|1mg\.com|netmeds\.com|zepto\.com|zeptonow\.com|blinkit\.com|tirabeauty\.com|bebodywise\.com|oppo\.com|oneplus\.in|samsung\.com|mi\.com|vivo\.com|realme\.com)\/[^\s"'<>]*/i);
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
  const matches = [...String(text).matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]{2,9}(?:\.\d{1,2})?)/gi)];
  const nums = [];
  for (const m of matches) {
    const val = Math.round(parseFloat(m[1].replace(/,/g, '')));
    // Skip unit-price strings like "₹2/ml" or "₹1.4/ml" by checking what immediately follows the match
    const afterIdx = m.index + m[0].length;
    const afterSlice = String(text).slice(afterIdx, afterIdx + 8).toLowerCase();
    if (/^\s*\/\s*(?:ml|g|gm|kg|pc|unit|100)/.test(afterSlice)) continue;
    if (val >= 75 && val <= 1500000 && !nums.includes(val)) {
      nums.push(val);
    }
  }
  return nums;
}

function detectStoreFromNameOrUrl(raw) {
  const h = String(raw || '').toLowerCase();
  if (h.includes('amazon') || h.includes('amzn')) return { id: 'amazon', name: 'Amazon India', site: 'amazon.in' };
  if (h.includes('flipkart') || h.includes('fkrt')) return { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com' };
  if (h.includes('nykaaman')) return { id: 'nykaa', name: 'Nykaa Man', site: 'nykaaman.com' };
  if (h.includes('nykaa')) return { id: 'nykaa', name: 'Nykaa', site: 'nykaa.com' };
  if (h.includes('myntra') || h.includes('myntr')) return { id: 'myntra', name: 'Myntra', site: 'myntra.com' };
  if (h.includes('meesho')) return { id: 'meesho', name: 'Meesho', site: 'meesho.com' };
  if (h.includes('tira')) return { id: 'tira', name: 'Tira Beauty', site: 'tirabeauty.com' };
  if (h.includes('bebodywise') || h.includes('bodywise')) return { id: 'bebodywise', name: 'Be Bodywise Official', site: 'bebodywise.com' };
  if (h.includes('zepto')) return { id: 'zepto', name: 'Zepto', site: 'zepto.com' };
  if (h.includes('blinkit')) return { id: 'blinkit', name: 'Blinkit', site: 'blinkit.com' };
  if (h.includes('pharmeasy')) return { id: 'pharmeasy', name: 'PharmEasy', site: 'pharmeasy.in' };
  if (h.includes('1mg')) return { id: 'tata1mg', name: 'Tata 1mg', site: '1mg.com' };
  if (h.includes('netmeds')) return { id: 'netmeds', name: 'Netmeds', site: 'netmeds.com' };
  if (h.includes('apollo')) return { id: 'apollo', name: 'Apollo 24|7', site: 'apollo247.com' };
  if (h.includes('croma')) return { id: 'croma', name: 'Croma', site: 'croma.com' };
  if (h.includes('reliance')) return { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in' };
  if (h.includes('vijay sales') || h.includes('vijaysales')) return { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com' };
  if (h.includes('tata cliq') || h.includes('tatacliq')) return { id: 'tatacliq', name: 'Tata CLiQ', site: 'tatacliq.com' };
  if (h.includes('ajio')) return { id: 'ajio', name: 'AJIO', site: 'ajio.com' };
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

// Stage 1: Canonical Product & Spec Fingerprinting (Supports Electronics AND Beauty/FMCG/Pharmacy)
function buildProductFingerprint(rawTitle) {
  let s = String(rawTitle || '').trim();
  if (!s) return { cleanQuery: '', brand: '', modelTokens: [], storageGb: 0, volumeMl: 0 };

  s = s.replace(/https?:\/\/[^\s]+/gi, ' ');
  // Convert URL slug tokens like "1percent" -> "1%"
  s = s.replace(/(\d+)\s*percent\b/gi, '$1%');
  s = s.replace(/^(?:take a look at this|check out this|buy)\s+/i, '');
  s = s.replace(/\s+on\s+(?:flipkart|amazon|myntra|croma|ajio|nykaa|nykaaman|meesho).*$/i, '');
  s = s.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Nykaa|NykaaMan|Smartprix|91mobiles|BuyHatke|Buy Online|Price in India.*).*$/i, '');
  s = s.replace(/\b(?:Price in India|Buy Online|Specifications|Features|Review|Online at Best Price|Full Specs)\b.*$/i, '');

  const gbMatches = [...s.matchAll(/\b(\d+)\s*GB\b/gi)].map(m => parseInt(m[1], 10));
  const storageGb = gbMatches.find(n => n >= 64) || 0;

  const mlMatches = [...s.matchAll(/\b(\d+)\s*(?:ml|g|gm)\b/gi)].map(m => parseInt(m[1], 10));
  const volumeMl = mlMatches[0] || 0;

  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.split(/[|;]/)[0].split(',')[0];
  s = s.replace(/\b(smartphone|mobile\s+phone|with\s+.*|for\s+men.*|for\s+women.*|compatible\s+with.*|includes\s+.*|no\s+cost\s+emi.*|exchange\s+offer.*|treats\s+.*|prevents\s+.*)\b/gi, ' ');
  s = s.replace(/[^a-zA-Z0-9%\s+.-]/g, ' ').replace(/\s+/g, ' ').trim();

  const colorStop = new Set(['mist', 'grey', 'gray', 'black', 'white', 'silver', 'gold', 'blue', 'green', 'titanium', 'pink', 'purple', 'red', 'orange', 'yellow', 'starlight', 'midnight', 'teal', 'ultramarine', 'desert', 'natural']);
  const words = s.split(' ').filter(w => w && !colorStop.has(w.toLowerCase()) && !/^\d+gb$/i.test(w)).slice(0, 7);

  let brand = (words[0] || '').toLowerCase();
  if (brand === 'be' && words[1] && words[1].toLowerCase() === 'bodywise') {
    brand = 'bebodywise';
  }

  let cleanQuery = words.join(' ');
  if (storageGb && !new RegExp(`\\b${storageGb}\\s*GB\\b`, 'i').test(cleanQuery)) {
    cleanQuery += ` ${storageGb}GB`;
  }
  if (volumeMl && !new RegExp(`\\b${volumeMl}\\s*(?:ml|g|gm)\\b`, 'i').test(cleanQuery)) {
    cleanQuery += ` ${volumeMl}ml`;
  }

  const modelTokens = words
    .map(w => w.toLowerCase().replace(/%$/, ''))
    .filter(w => w.length >= 2 && !['5g', '4g', 'ram', 'rom', 'the', 'new', 'be', 'for', 'and', 'with'].includes(w));

  return { cleanQuery: cleanQuery.trim(), brand, modelTokens, storageGb, volumeMl };
}

function normalizeSearchQuery(rawTitle) {
  return buildProductFingerprint(rawTitle).cleanQuery;
}

function isRelevantCandidate(queryTitle, candidateTitle, candidatePrice, referencePrice) {
  const fp = buildProductFingerprint(queryTitle);
  const cand = String(candidateTitle || '').toLowerCase().replace(/(\d+)\s*percent\b/gi, '$1%');
  const q = String(queryTitle || '').toLowerCase();

  const accessoryWords = [
    'case', 'cover', 'tempered', 'glass', 'screen guard', 'protector',
    'back cover', 'pouch', 'skin', 'strap', 'cable', 'adapter', 'stand',
    'holder', 'flip cover', 'bumper', 'hydrogel', 'lens protector', 'charger for', 'dummy'
  ];
  for (const w of accessoryWords) {
    if (cand.includes(w) && !q.includes(w)) return false;
  }

  // Reject wrong phone storage variant
  if (fp.storageGb) {
    const candGbs = [...cand.matchAll(/\b(64|128|256|512|1024)\s*gb\b/gi)].map(m => parseInt(m[1], 10));
    if (candGbs.length > 0 && !candGbs.includes(fp.storageGb)) {
      return false;
    }
  }

  // Reject multi-packs / kits if query is a single item
  if (!/\b(pack|combo|kit|set\s+of)\b/i.test(q) && /\b(pack\s+of\s+[234]|combo\s+set|set\s+of\s+[234]|back\s+acne\s+kit)\b/i.test(cand)) {
    return false;
  }

  if (referencePrice > 800 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.48 || candidatePrice > referencePrice * 1.65) {
      return false;
    }
  } else if (referencePrice >= 150 && referencePrice <= 800 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.45 || candidatePrice > referencePrice * 2.2) {
      return false;
    }
  }

  if (fp.modelTokens.length === 0) return true;

  // Only enforce strict digit-token matching for multi-character alphanumeric model codes (e.g., "x10", "s24", "m35") — not percentages like "1%" or "2%"
  for (const token of fp.modelTokens) {
    if (/[a-z]/i.test(token) && /\d/.test(token) && !cand.includes(token)) {
      return false;
    }
  }

  let matched = 0;
  for (const t of fp.modelTokens) {
    if (cand.includes(t)) matched++;
  }
  return (matched / fp.modelTokens.length) >= 0.55;
}

// Stage 3: Deal & Offer Breakdown Parser (Handles WOW! Deal, Myntra "Best Price ₹... with coupon", Amazon coupons, and Bank Instant Discounts)
function extractStructuredDealInfo(text, listedPrice) {
  const t = String(text || '').replace(/\s+/g, ' ');
  let couponDiscount = 0;
  let wowDealPrice = 0;
  let wowDealDiscount = 0;
  let bankInstantDiscount = 0;
  const matchedBanks = [];
  const offerSnippets = [];

  // 1. Check for "Buy at ₹...", "Best Price ₹... with coupon" (Myntra), "WOW! DEAL", "Effective Price ₹..."
  const buyAtMatches = [
    ...t.matchAll(/(?:buy\s+at|best\s+price|wow!?\s*deal[^₹]*|effective\s+price[^₹]*|net\s+effective\s+price[^₹]*|special\s+deal\s+price[^₹]*)\s*(?:₹|rs\.?|inr)\s*([\d,]{2,9})/gi)
  ];
  for (const m of buyAtMatches) {
    const dealP = parseInt(m[1].replace(/,/g, ''), 10);
    if (listedPrice >= 150 && dealP > listedPrice * 0.5 && dealP < listedPrice) {
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
    if (val >= 25 && val <= 25000 && (!listedPrice || val <= listedPrice * 0.4)) {
      if (val > couponDiscount) couponDiscount = val;
    }
  }

  // 3. Check for Bank Instant Discounts & identify qualifying banks
  const bankRegexes = [
    /(?:flat|instant|extra|up\s*to|get|save|additional)\s*(?:₹|rs\.?|inr)\s*([\d,]{2,7})\s*(?:off|instant\s*discount|discount|cashback)[^.]{0,90}?(icici|hdfc|axis|sbi|indusind|kotak|all\s+bank|credit\s+card)/gi,
    /(icici|hdfc|axis|sbi|indusind|kotak)\s*(?:bank)?\s*(?:credit\s*cards?)?[^.]{0,60}?(?:flat|instant|up\s*to|off|discount)\s*(?:of\s*)?(?:₹|rs\.?|inr)\s*([\d,]{2,7})/gi
  ];

  for (const m of t.matchAll(bankRegexes[0])) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    const bankRaw = (m[2] || '').toLowerCase();
    if (val >= 50 && val <= 30000 && (!listedPrice || val <= listedPrice * 0.35)) {
      if (val > bankInstantDiscount) bankInstantDiscount = val;
      if (bankRaw && !matchedBanks.includes(bankRaw)) matchedBanks.push(bankRaw);
      offerSnippets.push(m[0].trim().slice(0, 140));
    }
  }
  for (const m of t.matchAll(bankRegexes[1])) {
    const bankRaw = (m[1] || '').toLowerCase();
    const val = parseInt(m[2].replace(/,/g, ''), 10);
    if (val >= 50 && val <= 30000 && (!listedPrice || val <= listedPrice * 0.35)) {
      if (val > bankInstantDiscount) bankInstantDiscount = val;
      if (bankRaw && !matchedBanks.includes(bankRaw)) matchedBanks.push(bankRaw);
      offerSnippets.push(m[0].trim().slice(0, 140));
    }
  }

  const totalSaleDiscount = wowDealDiscount > 0
    ? wowDealDiscount
    : (couponDiscount + bankInstantDiscount);

  let dealSummary = '';
  if (wowDealDiscount > 0) {
    dealSummary = `Deal / Coupon Price: Buy at ₹${wowDealPrice.toLocaleString('en-IN')} (−₹${wowDealDiscount.toLocaleString('en-IN')} off listed ₹${listedPrice.toLocaleString('en-IN')})`;
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
    const pidParam = u.searchParams.get('pid') || u.searchParams.get('skuId') || u.searchParams.get('productId');
    if (pidParam) productId = pidParam;

    const qParam = u.searchParams.get('k') || u.searchParams.get('q');
    if (qParam && qParam.trim().length > 2) {
      return { slugTitle: normalizeSearchQuery(qParam), productId };
    }

    const parts = u.pathname.split('/').filter(Boolean);
    for (const p of parts) {
      if (/^B0[A-Z0-9]{8}$/i.test(p)) productId = p;
      if (/^itm[a-z0-9]{8,}$/i.test(p) && !productId) productId = p;
      if (/^\d{6,10}$/.test(p) && !productId) productId = p;
    }

    const stop = new Set(['dp', 'p', 's', 'gp', 'd', 'product', 'buy', 'shop', 'ref', 'itm', 'dl', 'pn', 'pvid']);
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
      const raw = decodeURIComponent(longest).replace(/[-_+]+/g, ' ').replace(/(\d+)\s*percent\b/gi, '$1%').trim();
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
            $('h1.css-1gc4x7i').text().trim() ||
            $('meta[property="og:title"]').attr('content') ||
            $('meta[name="twitter:title"]').attr('content') ||
            $('title').text().trim();
  }

  if (!price) {
    const amzOffscreen = $('#corePriceDisplay_desktop_feature_div .a-price.priceToPay .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #apex_desktop .a-price.priceToPay .a-offscreen').first().text();
    const amzWhole = $('#corePriceDisplay_desktop_feature_div .a-price-whole, #corePrice_feature_div .a-price-whole').first().text();
    const fkPrice = $('div.Nx9bqj.CxhGGd, div._30jeq3._16Jk6d, div.hl05eU .Nx9bqj').first().text();
    const nykaaPrice = $('span.css-1jczs19').first().text();
    const metaPrice = $('meta[property="product:price:amount"], meta[property="og:price:amount"], meta[name="twitter:data1"]').attr('content');
    price = parsePriceNumber(amzOffscreen) || parsePriceNumber(amzWhole) || parsePriceNumber(fkPrice) || parsePriceNumber(nykaaPrice) || parsePriceNumber(metaPrice);
  }

  if (!price) {
    const stateMatch =
      html.match(/"finalPrice"\s*:\s*\{[^}]*"value"\s*:\s*(\d+)/) ||
      html.match(/"offerPrice"\s*:\s*(\d+)/) ||
      html.match(/"discountedPrice"\s*:\s*(\d+)/) ||
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

// Layer 1: Scrape Indian Multi-Category Aggregators (BuyHatke, PriceHistory.app, Smartprix, 91mobiles)
// BuyHatke indexes beauty, personal care, fashion, groceries, medicines, AND electronics across Myntra, Nykaa, NykaaMan, Meesho, Tira, Amazon, Flipkart, Netmeds!
async function fetchFromIndianPriceAggregators(cleanQuery, referencePrice, scraperKey) {
  const storeResults = [];
  try {
    const q = `${cleanQuery} price in india (site:buyhatke.com OR site:pricehistory.app OR site:smartprix.com OR site:91mobiles.com)`;
    const searchUrl = `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}`;
    const resp = await axios.get(buildFetchUrl(searchUrl, scraperKey), {
      headers: DESKTOP_HEADERS,
      timeout: 8500
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

      // First parse BuyHatke / PriceHistory search snippets directly!
      // BuyHatke snippets look like: "Be Bodywise 1% Salicylic Acid Body Wash (250 ml)... ₹360. Buy now · Amazon ... ₹331. Buy now · Meesho"
      const combined = `${rawTitle} ${snippet}`;
      const buyNowParts = combined.split(/Buy\s+now/i);
      for (let i = 0; i < buyNowParts.length - 1; i++) {
        const leftPart = buyNowParts[i];
        const rightPart = buyNowParts[i + 1];
        const prices = extractAllRupeePrices(leftPart);
        const storeMatch = rightPart.match(/^\s*[·•|-]?\s*([A-Za-z0-9]+)|$/);
        const storeHint = (storeMatch && storeMatch[1]) || href;
        const store = detectStoreFromNameOrUrl(storeHint);
        if (store.id !== 'other' && prices.length > 0) {
          const pVal = prices[prices.length - 1];
          if (isRelevantCandidate(cleanQuery, leftPart, pVal, referencePrice) && !storeResults.some(r => r.merchantId === store.id)) {
            storeResults.push({
              merchantId: store.id,
              storeName: store.name,
              price: pVal,
              saleDiscount: 0,
              dealSummary: '',
              matchedBanks: [],
              productTitle: cleanQuery,
              url: `https://www.${store.site}`
            });
          }
        }
      }

      if (href && (href.includes('buyhatke.com') || href.includes('smartprix.com') || href.includes('91mobiles.com') || href.includes('pricehistory.app')) && aggUrls.length < 3) {
        aggUrls.push({ href, rawTitle, snippet });
      }
    });

    // Fetch top aggregator pages to extract full multi-store comparison rows
    await Promise.allSettled(aggUrls.map(async (agg) => {
      try {
        const pageResp = await axios.get(buildFetchUrl(agg.href, scraperKey), {
          headers: DESKTOP_HEADERS,
          timeout: 8000
        });
        const $p = cheerio.load(pageResp.data || '');
        const pageTitle = $p('h1').first().text().trim() || agg.rawTitle;

        // Parse Smartprix / 91mobiles / BuyHatke store cards
        $p('li.sm-store-item, div.pg-prc-tbl-row, tr.store_row, div.store_pricelist, .prc-grid, .store-row, a[href*="buyhatke"], div[class*="store"], div[class*="card"]').each((_, rowEl) => {
          const rowText = $p(rowEl).text().replace(/\s+/g, ' ').trim();
          if (rowText.length > 260) return;
          const imgAlt = $p(rowEl).find('img').attr('alt') || '';
          const combinedStoreHint = `${imgAlt} ${rowText}`;
          const store = detectStoreFromNameOrUrl(combinedStoreHint);
          if (store.id === 'other') return;

          const prices = extractAllRupeePrices(rowText);
          if (prices.length === 0) return;
          const pVal = prices[0];
          if (!isRelevantCandidate(cleanQuery, `${pageTitle} ${rowText}`, pVal, referencePrice)) return;

          const dealInfo = extractStructuredDealInfo(rowText, pVal);
          if (!storeResults.some(r => r.merchantId === store.id)) {
            storeResults.push({
              merchantId: store.id,
              storeName: store.name,
              price: pVal,
              saleDiscount: dealInfo.totalSaleDiscount || 0,
              dealSummary: dealInfo.dealSummary || '',
              matchedBanks: dealInfo.matchedBanks || [],
              productTitle: pageTitle.replace(/\s*(?:Price History of|Price in India).*$/i, '').trim() || cleanQuery,
              url: `https://www.${store.site}`
            });
          }
        });
      } catch (e) {}
    }));
  } catch (e) {}
  return storeResults;
}

// Layer 2 & 3: Multi-Engine Web Index Lookup (Yahoo India + DuckDuckGo HTML)
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
        const cleanTitle = c.rawTitle.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Nykaa|NykaaMan|Meesho|Zepto|Be Bodywise|OPPO|OnePlus|Samsung|Buy Online|Price in India.*).*$/i, '').trim();
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

            if (validPrices.length >= 2 && maxP <= (referencePrice ? referencePrice * 1.25 : maxP) && minP >= maxP * 0.65 && minP < maxP) {
              listedPrice = maxP;
              const gap = maxP - minP;
              if (gap > saleDisc) {
                saleDisc = gap;
                dealSummary = `Coupon / Deal Price ₹${minP.toLocaleString('en-IN')} (−₹${gap.toLocaleString('en-IN')} off listed ₹${maxP.toLocaleString('en-IN')})`;
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

  const textBeforeUrl = String(rawInput || '').replace(/https?:\/\/[^\s]+/gi, '').replace(/^(?:take a look at this|check out this)\s+/i, '').replace(/\s+on\s+(?:flipkart|amazon|nykaa|myntra).*$/i, '').trim();

  try {
    const resp = await axios.get(buildFetchUrl(inputUrl, scraperKey), {
      headers: BOT_PREVIEW_HEADERS,
      maxRedirects: 8,
      timeout: 8500
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
        timeout: 8500
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
      // For NykaaMan (6005003), also check nykaa.com since both share the exact same product catalog and SKU!
      const siteFilter = storeInfo.site === 'nykaaman.com' ? 'nykaa.com' : (storeInfo.site || '');
      const indexed = await lookupProductViaWebIndex(lookupQ, siteFilter, 0, scraperKey);
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

  // Detect whether query is Beauty / Personal Care / Pharmacy / Fashion vs Electronics
  const isBeautyOrPersonalCare = /\b(body\s*wash|face\s*wash|serum|lotion|cream|shampoo|sunscreen|salicylic|niacinamide|benzoyl|lactic|aha|bha|moisturizer|cleanser|perfume|deodorant|bodywise|minimalist|nykaa|cetaphil|cerave|derma)\b/i.test(cleanTitle);

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
    }
  ];

  const [aggResults, directSettled] = await Promise.all([
    fetchFromIndianPriceAggregators(cleanTitle, referencePrice, scraperKey),
    Promise.allSettled(directTargets.map(async (t) => {
      try {
        const resp = await axios.get(buildFetchUrl(t.searchUrl, scraperKey), {
          headers: DESKTOP_HEADERS,
          timeout: 8000
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

  // Choose category-appropriate stores for Web Index lookup
  const webTargets = isBeautyOrPersonalCare
    ? [
        { id: 'nykaa', name: 'Nykaa / Nykaa Man', site: 'nykaa.com', fallbackUrl: `https://www.nykaa.com/search/result/?q=${enc}` },
        { id: 'myntra', name: 'Myntra', site: 'myntra.com', fallbackUrl: `https://www.myntra.com/${enc.replace(/%20/g, '-')}` },
        { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com', fallbackUrl: `https://www.flipkart.com/search?q=${enc}` },
        { id: 'amazon', name: 'Amazon India', site: 'amazon.in', fallbackUrl: `https://www.amazon.in/s?k=${enc}` },
        { id: 'zepto', name: 'Zepto', site: 'zepto.com', fallbackUrl: `https://www.zepto.com/search?query=${enc}` }
      ]
    : [
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

      if (found.url && (found.url.includes('/p/') || found.url.includes('/dp/') || found.url.includes('/product') || found.url.includes('/buy'))) {
        try {
          const pResp = await axios.get(buildFetchUrl(found.url, scraperKey), {
            headers: BOT_PREVIEW_HEADERS,
            timeout: 6000
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

  return results;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CardPick Multi-Store Live Engine v5.0',
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
  console.log(`CardPick Full-Stack Server v5.0 running on http://localhost:${PORT}`);
});
