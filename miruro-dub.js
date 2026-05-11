// Miruro DUB - Sources via AllAnime/AllManga infrastructure
// Streams: Direct 1080p MP4 via tools.fast4speed.rsvp (no proxy throttling)

const ALLANIME_API = 'https://api.allanime.day/api';
const MIRURO_PIPE = 'https://www.miruro.to/api/secure/pipe';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://allmanga.to/',
    'sec-ch-ua-platform': '"Windows"'
};

// Helper: base64 encode (URL-safe not needed for Miruro pipe)
function btoa_safe(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

// Helper: decode Miruro's gzip+base64 response
async function decodeMiruroResponse(text) {
    try {
        // The response is URL-safe base64 encoded gzip
        const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return JSON.parse(new TextDecoder().decode(result));
    } catch (e) {
        console.error('Failed to decode Miruro response:', e);
        return null;
    }
}

// Step 1: Search AniList for anime by keyword
async function searchResults(keyword) {
    const results = [];
    const query = `
        query ($search: String) {
            Page(page: 1, perPage: 20) {
                media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
                    id
                    title { english romaji native }
                    coverImage { large }
                }
            }
        }
    `;

    try {
        const res = await fetchv2('https://graphql.anilist.co', {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }, 'POST', JSON.stringify({ query, variables: { search: keyword } }));

        const data = await res.json();
        const mediaList = data?.data?.Page?.media || [];

        for (const anime of mediaList) {
            const title = anime.title.english || anime.title.romaji || anime.title.native || 'Unknown';
            const image = anime.coverImage.large;
            const href = String(anime.id);
            if (title && image && href) {
                results.push({ title, image, href });
            }
        }
    } catch (e) {
        console.error('Search error:', e);
    }

    return JSON.stringify(results);
}

// Step 2: Get anime details from Miruro (which uses AniList data)
async function extractDetails(anilistId) {
    try {
        const pipeQuery = { path: `info/anilist/${anilistId}`, method: 'GET', query: {}, body: null };
        const e = btoa_safe(JSON.stringify(pipeQuery));
        const res = await fetchv2(`${MIRURO_PIPE}?e=${e}`, HEADERS);
        const text = await res.text();
        const data = await decodeMiruroResponse(text);

        const description = data?.description || data?.data?.description || 'No description available';
        const synonyms = data?.synonyms || data?.data?.synonyms || [];
        const startDate = data?.startDate || data?.data?.startDate;
        const airdate = startDate ? `${startDate.year || ''}` : 'N/A';

        return JSON.stringify([{
            description: cleanHtmlSymbols(description),
            aliases: Array.isArray(synonyms) ? synonyms.join(', ') : 'N/A',
            airdate: airdate
        }]);
    } catch (e) {
        console.error('Details error:', e);
        return JSON.stringify([{ description: 'No description available', aliases: 'N/A', airdate: 'N/A' }]);
    }
}

// Step 3: Get episode list via AllAnime API
async function extractEpisodes(anilistId) {
    const results = [];

    try {
        // Search AllAnime by AniList ID to get the show ID
        const searchQuery = `
            query($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType) {
                shows(search: $search, limit: $limit, page: $page, translationType: $translationType) {
                    edges { _id name availableEpisodes }
                }
            }
        `;

        const variables = {
            search: { anilistId: parseInt(anilistId) },
            limit: 1,
            page: 1,
            translationType: 'dub'
        };

        const params = new URLSearchParams({
            variables: JSON.stringify(variables),
            query: searchQuery
        });

        const res = await fetchv2(`${ALLANIME_API}?${params.toString()}`, HEADERS);
        const data = await res.json();
        const show = data?.data?.shows?.edges?.[0];

        if (!show) {
            console.error('Show not found on AllAnime for AniList ID:', anilistId);
            return JSON.stringify([]);
        }

        const showId = show._id;
        const dubEpisodes = show.availableEpisodes?.dub || 0;

        for (let i = 1; i <= dubEpisodes; i++) {
            // episodeId = base64("allmanga:{showId}:{episodeNum}")
            const rawId = `allmanga:${showId}:${i}`;
            const episodeId = btoa_safe(rawId);
            results.push({
                number: i,
                href: `anilist:${anilistId}|epId:${episodeId}`
            });
        }
    } catch (e) {
        console.error('Episodes error:', e);
    }

    return JSON.stringify(results);
}

// Step 4: Get stream URL via Miruro pipe
async function extractStreamUrl(slug) {
    try {
        const anilistIdMatch = slug.match(/anilist:(\d+)/);
        const epIdMatch = slug.match(/epId:([^|]+)/);

        if (!anilistIdMatch || !epIdMatch) {
            console.error('Invalid slug format:', slug);
            return JSON.stringify({ streams: [] });
        }

        const anilistId = parseInt(anilistIdMatch[1]);
        const episodeId = epIdMatch[1];

        const pipeQuery = {
            path: 'sources',
            method: 'GET',
            query: {
                episodeId: episodeId,
                provider: 'ally',
                category: 'dub',
                anilistId: anilistId
            },
            body: null
        };

        const e = btoa_safe(JSON.stringify(pipeQuery));
        const res = await fetchv2(`${MIRURO_PIPE}?e=${e}`, HEADERS);
        const text = await res.text();
        const data = await decodeMiruroResponse(text);

        if (!data?.streams?.length) {
            console.error('No streams found');
            return JSON.stringify({ streams: [] });
        }

        const streams = [];

        for (const stream of data.streams) {
            if (stream.type === 'mp4' && stream.url) {
                streams.push({
                    title: `Direct - ${stream.quality || '1080p'}`,
                    streamUrl: stream.url,
                    headers: { 'Referer': stream.referer || 'https://allmanga.to/' }
                });
            }
        }

        // Fallback: try HLS streams if no MP4
        if (streams.length === 0) {
            for (const stream of data.streams) {
                if (stream.url && stream.type !== 'embed') {
                    streams.push({
                        title: `${stream.server || 'Stream'} - ${stream.quality || 'Auto'}`,
                        streamUrl: stream.url,
                        headers: { 'Referer': stream.referer || 'https://allmanga.to/' }
                    });
                }
            }
        }

        return JSON.stringify({ streams, subtitle: '' });
    } catch (e) {
        console.error('Stream error:', e);
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
