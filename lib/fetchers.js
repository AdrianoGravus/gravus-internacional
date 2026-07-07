/**
 * Gravus Internacional - Data Fetchers
 * Fetches global financial data from Yahoo Finance and international news sources (PT + EN).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ============================================================
// CACHE (in-memory, 120s TTL)
// ============================================================
const CACHE = {};
const CACHE_TTL = 120 * 1000;

function cget(key) {
  const entry = CACHE[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function cset(key, data) {
  CACHE[key] = { data, ts: Date.now() };
}

// ============================================================
// HTTP HELPER
// ============================================================
async function fetchText(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/html,application/xhtml+xml,application/xml,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(url, timeout = 12000) {
  const text = await fetchText(url, timeout);
  return JSON.parse(text);
}

// ============================================================
// YAHOO FINANCE
// ============================================================
async function yfQuote(sym) {
  const cached = cget(`yf_${sym}`);
  if (cached) return [sym, cached];
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&includePrePost=false`;
    const data = await fetchJSON(url);
    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose || meta.previousClose;
    if (price == null || prev == null) return [sym, null];
    const change = price - prev;
    const pct = (change / prev) * 100;
    const result = {
      symbol: sym,
      price: +price.toFixed(6),
      change: +change.toFixed(6),
      pct: +pct.toFixed(4),
      prevClose: +prev.toFixed(6),
    };
    cset(`yf_${sym}`, result);
    return [sym, result];
  } catch (e) {
    console.log(`  [!] ${sym}: ${e.message}`);
    return [sym, null];
  }
}

async function yfBatch(symbols, label = '') {
  const results = {};
  const runPass = async (syms) => {
    const settled = await Promise.allSettled(syms.map(s => yfQuote(s)));
    for (const res of settled) {
      if (res.status === 'fulfilled' && res.value[1]) {
        const [sym, data] = res.value;
        results[sym] = data;
      }
    }
  };
  await runPass(symbols);
  // retry once for symbols that failed (transient network errors)
  const missing = symbols.filter(s => !results[s]);
  if (missing.length) {
    await new Promise(r => setTimeout(r, 400));
    await runPass(missing);
  }
  if (label) console.log(`  [${label}] ${Object.keys(results).length}/${symbols.length} quotes OK`);
  return results;
}

// ============================================================
// NEWS (RSS) - mixed PT + EN
// ============================================================
function extractXML(text, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's');
  const m = text.match(regex);
  return m ? m[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim() : '';
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function parseRssItems(text, { source, lang, max = 15, sourceFromFeed = false } = {}) {
  const items = [];
  const rawItems = text.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const raw of rawItems.slice(0, max)) {
    const title = decodeEntities(extractXML(raw, 'title'));
    if (!title) continue;
    const linkM = raw.match(/<link>(.*?)<\/link>/s);
    const link = linkM ? decodeEntities(linkM[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()) : '#';
    const pubM = raw.match(/<pubDate>(.*?)<\/pubDate>/);
    const pub = pubM ? pubM[1].trim() : '';
    let image = '';
    const encM = raw.match(/<enclosure[^>]*url=["']([^"']+)["']/) ||
      raw.match(/<media:content[^>]*url=["']([^"']+)["']/) ||
      raw.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/);
    if (encM) image = decodeEntities(encM[1]);
    if (!image) {
      const imgM = raw.match(/<img[^>]*src=["']([^"'?>]+)/);
      if (imgM) image = imgM[1].split('?')[0];
    }
    if (image && !/^https?:\/\//.test(image)) image = '';
    if (image.includes('108x81')) image = '';
    let src = source;
    if (sourceFromFeed) {
      const srcM = raw.match(/<source[^>]*>(.*?)<\/source>/);
      src = srcM ? decodeEntities(srcM[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : source;
    }
    items.push({ title, link, source: src, pubDate: pub, image, lang });
  }
  return items;
}

function feed(url, opts) {
  return fetchText(url, 10000)
    .then(text => {
      const items = parseRssItems(text, opts);
      console.log(`  [${opts.source}/${opts.lang}] ${items.length} articles`);
      return items;
    })
    .catch(e => { console.log(`  [${opts.source}] Error: ${e.message}`); return []; });
}

async function fetchNews() {
  const cached = cget('news_global');
  if (cached) return cached;

  const sources = [
    // --- Português ---
    feed('https://www.infomoney.com.br/mundo/feed/', { source: 'InfoMoney', lang: 'pt', max: 12 }),
    feed('https://www.bloomberglinea.com.br/arc/outboundfeeds/rss/?outputType=xml', { source: 'Bloomberg Línea', lang: 'pt', max: 12 }),
    feed('https://news.google.com/rss/search?q=wall+street+OR+fed+OR+bolsas+globais+OR+economia+global+when:1d&hl=pt-BR&gl=BR&ceid=BR:pt-419', { source: 'Google News', lang: 'pt', max: 12, sourceFromFeed: true }),
    // --- English ---
    feed('https://www.investing.com/rss/news_25.rss', { source: 'Investing.com', lang: 'en', max: 12 }),
    feed('https://www.cnbc.com/id/100727362/device/rss/rss.html', { source: 'CNBC', lang: 'en', max: 12 }),
    feed('https://www.cnbc.com/id/100003114/device/rss/rss.html', { source: 'CNBC', lang: 'en', max: 10 }),
    feed('https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', { source: 'MarketWatch', lang: 'en', max: 10 }),
    feed('https://news.google.com/rss/search?q=stock+market+OR+federal+reserve+OR+treasury+yields+when:1d&hl=en-US&gl=US&ceid=US:en', { source: 'Google News', lang: 'en', max: 10, sourceFromFeed: true }),
  ];

  const settled = await Promise.allSettled(sources);

  const seenTitles = new Set();
  const withImg = [];
  const withoutImg = [];
  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    for (const item of res.value) {
      const key = item.title.toLowerCase().slice(0, 80);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      if (item.image) withImg.push(item);
      else withoutImg.push(item);
    }
  }

  // interleave PT / EN so both languages show up early
  const interleave = (arr) => {
    const pt = arr.filter(i => i.lang === 'pt');
    const en = arr.filter(i => i.lang === 'en');
    const out = [];
    const n = Math.max(pt.length, en.length);
    for (let i = 0; i < n; i++) {
      if (pt[i]) out.push(pt[i]);
      if (en[i]) out.push(en[i]);
    }
    return out;
  };

  const allNews = [...interleave(withImg), ...interleave(withoutImg)].slice(0, 40);
  console.log(`  [Total] ${allNews.length} news (${withImg.length} with image)`);
  cset('news_global', allNews);
  return allNews;
}

// ============================================================
// ASSET LISTS
// ============================================================
const AMERICAS = ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', '^BVSP', '^MXX', '^GSPTSE'];
const EUROPE = ['^STOXX50E', '^GDAXI', '^FTSE', '^FCHI', '^IBEX', '^SSMI', '^AEX', 'FTSEMIB.MI'];
const ASIA = ['^N225', '^HSI', '000300.SS', '^KS11', '^TWII', '^BSESN', '^AXJO', '^STI'];
const FUTURES = ['ES=F', 'NQ=F', 'YM=F', 'RTY=F'];
const MEGACAPS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'TSM', 'ASML', 'SAP', 'TM', 'BABA', 'NVO', 'JPM', 'V'];
const YIELDS = ['^IRX', '2YY=F', '^FVX', '^TNX', '^TYX'];
const CURRENCIES = ['DX-Y.NYB', 'EURUSD=X', 'GBPUSD=X', 'JPY=X', 'CNY=X', 'CHF=X', 'AUDUSD=X', 'USDBRL=X', 'EURBRL=X', 'MXN=X'];
const COMMODITIES = ['BZ=F', 'CL=F', 'GC=F', 'SI=F', 'HG=F', 'PL=F', 'NG=F', 'ZC=F', 'ZS=F', 'ZW=F', 'KC=F', 'SB=F', 'CT=F', 'CC=F'];
const CRYPTO = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD'];

// ============================================================
// FETCH ALL (parallel)
// ============================================================
export async function fetchGlobalData() {
  const t0 = Date.now();
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  UPDATING GLOBAL - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  console.log(`${'='.repeat(55)}`);

  const [americas, europe, asia, futures, megacaps, yields, currencies, commodities, crypto, news] =
    await Promise.allSettled([
      yfBatch(AMERICAS, 'Américas'),
      yfBatch(EUROPE, 'Europa'),
      yfBatch(ASIA, 'Ásia'),
      yfBatch(FUTURES, 'Futuros EUA'),
      yfBatch(MEGACAPS, 'Mega caps'),
      yfBatch(YIELDS, 'Treasuries'),
      yfBatch(CURRENCIES, 'Câmbio'),
      yfBatch(COMMODITIES, 'Commodities'),
      yfBatch(CRYPTO, 'Cripto'),
      fetchNews(),
    ]);

  const val = (r) => r.status === 'fulfilled' ? r.value : {};
  const valArr = (r) => r.status === 'fulfilled' ? r.value : [];

  const results = {
    americas: val(americas),
    europe: val(europe),
    asia: val(asia),
    futures: val(futures),
    megacaps: val(megacaps),
    yields: val(yields),
    currencies: val(currencies),
    commodities: val(commodities),
    crypto: val(crypto),
    news: valArr(news),
  };

  // Top movers (mega caps only)
  const sortedByPct = Object.values(results.megacaps).sort((a, b) => (a.pct || 0) - (b.pct || 0));
  results.top_gainers = sortedByPct.slice(-5).reverse();
  results.top_losers = sortedByPct.slice(0, 5);

  const totalQuotes = ['americas', 'europe', 'asia', 'futures', 'megacaps', 'yields', 'currencies', 'commodities', 'crypto']
    .reduce((sum, k) => sum + Object.keys(results[k]).length, 0);
  const elapsed = Date.now() - t0;

  results.timestamp = new Date().toISOString();
  results.stats = {
    americas: Object.keys(results.americas).length,
    europe: Object.keys(results.europe).length,
    asia: Object.keys(results.asia).length,
    futures: Object.keys(results.futures).length,
    megacaps: Object.keys(results.megacaps).length,
    yields: Object.keys(results.yields).length,
    currencies: Object.keys(results.currencies).length,
    commodities: Object.keys(results.commodities).length,
    crypto: Object.keys(results.crypto).length,
    news: results.news.length,
    news_pt: results.news.filter(n => n.lang === 'pt').length,
    news_en: results.news.filter(n => n.lang === 'en').length,
    total_quotes: totalQuotes,
    elapsed_ms: elapsed,
  };

  console.log(`\n  TOTAL: ${totalQuotes} quotes | ${results.news.length} news | ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`${'='.repeat(55)}\n`);

  return results;
}
