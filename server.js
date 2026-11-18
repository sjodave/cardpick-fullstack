const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SERPAPI_KEY = process.env.SERPAPI_KEY || 'f8326bc33594a64328e3c11f18049a6e5d38a01e653b1105109856ec7144f812';
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
  bebodywise: { id: 'bebodywise', name: 'Be Bodywise Official', site: 'bebodywise.com', searchUrl: (q) => `https://bebodywise.com/search?q=${encodeURIComponent(q)}` }
};

function buildFetchUrl(targetUrl, apiKey) {
  const key = apiKey || SCRAPERAPI_KEY;
  if (key) {
    return `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}&country_code=in`;
  }
  return targetUrl;
}

// Fetch via r.jina.ai reader proxy when direct datacenter IP is blocked by Cloudflare/Captchas
async function fetchViaJinaReader(targetUrl, timeoutMs = 9500) {
  const jinaUrl = `https://r.jina.ai/${targetUrl}`;
  const resp = await axios.get(jinaUrl, {
    headers: {
      'Accept': 'text/plain',
      'X-Return-Format': 'markdown',
      'User-Agent': DESKTOP_HEADERS['User-Agent']
    },
    timeout: timeoutMs
  });
  return typeof resp.data === 'string' ? resp.data : '';
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
  const str = String(text);
  const matches = [
    ...str.matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]{2,9}(?:\.\d{1,2})?)/gi),
    ...str.matchAll(/(?:Price(?:\s+in\s+India)?|List\s+Price|Regular\s+Price|Selling\s+Price|Effective\s+Price|MRP)\s*[:|-]?\s*(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/gi)
  ];
  const nums = [];
  for (const m of matches) {
    const val = Math.round(parseFloat(m[1].replace(/,/g, '')));
    const afterIdx = (m.index || 0) + m[0].length;
    const afterSlice = str.slice(afterIdx, afterIdx + 12).toLowerCase();
    // Skip unit prices like "₹1.4/ml", EMI strings, or benchmark scores
    if (/^\s*\/\s*(?:ml|g|gm|kg|pc|unit|100|mo|month|m\b)/.test(afterSlice)) continue;
    if (/^\s*(?:mah|mp|hz|gb|tb|w\b|watt|points|score)/i.test(afterSlice)) continue;
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

// Stage 1: Canonical Product & Spec Fingerprinting with Strict Sub-Model Disambiguation
function buildProductFingerprint(rawTitle) {
  let s = String(rawTitle || '').trim();
  if (!s) return { cleanQuery: '', brand: '', modelTokens: [], storageGb: 0, volumeMl: 0 };

  s = s.replace(/https?:\/\/[^\s]+/gi, ' ');
  s = s.replace(/(\d+)\s*percent\b/gi, '$1%');
  s = s.replace(/^(?:take a look at this|check out this|buy)\s+/i, '');
  s = s.replace(/\s+on\s+(?:flipkart|amazon|myntra|croma|ajio|nykaa|nykaaman|meesho).*$/i, '');
  s = s.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Nykaa|NykaaMan|Smartprix|91mobiles|BuyHatke|Beebom|Buy Online|Price in India.*).*$/i, '');
  s = s.replace(/\b(?:Price in India|Buy Online|Specifications|Features|Review|Online at Best Price|Full Specs)\b.*$/i, '');

  const gbMatches = [...s.matchAll(/\b(\d+)\s*GB\b/gi)].map(m => parseInt(m[1], 10));
  const storageGb = gbMatches.find(n => n >= 64) || 0;

  const mlMatches = [...s.matchAll(/\b(\d+)\s*(?:ml|g|gm)\b/gi)].map(m => parseInt(m[1], 10));
  const volumeMl = mlMatches[0] || 0;

  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.split(/[|;]/)[0].split(',')[0];
  s = s.replace(/\b(smartphone|mobile\s+phone|with\s+.*|for\s+men.*|for\s+women.*|compatible\s+with.*|includes\s+.*|no\s+cost\s+emi.*|exchange\s+offer.*|treats\s+.*|prevents\s+.*)\b/gi, ' ');
  s = s.replace(/[^a-zA-Z0-9%\s+.-]/g, ' ').replace(/\s+/g, ' ').trim();

  const colorStop = new Set(['mist', 'grey', 'gray', 'black', 'white', 'silver', 'gold', 'blue', 'green', 'titanium', 'pink', 'purple', 'red', 'orange', 'yellow', 'starlight', 'midnight', 'teal', 'ultramarine', 'desert', 'natural', 'fresh', 'mint', 'pitch', 'quick']);
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
    .filter(w => w.length >= 1 && !['5g', '4g', 'ram', 'rom', 'the', 'new', 'be', 'for', 'and', 'with'].includes(w));

  return { cleanQuery: cleanQuery.trim(), brand, modelTokens, storageGb, volumeMl };
}

function normalizeSearchQuery(rawTitle) {
  return buildProductFingerprint(rawTitle).cleanQuery;
}

// Strict candidate validation: prevents "OnePlus Nord CE 6" (₹34,999) or "Nord CE 6 Lite" (₹28,999) from matching "OnePlus Nord 6" (₹46,999)
function isRelevantCandidate(queryTitle, candidateTitle, candidatePrice, referencePrice) {
  const fp = buildProductFingerprint(queryTitle);
  const cand = String(candidateTitle || '').toLowerCase().replace(/(\d+)\s*percent\b/gi, '$1%');
  const q = String(queryTitle || '').toLowerCase();

  // 1. Reject accessories unless query explicitly asks for one
  const accessoryWords = [
    'case', 'cover', 'tempered', 'glass', 'screen guard', 'protector',
    'back cover', 'pouch', 'skin', 'strap', 'cable', 'adapter', 'stand',
    'holder', 'flip cover', 'bumper', 'hydrogel', 'lens protector', 'charger for', 'dummy'
  ];
  for (const w of accessoryWords) {
    if (cand.includes(w) && !q.includes(w)) return false;
  }

  // 2. Strict Sub-Model Disambiguation (CE, Lite, Pro, Ultra, Plus, FE, Mini, Neo, R, T)
  // If user searched "OnePlus Nord 6", reject "Nord CE 6", "Nord CE6", "Nord CE 6 Lite", "OnePlus N6"
  const subModelModifiers = [
    { rx: /\bce\b|\bce\d+\b/i, checkInQ: /\bce\b|\bce\d+\b/i },
    { rx: /\blite\b/i, checkInQ: /\blite\b/i },
    { rx: /\bultra\b/i, checkInQ: /\bultra\b/i },
    { rx: /\bpro\b/i, checkInQ: /\bpro\b/i },
    { rx: /\bplus\b|\+/i, checkInQ: /\bplus\b|\+/i },
    { rx: /\bfe\b/i, checkInQ: /\bfe\b/i },
    { rx: /\bmini\b/i, checkInQ: /\bmini\b/i },
    { rx: /\bfold\b/i, checkInQ: /\bfold\b/i },
    { rx: /\bflip\b/i, checkInQ: /\bflip\b/i }
  ];
  for (const mod of subModelModifiers) {
    if (mod.rx.test(cand) !== mod.checkInQ.test(q)) {
      return false;
    }
  }

  // Also ensure exact generation number matches (e.g. "nord 6" must not match "nord 5" or "nord 4" or "n6")
  const qGenNums = [...q.matchAll(/\b(\d{1,2}[a-z]?)\b/gi)]
    .map(m => m[1].toLowerCase())
    .filter(n => !['5g', '4g', '1', '2', '3'].includes(n) || /\b(nord|find\s*x|iphone|galaxy\s*s|pixel|reno|realme|redmi\s*note)\s+\d+/i.test(q));

  const modelNumMatch = q.match(/\b(nord|find\s*x|iphone|galaxy\s*s|galaxy\s*a|galaxy\s*m|pixel|reno|note|oneplus)\s*(\d{1,2}[a-z]?)\b/i);
  if (modelNumMatch) {
    const series = modelNumMatch[1].toLowerCase().replace(/\s+/g, '\\s*');
    const exactNum = modelNumMatch[2].toLowerCase();
    const expectedRx = new RegExp(`\\b${series}\\s*${exactNum}\\b`, 'i');
    if (!expectedRx.test(cand)) {
      return false;
    }
  }

  // 3. Category minimum price floor for phones/laptops/tablets/TVs
  const isHighTicketDevice = /\b(iphone|oneplus|nord|galaxy|pixel|oppo|find\s*x|reno|vivo|iqoo|realme|xiaomi|redmi|poco|nothing\s*phone|motorola|edge|razr|macbook|ipad|laptop|television|smart\s*tv|ps5|playstation)\b/i.test(q) &&
                             !/\b(buds|earbuds|neckband|airpods|watch|band|charger|cable|adapter|case|cover|glass|protector|power\s*bank)\b/i.test(q);
  if (isHighTicketDevice && candidatePrice > 0 && candidatePrice < 6500) {
    return false;
  }

  // 4. Reject wrong storage variant if both specify storage
  if (fp.storageGb) {
    const candGbs = [...cand.matchAll(/\b(64|128|256|512|1024)\s*gb\b/gi)].map(m => parseInt(m[1], 10));
    if (candGbs.length > 0 && !candGbs.includes(fp.storageGb)) {
      return false;
    }
  }

  // 5. Reject multi-packs / kits if query is a single item
  if (!/\b(pack|combo|kit|set\s+of)\b/i.test(q) && /\b(pack\s+of\s+[234]|combo\s+set|set\s+of\s+[234]|back\s+acne\s+kit)\b/i.test(cand)) {
    return false;
  }

  if (referencePrice > 800 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.55 || candidatePrice > referencePrice * 1.55) {
      return false;
    }
  } else if (referencePrice >= 150 && referencePrice <= 800 && candidatePrice > 0) {
    if (candidatePrice < referencePrice * 0.45 || candidatePrice > referencePrice * 2.2) {
      return false;
    }
  }

  if (fp.modelTokens.length === 0) return true;
  let matched = 0;
  for (const t of fp.modelTokens) {
    if (cand.includes(t)) matched++;
  }
  return (matched / fp.modelTokens.length) >= 0.6;
}

// Stage 3: Separate Store/Coupon Deal Discount vs. Instant Bank Card Discount
function extractStructuredDealInfo(text, listedPrice) {
  const t = String(text || '').replace(/\s+/g, ' ');
  let couponDiscount = 0;
  let wowDealPrice = 0;
  let wowDealDiscount = 0;
  let bankInstantDiscount = 0;
  const matchedBanks = [];
  const offerSnippets = [];

  // 1. Check for "Buy at ₹...", "Best Price ₹... with coupon", "Effective Price ₹...", "From ₹... incl bank offers"
  const buyAtMatches = [
    ...t.matchAll(/(?:buy\s+at|best\s+price|wow!?\s*deal[^₹]*|effective\s+price[^₹]*|from\s*)\s*(?:₹|rs\.?|inr)\s*([\d,]{2,9})/gi)
  ];
  for (const m of buyAtMatches) {
    const dealP = parseInt(m[1].replace(/,/g, ''), 10);
    if (listedPrice >= 150 && dealP > listedPrice * 0.55 && dealP < listedPrice) {
      const diff = listedPrice - dealP;
      const clause = t.slice(Math.max(0, m.index - 30), Math.min(t.length, m.index + 80)).toLowerCase();
      if (clause.includes('bank') || clause.includes('icici') || clause.includes('hdfc') || clause.includes('axis') || clause.includes('card')) {
        if (diff > bankInstantDiscount) bankInstantDiscount = diff;
      } else {
        if (diff > wowDealDiscount) {
          wowDealDiscount = diff;
          wowDealPrice = dealP;
        }
      }
    }
  }

  // 2. Check for Store Coupon ("Apply ₹2,000 coupon", "Save ₹1,500 with coupon")
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
    /(?:flat|instant|extra|up\s*to|get|save|additional)\s*(?:₹|rs\.?|inr)\s*([\d,]{2,7})\s*(?:off|instant\s*discount|discount|cashback)[^.]{0,90}?(icici|hdfc|axis|sbi|indusind|kotak|onecard|selected\s+banks|all\s+bank|credit\s+card)/gi,
    /(icici|hdfc|axis|sbi|indusind|kotak|onecard)\s*(?:bank)?\s*(?:credit\s*cards?)?[^.]{0,60}?(?:flat|instant|up\s*to|off|discount)\s*(?:of\s*)?(?:₹|rs\.?|inr)\s*([\d,]{2,7})/gi,
    /instant\s+bank\s+discounts?\s+of\s+(?:₹|rs\.?|inr)\s*([\d,]{2,7})/gi
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
  for (const m of t.matchAll(bankRegexes[2])) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 50 && val <= 30000 && (!listedPrice || val <= listedPrice * 0.35)) {
      if (val > bankInstantDiscount) bankInstantDiscount = val;
    }
  }

  const storeCouponOrDealDiscount = wowDealDiscount > 0 ? wowDealDiscount : couponDiscount;

  const parts = [];
  if (wowDealDiscount > 0) {
    parts.push(`WOW/Deal −₹${wowDealDiscount.toLocaleString('en-IN')} (Buy at ₹${wowDealPrice.toLocaleString('en-IN')})`);
  } else if (couponDiscount > 0) {
    parts.push(`Store Coupon −₹${couponDiscount.toLocaleString('en-IN')}`);
  }
  if (bankInstantDiscount > 0) {
    const bLabel = matchedBanks.length > 0 ? ` (${matchedBanks.map(b => b.toUpperCase()).join('/')})` : ' (Select Bank Cards)';
    parts.push(`Instant Bank Discount −₹${bankInstantDiscount.toLocaleString('en-IN')}${bLabel}`);
  }

  return {
    couponDiscount: storeCouponOrDealDiscount,
    wowDealPrice,
    wowDealDiscount,
    bankInstantDiscount,
    matchedBanks,
    totalSaleDiscount: storeCouponOrDealDiscount,
    dealSummary: parts.join(' • '),
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

function parsePriceHistoryStats(text, currentPrices, cleanQuery) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const isPhoneOrLaptop = /\b(iphone|oneplus|nord|galaxy|pixel|oppo|find\s*x|reno|vivo|iqoo|realme|xiaomi|redmi|poco|macbook|ipad|laptop)\b/i.test(cleanQuery || '');
  const minValid = isPhoneOrLaptop ? 6500 : 75;

  let lowest = 0;
  let average = 0;
  let highest = 0;

  const lowMatch = t.match(/Lowest(?:\s+Ever)?\s*(?:Price)?\s*[:|-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]{2,9})/i) ||
                   t.match(/offer\s+price\s+of\s*(?:₹|Rs\.?|INR)\s*([\d,]{2,9})/i);
  const avgMatch = t.match(/Average\s*(?:Price)?\s*[:|-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]{2,9})/i) ||
                   t.match(/average\s+and\s+highest\s+prices\s+are\s*(?:₹|Rs\.?|INR)?\s*([\d,]{2,9})/i);
  const highMatch = t.match(/Highest\s*(?:Price)?\s*[:|-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]{2,9})/i) ||
                    t.match(/average\s+and\s+highest\s+prices\s+are\s*(?:₹|Rs\.?|INR)?\s*[\d,]+\s+and\s*(?:₹|Rs\.?|INR)?\s*([\d,]{2,9})/i);

  if (lowMatch) { const v = parseInt(lowMatch[1].replace(/,/g, ''), 10) || 0; if (v >= minValid) lowest = v; }
  if (avgMatch) { const v = parseInt(avgMatch[1].replace(/,/g, ''), 10) || 0; if (v >= minValid) average = v; }
  if (highMatch) { const v = parseInt(highMatch[1].replace(/,/g, ''), 10) || 0; if (v >= minValid) highest = v; }

  const validCurr = (currentPrices || []).filter(p => p >= minValid);
  if (validCurr.length > 0) {
    const minCurr = Math.min(...validCurr);
    const maxCurr = Math.max(...validCurr);
    const sumCurr = validCurr.reduce((a, b) => a + b, 0);
    if (!lowest || lowest > minCurr) lowest = minCurr;
    if (!average) average = Math.round(sumCurr / validCurr.length);
    if (!highest || highest < maxCurr) highest = maxCurr;
  }

  return { lowestPrice: lowest, averagePrice: average, highestPrice: highest };
}

// Layer 1: Keyless Jina Reader + Direct Scraping of 91mobiles, Smartprix, Beebom, BuyHatke, PriceHistory, and Brand Stores
async function fetchFromJinaAndAggregators(cleanQuery, referencePrice, scraperKey) {
  const storeResults = [];
  let historyTextAccumulator = '';
  const fp = buildProductFingerprint(cleanQuery);

  // Build slug for 91mobiles & Beebom (e.g. "oneplus-nord-6" or "apple-iphone-16")
  const modelSlug = fp.modelTokens.join('-').replace(/[^a-z0-9-]/g, '');

  const jinaTargets = [];
  if (modelSlug.length >= 3) {
    jinaTargets.push({ type: '91mobiles', url: `https://www.91mobiles.com/${modelSlug}-price-in-india` });
    jinaTargets.push({ type: 'beebom', url: `https://gadgets.beebom.com/mobile/${modelSlug}` });
  }
  if (fp.brand === 'oneplus' && modelSlug) {
    jinaTargets.push({ type: 'brand_oneplus', url: `https://www.oneplus.in/${modelSlug}` });
  }

  // Run Jina Reader on aggregator & brand pages in parallel (bypasses Render US IP blocks!)
  await Promise.allSettled(jinaTargets.map(async (jt) => {
    try {
      const md = await fetchViaJinaReader(jt.url, 9000);
      if (!md || md.length < 100) return;
      historyTextAccumulator += ' ' + md.slice(0, 8000);

      if (jt.type === 'brand_oneplus') {
        const prices = extractAllRupeePrices(md).filter(p => isRelevantCandidate(cleanQuery, cleanQuery, p, referencePrice));
        if (prices.length > 0) {
          // On OnePlus.in, "minimum fixed price is: ₹46,999" and "From ₹43,999 incl bank offers"
          const fixedMatch = md.match(/minimum\s+fixed\s+price\s+is\s*:\s*(?:₹|Rs\.?|INR)\s*([\d,]+)/i);
          const listed = fixedMatch ? parsePriceNumber(fixedMatch[1]) : Math.max(...prices.slice(0, 3));
          const dealInfo = extractStructuredDealInfo(md, listed);
          if (listed > 0 && isRelevantCandidate(cleanQuery, cleanQuery, listed, referencePrice)) {
            storeResults.push({
              merchantId: 'oneplus',
              storeName: 'OnePlus Store India',
              price: listed,
              saleDiscount: dealInfo.couponDiscount || 0,
              bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
              dealSummary: dealInfo.dealSummary || '',
              matchedBanks: dealInfo.matchedBanks.length ? dealInfo.matchedBanks : ['icici', 'hdfc', 'axis'],
              productTitle: cleanQuery,
              url: jt.url
            });
          }
        }
        return;
      }

      // Parse 91mobiles / Beebom markdown lines for store prices (e.g. "Amazon ₹46,999", "Flipkart ₹46,999", "Croma ₹46,999")
      const lines = md.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const windowText = lines.slice(i, i + 3).join(' ');
        const store = detectStoreFromNameOrUrl(windowText);
        if (store.id === 'other' || storeResults.some(r => r.merchantId === store.id)) continue;
        const prices = extractAllRupeePrices(windowText);
        if (prices.length === 0) continue;
        const pVal = prices[0];
        if (!isRelevantCandidate(cleanQuery, cleanQuery, pVal, referencePrice)) continue;

        const dealInfo = extractStructuredDealInfo(windowText, pVal);
        storeResults.push({
          merchantId: store.id,
          storeName: store.name,
          price: pVal,
          saleDiscount: dealInfo.couponDiscount || 0,
          bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
          dealSummary: dealInfo.dealSummary || '',
          matchedBanks: dealInfo.matchedBanks || [],
          productTitle: cleanQuery,
          url: `https://www.${store.site}/search?q=${encodeURIComponent(cleanQuery)}`
        });
      }
    } catch (e) {}
  }));

  // Layer 1B: Query Bing India RSS Feed (format=rss&setmkt=en-IN) + Jina Search Proxy — never blocked by US datacenter CAPTCHAs!
  const multiQueries = [
    `${cleanQuery} price in india amazon flipkart`,
    `${cleanQuery} price in india 91mobiles smartprix buyhatke`
  ];

  await Promise.allSettled(multiQueries.map(async (mq) => {
    try {
      const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(mq)}&format=rss&setmkt=en-IN&cc=IN`;
      const resp = await axios.get(buildFetchUrl(rssUrl, scraperKey), {
        headers: DESKTOP_HEADERS,
        timeout: 8000
      });
      const xml = typeof resp.data === 'string' ? resp.data : '';
      const $x = cheerio.load(xml, { xmlMode: true });

      $x('item').each((_, el) => {
        const itemTitle = $x(el).find('title').text().replace(/\s+/g, ' ').trim();
        const itemDesc = $x(el).find('description').text().replace(/\s+/g, ' ').trim();
        const itemLink = $x(el).find('link').text().trim();
        const combined = `${itemTitle} ${itemDesc}`;

        if (!isRelevantCandidate(cleanQuery, itemTitle, 0, 0)) return;
        historyTextAccumulator += ' ' + combined;

        // Check direct store match from URL or title
        const directStore = detectStoreFromNameOrUrl(`${itemLink} ${itemTitle}`);
        const prices = extractAllRupeePrices(combined).filter(p => isRelevantCandidate(cleanQuery, itemTitle, p, referencePrice));

        if (directStore.id !== 'other' && prices.length > 0 && !storeResults.some(r => r.merchantId === directStore.id)) {
          const dealInfo = extractStructuredDealInfo(combined, prices[0]);
          storeResults.push({
            merchantId: directStore.id,
            storeName: directStore.name,
            price: prices[0],
            saleDiscount: dealInfo.couponDiscount || 0,
            bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
            dealSummary: dealInfo.dealSummary || '',
            matchedBanks: dealInfo.matchedBanks || [],
            productTitle: itemTitle.replace(/\s*[:|–-]\s*(?:Amazon|Flipkart|Croma|Reliance|Vijay Sales|Myntra|Nykaa).*$/i, '').trim() || cleanQuery,
            url: itemLink || `https://www.${directStore.site}`
          });
        }

        // Also check aggregator snippets that mention Amazon / Flipkart / Croma / Vijay Sales / Reliance Digital prices inline
        const inlineStores = [
          { id: 'amazon', name: 'Amazon India', site: 'amazon.in', rx: /Amazon(?:\.in)?[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i },
          { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com', rx: /Flipkart(?:\.com)?[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i },
          { id: 'croma', name: 'Croma', site: 'croma.com', rx: /Croma[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i },
          { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com', rx: /Vijay\s*Sales[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i }
        ];
        for (const is of inlineStores) {
          if (storeResults.some(r => r.merchantId === is.id)) continue;
          const m = combined.match(is.rx);
          if (m) {
            const pVal = parsePriceNumber(m[1]);
            if (pVal > 0 && isRelevantCandidate(cleanQuery, itemTitle, pVal, referencePrice)) {
              const dealInfo = extractStructuredDealInfo(combined, pVal);
              storeResults.push({
                merchantId: is.id,
                storeName: is.name,
                price: pVal,
                saleDiscount: dealInfo.couponDiscount || 0,
                bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
                dealSummary: dealInfo.dealSummary || '',
                matchedBanks: dealInfo.matchedBanks || [],
                productTitle: cleanQuery,
                url: is.id === 'amazon' ? `https://www.amazon.in/s?k=${encodeURIComponent(cleanQuery)}` : `https://www.${is.site}/search?q=${encodeURIComponent(cleanQuery)}`
              });
            }
          }
        }

        // If an aggregator snippet (91mobiles, GadgetsNow, Beebom, Smartprix) states "price in India starts from Rs. 46,999" or "Price in India is ₹46,999" without naming a store in the same sentence, attribute it to Amazon & Flipkart if still empty
        if (prices.length > 0 && /(?:91mobiles|smartprix|gadgetsnow|beebom|cashify|pricehistory|buyhatke)/i.test(itemLink)) {
          const baseP = prices[0];
          const dealInfo = extractStructuredDealInfo(combined, baseP);
          if (/amazon/i.test(combined) && !storeResults.some(r => r.merchantId === 'amazon')) {
            storeResults.push({
              merchantId: 'amazon',
              storeName: 'Amazon India',
              price: baseP,
              saleDiscount: dealInfo.couponDiscount || 0,
              bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
              dealSummary: dealInfo.dealSummary || '',
              matchedBanks: dealInfo.matchedBanks || [],
              productTitle: cleanQuery,
              url: `https://www.amazon.in/s?k=${encodeURIComponent(cleanQuery)}`
            });
          }
          if (/flipkart/i.test(combined) && !storeResults.some(r => r.merchantId === 'flipkart')) {
            storeResults.push({
              merchantId: 'flipkart',
              storeName: 'Flipkart',
              price: baseP,
              saleDiscount: dealInfo.couponDiscount || 0,
              bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
              dealSummary: dealInfo.dealSummary || '',
              matchedBanks: dealInfo.matchedBanks || [],
              productTitle: cleanQuery,
              url: `https://www.flipkart.com/search?q=${encodeURIComponent(cleanQuery)}`
            });
          }
        }
      });
    } catch (e) {}
  }));

  // Also query Yahoo India for Smartprix / 91mobiles / BuyHatke / PriceHistory snippets
  try {
    const q = `${cleanQuery} price in india (site:91mobiles.com OR site:smartprix.com OR site:buyhatke.com OR site:pricehistory.app OR site:gadgets.beebom.com)`;
    const searchUrl = `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}`;
    const resp = await axios.get(buildFetchUrl(searchUrl, scraperKey), {
      headers: DESKTOP_HEADERS,
      timeout: 8000
    });
    const $ = cheerio.load(resp.data || '', eng.isXml ? { xmlMode: true } : undefined);

    $('div.algo, div.dd.algo').each((_, el) => {
      const block = $(el);
      const rawTitle = block.find('h3.title').text().replace(/\s+/g, ' ').trim();
      const snippet = block.find('.compText, .fc-falcon').text().replace(/\s+/g, ' ').trim();
      const combined = `${rawTitle} ${snippet}`;
      if (!isRelevantCandidate(cleanQuery, rawTitle, 0, 0)) return;

      historyTextAccumulator += ' ' + combined;

      // Extract store-paired prices from aggregator snippets (e.g. "Amazon. ₹46,999")
      const storeMentions = [
        { id: 'amazon', name: 'Amazon India', site: 'amazon.in', rx: /Amazon(?:\.in)?[^₹\d]{0,35}(?:₹|Rs\.?|INR)\s*([\d,]{3,9})/i },
        { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com', rx: /Flipkart(?:\.com)?[^₹\d]{0,35}(?:₹|Rs\.?|INR)\s*([\d,]{3,9})/i },
        { id: 'croma', name: 'Croma', site: 'croma.com', rx: /Croma[^₹\d]{0,35}(?:₹|Rs\.?|INR)\s*([\d,]{3,9})/i },
        { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com', rx: /Vijay\s*Sales[^₹\d]{0,35}(?:₹|Rs\.?|INR)\s*([\d,]{3,9})/i },
        { id: 'reliancedigital', name: 'Reliance Digital', site: 'reliancedigital.in', rx: /Reliance\s*Digital[^₹\d]{0,35}(?:₹|Rs\.?|INR)\s*([\d,]{3,9})/i }
      ];

      for (const sm of storeMentions) {
        if (storeResults.some(r => r.merchantId === sm.id)) continue;
        const m = combined.match(sm.rx);
        if (m) {
          const pVal = parsePriceNumber(m[1]);
          if (pVal > 0 && isRelevantCandidate(cleanQuery, rawTitle, pVal, referencePrice)) {
            const dealInfo = extractStructuredDealInfo(combined, pVal);
            storeResults.push({
              merchantId: sm.id,
              storeName: sm.name,
              price: pVal,
              saleDiscount: dealInfo.couponDiscount || 0,
              bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
              dealSummary: dealInfo.dealSummary || '',
              matchedBanks: dealInfo.matchedBanks || [],
              productTitle: cleanQuery,
              url: sm.id === 'amazon' ? `https://www.amazon.in/s?k=${encodeURIComponent(cleanQuery)}` : `https://www.${sm.site}/search?q=${encodeURIComponent(cleanQuery)}`
            });
          }
        }
      }

      // Parse BuyHatke "₹... Buy now · Store" pairs
      const buyNowParts = combined.split(/Buy\s+now/i);
      for (let i = 0; i < buyNowParts.length - 1; i++) {
        const leftPart = buyNowParts[i];
        const rightPart = buyNowParts[i + 1];
        const prices = extractAllRupeePrices(leftPart);
        const storeMatch = rightPart.match(/^\s*[·•|-]?\s*([A-Za-z0-9]+)/);
        const storeHint = (storeMatch && storeMatch[1]) || '';
        const store = detectStoreFromNameOrUrl(storeHint);
        if (store.id !== 'other' && prices.length > 0 && !storeResults.some(r => r.merchantId === store.id)) {
          const pVal = prices[prices.length - 1];
          if (isRelevantCandidate(cleanQuery, leftPart, pVal, referencePrice)) {
            storeResults.push({
              merchantId: store.id,
              storeName: store.name,
              price: pVal,
              saleDiscount: 0,
              bankInstantDiscount: 0,
              dealSummary: '',
              matchedBanks: [],
              productTitle: cleanQuery,
              url: `https://www.${store.site}`
            });
          }
        }
      }
    });
  } catch (e) {}

  return { storeResults, historyTextAccumulator };
}

async function lookupProductViaWebIndex(query, targetSite, referencePrice, scraperKey) {
  const q = targetSite ? `${query} site:${targetSite}` : query;

  const engines = [
    {
      url: `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&setmkt=en-IN&cc=IN`,
      isXml: true,
      parse: ($) => {
        const items = [];
        $('item').each((_, el) => {
          const rawTitle = $(el).find('title').text().replace(/\s+/g, ' ').trim();
          const snippet = $(el).find('description').text().replace(/\s+/g, ' ').trim();
          const href = $(el).find('link').text().trim();
          if (rawTitle) items.push({ rawTitle, snippet, href });
        });
        return items;
      }
    },
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
        timeout: 8000
      });
      const $ = cheerio.load(resp.data || '');
      const candidates = eng.parse($);

      for (const c of candidates) {
        const cleanTitle = c.rawTitle.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Nykaa|NykaaMan|Meesho|Zepto|Be Bodywise|OPPO|OnePlus|Samsung|Buy Online|Price in India.*).*$/i, '').trim();
        if (!isRelevantCandidate(query, cleanTitle, 0, 0)) continue;

        const combined = `${c.rawTitle} ${c.snippet}`;
        const prices = extractAllRupeePrices(combined).filter(p => isRelevantCandidate(query, cleanTitle, p, referencePrice));

        if (prices.length > 0) {
          const maxP = Math.max(...prices);
          const minP = Math.min(...prices);
          let listedPrice = prices[0];
          const dealInfo = extractStructuredDealInfo(combined, listedPrice);
          let saleDisc = dealInfo.couponDiscount;
          let bankDisc = dealInfo.bankInstantDiscount;
          let dealSummary = dealInfo.dealSummary;

          if (prices.length >= 2 && maxP <= (referencePrice ? referencePrice * 1.25 : maxP) && minP >= maxP * 0.65 && minP < maxP) {
            listedPrice = maxP;
            const gap = maxP - minP;
            if (gap > saleDisc && !bankDisc) {
              saleDisc = gap;
              dealSummary = `Deal Price ₹${minP.toLocaleString('en-IN')} (−₹${gap.toLocaleString('en-IN')} off listed ₹${maxP.toLocaleString('en-IN')})`;
            }
          }

          return {
            title: cleanTitle,
            price: listedPrice,
            saleDiscount: saleDisc,
            bankInstantDiscount: bankDisc,
            dealSummary,
            matchedBanks: dealInfo.matchedBanks || [],
            url: c.href,
            snippet: c.snippet
          };
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
      timeout: 8000
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
      const md = await fetchViaJinaReader(finalUrl, 8500);
      if (md && md.length > 80) {
        const lines = md.split(/\r?\n/);
        const titleLine = lines.find(l => /^Title:\s+/i.test(l));
        if (!parsed.title && titleLine) {
          parsed.title = titleLine.replace(/^Title:\s+/i, '').trim();
        }
        const prices = extractAllRupeePrices(md);
        if (!parsed.price && prices.length > 0) {
          parsed.price = prices[0];
        }
        const dInfo = extractStructuredDealInfo(md, parsed.price);
        if (dInfo.couponDiscount > parsed.dealInfo.couponDiscount || dInfo.bankInstantDiscount > parsed.dealInfo.bankInstantDiscount) {
          parsed.dealInfo = dInfo;
        }
      }
    } catch (e) {}
  }

  let hostname = '';
  try { hostname = new URL(finalUrl).hostname; } catch (e) {}
  const storeInfo = detectStoreFromNameOrUrl(hostname);
  const { slugTitle, productId } = extractInfoFromUrl(finalUrl);

  let bestTitle = parsed.title || textBeforeUrl || slugTitle;
  let bestPrice = parsed.price;
  let bestDiscount = parsed.dealInfo.couponDiscount;
  let bestBankDiscount = parsed.dealInfo.bankInstantDiscount;
  let bestDealSummary = parsed.dealInfo.dealSummary;

  if (!bestPrice || !bestTitle) {
    const lookupQ = productId ? `${slugTitle} ${productId}`.trim() : slugTitle;
    if (lookupQ) {
      const siteFilter = storeInfo.site === 'nykaaman.com' ? 'nykaa.com' : (storeInfo.site || '');
      let indexed = null;
      if (SERPAPI_KEY) {
        try {
          const sq = siteFilter ? `${lookupQ} site:${siteFilter}` : lookupQ;
          const sUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(sq)}&gl=in&hl=en&api_key=${encodeURIComponent(SERPAPI_KEY)}`;
          const sResp = await axios.get(sUrl, { timeout: 10000 });
          const org = (sResp.data && sResp.data.organic_results) || [];
          for (const item of org) {
            const cTitle = String(item.title || '').replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Nykaa|NykaaMan|Buy Online|Price in India.*).*$/i, '').trim();
            const richPrice = item.rich_snippet && item.rich_snippet.top && item.rich_snippet.top.detected_extensions && item.rich_snippet.top.detected_extensions.price;
            const snippetPrices = extractAllRupeePrices(`${item.title || ''} ${item.snippet || ''}`);
            const pVal = parsePriceNumber(richPrice) || snippetPrices[0] || 0;
            if (cTitle.length > 4) {
              const dealInfo = extractStructuredDealInfo(`${item.title || ''} ${item.snippet || ''}`, pVal);
              indexed = {
                title: cTitle,
                price: pVal,
                saleDiscount: dealInfo.couponDiscount || 0,
                bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
                dealSummary: dealInfo.dealSummary || '',
                url: item.link || ''
              };
              if (pVal > 0) break;
            }
          }
        } catch (e) {}
      }
      if (!indexed || !indexed.price) {
        const webIdx = await lookupProductViaWebIndex(lookupQ, siteFilter, 0, scraperKey);
        if (webIdx) indexed = webIdx;
      }
      if (indexed) {
        if (!bestTitle && indexed.title) bestTitle = indexed.title;
        if (!bestPrice && indexed.price > 0) bestPrice = indexed.price;
        if (!bestDiscount && indexed.saleDiscount > 0) bestDiscount = indexed.saleDiscount;
        if (!bestBankDiscount && indexed.bankInstantDiscount > 0) bestBankDiscount = indexed.bankInstantDiscount;
        if (!bestDealSummary && indexed.dealSummary) bestDealSummary = indexed.dealSummary;
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
    originBankDiscount: bestBankDiscount,
    originDealSummary: bestDealSummary,
    originUrl: finalUrl,
    bankOffers: parsed.bankOffers
  };
}

async function searchStorePrices(searchQuery, referencePrice, serpApiKey, scraperKey) {
  const fp = buildProductFingerprint(searchQuery);
  const cleanTitle = fp.cleanQuery;
  if (!cleanTitle) return { stores: [], priceHistory: { lowestPrice: 0, averagePrice: 0, highestPrice: 0 } };

  const results = [];
  const activeSerpKey = serpApiKey || SERPAPI_KEY;

  const isBeautyOrPersonalCare = /\b(body\s*wash|face\s*wash|serum|lotion|cream|shampoo|sunscreen|salicylic|niacinamide|benzoyl|lactic|aha|bha|moisturizer|cleanser|perfume|deodorant|bodywise|minimalist|nykaa|cetaphil|cerave|derma)\b/i.test(cleanTitle);

  let serpHistoryText = '';
  if (activeSerpKey) {
    const shopUrl = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(cleanTitle)}&gl=in&hl=en&api_key=${encodeURIComponent(activeSerpKey)}`;
    const orgQ = `${cleanTitle} price in india (site:amazon.in OR site:flipkart.com OR site:croma.com OR site:vijaysales.com OR site:reliancedigital.in OR site:oneplus.in OR site:oppo.com OR site:nykaa.com OR site:myntra.com OR site:91mobiles.com OR site:smartprix.com OR site:pricehistory.app OR site:buyhatke.com)`;
    const orgUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(orgQ)}&num=20&gl=in&hl=en&api_key=${encodeURIComponent(activeSerpKey)}`;

    const [shopRes, orgRes] = await Promise.allSettled([
      axios.get(shopUrl, { timeout: 12000 }),
      axios.get(orgUrl, { timeout: 12000 })
    ]);

    // 1A: Parse SerpApi Google Shopping results
    if (shopRes.status === 'fulfilled' && shopRes.value && shopRes.value.data) {
      const shopping = shopRes.value.data.shopping_results || [];
      for (const item of shopping) {
        const store = detectStoreFromNameOrUrl(item.source || '');
        const price = parsePriceNumber(item.extracted_price || item.price);
        if (!price || store.id === 'other') continue;
        if (!isRelevantCandidate(cleanTitle, item.title || cleanTitle, price, referencePrice)) continue;

        const dealInfo = extractStructuredDealInfo(`${item.title || ''} ${(item.extensions || []).join(' ')}`, price);
        if (!results.some(r => r.merchantId === store.id)) {
          results.push({
            merchantId: store.id,
            storeName: store.name,
            price,
            saleDiscount: dealInfo.couponDiscount || 0,
            bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
            dealSummary: dealInfo.dealSummary || '',
            matchedBanks: dealInfo.matchedBanks || [],
            productTitle: item.title || cleanTitle,
            url: item.link || item.product_link || ''
          });
        }
      }
    }

    // 1B: Parse SerpApi Google Organic results (captures Flipkart, Amazon, OnePlus.in, 91mobiles, Smartprix, PriceHistory.app, BuyHatke!)
    if (orgRes.status === 'fulfilled' && orgRes.value && orgRes.value.data) {
      const organics = orgRes.value.data.organic_results || [];
      for (const item of organics) {
        const rawTitle = String(item.title || '').trim();
        const snippet = String(item.snippet || '').trim();
        const link = String(item.link || '').trim();
        const combined = `${rawTitle} ${snippet}`;

        if (!isRelevantCandidate(cleanTitle, rawTitle, 0, 0)) continue;
        serpHistoryText += ' ' + combined;

        // Check rich_snippet price first, then snippet rupee prices
        let richPrice = 0;
        if (item.rich_snippet && item.rich_snippet.top && item.rich_snippet.top.detected_extensions) {
          richPrice = parsePriceNumber(item.rich_snippet.top.detected_extensions.price);
        }
        const snippetPrices = extractAllRupeePrices(combined).filter(p => isRelevantCandidate(cleanTitle, rawTitle, p, referencePrice));
        const pVal = (richPrice && isRelevantCandidate(cleanTitle, rawTitle, richPrice, referencePrice)) ? richPrice : (snippetPrices[0] || 0);

        const directStore = detectStoreFromNameOrUrl(`${link} ${item.source || ''}`);
        if (directStore.id !== 'other' && pVal > 0 && !results.some(r => r.merchantId === directStore.id)) {
          const dealInfo = extractStructuredDealInfo(combined, pVal);
          results.push({
            merchantId: directStore.id,
            storeName: directStore.name,
            price: pVal,
            saleDiscount: dealInfo.couponDiscount || 0,
            bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
            dealSummary: dealInfo.dealSummary || '',
            matchedBanks: dealInfo.matchedBanks || [],
            productTitle: rawTitle.replace(/\s*[:|–-]\s*(?:Amazon\.in|Flipkart\.com|Flipkart|Croma|Reliance Digital|Vijay Sales|Myntra|Nykaa|NykaaMan|Buy Online|Price in India.*).*$/i, '').trim() || cleanTitle,
            url: link
          });
        }

        // Also parse aggregator snippets (91mobiles, Smartprix, GadgetsNow, Beebom, BuyHatke) returned by Google!
        if (/(?:91mobiles|smartprix|gadgetsnow|beebom|buyhatke|pricehistory)/i.test(link) && pVal > 0) {
          const inlineStores = [
            { id: 'amazon', name: 'Amazon India', site: 'amazon.in', rx: /Amazon(?:\.in)?[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i },
            { id: 'flipkart', name: 'Flipkart', site: 'flipkart.com', rx: /Flipkart(?:\.com)?[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i },
            { id: 'croma', name: 'Croma', site: 'croma.com', rx: /Croma[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i },
            { id: 'vijaysales', name: 'Vijay Sales', site: 'vijaysales.com', rx: /Vijay\s*Sales[^₹\d]{0,40}(?:₹|Rs\.?|INR)?\s*(\d{1,2},\d{2},\d{3}|\d{2},\d{3}|\d{3,6})/i }
          ];
          for (const is of inlineStores) {
            if (results.some(r => r.merchantId === is.id)) continue;
            const m = combined.match(is.rx);
            const storeP = m ? parsePriceNumber(m[1]) : (combined.toLowerCase().includes(is.id) ? pVal : 0);
            if (storeP > 0 && isRelevantCandidate(cleanTitle, rawTitle, storeP, referencePrice)) {
              const dealInfo = extractStructuredDealInfo(combined, storeP);
              results.push({
                merchantId: is.id,
                storeName: is.name,
                price: storeP,
                saleDiscount: dealInfo.couponDiscount || 0,
                bankInstantDiscount: dealInfo.bankInstantDiscount || 0,
                dealSummary: dealInfo.dealSummary || '',
                matchedBanks: dealInfo.matchedBanks || [],
                productTitle: cleanTitle,
                url: is.id === 'amazon' ? `https://www.amazon.in/s?k=${encodeURIComponent(cleanTitle)}` : `https://www.${is.site}/search?q=${encodeURIComponent(cleanTitle)}`
              });
            }
          }
        }
      }
    }

    // If SerpApi already found 2+ stores, return immediately without waiting for slow fallback scrapers!
    if (results.length >= 2) {
      const allStorePrices = results.map(r => r.price).filter(p => p > 0);
      const priceHistory = parsePriceHistoryStats(serpHistoryText, allStorePrices, cleanTitle);
      return { stores: results, priceHistory };
    }
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
              saleDiscount: dealInfo.couponDiscount,
              bankInstantDiscount: dealInfo.bankInstantDiscount,
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
              saleDiscount: dealInfo.couponDiscount,
              bankInstantDiscount: dealInfo.bankInstantDiscount,
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

  const [aggData, directSettled] = await Promise.all([
    fetchFromJinaAndAggregators(cleanTitle, referencePrice, scraperKey),
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
            bankInstantDiscount: parsed.bankInstantDiscount || 0,
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

  const aggResults = (aggData && aggData.storeResults) || [];
  const historyTextAccumulator = (aggData && aggData.historyTextAccumulator) || '';
  for (const agg of aggResults) {
    if (!results.some(r => r.merchantId === agg.merchantId)) {
      results.push(agg);
    }
  }

  const effectiveRefPrice = referencePrice || (results[0] && results[0].price) || 0;

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
      return {
        merchantId: wt.id,
        storeName: wt.name,
        price: found.price,
        saleDiscount: found.saleDiscount || 0,
        bankInstantDiscount: found.bankInstantDiscount || 0,
        dealSummary: found.dealSummary || '',
        matchedBanks: found.matchedBanks || [],
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

  const allStorePrices = results.map(r => r.price).filter(p => p > 0);
  const priceHistory = parsePriceHistoryStats(serpHistoryText + ' ' + historyTextAccumulator, allStorePrices, cleanTitle);
  return { stores: results, priceHistory };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CardPick Multi-Store Live Engine v6.5 (SerpApi Enabled)',
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
    const searchOut = await searchStorePrices(searchQuery, refPrice, serpApiKey, scraperApiKey);
    const stores = searchOut.stores || [];
    let priceHistory = searchOut.priceHistory || { lowestPrice: 0, averagePrice: 0, highestPrice: 0 };

    if (originData && originData.originStore && originData.originStore.id !== 'other') {
      const idx = stores.findIndex(s => s.merchantId === originData.originStore.id);
      if (originData.originPrice > 0) {
        const originEntry = {
          merchantId: originData.originStore.id,
          storeName: originData.originStore.name,
          price: originData.originPrice,
          saleDiscount: originData.originSaleDiscount || 0,
          bankInstantDiscount: originData.originBankDiscount || 0,
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
          if (originData.originBankDiscount > (stores[idx].bankInstantDiscount || 0)) {
            stores[idx].bankInstantDiscount = originData.originBankDiscount;
          }
        } else {
          stores.unshift(originEntry);
        }
      } else if (idx >= 0) {
        stores[idx].url = originData.originUrl;
      }
    }

    if (stores.length > 0 && (!priceHistory.lowestPrice || !priceHistory.averagePrice)) {
      const pList = stores.map(s => s.price).filter(p => p > 0);
      if (pList.length > 0) {
        if (!priceHistory.lowestPrice) priceHistory.lowestPrice = Math.min(...pList);
        if (!priceHistory.averagePrice) priceHistory.averagePrice = Math.round(pList.reduce((a, b) => a + b, 0) / pList.length);
        if (!priceHistory.highestPrice) priceHistory.highestPrice = Math.max(...pList);
      }
    }

    return res.json({
      ok: true,
      productTitle: searchQuery,
      fullTitle: (originData && originData.title) || searchQuery,
      originData,
      priceHistory,
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
  console.log(`CardPick Full-Stack Server v6.0 running on http://localhost:${PORT}`);
});
