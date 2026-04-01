const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const NYT_KEY = 'FBk70O0AQMdtdfKHLhYUbOdH0E7CH4OtD7J0iem97oGlaeeu';
const GUARDIAN_KEY = '947edef0-14f7-4bff-86ad-5a158a053292';
const MEDIASTACK_KEY = 'b6dacf356f4b696958122b07e1c305f1';

const BRANDS = [
  { name: 'Wawa',    query: 'Wawa',           color: '#e8002d' },
  { name: 'Stihl',   query: 'Stihl',          color: '#f97316' },
  { name: 'Geico',   query: 'Geico',          color: '#22c55e' },
  { name: 'Hershey', query: 'Hershey',        color: '#a0522d' },
  { name: 'Axe',     query: 'Axe body spray', color: '#3b82f6' },
];

const BLOCKED_SUBREDDITS = [
  'onlyfans','nsfw','gonewild','sex','porn','adult','hentai','anime',
  'lewd','erotica','realgirls','cumsluts','ass','boobs','rule34',
  'nsfwhardcore','randnsfw','freeuse','thighzone','cosplaygirls',
  'blowjobs','cumshots','teenagers','pokemontcg_de','pokemon'
];

const BLOCKED_KEYWORDS = [
  'onlyfans','nsfw','porn','xxx','nude','naked','cock','pussy',
  'anal','sex tape','only fans','18+','cum','boobs','ass pic',
  'free of','my of','subscribe','leak'
];

const FOREIGN_WORDS = [
  'euch','ihr','und','die','der','das','ist','nicht','eine','von',
  'mit','sich','auch','auf','für','mais','pour','les','des','que',
  'por','los','las','una','con','del','esto','para','como','tout',
  'avec','dans','est','sur','qui','pas','sont','leur','nous'
];

function isEnglish(text) {
  if (!text || text.length < 10) return true;
  const words = text.toLowerCase().split(/\s+/);
  return words.filter(w => FOREIGN_WORDS.includes(w)).length < 2;
}

function score(text) {
  const t = text.toLowerCase();
  const pos = ['love','great','best','amazing','perfect','good','fresh','favorite','awesome','excellent','free','loyalty','expand','donate','top','win','happy','convenient','clean','friendly','quality','announce','launch','award','opens','recommend','celebrate'];
  const neg = ['bad','broken','slow','wrong','complaint','issue','problem','rude','stale','expensive','unhappy','frustrated','concern','pricey','error','fail','disappoint','discontinue','lawsuit','recall','shut','cancel'];
  let p=0,n=0;
  pos.forEach(w=>{if(t.includes(w))p++;});
  neg.forEach(w=>{if(t.includes(w))n++;});
  return p>n?'positive':n>p?'negative':'neutral';
}

async function getReddit(brand) {
  try {
    const r = await fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(brand.query)}&sort=relevance&limit=50&t=week&raw_json=1`, {
      headers: { 'User-Agent': 'Martin-Command-Center/1.0', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error('Reddit ' + r.status);
    const data = await r.json();
    const seen = new Set();
    return (data.data?.children || []).filter(c => {
      const p = c.data;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      const sub = (p.subreddit || '').toLowerCase();
      const title = (p.title || '').toLowerCase();
      const body = (p.selftext || '').toLowerCase();
      const combined = title + ' ' + body;
      if (BLOCKED_SUBREDDITS.some(s => sub.includes(s))) return false;
      if (BLOCKED_KEYWORDS.some(k => combined.includes(k))) return false;
      if (p.over_18) return false;
      if ((p.score || 0) < 1) return false;
      if (!isEnglish(p.title)) return false;
      if (!title.includes(brand.name.toLowerCase())) return false;
      return true;
    }).slice(0, 10).map(c => ({
      id: 'r_' + c.data.id,
      type: 'reddit',
      brand: brand.name,
      color: brand.color,
      title: c.data.title,
      description: c.data.selftext ? c.data.selftext.substring(0, 140) : '',
      source: 'r/' + c.data.subreddit,
      url: 'https://reddit.com' + c.data.permalink,
      ts: c.data.created_utc,
      engagement: (c.data.ups || 0).toLocaleString() + ' pts',
      sentiment: score(c.data.title + ' ' + c.data.selftext)
    }));
  } catch(e) { console.error('Reddit ' + brand.name + ':', e.message); return []; }
}

async function getNYT(brand) {
  try {
    const url = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(brand.query)}&sort=newest&api-key=${NYT_KEY}`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('NYT ' + r.status);
    const d = await r.json();
    return (d.response?.docs || [])
      .filter(a => (a.headline?.main || '').toLowerCase().includes(brand.name.toLowerCase()))
      .map(a => ({
        id: 'nyt_' + a._id,
        type: 'news',
        brand: brand.name,
        color: brand.color,
        title: a.headline?.main || '',
        description: (a.abstract || a.snippet || '').substring(0, 140),
        source: 'New York Times',
        url: a.web_url,
        ts: new Date(a.pub_date).getTime() / 1000,
        engagement: 'NYT',
        sentiment: score((a.headline?.main || '') + ' ' + (a.abstract || ''))
      }));
  } catch(e) { console.error('NYT ' + brand.name + ':', e.message); return []; }
}

async function getGuardian(brand) {
  try {
    const url = `https://content.guardianapis.com/search?q="${encodeURIComponent(brand.query)}"&order-by=newest&show-fields=trailText&page-size=10&api-key=${GUARDIAN_KEY}`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Guardian ' + r.status);
    const d = await r.json();
    return (d.response?.results || [])
      .filter(a => a.webTitle.toLowerCase().includes(brand.name.toLowerCase()))
      .map(a => ({
        id: 'g_' + a.id,
        type: 'news',
        brand: brand.name,
        color: brand.color,
        title: a.webTitle || '',
        description: (a.fields?.trailText || '').replace(/<[^>]+>/g, '').substring(0, 140),
        source: 'The Guardian',
        url: a.webUrl,
        ts: new Date(a.webPublicationDate).getTime() / 1000,
        engagement: 'Guardian',
        sentiment: score(a.webTitle + ' ' + (a.fields?.trailText || ''))
      }));
  } catch(e) { console.error('Guardian ' + brand.name + ':', e.message); return []; }
}

async function getMediastack(brand) {
  try {
    const url = `https://api.mediastack.com/v1/news?access_key=${MEDIASTACK_KEY}&keywords=${encodeURIComponent(brand.name)}&languages=en&limit=10`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Mediastack ' + r.status);
    const d = await r.json();
    return (d.data || [])
      .filter(a => a.title && a.title.toLowerCase().includes(brand.name.toLowerCase()))
      .map(a => ({
        id: 'ms_' + a.url,
        type: 'news',
        brand: brand.name,
        color: brand.color,
        title: a.title || '',
        description: (a.description || '').substring(0, 140),
        source: a.source || 'News',
        url: a.url,
        ts: a.published_at ? new Date(a.published_at).getTime() / 1000 : Date.now() / 1000,
        engagement: 'News',
        sentiment: score((a.title || '') + ' ' + (a.description || ''))
      }));
  } catch(e) { console.error('Mediastack ' + brand.name + ':', e.message); return []; }
}

app.get('/api/all', async (req, res) => {
  try {
    const results = await Promise.all(
      BRANDS.flatMap(brand => [getReddit(brand), getNYT(brand), getGuardian(brand), getMediastack(brand)])
    );
    const all = results.flat().sort((a, b) => b.ts - a.ts);
    BRANDS.forEach(b => {
      const count = all.filter(i => i.brand === b.name).length;
      console.log(`${b.name}: ${count} items`);
    });
    res.json({ items: all });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Martin Command Center running on port ${PORT}`);
});
