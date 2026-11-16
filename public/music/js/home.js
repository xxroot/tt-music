// ========== Home Module - 首页功能 ==========
// 首页作为默认落地页：统计卡片、已播放歌曲、最近添加专辑、歌单快捷入口
// 依赖全局函数: getUserAuthHeaders, getImgUrl, buildCoverUrl, updatePlaylist,
//               openAlbumByName, handleListClick, createMarqueeHtml, applyMarqueeChecks,
//               escapeHtml, formatDuration, lazyLoadImages, showInfo
// ==================================================

// ---------- 首页状态 ----------
let _homeStats = null;
let _homeAddedAlbums = [];
let _homePlayedSongs = [];
let _homeCurrentTab = 'played';

// ---------- 主入口 ----------
async function loadHomePage() {
    // 并行加载统计数据 + 最近添加专辑
    const [stats, albums] = await Promise.all([
        fetchHomeStats(),
        fetchRecentAddedAlbums()
    ]);

    _homeStats = stats;
    _homeAddedAlbums = albums;

    // 从 currentListData 获取已播放歌曲和歌单
    _homePlayedSongs = (window.currentListData && window.currentListData.defaultList) || [];

    renderHomeStats(stats);

    // 根据当前 TAB 渲染对应内容
    switchHomeTab(_homeCurrentTab);
}
window.loadHomePage = loadHomePage;

// ---------- API 调用 ----------
async function fetchHomeStats() {
    try {
        const headers = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
        const res = await fetch('/api/music/home/stats', { headers });
        const json = await res.json();
        return json.success ? json.data : { artistCount: 0, albumCount: 0, songCount: 0 };
    } catch (e) {
        console.warn('[Home] Failed to fetch stats:', e);
        return { artistCount: 0, albumCount: 0, songCount: 0 };
    }
}

async function fetchRecentAddedAlbums() {
    try {
        const headers = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
        const res = await fetch('/api/music/home/recent-added?limit=15', { headers });
        const json = await res.json();
        return json.success ? (json.data || []) : [];
    } catch (e) {
        console.warn('[Home] Failed to fetch recent albums:', e);
        return [];
    }
}

// ---------- 统计卡片渲染 ----------
function renderHomeStats(stats) {
    const elArtists = document.getElementById('home-stat-artists');
    const elAlbums = document.getElementById('home-stat-albums');
    const elSongs = document.getElementById('home-stat-songs');
    if (elArtists) elArtists.textContent = stats.artistCount || 0;
    if (elAlbums) elAlbums.textContent = stats.albumCount || 0;
    if (elSongs) elSongs.textContent = stats.songCount || 0;
}

// ---------- TAB 切换 ----------
function switchHomeTab(tab) {
    _homeCurrentTab = tab;

    // TAB 按钮样式
    const tabIds = ['played', 'added', 'playlist'];
    tabIds.forEach(t => {
        const btn = document.getElementById(`home-tab-${t}`);
        if (!btn) return;
        if (t === tab) {
            btn.classList.remove('border-transparent', 't-text-muted');
            btn.classList.add('border-emerald-500', 'text-emerald-600');
        } else {
            btn.classList.remove('border-emerald-500', 'text-emerald-600');
            btn.classList.add('border-transparent', 't-text-muted');
        }
    });

    // 内容区域显隐
    const sectionIds = { played: 'home-played-section', added: 'home-added-section', playlist: 'home-playlist-section' };
    Object.entries(sectionIds).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (key === tab) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });

    // 渲染当前 TAB 内容
    if (tab === 'played') renderPlayedSongs();
    else if (tab === 'added') renderAddedAlbums(_homeAddedAlbums);
    else if (tab === 'playlist') renderPlaylistCards();
}
window.switchHomeTab = switchHomeTab;

// ---------- 已播放歌曲列表 ----------
function renderPlayedSongs() {
    const container = document.getElementById('home-played-list');
    if (!container) return;

    // 显示逻辑：已登录 → 服务器 defaultList（顺序即播放顺序）+ 本地 localStorage 补充去重；
    // 未登录 → 只显示本地 localStorage 历史（按 origin 天然按服务器隔离）
    const isLoggedIn = window.currentListData && window.currentListData.username && window.currentListData.username !== 'default';

    // 读取本地播放历史（未登录时保存）
    let localHistory = [];
    try {
        localHistory = JSON.parse(localStorage.getItem('play_history') || '[]') || [];
    } catch (e) {
        console.warn('[Home] 读取本地播放历史失败:', e);
    }

    if (isLoggedIn) {
        // 服务器记录在前（defaultList 顺序即播放顺序），本地记录按 id 去重后补充
        const serverSongs = (window.currentListData && window.currentListData.defaultList) || [];
        const seen = new Set(serverSongs.map(s => s.id));
        const localExtra = localHistory.filter(s => s.id && !seen.has(s.id));
        _homePlayedSongs = [...serverSongs, ...localExtra].slice(0, 10);
    } else {
        _homePlayedSongs = localHistory.slice(0, 10);
    }
    const songs = _homePlayedSongs;

    if (songs.length === 0) {
        container.innerHTML = `
            <div class="py-12 text-center t-text-muted">
                <i class="fas fa-headphones text-3xl mb-3 opacity-30"></i>
                <p class="text-sm">还没有播放记录</p>
                <p class="text-xs mt-1 opacity-60">播放任意歌曲后将在这里显示</p>
            </div>`;
        return;
    }

    // 设置 viewingPlaylist 以便 playFromView 使用
    window.viewingPlaylist = songs;
    if (typeof window.currentSearchScope !== 'undefined') {
        window.currentSearchScope = 'local_list';
    }

    container.innerHTML = '';
    songs.forEach((song, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 px-3 py-2 rounded-xl hover:t-bg-panel cursor-pointer group transition-colors';
        row.onclick = () => playSongFromPlayed(idx);

        const imgUrl = typeof getImgUrl === 'function' ? getImgUrl(song) : '/music/assets/logo.png';
        const name = window.escapeHtml ? window.escapeHtml(song.name || '未知歌曲') : (song.name || '未知歌曲');
        const singer = window.escapeHtml ? window.escapeHtml(song.singer || '未知歌手') : (song.singer || '未知歌手');
        const album = song.albumName || song.album || '';
        const albumDisplay = window.escapeHtml ? window.escapeHtml(album) : album;
        const duration = song.interval || (song.duration ? formatDuration(song.duration) : '--:--');

        row.innerHTML = `
            <!-- 序号 -->
            <div class="w-6 text-center text-xs t-text-muted flex-shrink-0 tabular-nums">${idx + 1}</div>
            <!-- 封面 -->
            <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative shadow-sm">
                <img src="${imgUrl}" onerror="this.src='/music/assets/logo.png'"
                     loading="lazy" class="w-full h-full object-cover" alt="${name}">
                <div class="absolute inset-0 bg-black/20 hidden group-hover:flex items-center justify-center transition-all">
                    <i class="fas fa-play text-white text-xs"></i>
                </div>
            </div>
            <!-- 信息 -->
            <div class="flex-1 min-w-0 flex flex-col justify-center">
                <div class="font-medium text-sm t-text-main truncate group-hover:text-emerald-500 transition-colors">${name}</div>
                <div class="text-xs t-text-muted truncate mt-0.5">${singer}${albumDisplay ? ' · ' + albumDisplay : ''}</div>
            </div>
            <!-- 时长 -->
            <div class="text-xs t-text-muted font-mono flex-shrink-0 tabular-nums">${duration}</div>
            <!-- 播放按钮 -->
            <button class="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    onclick="event.stopPropagation(); playSongFromPlayed(${idx})" title="播放">
                <i class="fas fa-play text-xs"></i>
            </button>
        `;
        container.appendChild(row);
    });

    // 初始化懒加载
    if (typeof lazyLoadImages === 'function') lazyLoadImages();
}

function playSongFromPlayed(idx) {
    const songs = _homePlayedSongs.slice(0, 10);
    if (!songs[idx]) return;
    // 设置播放列表并播放
    if (typeof updatePlaylist === 'function') {
        updatePlaylist(songs, idx, 'local_list');
    }
}
window.playSongFromPlayed = playSongFromPlayed;

// ---------- 随心听 (Mix Play) ----------

/**
 * 随心听：从本地库与收藏歌单随机取 200 首混合播放
 * 调后端 /api/music/home/mix：本地库歌曲标记 _serverCachePath 走服务端文件流，收藏歌曲走在线解析
 */
async function playHomeMix() {
    const btn = document.getElementById('home-mix-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin text-xs"></i> 生成中...';
    }
    try {
        const headers = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
        const res = await fetch('/api/music/home/mix?limit=200', { headers });
        const json = await res.json();
        if (!json.success || !json.data || json.data.length === 0) {
            if (typeof showInfo === 'function') showInfo('暂无可播放的歌曲，请先下载歌曲或收藏歌单');
            return;
        }

        // 本地库歌曲标记服务端缓存路径，收藏歌单歌曲保持原样（在线解析）
        const songs = json.data.map(s => {
            if (s.mixType === 'local') {
                s._serverCachePath = s.relativePath;
                s._isMusicLibSong = true;
            }
            return s;
        });

        // scope='mix'：避免触发歌单/搜索的队列切换逻辑；shouldAddToDefault=true 让歌曲进入播放记录
        if (typeof updatePlaylist === 'function') {
            updatePlaylist(songs, 0, 'mix', true);
        }
    } catch (err) {
        console.error('[Home] Mix play failed:', err);
        if (typeof showError === 'function') showError('随心听生成失败');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-shuffle text-xs"></i> 随心听';
        }
    }
}
window.playHomeMix = playHomeMix;

// ---------- 添加于专辑卡片 ----------
function renderAddedAlbums(albums) {
    const container = document.getElementById('home-added-list');
    if (!container) return;

    if (!albums || albums.length === 0) {
        container.innerHTML = `
            <div class="py-12 text-center t-text-muted w-full">
                <i class="fas fa-record-vinyl text-3xl mb-3 opacity-30"></i>
                <p class="text-sm">还没有添加的专辑</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    albums.forEach((album, idx) => {
        const card = document.createElement('div');
        card.className = 'min-w-0 cursor-pointer group';
        card.onclick = () => openAlbumFromAdded(idx);

        // 封面 URL (img 可能是逗号分隔的多个值，取第一个)
        const firstImg = extractFirstImg(album.img);
        const coverUrl = (firstImg?.startsWith('http') && firstImg) ||
            (firstImg && typeof buildCoverUrl === 'function' && buildCoverUrl(firstImg, album.source)) ||
            '/music/assets/logo.png';

        const albumName = window.escapeHtml ? window.escapeHtml(album.album || '未知专辑') : (album.album || '未知专辑');
        const singerName = window.escapeHtml ? window.escapeHtml(album.singer || '未知歌手') : (album.singer || '未知歌手');
        const songCount = album.songCount || 0;

        card.innerHTML = `
            <div class="relative aspect-square rounded-xl overflow-hidden shadow-md mb-2 group-hover:shadow-xl group-hover:scale-[1.03] transition-all duration-300"
                 onclick="event.stopPropagation(); playAlbumFromAdded(${idx})">
                <img src="${coverUrl}" onerror="this.src='/music/assets/logo.png'"
                     loading="lazy" class="w-full h-full object-cover" alt="${albumName}">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div class="w-10 h-10 md:w-12 md:h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-300">
                        <i class="fas fa-play ml-0.5"></i>
                    </div>
                </div>
            </div>
            <div class="text-sm font-medium t-text-main truncate group-hover:text-emerald-500 transition-colors" title="${albumName}">${albumName}</div>
            <div class="text-xs t-text-muted truncate">${singerName}${songCount ? ' · ' + songCount + '首' : ''}</div>
        `;
        container.appendChild(card);
    });
}

function openAlbumFromAdded(idx) {
    const album = _homeAddedAlbums[idx];
    if (!album) return;
    if (typeof openAlbumByName === 'function') {
        openAlbumByName({
            album: album.album,
            singer: album.singer || '',
            img: album.img || '',
            source: album.source || '',
            songCount: album.songCount || 0
        });
    }
}
window.openAlbumFromAdded = openAlbumFromAdded;

// 点击封面播放图标：直接播放该专辑歌曲，不跳转
async function playAlbumFromAdded(idx) {
    const album = _homeAddedAlbums[idx];
    if (!album) return;
    try {
        const headers = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
        const res = await fetch(`/api/music/cache/list?album=${encodeURIComponent(album.album)}`, { headers });
        const result = await res.json();
        if (!result.success || !result.data || result.data.length === 0) return;
        const songs = result.data;
        // 设置播放列表（与 doPlayAlbumSongs 一致）
        window.currentPlaylist = songs.map(s => {
            s._serverCachePath = s.relativePath;
            s._isMusicLibSong = true;
            s._isFromAlbumLib = true;
            return s;
        });
        window.currentPlayingScope = 'album';
        if (typeof window.syncPlaylistToDmc === 'function') {
            window.syncPlaylistToDmc(window.currentPlaylist, 0, true);
        }
        // [AirPlay DMC] 同步歌单到 AirPlay DMC
        if (typeof window.syncPlaylistToAirPlay === 'function') {
            window.syncPlaylistToAirPlay(window.currentPlaylist, 0, true);
        }
        if (window._castDeviceType !== 'upnp' && window._castDeviceType !== 'airplay') {
            window.playSong(window.currentPlaylist[0], 0, null, false, false, true);
        }
    } catch (err) {
        console.error('[Home] Failed to play album:', err);
    }
}
window.playAlbumFromAdded = playAlbumFromAdded;

// ---------- 歌单卡片 ----------

/**
 * 渲染歌单方格卡片（共享函数，首页歌单 TAB 与我的收藏视图复用）
 * @param {Array<{id:string, name:string, count:number, coverSong?:object, listImg?:string|null, icon?:string}>} playlists
 * @param {string} containerId 目标容器 DOM ID
 */
function renderPlaylistGrid(playlists, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!playlists || playlists.length === 0) {
        container.innerHTML = `
            <div class="py-12 text-center t-text-muted w-full col-span-full">
                <i class="fas fa-list text-3xl mb-3 opacity-30"></i>
                <p class="text-sm">还没有歌单</p>
                <p class="text-xs mt-1 opacity-60">收藏歌曲后将自动创建歌单</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'min-w-0 cursor-pointer group';
        card.onclick = () => navigateToList(pl.id);

        // 封面：优先使用歌单自身的 listImg，没有则取第一首歌的封面
        let coverUrl;
        if (pl.listImg) {
            coverUrl = pl.listImg;
        } else {
            const coverSong = pl.coverSong;
            coverUrl = coverSong ? (typeof getImgUrl === 'function' ? getImgUrl(coverSong) : '/music/assets/logo.png') : '/music/assets/logo.png';
        }
        if (!coverUrl) coverUrl = '/music/assets/logo.png';
        const listName = window.escapeHtml ? window.escapeHtml(pl.name) : pl.name;

        // 图标叠加层：播放记录 / 收藏 使用专属图标，自定义歌单显示播放图标
        let overlayIcon = 'fa-play';
        if (pl.icon) overlayIcon = pl.icon;

        card.innerHTML = `
            <div class="relative aspect-square rounded-xl overflow-hidden shadow-md mb-2 group-hover:shadow-xl group-hover:scale-[1.03] transition-all duration-300">
                <img src="${coverUrl}" onerror="this.src='/music/assets/logo.png'"
                     loading="lazy" class="w-full h-full object-cover" alt="${listName}">
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <i class="fas ${overlayIcon} text-white text-2xl opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg"></i>
                </div>
                <!-- 歌曲数角标 -->
                <div class="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full backdrop-blur-sm">
                    ${pl.count} 首
                </div>
            </div>
            <div class="text-sm font-medium t-text-main truncate group-hover:text-emerald-500 transition-colors" title="${listName}">${listName}</div>
            <div class="text-xs t-text-muted">${pl.count} 首歌曲</div>
        `;
        container.appendChild(card);
    });
}
window.renderPlaylistGrid = renderPlaylistGrid;

/**
 * 从 currentListData 构造完整歌单列表（含播放记录、我的收藏、自定义歌单）
 * @returns {Array} playlists 数组
 */
function buildAllPlaylists() {
    const data = window.currentListData;
    if (!data) return null; // null 表示未登录

    const playlists = [];

    // 播放记录
    if (data.defaultList && data.defaultList.length > 0) {
        playlists.push({
            id: 'default',
            name: '播放记录',
            count: data.defaultList.length,
            coverSong: data.defaultList[0],
            icon: 'fa-clock-rotate-back'
        });
    }

    // 我的收藏
    if (data.loveList && data.loveList.length > 0) {
        playlists.push({
            id: 'love',
            name: '我的收藏',
            count: data.loveList.length,
            coverSong: data.loveList[0],
            icon: 'fa-heart'
        });
    }

    // 自定义歌单
    if (data.userList) {
        data.userList.forEach(uList => {
            if (uList.list && uList.list.length > 0) {
                playlists.push({
                    id: uList.id,
                    name: uList.name || '未命名歌单',
                    count: uList.list.length,
                    listImg: uList.info?.img || null,
                    coverSong: uList.list[0]
                });
            }
        });
    }

    return playlists;
}
window.buildAllPlaylists = buildAllPlaylists;

function renderPlaylistCards() {
    const container = document.getElementById('home-playlist-list');
    if (!container) return;

    const playlists = buildAllPlaylists();
    if (playlists === null) {
        // 未登录
        container.innerHTML = `
            <div class="py-12 text-center t-text-muted w-full">
                <p class="text-sm">请先登录使用收藏功能</p>
            </div>`;
        return;
    }

    renderPlaylistGrid(playlists, 'home-playlist-list');
}

function navigateToList(listId) {
    if (typeof handleListClick === 'function') {
        handleListClick(listId);
    }
}
window.navigateToList = navigateToList;
