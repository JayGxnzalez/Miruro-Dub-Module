// Miruro DUB - Sources via AllAnime/AllManga infrastructure

const MIRURO_BASE = 'https://www.miruro.to';
const MIRURO_PIPE = 'https://www.miruro.to/api/secure/pipe';
const MIRURO_KEY = '71951034f8fbcf53d89db52ceb3dc22c';

const XOR_KEY = [];
for (let i = 0; i < MIRURO_KEY.length; i += 2) {
    XOR_KEY.push(parseInt(MIRURO_KEY.substr(i, 2), 16));
}

let _global;
try { _global = globalThis; } catch(e) {
    try { _global = window; } catch(e) {
        try { _global = global; } catch(e) { _global = this; }
    }
}

function pureAtob(input) {
    let str = String(input).replace(/=+$/, '');
    if (str.length % 4 == 1) return null;
    let output = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    for (let bc = 0, bs = 0, buffer, i = 0;
        buffer = str.charAt(i++);
        ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4)
            ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6))
            : 0
    ) { buffer = chars.indexOf(buffer); }
    return output;
}

function pureBtoa(input) {
    let str = String(input); let output = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    for (let block = 0, charCode, i = 0, map = chars;
        str.charAt(i | 0) || (map = '=', i % 1);
        output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
        charCode = str.charCodeAt(i += 3/4);
        block = block << 8 | charCode;
    }
    return output;
}

function base64UrlEncode(obj) {
    const jsonStr = JSON.stringify(obj);
    const utf8Str = unescape(encodeURIComponent(jsonStr));
    const b64 = pureBtoa(utf8Str);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeBytesToString(u8arr) {
    let s = '';
    for (let i = 0; i < u8arr.length; i++) s += String.fromCharCode(u8arr[i]);
    try { return decodeURIComponent(escape(s)); } catch(e) { return s; }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try { return await fetch(url, options); } catch(error) { return null; }
    }
}

async function ensurePako() {
    if (_global.pako) return;
    try {
        const res = await soraFetch('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
        const code = await res.text();
        const runner = new Function('window', 'global', code);
        runner(_global, _global);
    } catch (e) {
        console.error('Failed to load pako:' + e.message);
    }
}

async function makeSecureRequest(path, query = {}, refererUrl = null) {
    await ensurePako();

    const payload = { path: path, method: 'GET', query: query, body: null, version: '0.2.0' };
    const encodedPayload = base64UrlEncode(payload);
    const url = `${MIRURO_PIPE}?e=${encodedPayload}`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': MIRURO_BASE,
        'Referer': refererUrl || `${MIRURO_BASE}/`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
    };

    let b64Text = '';

    try {
        const response = await soraFetch(url, { method: 'GET', headers: headers });
        if (response) {
            b64Text = typeof response.text === 'function' ? await response.text() : response.data;
        }
    } catch(e) {
        console.error('Network error:' + e.message);
    }

    if (!b64Text) return null;

    if (b64Text.trim().startsWith('<') || b64Text.toLowerCase().includes('cloudflare') || b64Text.toLowerCase().includes('just a moment') || b64Text.toLowerCase().includes('upstream unreachable')) {
        console.error('Blocked by Cloudflare for path:' + path);
        return { _blocked: true };
    }

    if (b64Text.length < 200 && b64Text.includes('error')) {
        console.error('Server error:' + b64Text);
        return null;
    }

    let b64 = b64Text.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);

    const binaryStr = pureAtob(b64);
    if (!binaryStr) return null;

    const bytes = [];
    for (let i = 0; i < binaryStr.length; i++) bytes.push(binaryStr.charCodeAt(i));

    let jsonStr = '';
    let isDecompressed = false;

    // Plan A: XOR + decompress
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= XOR_KEY[i % XOR_KEY.length];
    try {
        jsonStr = _global.pako.ungzip(bytes, { to: 'string' });
        isDecompressed = true;
    } catch (e1) {
        try { jsonStr = _global.pako.inflate(bytes, { to: 'string' }); isDecompressed = true; } catch (e2) {}
    }

    // Plan B: XOR back, try plain gzip
    if (!isDecompressed) {
        for (let i = 0; i < bytes.length; i++) bytes[i] ^= XOR_KEY[i % XOR_KEY.length];
        try {
            jsonStr = _global.pako.ungzip(bytes, { to: 'string' });
            isDecompressed = true;
        } catch (e3) {
            try { jsonStr = _global.pako.inflate(bytes, { to: 'string' }); isDecompressed = true; } catch (e4) {}
        }
    }

    if (!isDecompressed) jsonStr = safeBytesToString(bytes);

    try {
        return JSON.parse(String(jsonStr || ''));
    } catch (e) {
        console.error('JSON parse error for path:' + path);
        return null;
    }
}

async function searchResults(keyword) {
    try {
        const data = await makeSecureRequest('search', {
            q: keyword, limit: 20, offset: 0, sort: 'POPULARITY_DESC', type: 'ANIME'
        });

        if (!data || data._blocked) return JSON.stringify([]);

        const results = [];
        const items = Array.isArray(data) ? data : (data.results || []);

        for (const item of items) {
            const title = item.title?.english || item.title?.romaji || item.title?.native || 'Unknown';
            const image = item.coverImage?.large || item.coverImage?.medium || '';
            const href = `miruro://${item.id}`;
            if (title && image && item.id) results.push({ title, image, href });
        }

        return JSON.stringify(results);
    } catch (e) {
        console.error('Search error:' + e);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const id = url.replace('miruro://', '');
        const data = await makeSecureRequest(`info/anilist/${id}`);

        if (!data || data._blocked) {
            return JSON.stringify([{ description: 'No description available', aliases: 'N/A', airdate: 'N/A' }]);
        }

        const description = data.description ? data.description.replace(/<[^>]+>/g, '').trim() : 'No description available';
        const rating = data.averageScore ? `${data.averageScore}/100` : 'N/A';
        const year = data.seasonYear ? String(data.seasonYear) : 'N/A';

        return JSON.stringify([{
            description: cleanHtmlSymbols(description),
            aliases: `Score: ${rating}`,
            airdate: `Year: ${year}`
        }]);
    } catch (e) {
        console.error('Details error:' + e);
        return JSON.stringify([{ description: 'No description available', aliases: 'N/A', airdate: 'N/A' }]);
    }
}

async function extractEpisodes(url) {
    try {
        const anilistId = url.replace('miruro://', '');
        const data = await makeSecureRequest('episodes', { anilistId: anilistId });

        if (!data || data._blocked) return JSON.stringify([]);

        let allEps = [];
        function searchEpisodes(obj) {
            if (Array.isArray(obj)) {
                if (obj.length > 0 && obj[0].id !== undefined && obj[0].number !== undefined) {
                    allEps = allEps.concat(obj);
                } else {
                    obj.forEach(searchEpisodes);
                }
            } else if (typeof obj === 'object' && obj !== null) {
                Object.values(obj).forEach(searchEpisodes);
            }
        }

        if (data.providers) {
            for (const provKey in data.providers) {
                const provData = data.providers[provKey];
                if (provData?.episodes?.dub) {
                    searchEpisodes(provData.episodes.dub);
                }
            }
        } else {
            searchEpisodes(data);
        }

        const uniqueEps = [];
        const seenNumbers = new Set();
        for (const ep of allEps) {
            if (!seenNumbers.has(ep.number)) {
                seenNumbers.add(ep.number);
                uniqueEps.push({
                    href: `miruro-play://${anilistId}/${ep.number}`,
                    number: ep.number,
                    title: ep.title || `Episode ${ep.number}`
                });
            }
        }

        uniqueEps.sort((a, b) => a.number - b.number);
        return JSON.stringify(uniqueEps);
    } catch (e) {
        console.error('Episodes error:' + e);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const parts = url.replace('miruro-play://', '').split('/');
        const anilistId = parts[0];
        const epNumber = parts.length > 2 ? parts[2] : parts[1];

        const watchReferer = `${MIRURO_BASE}/watch/${anilistId}/${epNumber}?ep=${epNumber}`;

        const epsData = await makeSecureRequest('episodes', { anilistId: anilistId });

        if (!epsData || epsData._blocked) {
            return JSON.stringify({ type: 'none' });
        }

        const dubConfigs = [];

        if (epsData.providers) {
            for (const provKey in epsData.providers) {
                const provData = epsData.providers[provKey];
                if (provData?.episodes && typeof provData.episodes === 'object') {
                    for (const catKey in provData.episodes) {
                        if (!catKey.toLowerCase().includes('dub')) continue;

                        const epList = provData.episodes[catKey];
                        if (Array.isArray(epList)) {
                            const ep = epList.find(e => parseInt(e.number) === parseInt(epNumber));
                            if (ep && ep.id) {
                                dubConfigs.push({
                                    name: provKey.toLowerCase(),
                                    cat: catKey.toLowerCase(),
                                    id: ep.id
                                });
                            }
                        }
                    }
                }
            }
        }

        if (dubConfigs.length === 0) {
            console.error('No dub configs found for episode:' + epNumber);
            return JSON.stringify({ type: 'none' });
        }

        const streams = [];
        let bestSubtitle = '';

        for (const config of dubConfigs) {
            try {
                const reqQuery = {
                    episodeId: config.id,
                    provider: config.name,
                    category: config.cat,
                    ttl: 86400
                };

                if (['dune', 'zoro', 'arc'].includes(config.name)) {
                    reqQuery.anilistId = parseInt(anilistId);
                }

                const res = await makeSecureRequest('sources', reqQuery, watchReferer);

                if (!res || res._blocked) continue;

                let videoArray = res.sources || res.streams || [];

                if (!Array.isArray(videoArray) || videoArray.length === 0) {
                    const possibleKeys = [config.cat, 'sub', 'ssub', 'dub', 'hdub', 'hsub'];
                    for (const k of possibleKeys) {
                        if (res[k]) {
                            if (Array.isArray(res[k].streams) && res[k].streams.length > 0) {
                                videoArray = res[k].streams;
                                break;
                            } else if (Array.isArray(res[k].sources) && res[k].sources.length > 0) {
                                videoArray = res[k].sources;
                                break;
                            }
                        }
                    }
                }

                if (Array.isArray(videoArray) && videoArray.length > 0) {
                    for (const s of videoArray) {
                        if (!s.url) continue;
                        if (s.type === 'embed' && videoArray.some(v => v.type === 'hls' || v.type === 'mp4')) continue;

                        const label = s.quality || (s.type === 'hls' ? 'Auto' : s.type) || 'Auto';
                        streams.push({
                            title: `${label} - ${config.name.toUpperCase()}`,
                            streamUrl: s.url,
                            headers: { 'Referer': s.referer || `${MIRURO_BASE}/` }
                        });
                    }
                }

                if (res.subtitles && Array.isArray(res.subtitles)) {
                    for (const sub of res.subtitles) {
                        const lang = (sub.language || sub.lang || sub.label || '').toLowerCase();
                        if (lang.includes('eng') || lang.includes('english')) {
                            if (bestSubtitle === '') bestSubtitle = sub.url || sub.file;
                        }
                    }
                }
            } catch (e) {
                console.error('Stream error for ' + config.name + ':' + e.message);
            }
        }

        if (streams.length > 0) {
            return JSON.stringify({ type: 'servers', streams: streams, subtitles: bestSubtitle });
        } else {
            return JSON.stringify({ type: 'none' });
        }
    } catch (e) {
        console.error('extractStreamUrl error:' + e);
        return JSON.stringify({ type: 'none' });
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
