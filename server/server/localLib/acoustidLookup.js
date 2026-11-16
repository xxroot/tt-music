"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadCoverImage = exports.getCoverArtUrl = exports.lookupByFingerprint = void 0;
/**
 * Acoustid + MusicBrainz 查询模块
 * Acoustid: 指纹匹配获取 MBIDs (简化调用)
 * MusicBrainz: 通过 MBIDs 获取完整元数据
 * Cover Art Archive: 通过 Release MBID 获取封面
 */
const needle_1 = __importDefault(require("needle"));
// API 配置
// const ACOUSTID_API_KEY = 'UBlfa8vpUc'
const ACOUSTID_API_KEY = 'Ti0HHLDf9O';
const ACOUSTID_API_URL = 'https://api.acoustid.org/v2/lookup';
const MUSICBRAINZ_API_URL = 'https://musicbrainz.org/ws/2';
const COVER_ART_ARCHIVE_URL = 'https://coverartarchive.org';
const USER_AGENT = 'lx-music-server/1.0 (https://github.com/XCQ0607/lxserver)';
/** 封面相关请求代理；留空表示直连，需要时在配置 proxy.all.address 或 HTTP(S)_PROXY 环境变量中设置 */
const COVER_ART_PROXY = '';
// Acoustid 速率限制: ≤3 请求/秒
let lastAcoustidCallTime = 0;
const ACOUSTID_MIN_INTERVAL = 350; // ms
// MusicBrainz 速率限制: 1 请求/秒
let lastMbCallTime = 0;
const MB_MIN_INTERVAL = 1100; // ms
/** Acoustid 速率限制 */
const acoustidDelay = async () => {
    const now = Date.now();
    const elapsed = now - lastAcoustidCallTime;
    if (elapsed < ACOUSTID_MIN_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, ACOUSTID_MIN_INTERVAL - elapsed));
    }
    lastAcoustidCallTime = Date.now();
};
/**
 * 从 Acoustid 响应中提取 MBIDs 和位置信息 (简化提取，不提取 title/album 等)
 */
const extractAcoustidMatch = (result) => {
    const recordings = result.recordings;
    if (!recordings || recordings.length === 0)
        return null;
    let best = null;
    let bestScore = -1;
    for (const recording of recordings) {
        const recordingMbid = recording.id || null;
        if (recording.releasegroups && recording.releasegroups.length > 0) {
            for (const rg of recording.releasegroups) {
                const releaseGroupMbid = rg.id || null;
                if (rg.releases && rg.releases.length > 0) {
                    for (const release of rg.releases) {
                        const releaseMbid = release.id || null;
                        if (release.mediums && release.mediums.length > 0) {
                            for (const medium of release.mediums) {
                                const discNumber = medium.position ? String(medium.position) : null;
                                if (medium.tracks && medium.tracks.length > 0) {
                                    for (const track of medium.tracks) {
                                        const trackNumber = track.position ? String(track.position) : null;
                                        const candidate = {
                                            acoustidId: result.id, score: result.score || 0,
                                            recordingMbid, releaseGroupMbid, releaseMbid,
                                            trackNumber, discNumber
                                        };
                                        const score = Object.values(candidate).filter(v => v !== null).length;
                                        if (score > bestScore) {
                                            bestScore = score;
                                            best = candidate;
                                        }
                                    }
                                }
                            }
                        }
                        else {
                            const candidate = {
                                acoustidId: result.id, score: result.score || 0,
                                recordingMbid, releaseGroupMbid, releaseMbid,
                                trackNumber: null, discNumber: null
                            };
                            const score = Object.values(candidate).filter(v => v !== null).length;
                            if (score > bestScore) {
                                bestScore = score;
                                best = candidate;
                            }
                        }
                    }
                }
                else {
                    const candidate = {
                        acoustidId: result.id, score: result.score || 0,
                        recordingMbid, releaseGroupMbid, releaseMbid: null,
                        trackNumber: null, discNumber: null
                    };
                    const score = Object.values(candidate).filter(v => v !== null).length;
                    if (score > bestScore) {
                        bestScore = score;
                        best = candidate;
                    }
                }
            }
        }
        else {
            const candidate = {
                acoustidId: result.id, score: result.score || 0,
                recordingMbid, releaseGroupMbid: null, releaseMbid: null,
                trackNumber: null, discNumber: null
            };
            const score = Object.values(candidate).filter(v => v !== null).length;
            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
    }
    return best;
};
/**
 * 通过指纹查询 Acoustid，获取 MBIDs (简化调用)
 */
const lookupAcoustid = async (fingerprint, duration) => {
    await acoustidDelay();
    const params = {
        client: ACOUSTID_API_KEY,
        duration: Math.round(duration),
        fingerprint,
        // meta: 'recordings recordingids releasegroups releasegroupids releases releaseids tracks',
        meta: 'recordings releasegroups releases tracks',
        format: 'json'
    };
    console.log(`[Acoustid] Looking up: fingerprint length=${fingerprint.length}, duration=${duration.toFixed(1)}s`);
    try {
        const response = await (0, needle_1.default)('post', ACOUSTID_API_URL, params, {
            timeout: 10000,
            json: false,
            multipart: false
        });
        if (response.statusCode !== 200) {
            console.error(`[Acoustid] API error: status=${response.statusCode}`);
            return null;
        }
        const body = response.body;
        console.log('[Acoustid] Response:', JSON.stringify(body, null, 2));
        if (!body || body.status !== 'ok' || !body.results || body.results.length === 0) {
            console.log('[Acoustid] No match found');
            return null;
        }
        // 优先选择有 recordings 且分数最高的结果
        const resultsWithRecordings = body.results.filter((r) => r.recordings && r.recordings.length > 0);
        const bestResult = resultsWithRecordings.length > 0
            ? resultsWithRecordings.reduce((prev, curr) => (curr.score || 0) > (prev.score || 0) ? curr : prev)
            : body.results.reduce((prev, curr) => (curr.score || 0) > (prev.score || 0) ? curr : prev);
        const score = bestResult.score || 0;
        console.log(`[Acoustid] Best match: score=${score}, acoustidId=${bestResult.id}`);
        if (score < 0.8) {
            console.log(`[Acoustid] Score ${score} below threshold 0.8, skipping`);
            return null;
        }
        const match = extractAcoustidMatch(bestResult);
        if (match) {
            console.log(`[Acoustid] MBIDs: recording=${match.recordingMbid}, releaseGroup=${match.releaseGroupMbid}, release=${match.releaseMbid}`);
        }
        return match;
    }
    catch (err) {
        console.error('[Acoustid] Lookup failed:', err.message);
        return null;
    }
};
// ======================== MusicBrainz 完整查询 ========================
/** MusicBrainz 速率限制 */
const musicBrainzDelay = async () => {
    const now = Date.now();
    const elapsed = now - lastMbCallTime;
    if (elapsed < MB_MIN_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MB_MIN_INTERVAL - elapsed));
    }
    lastMbCallTime = Date.now();
};
/**
 * 通过 Recording MBID 从 MusicBrainz 获取完整元数据
 * 查询: /ws/2/recording/{mbid}?inc=artist-credits+releases+media+tags
 * 注意: release-groups 和 labels 不是 recording 端点的合法 inc 值，需通过 release 端点获取
 */
const fetchMusicBrainzRecording = async (recordingMbid) => {
    await musicBrainzDelay();
    const url = `${MUSICBRAINZ_API_URL}/recording/${recordingMbid}?fmt=json&inc=artist-credits+releases+media+tags`;
    console.log(`[MusicBrainz] Fetching recording: ${recordingMbid}`);
    try {
        const resp = await (0, needle_1.default)('get', url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
            timeout: 15000
        });
        if (resp.statusCode !== 200 || !resp.body) {
            console.log(`[MusicBrainz] Recording query failed: HTTP ${resp.statusCode}`);
            return null;
        }
        const raw = resp.body;
        // 打印完整数据
        console.log('[MusicBrainz] 完整 Recording 数据:');
        console.log(JSON.stringify(raw, null, 2));
        // 提取元数据 (Recording 端点只提供 title, artist-credit, releases 基本信息)
        // release-group 和 label 信息需通过 Release 端点获取
        const meta = {};
        meta.title = raw.title || null;
        const artistCredits = raw['artist-credit'];
        if (artistCredits?.length > 0) {
            meta.artist = artistCredits.map((ac) => (ac.name || '') + (ac.joinphrase || '')).join('') || null;
            meta.artistSortName = artistCredits[0]?.artist?.['sort-name'] || null;
        }
        // 从 releases 中提取基本信息 (不含 release-group/label-info，需单独查 release)
        const releases = raw.releases;
        if (releases?.length > 0) {
            // 优先选择有封面 + media 的 release，其次有 media 的
            const withMediaAndCover = releases.find((r) => r.media?.length > 0 && r['cover-art-archive']?.artwork === true);
            const withMedia = releases.find((r) => r.media && r.media.length > 0);
            const best = withMediaAndCover || withMedia || releases[0];
            meta.releaseMbid = best.id || null;
            meta.date = best.date || null;
            meta.country = best.country || null;
            // 从 media 中提取 track/disc 位置信息
            if (best.media) {
                for (const medium of best.media) {
                    if (medium.tracks) {
                        for (const track of medium.tracks) {
                            if (track.recording?.id === recordingMbid || track.title === meta.title) {
                                if (track.position)
                                    meta.trackNumber = String(track.position);
                                if (medium.position)
                                    meta.discNumber = String(medium.position);
                            }
                        }
                    }
                }
            }
            // 收集其他有封面的 release MBIDs (用于封面查询 fallback)
            const coverReleaseMbids = releases
                .filter((r) => r['cover-art-archive']?.artwork === true && r.id !== best.id)
                .map((r) => r.id);
            if (coverReleaseMbids.length > 0) {
                meta._coverFallbackMbids = coverReleaseMbids;
            }
        }
        // tags
        const tags = raw.tags;
        if (tags?.length > 0) {
            meta.genre = tags.map((t) => t.name).join(', ') || null;
        }
        return { raw, metadata: meta };
    }
    catch (err) {
        console.error('[MusicBrainz] Recording fetch failed:', err.message);
        return null;
    }
};
/**
 * 通过 Release MBID 从 MusicBrainz 获取 release-group、label 等详细信息
 * 查询: /ws/2/release/{mbid}?inc=release-groups+labels+artists+media
 * release-groups 和 labels 是 release 端点的合法 inc 值
 */
const fetchMusicBrainzRelease = async (releaseMbid) => {
    await musicBrainzDelay();
    const url = `${MUSICBRAINZ_API_URL}/release/${releaseMbid}?fmt=json&inc=release-groups+labels+artists+media`;
    console.log(`[MusicBrainz] Fetching release: ${releaseMbid}`);
    try {
        const resp = await (0, needle_1.default)('get', url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
            timeout: 15000
        });
        if (resp.statusCode !== 200 || !resp.body) {
            console.log(`[MusicBrainz] Release query failed: HTTP ${resp.statusCode}`);
            return null;
        }
        const raw = resp.body;
        console.log('[MusicBrainz] 完整 Release 数据:');
        console.log(JSON.stringify(raw, null, 2));
        const meta = {};
        meta.releaseMbid = raw.id || null;
        meta.date = raw.date || null;
        meta.country = raw.country || null;
        // release-group → album, albumArtist, releaseType
        const rg = raw['release-group'];
        if (rg) {
            meta.releaseGroupMbid = rg.id || null;
            meta.album = rg.title || null;
            meta.releaseType = rg['primary-type'] || null;
            const rgArtists = rg['artist-credit'];
            if (rgArtists?.length > 0) {
                meta.albumArtist = rgArtists.map((ac) => (ac.name || '') + (ac.joinphrase || '')).join('') || null;
                meta.albumArtistSortName = rgArtists[0]?.artist?.['sort-name'] || null;
            }
            if (!meta.date && rg['first-release-date']) {
                meta.date = rg['first-release-date'];
            }
        }
        // label-info → label
        const labelInfo = raw['label-info'];
        if (labelInfo?.length > 0) {
            meta.label = labelInfo[0]?.label?.name || null;
        }
        return { raw, metadata: meta };
    }
    catch (err) {
        console.error('[MusicBrainz] Release fetch failed:', err.message);
        return null;
    }
};
/**
 * 通过 Release Group MBID 补充信息 (Recording 查询失败时的 fallback)
 */
const fetchMusicBrainzReleaseGroup = async (releaseGroupMbid) => {
    await musicBrainzDelay();
    const url = `${MUSICBRAINZ_API_URL}/release-group/${releaseGroupMbid}?fmt=json&inc=artists`;
    console.log(`[MusicBrainz] Fetching release-group: ${releaseGroupMbid}`);
    try {
        const resp = await (0, needle_1.default)('get', url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
            timeout: 15000
        });
        if (resp.statusCode !== 200 || !resp.body) {
            console.log(`[MusicBrainz] ReleaseGroup query failed: HTTP ${resp.statusCode}`);
            return null;
        }
        const raw = resp.body;
        console.log('[MusicBrainz] 完整 ReleaseGroup 数据:');
        console.log(JSON.stringify(raw, null, 2));
        const meta = {};
        meta.album = raw.title || null;
        meta.date = raw['first-release-date'] || null;
        meta.releaseGroupMbid = raw.id || null;
        meta.releaseType = raw['primary-type'] || null;
        const rgArtists = raw['artist-credit'];
        if (rgArtists?.length > 0) {
            meta.albumArtist = rgArtists.map((ac) => (ac.name || '') + (ac.joinphrase || '')).join('') || null;
            meta.albumArtistSortName = rgArtists[0]?.artist?.['sort-name'] || null;
        }
        return { raw, metadata: meta };
    }
    catch (err) {
        console.error('[MusicBrainz] ReleaseGroup fetch failed:', err.message);
        return null;
    }
};
// ======================== 主查询入口 ========================
/**
 * 指纹查询完整流程: Acoustid 获取 MBIDs → MusicBrainz 获取完整元数据 → Cover Art 获取封面
 */
const lookupByFingerprint = async (fingerprint, duration) => {
    // Step 1: Acoustid 指纹匹配，获取 MBIDs
    const match = await lookupAcoustid(fingerprint, duration);
    if (!match)
        return null;
    // Step 2: MusicBrainz Recording 查询 → title, artist
    let mbMetadata = {};
    let rawMb = null;
    if (match.recordingMbid) {
        const mbResult = await fetchMusicBrainzRecording(match.recordingMbid);
        if (mbResult) {
            mbMetadata = mbResult.metadata;
            rawMb = mbResult.raw;
        }
    }
    // Step 3: MusicBrainz Release 查询 → album, albumArtist, label
    const releaseMbid = mbMetadata.releaseMbid || match.releaseMbid;
    if (releaseMbid) {
        const releaseResult = await fetchMusicBrainzRelease(releaseMbid);
        if (releaseResult) {
            for (const [key, value] of Object.entries(releaseResult.metadata)) {
                if (value && !mbMetadata[key]) {
                    mbMetadata[key] = value;
                }
            }
        }
    }
    // Fallback: 仍未获取 album，尝试 Release Group
    if (!mbMetadata.album && match.releaseGroupMbid) {
        const rgResult = await fetchMusicBrainzReleaseGroup(match.releaseGroupMbid);
        if (rgResult) {
            for (const [key, value] of Object.entries(rgResult.metadata)) {
                if (value && !mbMetadata[key]) {
                    mbMetadata[key] = value;
                }
            }
            if (!rawMb)
                rawMb = rgResult.raw;
        }
    }
    // 合并 Acoustid 位置信息 + MusicBrainz 元数据
    const metadata = {
        title: mbMetadata.title || null,
        artist: mbMetadata.artist || null,
        album: mbMetadata.album || null,
        albumArtist: mbMetadata.albumArtist || null,
        date: mbMetadata.date || null,
        trackNumber: mbMetadata.trackNumber || match.trackNumber,
        discNumber: mbMetadata.discNumber || match.discNumber,
        releaseMbid: mbMetadata.releaseMbid || match.releaseMbid,
        recordingMbid: match.recordingMbid,
        releaseGroupMbid: mbMetadata.releaseGroupMbid || match.releaseGroupMbid,
        genre: mbMetadata.genre || null,
        releaseType: mbMetadata.releaseType || null,
        label: mbMetadata.label || null,
        country: mbMetadata.country || null,
        releaseDate: mbMetadata.date || null,
        artistSortName: mbMetadata.artistSortName || null,
        albumArtistSortName: mbMetadata.albumArtistSortName || null,
        rawMusicBrainz: rawMb,
        _coverFallbackMbids: mbMetadata._coverFallbackMbids
    };
    console.log(`[Result] title="${metadata.title}", artist="${metadata.artist}", album="${metadata.album}", albumArtist="${metadata.albumArtist}", date="${metadata.date}", track=${metadata.trackNumber}, disc=${metadata.discNumber}, genre="${metadata.genre}", releaseType="${metadata.releaseType}", label="${metadata.label}", country="${metadata.country}"`);
    // Step 4: 封面查询
    // 收集所有候选封面 URL，然后依次尝试下载，返回第一个可下载的
    const coverCandidates = [];
    const releaseMbids = [];
    if (metadata.releaseMbid)
        releaseMbids.push(metadata.releaseMbid);
    if (metadata._coverFallbackMbids)
        releaseMbids.push(...metadata._coverFallbackMbids);
    if (match.releaseMbid && !releaseMbids.includes(match.releaseMbid)) {
        releaseMbids.push(match.releaseMbid);
    }
    // CAA release /front (原始分辨率) → /front-500 (500px 缩略图)
    for (const mbid of releaseMbids) {
        const url = await fetchCoverByFrontEndpoint('release', mbid);
        if (url)
            coverCandidates.push(url);
    }
    // CAA release-group /front → /front-500
    if (metadata.releaseGroupMbid) {
        const url = await fetchCoverByFrontEndpoint('release-group', metadata.releaseGroupMbid);
        if (url)
            coverCandidates.push(url);
    }
    // 尝试下载每个候选 URL，返回第一个可访问的
    let coverUrl = null;
    if (coverCandidates.length > 0) {
        console.log(`[CoverArt] ${coverCandidates.length} candidate(s), checking reachability...`);
        for (const candidate of coverCandidates) {
            const reachable = await isUrlReachable(candidate);
            if (reachable) {
                coverUrl = candidate;
                console.log(`[CoverArt] ✓ Using reachable URL: ${candidate}`);
                break;
            }
            console.log(`[CoverArt] ✗ Unreachable: ${candidate}`);
        }
        if (!coverUrl) {
            console.log('[CoverArt] All candidates unreachable');
            // 返回第一个候选 URL (即使不可达，至少有个 URL)
            coverUrl = coverCandidates[0];
        }
    }
    return {
        acoustidId: match.acoustidId,
        score: match.score,
        metadata,
        coverUrl
    };
};
exports.lookupByFingerprint = lookupByFingerprint;
// ======================== Cover Art Archive ========================
/**
 * 通过 CAA front 端点直接获取封面 URL (307 重定向到图片)
 * 优先尝试 /front (原始分辨率)，404 时 fallback 到 /front-500 (500px 缩略图)
 */
const fetchCoverByFrontEndpoint = async (entityType, mbid) => {
    // 优先原始分辨率，再 fallback 到缩略图
    const endpoints = ['/front', '/front-500'];
    for (const endpoint of endpoints) {
        const url = `${COVER_ART_ARCHIVE_URL}/${entityType}/${mbid}${endpoint}`;
        console.log(`[CoverArt] Trying ${entityType}${endpoint}: ${mbid}`);
        try {
            // 不自动跟随重定向，直接读 Location header
            const resp = await (0, needle_1.default)('get', url, {
                headers: { 'User-Agent': USER_AGENT },
                follow_max: 0,
                timeout: 15000,
                proxy: COVER_ART_PROXY
            });
            if (resp.statusCode === 307 || resp.statusCode === 302 || resp.statusCode === 301) {
                const location = resp.headers?.location;
                if (location) {
                    console.log(`[CoverArt] ✓ ${entityType} ${mbid}${endpoint} → ${location}`);
                    return location;
                }
            }
            if (resp.statusCode === 404) {
                console.log(`[CoverArt] No${endpoint} cover for ${entityType}: ${mbid}`);
                // /front 404 时继续尝试 /front-500
                continue;
            }
            console.log(`[CoverArt] ${entityType} ${mbid}${endpoint} returned status ${resp.statusCode}`);
        }
        catch (err) {
            console.error(`[CoverArt] ${entityType} ${mbid}${endpoint} failed:`, err.message);
        }
    }
    return null;
};
/**
 * 获取专辑封面 URL (Cover Art Archive)
 * 优先 /front (原始分辨率)，再 /front-500 (500px 缩略图)
 */
const getCoverArtUrl = async (releaseMbid) => {
    return fetchCoverByFrontEndpoint('release', releaseMbid);
};
exports.getCoverArtUrl = getCoverArtUrl;
/**
 * 快速检测 URL 是否可访问 (HEAD 请求，5秒超时)
 */
const isUrlReachable = async (url) => {
    try {
        const resp = await (0, needle_1.default)('head', url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'image/*,*/*'
            },
            timeout: 5000,
            follow_max: 3,
            proxy: COVER_ART_PROXY
        });
        return resp.statusCode === 200;
    }
    catch {
        return false;
    }
};
/**
 * 获取代理配置 (优先项目配置，再环境变量)
 */
const getProxyUrl = () => {
    try {
        if (global.lx?.config?.['proxy.all.enabled'] && global.lx?.config?.['proxy.all.address']) {
            return global.lx.config['proxy.all.address'];
        }
    }
    catch {
    }
    return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || null;
};
/**
 * 为 needle 创建代理配置
 */
const getProxyOptions = async (proxyUrl) => {
    try {
        const url = new URL(proxyUrl);
        if (url.protocol.startsWith('socks')) {
            const { SocksProxyAgent } = await import('socks-proxy-agent');
            return { agent: new SocksProxyAgent(proxyUrl) };
        }
        return { proxy: proxyUrl };
    }
    catch {
        return { proxy: proxyUrl };
    }
};
/**
 * 下载封面图片数据
 * 支持代理 (项目配置或环境变量)，尝试 https 和 http 两种方式
 * @param coverUrl 封面图片 URL
 * @returns 图片 Buffer 和 MIME 类型
 */
const downloadCoverImage = async (coverUrl) => {
    // 优先使用项目配置/环境变量的代理，其次使用封面专用代理
    const proxyUrl = getProxyUrl() || COVER_ART_PROXY;
    console.log(`[CoverArt] Using proxy: ${proxyUrl}`);
    const proxyOpts = await getProxyOptions(proxyUrl);
    // 尝试 https 和 http 两个版本 (archive.org 在某些网络下 https 可能不通)
    const urls = [coverUrl];
    if (coverUrl.startsWith('https://')) {
        urls.push(coverUrl.replace('https://', 'http://'));
    }
    else if (coverUrl.startsWith('http://')) {
        urls.push(coverUrl.replace('http://', 'https://'));
    }
    for (const url of urls) {
        console.log(`[CoverArt] Downloading: ${url}`);
        try {
            const response = await (0, needle_1.default)('get', url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'image/*,*/*'
                },
                timeout: 30000,
                follow_max: 5,
                ...proxyOpts
            });
            if (response.statusCode === 200 && response.body && response.body.length > 0) {
                const mime = response.headers?.['content-type'] || 'image/jpeg';
                console.log(`[CoverArt] Downloaded: ${response.body.length} bytes, mime=${mime}`);
                return { data: response.body, mime };
            }
            console.log(`[CoverArt] Download status=${response.statusCode}`);
        }
        catch (err) {
            console.error(`[CoverArt] Download failed (${url}):`, err.message);
        }
    }
    console.error('[CoverArt] All download attempts failed');
    return null;
};
exports.downloadCoverImage = downloadCoverImage;
