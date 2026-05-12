// Miruro DUB - Sources via AllAnime/AllManga infrastructure

const MIRURO_BASE = 'https://www.miruro.to';
const MIRURO_PIPE = 'https://www.miruro.to/api/secure/pipe';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Origin': 'https://www.miruro.to',
    'Referer': 'https://www.miruro.to/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
};

let _global;
try { _global = globalThis; } catch(e) {
    try { _global = window; } catch(e) {
        try { _global = global; } catch(e) { _global = this; }
    }
}

function encodePayload(obj) {
    const jsonStr = JSON.stringify(obj);
    const utf8Str = unescape(encodeURIComponent(jsonStr));
    const b64 = btoa(utf8Str);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function ensurePako() {
    if (_global.pako) return;
    try {
        const res = await fetchv2('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
        const code = await res.text();
        const runner = new Function('window', 'global', code);
        runner(_global, _global);
        console.error('Pako loaded successfully');
    } catch (e) {
        console.error('Failed to load pako:' + e.message);
    }
}

async function decodePipeResponse(text) {
    try {
        console.error('Raw text length:' + text?.length);
        console.error('Raw text first 100:' + text?.substring(0, 100));

        await ensurePako();
        console.error('Pako type:' + typeof _global.pako);

        let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4;
        if (pad) b64 += '='.repeat(4 - pad);

        const binaryStr = atob(b64);
        console.error('Binary string length:' + binaryStr.length);

        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        console.error('First 4 bytes:' + bytes[0] + ' ' + bytes[1] + ' ' + bytes[2] + ' ' + bytes[3]);

        const result = _global.pako.ungzip(bytes, { to: 'string' });
        return JSON.parse(result);
    } catch (e) {
        console.error('Failed to decode pipe response:' + e.message);
        return null;
    }
}

async function pipeRequest(path, query = {}, referer = null) {
    const payload = {
        path: path,
        method: 'GET',
        query: query,
        body: null,
        version: '0.2.0'
    };

    const e = encodePayload(payload);
    const headers = { ...HEADERS };
    if (referer) headers['Referer'] = referer;

    try {
        const res = await fetchv2(`${MIRURO_PIPE}?e=${e}`, headers);
        const text = await res.text();

        console.error('pipeRequest text length:' + text?.length);
        console.error('pipeRequest text first 50:' + text?.substring(0, 50));

        if (!text || text.trim().startsWith('<')) {
            console.error('Blocked or invalid response for path:' + path);
            return null;
        }

        return await decodePipeResponse(text);
    } catch (e) {
        console.error('Pipe request error:' + e.message);
        return null;
    }
}

async function searchResults(keyword) {
    const results = [];

    try {
        const data = await pipeRequest('search', {
            q: keyword,
            limit: 20,
            offset: 0,
            type: 'ANIME',
            sort: 'POPULARITY_DESC'
        });

        if (!data) return JSON.stringify([]);

        const items = Array.isArray(data) ? data : (data.results || []);

        for (const anime of items) {
            const title =
                anime.title?.english ||
                anime.title?.romaji ||
                anime.title?.native ||
                'Unknown';
            const image =
                anime.coverImage?.large ||
                anime.coverImage?.medium ||
                anime.coverImage?.extraLarge ||
                '';
            const href = String(anime.id);

            if (title && image && href) {
                results.push({ title, image, href });
            }
        }
    } catch (e) {
        console.error('Search error:' + e);
    }

    return JSON.stringify(results);
}

async function extractDetails(anilistId) {
    try {
        const data = await pipeRequest(`info/anilist/${anilistId}`);

        if (!data) {
            return JSON.stringify([{ description: 'No description available', aliases: 'N/A', airdate: 'N/A' }]);
        }

        const description = data.description || 'No description available';
        const synonyms = data.synonyms || [];
        const startDate = data.startDate;
        const airdate = startDate?.year ? String(startDate.year) : 'N/A';

        return JSON.stringify([{
            description: cleanHtmlSymbols(description),
            aliases: Array.isArray(synonyms) ? synonyms.join(', ') : 'N/A',
            airdate: airdate
        }]);
    } catch (e) {
        console.error('Details error:' + e);
        return JSON.stringify([{ description: 'No description available', aliases: 'N/A', airdate: 'N/A' }]);
    }
}

async function extractEpisodes(anilistId) {
    const results = [];

    try {
        const data = await pipeRequest('episodes', { anilistId: anilistId });

        if (!data) return JSON.stringify([]);

        const providers = data.providers || {};
        let providerKey = null;
        let episodeList = [];

        if (providers.ally?.episodes?.dub?.length) {
            providerKey = 'ally';
            episodeList = providers.ally.episodes.dub;
        } else {
            for (const key of Object.keys(providers)) {
                if (providers[key]?.episodes?.dub?.length) {
                    providerKey = key;
                    episodeList = providers[key].episodes.dub;
                    break;
                }
            }
        }

        if (!episodeList.length) {
            console.error('No dub episodes found for AniList ID:' + anilistId);
            return JSON.stringify([]);
        }

        for (const ep of episodeList) {
            results.push({
                number: ep.number,
                href: `anilistId:${anilistId}|provider:${providerKey}|epId:${ep.id}`
            });
        }

        results.sort((a, b) => a.number - b.number);
    } catch (e) {
        console.error('Episodes error:' + e);
    }

    return JSON.stringify(results);
}

async function extractStreamUrl(slug) {
    try {
        const anilistIdMatch = slug.match(/anilistId:(\d+)/);
        const providerMatch = slug.match(/provider:([^|]+)/);
        const epIdMatch = slug.match(/epId:([^|]+)/);

        if (!anilistIdMatch || !providerMatch || !epIdMatch) {
            console.error('Invalid slug format:' + slug);
            return JSON.stringify({ streams: [] });
        }

        const anilistId = anilistIdMatch[1];
        const provider = providerMatch[1];
        const episodeId = epIdMatch[1];

        const watchReferer = `${MIRURO_BASE}/watch/${anilistId}?ep=${episodeId}`;

        const data = await pipeRequest('sources', {
            episodeId: episodeId,
            provider: provider,
            category: 'dub'
        }, watchReferer);

        if (!data) return JSON.stringify({ streams: [] });

        const videoArray = data.streams || data.sources || [];
        const streams = [];

        for (const stream of videoArray) {
            if (!stream.url) continue;
            if (stream.type === 'embed') continue;

            streams.push({
                title: `${provider.toUpperCase()} - ${stream.quality || stream.type || 'Auto'}`,
                streamUrl: stream.url,
                headers: { 'Referer': stream.referer || `${MIRURO_BASE}/` }
            });
        }

        if (streams.length === 0) {
            for (const stream of videoArray) {
                if (!stream.url) continue;
                streams.push({
                    title: `${stream.server || provider.toUpperCase()} - ${stream.quality || 'Auto'}`,
                    streamUrl: stream.url,
                    headers: { 'Referer': stream.referer || `${MIRURO_BASE}/` }
                });
            }
        }

        return JSON.stringify({ streams, subtitle: '' });
    } catch (e) {
        console.error('Stream error:' + e);
        return JSON.stringify({ streams: [] });
    }
}

function cleanHtmlSymbols(string) {
    if (!string) return '';
    return string
        .replace(/&#8217;/g, "'")
        .replace(/&#8211;/g, '-')
        .replace(/&#[0-9]+;/g, '')
        .replace(/\r?\n|\r/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/<i[^>]*>(.*?)<\/i>/g, '$1')
        .replace(/<b[^>]*>(.*?)<\/b>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();
}
