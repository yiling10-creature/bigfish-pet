const SEARCH_TIMEOUT_MS = 9000;
const MAX_RESULTS = 5;
const MAX_QUERY = 300;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
};

function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      if (!Number.isFinite(value) || value < 1 || value > 0x10ffff) return all;
      try {
        return String.fromCodePoint(value);
      } catch {
        return all;
      }
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? all;
  });
}

function plainText(value, limit) {
  const stripped = String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ');
  const text = decodeEntities(stripped)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limit ? text.slice(0, limit) : text;
}

function readTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1] : '';
}

function parseRss(xml, limit = MAX_RESULTS) {
  if (typeof xml !== 'string') return [];
  const results = [];
  const seen = new Set();
  const items = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match;
  while (results.length < limit && (match = items.exec(xml))) {
    const block = match[1] || '';
    const title = plainText(readTag(block, 'title'), 180);
    const snippet = plainText(readTag(block, 'description'), 320);
    const rawLink = decodeEntities(readTag(block, 'link')).replace(/\s+/g, '').trim();
    if (!title || !rawLink) continue;
    let url;
    try {
      url = new URL(rawLink);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.username = '';
    url.password = '';
    url.hash = '';
    const normalized = url.toString();
    if (normalized.length > 2048 || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push({
      title,
      url: normalized,
      host: url.hostname.replace(/^www\./i, ''),
      snippet,
    });
  }
  return results;
}

function createWebSearch({ log = () => {}, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => require('electron').net.fetch(...args));

  async function search(query, { signal } = {}) {
    const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
    if (!text) return { ok: false, code: 'query', message: '没有可搜索的问题。' };
    if (signal?.aborted) return { ok: false, code: 'aborted', message: '已停止。' };

    const base = (process.env.BIGFISH_SEARCH_BASE || 'https://cn.bing.com').replace(/\/+$/, '');
    const endpoint = `${base}/search?q=${encodeURIComponent(text)}&format=rss&setlang=zh-Hans&cc=cn`;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SEARCH_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const response = await doFetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        log('WEB_SEARCH_HTTP', response.status);
        return { ok: false, code: 'http', message: `联网搜索暂时不可用（${response.status}）。` };
      }
      const xml = (await response.text()).slice(0, 1024 * 1024);
      const results = parseRss(xml);
      if (!results.length) {
        log('WEB_SEARCH_EMPTY');
        return { ok: false, code: 'empty', message: '没有找到相关网页。' };
      }
      log('WEB_SEARCH_OK', results.length);
      return { ok: true, results };
    } catch (error) {
      if (signal?.aborted) return { ok: false, code: 'aborted', message: '已停止。' };
      log('WEB_SEARCH_FAILED', error.name, error.message);
      return timedOut
        ? { ok: false, code: 'timeout', message: '联网搜索超时。' }
        : { ok: false, code: 'network', message: '联网搜索失败，请检查网络。' };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  return { search };
}

module.exports = { createWebSearch, parseRss, decodeEntities, plainText };
