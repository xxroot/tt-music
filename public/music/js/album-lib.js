// ========== Album Library - 专辑库管理 ==========
// 数据加载、渲染、分页、详情视图、播放/删除功能

// ========== 专辑库功能 ==========
let _albumLibData = [];           // 当前页数据 (AlbumInfo[])
let _albumLibTotal = 0;           // 服务端返回的总专辑数
let _albumLibTotalPages = 0;      // 服务端返回的总页数
let _albumLibLoaded = false;
let _albumLibPage = 1;
let _albumLibPageSize = 25;
let _albumLibSort = 'mtime';      // 服务端排序字段 (默认按最近添加)
let _albumLibOrder = 'desc';       // 服务端排序方向 (默认降序)
let _albumLibKeyword = '';        // 搜索关键词
let _albumLibSourceFilter = '';  // 来源筛选

let _albumLibCurrentAlbum = null; // Current album being viewed in detail
let _currentAlbumIndex = -1;      // Index of the currently playing album
let _albumLibFromSinger = null;   // 记录从歌手详情进入时的上下文: { singerName, avatar, desc, musicCount, albumCount, singerId, source, gender }

function handleMusicLibClick() {
    // 如果侧边栏已收缩，先展开
    if (_sidebarCollapsed) {
        _sidebarCollapsed = false;
        localStorage.setItem('lx_sidebar_collapsed', 'false');
        applySidebarCollapse();
        // 等待展开动画完成后再展开子菜单
        setTimeout(() => {
            const children = document.getElementById('musiclib-children');
            const arrow = document.getElementById('musiclib-arrow');
            if (children) {
                children.style.height = children.scrollHeight + 'px';
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
        }, 320);
        return;
    }
    const children = document.getElementById('musiclib-children');
    const arrow = document.getElementById('musiclib-arrow');
    if (!children) return;
    if (children.style.height && children.style.height !== '0px') {
        children.style.height = '0px';
        if (arrow) arrow.style.transform = 'rotate(-90deg)';
    } else {
        children.style.height = children.scrollHeight + 'px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }
}

async function loadAlbumLib(filterSingerName) {
    const container = document.getElementById('albumlib-container');
    const countEl = document.getElementById('albumlib-count');
    if (!container) return;

    container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-compact-disc text-5xl mb-4 opacity-20"></i><p class="text-base font-medium animate-pulse">加载中...</p></div>';

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        const params = new URLSearchParams({
            page: _albumLibPage,
            pageSize: _albumLibPageSize,
            sort: _albumLibSort,
            order: _albumLibOrder
        });

        // 歌手过滤或搜索关键词
        if (filterSingerName) {
            params.set('search', filterSingerName);
        } else if (_albumLibKeyword) {
            params.set('search', _albumLibKeyword);
        }

        // 来源筛选
        if (_albumLibSourceFilter) {
            params.set('source', _albumLibSourceFilter);
        }

        const res = await fetch(`/api/music/album/page?${params}`, {headers});
        const result = await res.json();

        if (result.success) {
            _albumLibData = result.data || [];
            _albumLibTotal = result.total || 0;
            _albumLibTotalPages = result.totalPages || 0;
            _albumLibLoaded = true;

            // 调整页码范围
            if (_albumLibPage > _albumLibTotalPages && _albumLibTotalPages > 0) {
                _albumLibPage = _albumLibTotalPages;
            } else if (_albumLibTotal === 0) {
                _albumLibPage = 1;
            }

            renderAlbumLibList();
            if (countEl) countEl.textContent = `共 ${_albumLibTotal} 个专辑`;
        } else {
            _albumLibData = [];
            _albumLibTotal = 0;
            _albumLibTotalPages = 0;
            _albumLibPage = 1;
            container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-compact-disc text-5xl mb-4 opacity-20"></i><p class="text-base font-medium">暂无专辑</p></div>';
            if (countEl) countEl.textContent = '共 0 个专辑';
        }
    } catch (err) {
        console.error('[AlbumLib] Failed to load:', err);
        container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-exclamation-circle text-5xl mb-4 opacity-20 text-red-400"></i><p class="text-base font-medium">加载失败</p></div>';
    }
}

function filterAlbumLib() {
    const input = document.getElementById('albumlib-search-input');
    _albumLibKeyword = input ? input.value.trim() : '';
    _albumLibPage = 1;
    loadAlbumLib();
}

function filterAlbumLibBySource() {
    const select = document.getElementById('albumlib-source-filter');
    if (!select) return;
    _albumLibSourceFilter = select.value;
    _albumLibPage = 1;
    loadAlbumLib();
}

window.filterAlbumLibBySource = filterAlbumLibBySource;

function sortAndRenderAlbumLib() {
    const sortSelect = document.getElementById('albumlib-sort-select');
    const sortValue = sortSelect ? sortSelect.value : 'name';

    // 映射前端排序值到 API 参数
    const sortMap = {
        'name': 'album',
        'singer': 'singer',
        'count': 'singCount',
        'mtime': 'mtime'   // 使用视图的 mtime 字段（专辑中最大 mtime）
    };
    _albumLibSort = sortMap[sortValue] || 'mtime';
    // 使用当前排序方向（不自动重置）
    _albumLibPage = 1;
    loadAlbumLib();
}

// 切换专辑排序方向
function toggleAlbumSortOrder() {
    const orderBtn = document.getElementById('albumlib-sort-order-btn');
    if (!orderBtn) return;

    // 切换排序方向
    _albumLibOrder = _albumLibOrder === 'asc' ? 'desc' : 'asc';

    // 更新图标
    const icon = orderBtn.querySelector('i');
    if (_albumLibOrder === 'asc') {
        icon.className = 'fas fa-sort-amount-up text-sm';
        orderBtn.title = '当前: 正序 (点击切换为倒序)';
    } else {
        icon.className = 'fas fa-sort-amount-down text-sm';
        orderBtn.title = '当前: 倒序 (点击切换为正序)';
    }

    // 重新加载列表
    _albumLibPage = 1;
    loadAlbumLib();
}

function renderAlbumLibList() {
    const container = document.getElementById('albumlib-container');
    if (!container) return;

    if (!_albumLibData.length) {
        container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-compact-disc text-5xl mb-4 opacity-20"></i><p class="text-base font-medium">没有匹配的专辑</p></div>';
        updateAlbumLibPagination();
        return;
    }

    container.innerHTML = _albumLibData.map((album, idx) => {

        // 封面逻辑：img 可能是逗号分隔的多个值，取第一个非空值
        const firstImg = extractFirstImg(album.img);
        const coverUrl = (firstImg?.startsWith('http') && firstImg) ||
            (firstImg && buildCoverUrl(firstImg, album.source)) || '';

        const singerDisplay = album.singer || 'Unknown';
        const albumName = album.album || '未知专辑';

        // 构建统计信息
        const statsItems = [];
        statsItems.push(`<span><i class="fas fa-music text-[10px] mr-1"></i>${album.singCount}</span>`);
        if (album.duration > 0) {
            statsItems.push(`<span><i class="fas fa-clock text-[10px] mr-1"></i>${formatDuration(album.duration)}</span>`);
        }
        const firstYear = (album.year || '').split(',')[0];
        if (firstYear) {
            statsItems.push(`<span><i class="fas fa-calendar text-[10px] mr-1"></i>${escapeHtml(firstYear)}</span>`);
        }
        if (album.source) {
            statsItems.push(getSourceTag(album.source));
        }

        // 复用通用专辑风格卡片 (media-render-shared.js)，与 DLNA 服务保持同一套渲染代码
        return buildAlbumGridCardHtml({
            coverUrl: coverUrl,
            title: albumName,
            subtitle: singerDisplay,
            statsItems: statsItems,
            onclick: `openAlbumDetail(${idx})`,
            onOverlayClick: `playAlbumAll(${idx})`,
            overlayIcon: 'fa-play'
        });
    }).join('');

    updateAlbumLibPagination();
}

function escapeAttr(text) {
    if (!text) return '';
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ===== 专辑库分页 (由 pagination-factory.js 工厂生成) =====
const _albumLibPaginator = createLibPaginator({
    getPage: () => _albumLibPage, setPage: (p) => { _albumLibPage = p; },
    getPageSize: () => _albumLibPageSize, setPageSize: (s) => { _albumLibPageSize = s; },
    getTotal: () => _albumLibTotal, getTotalPages: () => _albumLibTotalPages,
    loadFn: loadAlbumLib, prefix: 'albumlib', itemLabel: '个专辑',
    defaultPageSize: 25, scrollContainerId: 'albumlib-grid', pageInfoId: 'albumlib-page-info'
});
const updateAlbumLibPagination = _albumLibPaginator.updatePagination;
const albumLibPrevPage = _albumLibPaginator.prevPage;
const albumLibNextPage = _albumLibPaginator.nextPage;
const albumLibGoToPage = _albumLibPaginator.goToPage;
const albumLibChangePageSize = _albumLibPaginator.changePageSize;

/**
 * 通用专辑详情 UI 更新 -- 设置封面/导航栏/信息区
 * @param {Object} album - { album, singer, singCount, duration, genre, year, albumArtist, source, img }
 */
function _updateAlbumDetailUI(album) {
    // 封面轮播逻辑 (封面位置 2：专辑详情左上角)
    // 解析所有封面 URL (img 可能是逗号分隔的多个值)
    const allCoverUrls = (album.img || '').split(',').map(s => s.trim()).filter(Boolean);
    initAlbumCoverCarousel(allCoverUrls, album.source);

    // Update navigation bar
    const navTitleEl = document.getElementById('albumlib-detail-nav-title');
    const navSubtitleEl = document.getElementById('albumlib-detail-nav-subtitle');
    if (navTitleEl) navTitleEl.textContent = album.album;
    if (navSubtitleEl) navSubtitleEl.textContent = `${album.singer} · ${album.singCount || 0} 首`;

    // 动态更新返回按钮 (Dynamically update back button based on navigation context)
    const backBtn = document.getElementById('albumlib-detail-back-btn');
    if (backBtn) {
        if (_albumLibFromSinger) {
            backBtn.onclick = backToAlbumDetailOrSinger;
            backBtn.title = '返回歌手详情';
        } else {
            backBtn.onclick = closeAlbumDetail;
            backBtn.title = '返回专辑列表';
        }
    }

    // Update info section
    const nameEl = document.getElementById('albumlib-detail-name');
    const singerEl = document.getElementById('albumlib-detail-singer');
    const statsEl = document.getElementById('albumlib-detail-stats');
    if (nameEl) nameEl.textContent = album.album;
    if (singerEl) singerEl.textContent = album.singer;
    if (statsEl) {
        const statsItems = [];
        statsItems.push(`<span><i class="fas fa-music text-[10px] mr-1"></i>${album.singCount || 0} 首</span>`);
        if (album.duration > 0) {
            statsItems.push(`<span><i class="fas fa-clock text-[10px] mr-1"></i>${formatDuration(album.duration)}</span>`);
        }
        const firstYear = (album.year || '').split(',')[0];
        if (firstYear) {
            statsItems.push(`<span><i class="fas fa-calendar text-[10px] mr-1"></i>${firstYear}</span>`);
        }
        if (album.genre) {
            statsItems.push(`<span><i class="fas fa-tag text-[10px] mr-1"></i>${album.genre}</span>`);
        }
        if (album.source) {
            statsItems.push(getSourceTag(album.source));
        }
        statsEl.innerHTML = statsItems.join('');
    }
}

/**
 * 专辑歌曲排序：光盘号 → 曲目号 → 标题（与明细页显示顺序一致）
 * 返回排序后的新数组，不改动原数组。
 * 用于保证加载时的歌曲顺序与页面显示、投屏播放队列三者一致。
 * @param {Array} songs - 歌曲数组
 * @returns {Array} 排序后的新数组
 */
function sortAlbumSongs(songs) {
    if (!songs || !Array.isArray(songs)) return [];
    return [...songs].sort((a, b) => {
        // 先按 discNumber 排序 (NULL 视为 0)
        const discA = a.discNumber || 0;
        const discB = b.discNumber || 0;
        if (discA !== discB) return discA - discB;
        // 同 disc 内按 trackNumber 排序 (NULL 视为 0)
        const trackA = a.trackNumber || 0;
        const trackB = b.trackNumber || 0;
        if (trackA !== trackB) return trackA - trackB;
        // trackNumber 相同时按名称排序
        const nameA = a.name || 'Unknown';
        const nameB = b.name || 'Unknown';
        return nameA.localeCompare(nameB, 'zh');
    });
}

/**
 * 异步加载专辑歌曲列表并刷新详情
 * @param {string} albumName - 专辑名称
 */
async function _loadAlbumSongs(albumName) {
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`/api/music/cache/list?album=${encodeURIComponent(albumName)}`, {headers});
        const result = await res.json();
        if (result.success && result.data) {
            // [投屏顺序修复] 加载时即按显示规则排序，保证播放队列与页面显示一致
            _albumLibCurrentAlbum.songs = sortAlbumSongs(result.data);
            _albumLibCurrentAlbum._loading = false;
            renderAlbumDetailList();
        }
    } catch (err) {
        console.error('[AlbumDetail] Failed to load songs:', err);
    }
}

async function openAlbumDetail(globalIdx) {
    const album = _albumLibData[globalIdx];
    if (!album) return;

    // 从专辑网格直接进入时，清除层层返回上下文（确保返回按钮回到专辑列表）
    _albumLibFromSinger = null;

    // 构建当前专辑对象（歌曲稍后异步加载）
    _albumLibCurrentAlbum = {
        name: album.album,
        singer: album.singer,
        singCount: album.singCount,
        duration: album.duration,
        genre: album.genre,
        year: album.year,
        albumArtist: album.albumArtist,
        source: album.source,
        img: album.img || '',
        songs: [],
        _loading: true
    };

    _updateAlbumDetailUI(album);

    // Show detail, hide grid (先展示详情面板)
    const detailEl = document.getElementById('albumlib-detail');
    const gridEl = document.getElementById('albumlib-grid-view');
    if (detailEl) detailEl.classList.remove('hidden');
    if (gridEl) gridEl.classList.add('hidden');

    // 渲染空歌曲列表（加载中状态）
    renderAlbumDetailList();

    // 异步加载歌曲列表
    await _loadAlbumSongs(album.album);
}

/**
 * 通用专辑详情入口 -- 从任意上下文打开专辑详情
 * @param {Object} albumInfo - { album, singer, singCount, duration, genre, year, albumArtist, source, img }
 */
async function openAlbumByName(albumInfo) {
    if (!albumInfo || !albumInfo.album) return;

    // 保存层层返回上下文 (Capture back-navigation context from singer detail)
    if (window._albumLibFromSinger) {
        _albumLibFromSinger = window._albumLibFromSinger;
        window._albumLibFromSinger = null;
    }

    // 切换到专辑视图 (会触发 closeAlbumDetail 重置状态，将 _albumLibCurrentAlbum 置 null)
    switchTab('albumlib');

    // 等 switchTab 完成 closeAlbumDetail() 后再赋值和显示详情
    await new Promise(r => setTimeout(r, 50));

    // 在 switchTab/closeAlbumDetail 之后再构建专辑对象，避免被置 null
    _albumLibCurrentAlbum = {
        name: albumInfo.album,
        singer: albumInfo.singer || '',
        singCount: albumInfo.singCount || 0,
        duration: albumInfo.duration || 0,
        genre: albumInfo.genre || '',
        year: albumInfo.year || '',
        albumArtist: albumInfo.albumArtist || '',
        source: albumInfo.source || '',
        img: albumInfo.img || '',
        songs: [],
        _loading: true
    };

    _updateAlbumDetailUI(albumInfo);

    // Show detail, hide grid
    const detailEl = document.getElementById('albumlib-detail');
    const gridEl = document.getElementById('albumlib-grid-view');
    if (detailEl) detailEl.classList.remove('hidden');
    if (gridEl) gridEl.classList.add('hidden');

    renderAlbumDetailList();

    // 异步加载歌曲列表
    await _loadAlbumSongs(albumInfo.album);
}

function renderAlbumDetailList() {

    const listEl = document.getElementById('albumlib-detail-list');
    if (!listEl || !_albumLibCurrentAlbum) return;

    // 按光盘号+曲目号排序（复用 sortAlbumSongs，与加载时排序保持一致），保留原始索引
    // 注：_albumLibCurrentAlbum.songs 加载时已排序，此处为保险兜底，确保显示顺序与播放队列一致
    const songs = sortAlbumSongs(_albumLibCurrentAlbum.songs)
        .map((song, originalIndex) => ({...song, _originalIndex: originalIndex}));

    listEl.innerHTML = songs.map((song, displayIndex) => {
        // 音质标签映射 (media-render-shared.js): FLAC→绿, Hi-Res/非常见→金黄, 其它→蓝
        const qualityTag = getQualityTagInfo(song.quality);

        const sizeStr = song.size ? formatFileSize(song.size) : '';
        const durationStr = song.duration ? formatDuration(song.duration) : '--:--';
        // 构造音频元信息标签: sampleRate / bitDepth / bitRate
        const audioMetaParts = [];
        if (song.sampleRate) {
            const sr = song.sampleRate >= 1000 ? (song.sampleRate / 1000).toFixed(1).replace('.0', '') + 'kHz' : song.sampleRate + 'Hz';
            audioMetaParts.push(sr);
        }
        if (song.bitDepth) audioMetaParts.push(song.bitDepth + 'Bit');
        if (song.bitRate) {
            const br = song.bitRate >= 1000 ? (song.bitRate / 1000).toFixed(0) + 'Kbps' : song.bitRate + 'Bps';
            audioMetaParts.push(br);
        }
        const audioMetaStr = audioMetaParts.length ? audioMetaParts.join(' / ') : '';
        const coverUrl = (song.img?.startsWith('http') && song.img) ||
            (song.relativePath && buildCoverUrl(song.relativePath, song.source)) || '';
        const isActive = isCurrentPlayingSong(song);
        const isActuallyPlaying = isActive && typeof audio !== 'undefined' && !audio.paused;
        const pathStr = song.relativePath || '';
        const activeTextClass = isActive ? 'text-emerald-600 dark:text-emerald-400' : '';
        const originalIndex = song._originalIndex;

        // 歌手列 (可点击按歌手搜索)
        const singerHtml = `<div class="hidden md:block md:col-span-2 truncate text-sm ${activeTextClass || 't-text-muted'} cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors" data-truncate-tooltip onclick="event.stopPropagation(); musicLibSearchByField('${escapeJs(song.singer || '')}')" >${escapeHtml(song.singer || 'Unknown')}</div>`;

        // 操作按钮: 编辑 + 删除
        const actionsHtml = `
            <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-400 hover:text-blue-500 transition-all" title="编辑" onclick="event.stopPropagation(); openTagEditor(${originalIndex}, 'album')">
                <i class="fas fa-pen text-[10px]"></i>
            </button>
            <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400 hover:text-red-500 transition-all" title="删除" onclick="event.stopPropagation(); albumDetailDeleteSong(${originalIndex})">
                <i class="fas fa-trash-alt text-[10px]"></i>
            </button>`;

        // 复用通用专辑明细歌曲行 (media-render-shared.js)，与 DLNA 服务保持同一套渲染代码
        return buildSongRowHtml({
            displayIndex: displayIndex + 1,
            title: song.name || 'Unknown',
            coverUrl: coverUrl,
            qualityLabel: qualityTag.label,
            qualityColorClass: qualityTag.colorClass,
            metaStr: audioMetaStr,
            sourceTagHtml: song.source ? getSourceTag(song.source) : '',
            singerHtml: singerHtml,
            durationStr: durationStr,
            sizeStr: sizeStr,
            isActive: isActive,
            isPlaying: isActuallyPlaying,
            onclick: `playAlbumSong(${originalIndex})`,
            tooltipStr: pathStr,
            actionsHtml: actionsHtml
        });
    }).join('');
    window._initTruncateTooltips();
}

function closeAlbumDetail() {
    clearInterval(_albumCoverTimer);
    _albumLibCurrentAlbum = null;
    // 注意：不在此处清空 _albumLibFromSinger
    // switchTab 切换时会调用 closeAlbumDetail()，如果清空会导致层层返回失效
    const detailEl = document.getElementById('albumlib-detail');
    const gridEl = document.getElementById('albumlib-grid-view');
    if (detailEl) detailEl.classList.add('hidden');
    if (gridEl) gridEl.classList.remove('hidden');
}

/**
 * 根据导航上下文返回 (Back navigation: singer detail or album grid)
 * 从歌手详情进入专辑时，返回到歌手详情；否则返回专辑网格
 */
function backToAlbumDetailOrSinger() {
    const ctx = _albumLibFromSinger;
    _albumLibFromSinger = null;

    if (ctx && ctx.singerName) {
        // 返回到歌手详情 (Back to singer detail)
        const detailEl = document.getElementById('albumlib-detail');
        const gridEl = document.getElementById('albumlib-grid-view');
        if (detailEl) detailEl.classList.add('hidden');
        if (gridEl) gridEl.classList.remove('hidden');

        // 切换到歌手视图
        if (typeof switchTab === 'function') {
            switchTab('singerlib');
        }

        // 延迟恢复歌手详情（等 switchTab 结束后）
        setTimeout(() => {
            if (typeof openSingerDetail === 'function') {
                openSingerDetail(
                    ctx.singerName,
                    ctx.avatar || '',
                    ctx.desc || '',
                    ctx.musicCount || 0,
                    ctx.albumCount || 0,
                    ctx.singerId || '',
                    ctx.source || '',
                    ctx.gender || ''
                );
            }
        }, 100);
    } else {
        // 正常返回专辑列表 (Back to album list)
        closeAlbumDetail();
    }
}

// ========== Segment B: 封面轮播 (Album Cover Carousel) ==========

let _albumCoverUrls = [];
let _albumCoverIndex = 0;
let _albumCoverTimer = null;

/**
 * 初始化专辑封面轮播
 * @param {string[]} urls - 所有封面 URL 列表
 * @param {string} source - 来源 (用于 buildCoverUrl)
 */
function initAlbumCoverCarousel(urls, source) {
    clearInterval(_albumCoverTimer);
    _albumCoverUrls = urls.map(url => {
        if (url.startsWith('http')) return url;
        return buildCoverUrl(url, source) || url;
    });
    _albumCoverIndex = 0;

    const carousel = document.getElementById('albumlib-detail-cover-carousel');
    const coverEl = document.getElementById('albumlib-detail-cover');
    const indicators = document.getElementById('albumlib-cover-indicators');
    const prevBtn = document.getElementById('albumlib-cover-prev');
    const nextBtn = document.getElementById('albumlib-cover-next');
    if (!carousel || !coverEl) return;

    if (_albumCoverUrls.length <= 1) {
        // 单张或无图: 静态显示，隐藏控件
        coverEl.src = _albumCoverUrls[0] || '/music/assets/logo.png';
        if (indicators) indicators.classList.add('hidden');
        if (prevBtn) prevBtn.classList.add('hidden');
        if (nextBtn) nextBtn.classList.add('hidden');
        return;
    }

    // 多张: 显示轮播控件
    renderCarouselCover();
    renderCarouselIndicators();
    if (indicators) indicators.classList.remove('hidden');
    if (prevBtn) prevBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.remove('hidden');

    // 自动轮播 (5秒间隔)
    restartCarouselTimer();
}

function restartCarouselTimer() {
    _albumCoverTimer = setInterval(() => {
        _albumCoverIndex = (_albumCoverIndex + 1) % _albumCoverUrls.length;
        renderCarouselCover();
        renderCarouselIndicators();
    }, 5000);
}

function renderCarouselCover() {
    const coverEl = document.getElementById('albumlib-detail-cover');
    if (!coverEl || !_albumCoverUrls.length) return;
    coverEl.src = _albumCoverUrls[_albumCoverIndex];
}

function renderCarouselIndicators() {
    const indicators = document.getElementById('albumlib-cover-indicators');
    if (!indicators) return;
    indicators.innerHTML = _albumCoverUrls.map((_, i) =>
        `<span class="w-1.5 h-1.5 rounded-full transition-colors ${i === _albumCoverIndex ? 'bg-white' : 'bg-white/40'}"></span>`
    ).join('');
}

function albumCoverCarouselPrev() {
    if (!_albumCoverUrls.length) return;
    clearInterval(_albumCoverTimer);
    _albumCoverIndex = (_albumCoverIndex - 1 + _albumCoverUrls.length) % _albumCoverUrls.length;
    renderCarouselCover();
    renderCarouselIndicators();
    restartCarouselTimer();
}

function albumCoverCarouselNext() {
    if (!_albumCoverUrls.length) return;
    clearInterval(_albumCoverTimer);
    _albumCoverIndex = (_albumCoverIndex + 1) % _albumCoverUrls.length;
    renderCarouselCover();
    renderCarouselIndicators();
    restartCarouselTimer();
}

// ========== Segment C: play/delete functions ==========

async function albumDetailDeleteSong(index) {
    if (!_albumLibCurrentAlbum || index < 0 || index >= _albumLibCurrentAlbum.songs.length) return;
    const song = _albumLibCurrentAlbum.songs[index];
    if (!song) return;

    // 显示确认弹窗
    window._showMusicLibBatchDeleteConfirm(
        `确定要删除 "${song.name || 'Unknown'}" 吗？`,
        '此操作不可恢复',
        async () => {
            window._showMusicLibBatchDeleteModal(`正在删除...`, '请稍候');
            try {
                const headers = {'Content-Type': 'application/json'};
                Object.assign(headers, getUserAuthHeaders());
                await fetch('/api/music/cache/remove', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({filenames: [song.relativePath]})
                });
                // Remove from local album data
                _albumLibCurrentAlbum.songs.splice(index, 1);
                // If album is now empty, close detail
                if (!_albumLibCurrentAlbum.songs.length) {
                    closeMusicLibBatchDeleteModal();
                    closeAlbumDetail();
                    loadAlbumLib();
                    return;
                }
                // Refresh the detail view and album grid
                renderAlbumDetailList();
                // Also update the stats header
                const statsEl = document.getElementById('albumlib-detail-stats');
                if (statsEl) {
                    const totalDuration = _albumLibCurrentAlbum.songs.reduce((sum, s) => sum + (s.duration || 0), 0);
                    const durationStr = totalDuration > 0 ? formatDuration(totalDuration) : '';

                    const statsItems = [];
                    statsItems.push(`<span><i class="fas fa-music text-[10px] mr-1"></i>${_albumLibCurrentAlbum.songs.length} 首</span>`);
                    if (durationStr) {
                        statsItems.push(`<span><i class="fas fa-clock text-[10px] mr-1"></i>${durationStr}</span>`);
                    }

                    const pubYear = _albumLibCurrentAlbum.pub_year || _albumLibCurrentAlbum.year || _albumLibCurrentAlbum.release_year;
                    if (pubYear) {
                        statsItems.push(`<span><i class="fas fa-calendar text-[10px] mr-1"></i>${pubYear}</span>`);
                    }

                    const genre = _albumLibCurrentAlbum.genre || _albumLibCurrentAlbum.style || _albumLibCurrentAlbum.mood;
                    if (genre) {
                        statsItems.push(`<span><i class="fas fa-tag text-[10px] mr-1"></i>${genre}</span>`);
                    }

                    const label = _albumLibCurrentAlbum.label || _albumLibCurrentAlbum.company || _albumLibCurrentAlbum.publisher;
                    if (label) {
                        statsItems.push(`<span><i class="fas fa-building text-[10px] mr-1"></i>${label}</span>`);
                    }

                    statsEl.innerHTML = statsItems.join('');
                }
                loadAlbumLib(); // Refresh album grid in background
                window._showMusicLibBatchDeleteResult('删除完成', `已成功删除 "${song.name || 'Unknown'}"`);
            } catch (err) {
                console.error('[AlbumDetail] Delete failed:', err);
                window._showMusicLibBatchDeleteResult('删除失败', err.message || '未知错误', true);
            }
        }
    );
}

function playAlbumSong(index) {
    if (!_albumLibCurrentAlbum || index < 0 || index >= _albumLibCurrentAlbum.songs.length) return;
    const songs = _albumLibCurrentAlbum.songs;
    const cachedSong = songs[index];

    const song = {
        id: cachedSong.id || `cache_${index}`,
        name: cachedSong.name || 'Unknown',
        singer: cachedSong.singer || 'Unknown',
        album: cachedSong.album || '',
        source: cachedSong.source || '',
        quality: cachedSong.quality || '',
        ext: cachedSong.ext || '',
        hasCover: cachedSong.hasCover || false,
        relativePath: cachedSong.relativePath || '',
        duration: cachedSong.duration || 0,
        size: cachedSong.size || 0,
        sampleRate: cachedSong.sampleRate || null,
        bitDepth: cachedSong.bitDepth || null,
        channels: cachedSong.channels || null,
        bitRate: cachedSong.bitRate || null,
        _serverCachePath: cachedSong.relativePath,
        _isMusicLibSong: true,
        _isFromAlbumLib: true,
    };

    // Set playlist to album songs
    // [ML-06 优化] 使用浅拷贝+标记，避免创建大量新的对象
    currentPlaylist = songs.map((s, i) => {
        s._serverCachePath = s.relativePath;
        s._isMusicLibSong = true;
        s._isFromAlbumLib = true;
        return s;
    });

    // Track which album is playing (for auto-advance to next album in order mode)
    _currentAlbumIndex = _albumLibData.findIndex(a => a.album === (_albumLibCurrentAlbum ? _albumLibCurrentAlbum.name : ''));
    currentPlayingScope = 'album';

    if (playMode === 'random') resetShuffleState(index);

    // [DLNA] 同步歌单到后端 DMC（新歌单，立即播放）
    // 前端操作：专辑列表点击播放单曲
    syncPlaylistToDmc(currentPlaylist, index, true);
    // [AirPlay DMC] 同步歌单到 AirPlay DMC
    syncPlaylistToAirPlay(currentPlaylist, index, true);

    // [DLNA/AirPlay Fix] 投屏模式下，syncPlaylist(playImmediately=true) 已经让 DMC 开始播放
    // 不要再调用 playSong()，否则会触发 /api/music/url 导致重复请求
    if (_castDeviceType !== 'upnp' && _castDeviceType !== 'airplay') {
        playSong(song, index, null, false, false, true);
    }
    renderAlbumDetailList(); // Update active highlight
}

function playAllAlbumSongs() {
    if (!_albumLibCurrentAlbum || !_albumLibCurrentAlbum.songs.length) return;
    const songs = _albumLibCurrentAlbum.songs;

    // [ML-06 优化] 使用浅拷贝+标记，避免创建大量新的对象
    currentPlaylist = songs.map((s, i) => {
        s._serverCachePath = s.relativePath;
        s._isMusicLibSong = true;
        s._isFromAlbumLib = true;
        return s;
    });

    // Track which album is playing (for auto-advance to next album in order mode)
    _currentAlbumIndex = _albumLibData.findIndex(a => a.album === (_albumLibCurrentAlbum ? _albumLibCurrentAlbum.name : ''));
    currentPlayingScope = 'album';

    if (playMode === 'random') resetShuffleState(0);

    // [DLNA] 同步歌单到后端 DMC（新歌单，立即播放）
    // 前端操作：专辑播放全部
    syncPlaylistToDmc(currentPlaylist, 0, true);
    // [AirPlay DMC] 同步歌单到 AirPlay DMC
    syncPlaylistToAirPlay(currentPlaylist, 0, true);

    // [DLNA/AirPlay Fix] 投屏模式下，syncPlaylist(playImmediately=true) 已经让 DMC 开始播放
    // 不要再调用 playSong()，否则会触发 /api/music/url 导致重复请求
    if (_castDeviceType !== 'upnp' && _castDeviceType !== 'airplay') {
        playSong(currentPlaylist[0], 0, null, false, false, true);
    }
    renderAlbumDetailList();
}

async function playAlbumAll(globalIdx) {
    const album = _albumLibData[globalIdx];
    if (!album) return;

    // 如果已有缓存的歌曲列表，直接用
    if (_albumLibCurrentAlbum && _albumLibCurrentAlbum.name === album.album && _albumLibCurrentAlbum.songs.length > 0 && !_albumLibCurrentAlbum._loading) {
        doPlayAlbumSongs(_albumLibCurrentAlbum.songs, globalIdx);
        return;
    }

    // 否则按需加载歌曲列表
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`/api/music/cache/list?album=${encodeURIComponent(album.album)}`, {headers});
        const result = await res.json();
        if (result.success && result.data && result.data.length > 0) {
            // [投屏顺序修复] 加载时即按显示规则排序，保证播放队列与页面显示一致
            const sortedSongs = sortAlbumSongs(result.data);
            _albumLibCurrentAlbum = {
                name: album.album,
                singer: album.singer,
                singCount: album.singCount,
                img: album.img || '',
                songs: sortedSongs,
                _loading: false
            };
            doPlayAlbumSongs(sortedSongs, globalIdx);
        }
    } catch (err) {
        console.error('[AlbumLib] Failed to load album songs for playback:', err);
    }
}

function doPlayAlbumSongs(songs, globalIdx) {
    _albumLibCurrentAlbum = _albumLibCurrentAlbum || {songs: []};

    // [ML-06 优化] 使用浅拷贝+标记，避免创建大量新的对象
    currentPlaylist = songs.map((s, i) => {
        s._serverCachePath = s.relativePath;
        s._isMusicLibSong = true;
        s._isFromAlbumLib = true;
        return s;
    });

    // Track which album is playing (for auto-advance to next album in order mode)
    _currentAlbumIndex = globalIdx;
    currentPlayingScope = 'album';

    if (playMode === 'random') resetShuffleState(0);

    // [DLNA] 同步歌单到后端 DMC（新歌单，立即播放）
    // 前端操作：专辑列表点击播放全部
    syncPlaylistToDmc(currentPlaylist, 0, true);
    // [AirPlay DMC] 同步歌单到 AirPlay DMC
    syncPlaylistToAirPlay(currentPlaylist, 0, true);

    // [DLNA/AirPlay Fix] 投屏模式下，syncPlaylist(playImmediately=true) 已经让 DMC 开始播放
    // 不要再调用 playSong()，否则会触发 /api/music/url 导致重复请求
    if (_castDeviceType !== 'upnp' && _castDeviceType !== 'airplay') {
        playSong(currentPlaylist[0], 0, null, false, false, true);
    }
}

// ========== Window exports ==========
window.handleMusicLibClick = handleMusicLibClick;
window.loadAlbumLib = loadAlbumLib;
window.filterAlbumLib = filterAlbumLib;
window.sortAndRenderAlbumLib = sortAndRenderAlbumLib;
window.toggleAlbumSortOrder = toggleAlbumSortOrder;
window.albumLibPrevPage = albumLibPrevPage;
window.albumLibNextPage = albumLibNextPage;
window.albumLibGoToPage = albumLibGoToPage;
window.albumLibChangePageSize = albumLibChangePageSize;
window.openAlbumDetail = openAlbumDetail;
window.openAlbumByName = openAlbumByName;
window.closeAlbumDetail = closeAlbumDetail;
window.backToAlbumDetailOrSinger = backToAlbumDetailOrSinger;
window.playAlbumSong = playAlbumSong;
window.playAllAlbumSongs = playAllAlbumSongs;
window.playAlbumAll = playAlbumAll;
window.albumDetailDeleteSong = albumDetailDeleteSong;
window.albumCoverCarouselPrev = albumCoverCarouselPrev;
window.albumCoverCarouselNext = albumCoverCarouselNext;

// Expose local variables for cross-module access (using defineProperty for live sync)
Object.defineProperty(window, '_albumLibCurrentAlbum', { get() { return _albumLibCurrentAlbum; }, set(v) { _albumLibCurrentAlbum = v; }, configurable: true });
Object.defineProperty(window, '_albumLibData', { get() { return _albumLibData; }, set(v) { _albumLibData = v; }, configurable: true });
Object.defineProperty(window, '_currentAlbumIndex', { get() { return _currentAlbumIndex; }, set(v) { _currentAlbumIndex = v; }, configurable: true });
window.renderAlbumDetailList = renderAlbumDetailList;
