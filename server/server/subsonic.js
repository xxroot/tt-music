"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subsonicHandler = void 0;
const crypto_1 = __importDefault(require("crypto"));
const user_1 = require("../user");
const userApi_1 = require("../server/userApi");
const singer_1 = require("../server/utils/singer");
/**
 * Subsonic 协议处理器
 * 实现了 OpenSubsonic 核心 API 集成
 * 实现了 OpenSubsonic 核心 API 集成
 *
 * 序列化策略：
 *  - JSON (f=json)：所有数据函数返回平铺的 JS 对象，sendResponse 直接 JSON.stringify
 *  - XML (默认)：数据函数返回 {attrs, children} 嵌套结构，toXml 负责渲染
 */
class SubsonicHandler {
    constructor() {
        this.VERSION = '1.16.1';
        this.SERVER_VERSION = '1.0.0';
    }
    // ─────────────────────────────────────────────
    // 鉴权
    // ─────────────────────────────────────────────
    verifyAuth(params) {
        const u = params.get('u');
        if (!u)
            return null;
        const user = global.lx.config.users.find((user) => user.name === u);
        if (!user)
            return null;
        // Token & Salt 方式 (推荐)
        const t = params.get('t');
        const s = params.get('s');
        if (t && s) {
            const hash = crypto_1.default.createHash('md5').update(user.password + s).digest('hex');
            if (hash === t.toLowerCase())
                return u;
        }
        // 明文密码方式 (包含 enc: 前缀处理)
        const p = params.get('p');
        if (p) {
            let password = p;
            if (p.startsWith('enc:')) {
                password = Buffer.from(p.substring(4), 'hex').toString();
            }
            if (password === user.password)
                return u;
        }
        return null;
    }
    // ─────────────────────────────────────────────
    // 响应序列化
    // ─────────────────────────────────────────────
    /**
     * 发送 Subsonic 成功响应
     * @param res    HTTP 响应
     * @param data   JSON 模式：平铺的 JS 对象；XML 模式：带 attrs/children 结构的对象
     * @param format 'json' | null/其他
     */
    sendResponse(res, data, format) {
        const base = {
            status: 'ok',
            version: this.VERSION,
            type: 'lxserver',
            serverVersion: this.SERVER_VERSION,
            openSubsonic: true,
        };
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ 'subsonic-response': { ...base, ...data } }));
        }
        else {
            res.setHeader('Content-Type', 'text/xml; charset=utf-8');
            let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
            xml += `<subsonic-response xmlns="http://subsonic.org/restapi"`;
            xml += ` status="${base.status}" version="${base.version}"`;
            xml += ` type="${base.type}" serverVersion="${base.serverVersion}" openSubsonic="true">\n`;
            xml += this.toXml(data);
            xml += '</subsonic-response>';
            res.end(xml);
        }
    }
    /** XML 渲染（仅 XML 路径使用）*/
    toXml(obj, indent = '  ') {
        let xml = '';
        for (const key in obj) {
            const val = obj[key];
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (!item)
                        continue;
                    xml += `${indent}<${key}${this.renderAttrs(item.attrs)}`;
                    if (item.children) {
                        xml += '>\n' + this.toXml(item.children, indent + '  ') + `${indent}</${key}>\n`;
                    }
                    else {
                        xml += ' />\n';
                    }
                }
            }
            else if (typeof val === 'object' && val !== null) {
                xml += `${indent}<${key}${this.renderAttrs(val.attrs)}`;
                if (val.children) {
                    xml += '>\n' + this.toXml(val.children, indent + '  ') + `${indent}</${key}>\n`;
                }
                else {
                    xml += ' />\n';
                }
            }
        }
        return xml;
    }
    renderAttrs(attrs) {
        if (!attrs)
            return '';
        let str = '';
        for (const k in attrs) {
            const v = String(attrs[k])
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            str += ` ${k}="${v}"`;
        }
        return str;
    }
    sendError(res, code, message, format) {
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({
                'subsonic-response': {
                    status: 'failed',
                    version: this.VERSION,
                    type: 'lxserver',
                    serverVersion: this.SERVER_VERSION,
                    openSubsonic: true,
                    error: { code, message },
                },
            }));
        }
        else {
            res.setHeader('Content-Type', 'text/xml; charset=utf-8');
            res.end(`<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<subsonic-response xmlns="http://subsonic.org/restapi" status="failed" version="${this.VERSION}"` +
                ` type="lxserver" serverVersion="${this.SERVER_VERSION}" openSubsonic="true">` +
                `<error code="${code}" message="${this.escapeXml(message)}"/></subsonic-response>`);
        }
    }
    escapeXml(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // ─────────────────────────────────────────────
    // 路由分发
    // ─────────────────────────────────────────────
    async handleRequest(req, res, urlObj) {
        const params = urlObj.searchParams;
        const format = params.get('f') === 'json' ? 'json' : 'xml';
        const username = this.verifyAuth(params);
        if (!username) {
            return this.sendError(res, 40, 'Wrong username or password', format);
        }
        const { pathname } = urlObj;
        const method = pathname.split('/').pop()?.split('.')[0] || '';
        try {
            switch (method) {
                case 'ping':
                    return this.sendResponse(res, {}, format);
                case 'getLicense':
                    return this.handleGetLicense(res, format);
                case 'getPlaylists':
                    return this.handleGetPlaylists(res, username, format);
                case 'getPlaylist':
                    return this.handleGetPlaylist(res, username, params, format);
                case 'getAlbum':
                    return this.handleGetPlaylist(res, username, params, format);
                case 'getSong':
                    return this.handleGetSong(res, username, params, format);
                case 'stream':
                case 'download':
                    return this.handleStream(req, res, username, params, format);
                case 'getCoverArt':
                    return this.handleGetCoverArt(req, res, username, params, format);
                case 'getUser':
                    return this.handleGetUser(res, username, params, format);
                case 'getMusicFolders':
                    return this.handleGetMusicFolders(res, format);
                case 'getMusicDirectory':
                    return this.handleGetMusicDirectory(res, username, params, format);
                case 'getGenres':
                    return this.handleGetGenres(res, username, format);
                case 'getAlbumList':
                    return this.handleGetAlbumList(res, username, params, format, false);
                case 'getAlbumList2':
                    return this.handleGetAlbumList(res, username, params, format, true);
                case 'getArtistInfo':
                case 'getArtistInfo2':
                    return this.handleGetArtistInfo(res, params, format);
                case 'getArtist':
                    return this.handleGetArtist(res, username, params, format);
                case 'getArtistList':
                case 'getArtists':
                    return this.handleGetArtists(res, username, format);
                case 'search2':
                case 'search3':
                    return this.handleSearch(res, username, params, format);
                case 'getStarred':
                    return this.handleGetStarred(res, username, format, false);
                case 'getStarred2':
                    return this.handleGetStarred(res, username, format, true);
                case 'getScanStatus':
                    return this.sendResponse(res, format === 'json'
                        ? { scanStatus: { scanning: false, count: 0 } }
                        : { scanStatus: { attrs: { scanning: false, count: 0 } } }, format);
                default:
                    return this.sendError(res, 0, 'Method not found: ' + method, format);
            }
        }
        catch (err) {
            console.error('[Subsonic] Error:', err);
            return this.sendError(res, 0, err.message || 'Internal server error', format);
        }
    }
    // ─────────────────────────────────────────────
    // 帮助函数
    // ─────────────────────────────────────────────
    parseDuration(interval) {
        if (!interval)
            return 0;
        const parts = interval.split(':').map(Number);
        if (parts.length === 3)
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2)
            return parts[0] * 60 + parts[1];
        return isNaN(parts[0]) ? 0 : parts[0];
    }
    /**
     * 将 MusicInfo 映射为 Subsonic child/song 的平铺 JS 对象（适用于 JSON 响应）
     */
    musicToSongFlat(music, parentId) {
        const meta = music.meta || {};
        return {
            id: music.id,
            parent: parentId,
            isDir: false,
            title: music.name,
            name: music.name,
            album: meta.albumName || '',
            albumId: parentId,
            artist: music.singer,
            artistId: `artist_${music.singer}`,
            track: 0,
            year: 0,
            genre: '',
            coverArt: music.id,
            duration: this.parseDuration(music.interval),
            bitRate: 128,
            size: 0,
            suffix: 'mp3',
            contentType: 'audio/mpeg',
            isVideo: false,
            type: 'music',
            mediaType: 'song',
        };
    }
    /**
     * 将 MusicInfo 映射为 XML 渲染格式 {attrs, children?}
     */
    musicToSongXml(music, parentId) {
        return { attrs: this.musicToSongFlat(music, parentId) };
    }
    /** 查找某个用户下所有列表中的某首歌 */
    async findMusicById(username, id) {
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        let music = listData.loveList.find((m) => m.id === id);
        if (music)
            return { music, listId: 'love' };
        music = listData.defaultList.find((m) => m.id === id);
        if (music)
            return { music, listId: 'default' };
        for (const listInfo of listData.userList) {
            const list = listInfo.list;
            music = list.find((m) => m.id === id);
            if (music)
                return { music, listId: listInfo.id };
        }
        return null;
    }
    // ─────────────────────────────────────────────
    // 端点实现
    // ─────────────────────────────────────────────
    handleGetLicense(res, format) {
        if (format === 'json') {
            return this.sendResponse(res, {
                license: { valid: true, email: 'lxserver@lxmusic.com', licenseExpires: '2099-12-31T00:00:00.000Z' },
            }, format);
        }
        return this.sendResponse(res, {
            license: { attrs: { valid: true, email: 'lxserver@lxmusic.com', licenseExpires: '2099-12-31T00:00:00.000Z' } },
        }, format);
    }
    handleGetMusicFolders(res, format) {
        if (format === 'json') {
            return this.sendResponse(res, {
                musicFolders: { musicFolder: [{ id: 1, name: 'LX Music' }] },
            }, format);
        }
        return this.sendResponse(res, {
            musicFolders: { children: { musicFolder: [{ attrs: { id: 1, name: 'LX Music' } }] } },
        }, format);
    }
    async handleGetPlaylists(res, username, format) {
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        const buildPlaylist = (id, name, count, created) => ({
            id,
            name,
            comment: '',
            owner: username,
            public: false,
            songCount: count,
            duration: 0,
            created: created || new Date().toISOString(),
            changed: created || new Date().toISOString(),
            coverArt: id,
        });
        const playlists = [];
        if (listData.defaultList.length > 0) {
            playlists.push(buildPlaylist('default', '默认列表', listData.defaultList.length));
        }
        playlists.push(buildPlaylist('love', '我的收藏', listData.loveList.length));
        for (const list of listData.userList) {
            const musics = (list.list || []);
            playlists.push(buildPlaylist(list.id, list.name, musics.length, list.locationUpdateTime ? new Date(list.locationUpdateTime).toISOString() : undefined));
        }
        if (format === 'json') {
            return this.sendResponse(res, { playlists: { playlist: playlists } }, format);
        }
        return this.sendResponse(res, {
            playlists: { children: { playlist: playlists.map(p => ({ attrs: p })) } },
        }, format);
    }
    async handleGetPlaylist(res, username, params, format) {
        const id = params.get('id');
        if (!id)
            return this.sendError(res, 10, 'Required parameter is missing: id', format);
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        let musics = [];
        let listName = 'Unknown';
        if (id === 'love') {
            musics = listData.loveList;
            listName = '我的收藏';
        }
        else if (id === 'default') {
            musics = listData.defaultList;
            listName = '默认列表';
        }
        else {
            const list = listData.userList.find((l) => l.id === id);
            if (list) {
                listName = list.name;
                musics = (list.list || []);
            }
        }
        const playlistMeta = {
            id,
            name: listName,
            comment: '',
            owner: username,
            public: false,
            songCount: musics.length,
            duration: musics.reduce((sum, m) => sum + this.parseDuration(m.interval), 0),
            created: new Date().toISOString(),
            changed: new Date().toISOString(),
            coverArt: id,
        };
        if (format === 'json') {
            return this.sendResponse(res, {
                playlist: {
                    ...playlistMeta,
                    entry: musics.map((m) => this.musicToSongFlat(m, id)),
                },
            }, format);
        }
        return this.sendResponse(res, {
            playlist: {
                attrs: playlistMeta,
                children: {
                    entry: musics.map((m) => this.musicToSongXml(m, id)),
                },
            },
        }, format);
    }
    async handleGetSong(res, username, params, format) {
        const id = params.get('id');
        if (!id)
            return this.sendError(res, 10, 'Required parameter is missing: id', format);
        const found = await this.findMusicById(username, id);
        if (!found)
            return this.sendError(res, 70, 'Song not found: ' + id, format);
        const { music, listId } = found;
        if (format === 'json') {
            return this.sendResponse(res, { song: this.musicToSongFlat(music, listId) }, format);
        }
        return this.sendResponse(res, { song: this.musicToSongXml(music, listId) }, format);
    }
    async handleGetMusicDirectory(res, username, params, format) {
        const id = params.get('id');
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        if (!id || id === '1' || id === 'root') {
            const dirs = [
                { id: 'love', parent: 'root', title: '我的收藏', isDir: true },
                { id: 'default', parent: 'root', title: '默认列表', isDir: true },
                ...listData.userList.map((l) => ({ id: l.id, parent: 'root', title: l.name, isDir: true })),
            ];
            if (format === 'json') {
                return this.sendResponse(res, {
                    directory: { id: 'root', name: 'Music', child: dirs },
                }, format);
            }
            return this.sendResponse(res, {
                directory: {
                    attrs: { id: 'root', name: 'Music' },
                    children: { child: dirs.map(d => ({ attrs: d })) },
                },
            }, format);
        }
        let musics = [];
        let dirName = 'Unknown';
        if (id === 'love') {
            musics = listData.loveList;
            dirName = '我的收藏';
        }
        else if (id === 'default') {
            musics = listData.defaultList;
            dirName = '默认列表';
        }
        else {
            const list = listData.userList.find((l) => l.id === id);
            if (list) {
                dirName = list.name;
                musics = (list.list || []);
            }
        }
        if (format === 'json') {
            return this.sendResponse(res, {
                directory: {
                    id,
                    name: dirName,
                    child: musics.map((m) => this.musicToSongFlat(m, id)),
                },
            }, format);
        }
        return this.sendResponse(res, {
            directory: {
                attrs: { id, name: dirName },
                children: {
                    child: musics.map((m) => this.musicToSongXml(m, id)),
                },
            },
        }, format);
    }
    async handleGetAlbumList(res, username, params, format, isV2) {
        const type = params.get('type');
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        let allLists = [];
        if (type === 'starred') {
            if (listData.loveList.length > 0) {
                allLists.push({ id: 'love', name: '我的收藏', musics: listData.loveList });
            }
        }
        else {
            if (listData.loveList.length > 0) {
                allLists.push({ id: 'love', name: '我的收藏', musics: listData.loveList });
            }
            if (listData.defaultList.length > 0) {
                allLists.push({ id: 'default', name: '默认列表', musics: listData.defaultList });
            }
            for (const list of listData.userList) {
                const musics = (list.list || []);
                if (musics.length > 0) {
                    allLists.push({ id: list.id, name: list.name, musics });
                }
            }
        }
        const buildAlbum = (item) => ({
            id: item.id,
            name: item.name,
            title: item.name,
            album: item.name,
            artist: 'LX Music',
            artistId: 'artist_lxmusic',
            isDir: true,
            coverArt: item.id,
            songCount: item.musics.length,
            duration: item.musics.reduce((s, m) => s + this.parseDuration(m.interval), 0),
            created: new Date().toISOString(),
            playCount: 0,
        });
        const wrapKey = isV2 ? 'albumList2' : 'albumList';
        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: { album: allLists.map(buildAlbum) },
            }, format);
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: { album: allLists.map(item => ({ attrs: buildAlbum(item) })) },
            },
        }, format);
    }
    async handleGetArtists(res, username, format) {
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        // 汇聚所有歌曲中的艺术家
        const artistMap = new Map();
        const processMusics = (musics) => {
            for (const m of musics) {
                const singer = m.singer || 'Unknown';
                const artistId = `artist_${singer}`;
                const existing = artistMap.get(artistId);
                if (existing) {
                    // 这里可以简单统计下该歌手出现的次数之类，或者暂时保持 1
                }
                else {
                    artistMap.set(artistId, {
                        id: artistId,
                        name: singer,
                        albumCount: 1,
                        coverArt: artistId
                    });
                }
            }
        };
        processMusics(listData.loveList);
        processMusics(listData.defaultList);
        for (const list of listData.userList) {
            processMusics((list.list || []));
        }
        const artists = Array.from(artistMap.values());
        // 按首字母分组
        const indexMap = new Map();
        for (const a of artists) {
            const firstChar = a.name[0]?.toUpperCase() || '#';
            const key = /[A-Z]/.test(firstChar) ? firstChar : '#';
            if (!indexMap.has(key))
                indexMap.set(key, []);
            indexMap.get(key).push(a);
        }
        if (format === 'json') {
            const indexArr = Array.from(indexMap.entries()).map(([name, artistList]) => ({
                name,
                artist: artistList,
            }));
            return this.sendResponse(res, {
                artists: { ignoredArticles: 'The An A Die Das Ein', index: indexArr },
            }, format);
        }
        const indexArr = Array.from(indexMap.entries()).map(([name, artistList]) => ({
            attrs: { name },
            children: {
                artist: artistList.map(a => ({ attrs: a })),
            },
        }));
        return this.sendResponse(res, {
            artists: {
                attrs: { ignoredArticles: 'The An A Die Das Ein' },
                children: { index: indexArr },
            },
        }, format);
    }
    async handleGetArtist(res, username, params, format) {
        const id = params.get('id');
        if (!id)
            return this.sendError(res, 10, 'Required parameter is missing: id', format);
        // artistId 格式: "artist_歌手名"
        const singerName = id.startsWith('artist_') ? id.slice(7) : id;
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        // 找出该歌手的所有歌曲，并构造一个虚拟专辑
        const allSongs = [];
        const addSongs = (musics) => {
            for (const m of musics) {
                if (m.singer === singerName)
                    allSongs.push(m);
            }
        };
        addSongs(listData.loveList);
        addSongs(listData.defaultList);
        for (const list of listData.userList)
            addSongs((list.list || []));
        const artistInfo = { id, name: singerName, albumCount: 1, coverArt: id };
        const album = { id: `album_artist_${singerName}`, name: `${singerName} 的歌曲`, artist: singerName, artistId: id, songCount: allSongs.length, duration: 0, coverArt: id };
        if (format === 'json') {
            return this.sendResponse(res, {
                artist: { ...artistInfo, album: [album] },
            }, format);
        }
        return this.sendResponse(res, {
            artist: {
                attrs: artistInfo,
                children: { album: [{ attrs: album }] },
            },
        }, format);
    }
    async handleGetArtistInfo(res, params, format) {
        const info = {
            biography: '',
            musicBrainzId: '',
            lastFmUrl: '',
            smallImageUrl: '',
            mediumImageUrl: '',
            largeImageUrl: '',
        };
        if (format === 'json') {
            return this.sendResponse(res, { artistInfo2: info }, format);
        }
        return this.sendResponse(res, { artistInfo2: { attrs: info } }, format);
    }
    async handleGetGenres(res, username, format) {
        if (format === 'json') {
            return this.sendResponse(res, { genres: { genre: [] } }, format);
        }
        return this.sendResponse(res, { genres: {} }, format);
    }
    async handleSearch(res, username, params, format) {
        const query = (params.get('query') || '').toLowerCase().trim();
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        const allMusics = [];
        const addMusics = (musics, listId) => {
            for (const m of musics)
                allMusics.push({ music: m, listId });
        };
        addMusics(listData.loveList, 'love');
        addMusics(listData.defaultList, 'default');
        for (const list of listData.userList)
            addMusics((list.list || []), list.id);
        const matched = query
            ? allMusics.filter(({ music }) => music.name.toLowerCase().includes(query) ||
                music.singer.toLowerCase().includes(query) ||
                (music.meta?.albumName || '').toLowerCase().includes(query))
            : allMusics.slice(0, 20);
        const songCount = parseInt(params.get('songCount') || '20');
        const songOffset = parseInt(params.get('songOffset') || '0');
        const songs = matched.slice(songOffset, songOffset + songCount);
        if (format === 'json') {
            return this.sendResponse(res, {
                searchResult3: {
                    song: songs.map(({ music, listId }) => this.musicToSongFlat(music, listId)),
                    album: [],
                    artist: [],
                },
            }, format);
        }
        return this.sendResponse(res, {
            searchResult3: {
                children: {
                    song: songs.map(({ music, listId }) => this.musicToSongXml(music, listId)),
                },
            },
        }, format);
    }
    async handleGetStarred(res, username, format, isV2 = true) {
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        const loveList = listData.loveList;
        const wrapKey = isV2 ? 'starred2' : 'starred';
        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: {
                    song: loveList.map((m) => this.musicToSongFlat(m, 'love')),
                    album: [],
                    artist: [],
                },
            }, format);
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: {
                    song: loveList.map((m) => this.musicToSongXml(m, 'love')),
                },
            },
        }, format);
    }
    async handleStream(req, res, username, params, format) {
        const id = params.get('id');
        if (!id)
            return this.sendError(res, 10, 'Required parameter is missing: id', format);
        // 解析 source 和 songmid
        let source = '';
        let songmid = '';
        if (id.includes('_')) {
            const index = id.indexOf('_');
            source = id.substring(0, index);
            songmid = id.substring(index + 1);
        }
        else {
            source = id.split('-')[0] || '';
            songmid = id;
        }
        try {
            const maxBitrate = parseInt(params.get('maxBitrate') || '0');
            const quality = maxBitrate > 128 ? '320k' : '128k';
            const musicInfo = { source, songmid, id, meta: { songId: songmid } };
            const result = await (0, userApi_1.callUserApiGetMusicUrl)(source, musicInfo, quality, username);
            if (result && result.url) {
                res.writeHead(302, { Location: result.url });
                res.end();
            }
            else {
                return this.sendError(res, 0, 'Could not resolve music URL', format);
            }
        }
        catch (err) {
            return this.sendError(res, 0, err.message || 'Stream error', format);
        }
    }
    async handleGetCoverArt(req, res, username, params, format) {
        const id = params.get('id');
        if (!id) {
            res.writeHead(404);
            return res.end();
        }
        // 1. 尝试作为歌曲 ID 处理
        const found = await this.findMusicById(username, id).catch(() => null);
        const picUrl = found ? (found.music?.meta?.picUrl || null) : null;
        if (picUrl) {
            res.writeHead(302, { Location: picUrl });
            return res.end();
        }
        // 2. 尝试作为歌手 ID 处理 (artist_歌手名)
        if (id.startsWith('artist_')) {
            const singerName = id.slice(7);
            if (singerName) {
                const cover = await (0, singer_1.getSingerPic)(singerName);
                if (cover) {
                    res.writeHead(302, { Location: cover });
                    return res.end();
                }
            }
        }
        // 3. 尝试作为歌单 ID 处理 (获取歌单封面 Album 字段)
        const userSpace = (0, user_1.getUserSpace)(username);
        const listData = await userSpace.listManage.getListData();
        let playlistCover = null;
        if (id === 'love') {
            // 我的收藏默认没有 Album 字段，可以根据需要设置默认
        }
        else if (id === 'default') {
            // 默认列表
        }
        else {
            const list = listData.userList.find((l) => l.id === id);
            if (list && list.Album) {
                playlistCover = list.Album;
            }
        }
        if (playlistCover) {
            res.writeHead(302, { Location: playlistCover });
            return res.end();
        }
        // 4. 兜底逻辑：返回默认 logo.svg (重定向到前端静态资源)
        res.writeHead(302, { Location: '/music/assets/logo.svg' });
        res.end();
    }
    async handleGetUser(res, username, params, format) {
        const userInfo = {
            username,
            email: '',
            scrobblingEnabled: false,
            adminRole: true,
            settingsRole: true,
            downloadRole: true,
            uploadRole: false,
            playlistRole: true,
            coverArtRole: true,
            commentRole: false,
            podcastRole: false,
            shareRole: false,
            videoConversionRole: false,
            folder: [1],
        };
        if (format === 'json') {
            return this.sendResponse(res, { user: userInfo }, format);
        }
        return this.sendResponse(res, { user: { attrs: userInfo } }, format);
    }
}
exports.subsonicHandler = new SubsonicHandler();
