// ========== Search - 搜索功能 ==========
// 负责音乐搜索、结果渲染、搜索建议、下载状态查询。
// 依赖全局: playSong, renderQueue, toggleLove, renderMyLists, settings, ListSearch
// ==================================================

// --- 搜索状态 (从 app.js 迁移) ---
let currentPage = 1;
let currentSearch = {name: '', source: 'kw'};
// 歌手详情页"热门歌曲"Tab 独立分页页码（与搜索 currentPage 解耦）
let _singerSongsPage = 1;
window.viewingPlaylist = [];
window.currentSearchScope = 'network';
window.batchCollectSongs = null;

// --- Segment A: 搜索功能 (原 app.js L807-L2390) ---

// Search Logic
function handleSearchKeyPress(e) {
    if (e.key === 'Enter') {
        if (typeof hideSearchSuggestions === 'function') hideSearchSuggestions();
        doSearch();
    }
}

/**
 * 快速跳转到搜索页并执行查询
 * @param {string} query 搜索关键词
 * @param {string} source 可选，切换到指定搜索源
 */
function performSearch(query, source = null) {
    if (!query || query === '暂无播放' || query === '选择一首歌曲播放') return;

    // 预处理：移除括号及其内容 (支持中英文括号)，通常用于移除"歌曲名 (DJ版)"中的补充信息
    let cleanedQuery = query.replace(/\s*[\(\uff08].*?[\)\uff09]\s*/g, ' ').trim();
    // 避免因为移除内容导致的连续多余空格
    cleanedQuery = cleanedQuery.replace(/\s+/g, ' ');

    // 切换到搜索页
    window.switchTab('search');

    // 如果指定了源且属于支持的源，则更新选择框
    const sourceEl = document.getElementById('search-source');
    const validSources = ['kw', 'kg', 'tx', 'wy', 'mg'];
    if (source && sourceEl && validSources.includes(source)) {
        sourceEl.value = source;
    }

    // 重置搜索范围到全网搜索
    if (typeof currentSearchScope !== 'undefined') {
        currentSearchScope = 'network';
    }

    // 设置搜索框内容
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = cleanedQuery || query; // 如果清理后为空，回退到原查询
        // 触发搜索
        doSearch();
    }
}

window.performSearch = performSearch;

const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'];

// ==================== 搜索类型选择器 (Search Type Selector) ====================

/** 获取当前搜索类型 (song/album/singer)，非 TX/WY 源始终返回 song */
function getSearchType() {
    const source = document.getElementById('search-source')?.value;
    if (source !== 'tx' && source !== 'wy') return 'song';
    const el = document.getElementById('search-type');
    return (el && !el.classList.contains('hidden')) ? (el.value || 'song') : 'song';
}

/** 根据当前源更新搜索类型下拉框的可见性 */
function updateSearchTypeVisibility() {
    const source = document.getElementById('search-source')?.value;
    const el = document.getElementById('search-type');
    if (!el) return;
    if (source === 'tx' || source === 'wy') {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
        el.value = 'song';
    }
}

/** 搜索类型切换时回调 */
function onSearchTypeChange() {
    const input = document.getElementById('search-input')?.value.trim();
    if (input) {
        currentPage = 1;
        doSearch();
    }
}

/** 音源切换时回调 (联动搜索类型可见性 + 重新搜索) */
function onSearchSourceChange() {
    updateSearchTypeVisibility();
    doSearch();
}

window.getSearchType = getSearchType;
window.updateSearchTypeVisibility = updateSearchTypeVisibility;
window.onSearchTypeChange = onSearchTypeChange;
window.onSearchSourceChange = onSearchSourceChange;


//搜索歌曲
async function doSearch(page = 1, append = false) {
    // 触发搜索时隐藏联想词
    if (typeof hideSearchSuggestions === 'function') hideSearchSuggestions();

    // 只有在开启全新搜索（第一页且非追加模式）时才重置局部过滤状态
    if (window.ListSearch && page === 1 && !append) window.ListSearch.resetState();

    // 全新搜索时，清除之前其他视图残留的选中状态
    if (page === 1 && !append && window.selectedItems && window.selectedItems.size > 0) {
        window.selectedItems.clear();
        window.selectedSongObjects.clear();
        if (typeof updateBatchToolbar === 'function') updateBatchToolbar();
    }

    const input = document.getElementById('search-input').value.trim();
    const resultsContainer = document.getElementById('search-results');

    // Local Search Logic
    if (currentSearchScope === 'local_list' || currentSearchScope === 'local_all') {
        if (!input) {
            renderResults(viewingPlaylist);
            return;
        }

        let targets = [];
        if (currentSearchScope === 'local_list') {
            // 从当前正在查看的列表中搜索，而不是播放列表
            const listId = window.currentViewingListId || 'default';
            if (window.currentListData) {
                if (listId === 'default') targets = window.currentListData.defaultList;
                else if (listId === 'love') targets = window.currentListData.loveList;
                else {
                    const uList = window.currentListData.userList.find(l => l.id === listId);
                    if (uList) targets = uList.list;
                }
            }
        } else {
            // Aggregate all local
            if (window.currentListData) {
                targets = [
                    ...(window.currentListData.defaultList || []),
                    ...(window.currentListData.loveList || []),
                    ...(window.currentListData.userList || []).flatMap(l => l.list)
                ];
            }
        }

        const lower = input.toLowerCase();
        const filtered = targets.filter(item =>
            (item.name && item.name.toLowerCase().includes(lower)) ||
            (item.singer && item.singer.toLowerCase().includes(lower)) ||
            (item.albumName && item.albumName.toLowerCase().includes(lower)) ||
            (item.album && typeof item.album === 'string' && item.album.toLowerCase().includes(lower)) ||
            (item.album && item.album.name && item.album.name.toLowerCase().includes(lower))
        );
        renderResults(filtered);
        return;
    }

    // Network Search Logic
    const source = document.getElementById('search-source').value;
    if (!input) {
        showInitialSearchState();
        return;
    }

    if (!append) {
        currentSearch = {name: input, source};
        currentPage = page;  // 用实际页码赋值，而非硬编码1，保证返回搜索时页码正确
        window.currentNetworkPage = page;
        resultsContainer.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';
    } else {
        window.currentNetworkPage = page;
    }

    try {
        const headers = {};
        if (typeof authToken !== 'undefined' && authToken) headers['x-user-token'] = authToken;
        Object.assign(headers, getUserAuthHeaders());

        let list = [];
        if (source === 'all') {
            // Aggregate Search
            const pageInfoEl = document.getElementById('page-info');
            if (pageInfoEl) pageInfoEl.innerText = `聚合搜索 (前20条/源)`;

            const promises = SOURCES.map(s =>
                fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${s}&page=1`, {headers})
                    .then(res => res.json())
                    .then(data => data.map(item => ({...item, source: s})))
                    .catch(e => {
                        console.warn(`[聚合搜索] ${s} 源失败:`, e);
                        return [];
                    })
            );
            const results = await Promise.all(promises);
            list = results.flat();
        } else {
            // Single Source Search
            const searchType = getSearchType();
            const res = await fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${source}&page=${page}&type=${searchType}`, {headers});

            if (!res.ok) {
                throw new Error(`搜索请求失败: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();

            // 专辑/歌手搜索: 后端返回对象格式 { list, total, allPage, type }
            if (searchType === 'album' || searchType === 'singer') {
                if (data.error) throw new Error(data.error);
                const resultList = (data.list || []).map(item => ({...item, source}));
                const pageInfoEl = document.getElementById('page-info');
                if (pageInfoEl && !append) pageInfoEl.innerText = `第 ${page} 页`;
                if (searchType === 'album') {
                    renderSearchAlbumResults(resultList, data.total, data.allPage, page);
                } else {
                    renderSearchSingerResults(resultList, data.total, data.allPage, page);
                }
                return;
            }

            // 歌曲搜索: 后端返回纯数组
            if (!Array.isArray(data)) {
                console.error('[Search] 后端返回非数组数据:', data);
                throw new Error(data.error || data.message || '搜索返回的数据格式错误');
            }

            list = data.map(item => ({...item, source}));

            const pageInfoEl = document.getElementById('page-info');
            if (pageInfoEl && !append) pageInfoEl.innerText = `第 ${page} 页`;
        }

        if (append) {
            // [Fix] Ensure each new song has unique ID
            if (list && list.length > 0) {
                list.forEach((item, idx) => {
                    if (!item.id || item.id === 'undefined') {
                        item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `temp_${Date.now()}_${idx}_append`;
                    }
                });
            }
            const existingIds = new Set((window.viewingPlaylist || []).map(item => String(item.id)));
            const newItems = list.filter(item => !existingIds.has(String(item.id)));

            if (newItems.length > 0) {
                const combinedList = [...(window.viewingPlaylist || []), ...newItems];
                currentPage++;
                renderResults(combinedList);
            } else {
                try {
                    showError('没有更多搜索结果了');
                } catch (err) {
                    showInfo('没有更多搜索结果了');
                }
            }
        } else {
            renderResults(list);
        }
    } catch (e) {
        console.error('[Search] 搜索失败:', e);
        if (append) {
            try {
                showError(`搜索追加出错: ${e.message}`);
            } catch (err) {
                showError(`搜索追加出错: ${e.message}`);
            }
        } else {
            resultsContainer.innerHTML = `<div class="text-center text-red-500 p-8">搜索出错: ${e.message}</div>`;
        }
    }
}

// ==================== 搜索结果卡片渲染 (Search Card Rendering) ====================

/** 渲染专辑搜索结果卡片网格 */
function renderSearchAlbumResults(albums, total, allPage, page) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const batchToolbar = document.getElementById('batch-toolbar');
    const pagination = document.getElementById('search-pagination');
    if (header) header.classList.add('hidden');
    if (batchToolbar) batchToolbar.classList.add('hidden');
    if (pagination) pagination.classList.remove('hidden');

    window.viewingPlaylist = [];

    if (!albums || albums.length === 0) {
        container.innerHTML = '<div class="text-center t-text-muted p-8">未找到相关专辑</div>';
        updateSearchPaginationInfo(0, 0, 0);
        return;
    }

    const sourceLabels = {tx: 'QQ音乐', wy: '网易云'};

    container.innerHTML = `
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 p-4">
            ${albums.map((album, idx) => {
        const img = album.picUrl || album.img || '/music/assets/logo.png';
        const singerName = album.artistName || album.singer || '';
        return `
                <div class="group cursor-pointer" onclick="openOnlineAlbumDetail('${escapeJs(album.id)}', '${escapeJs(album.source)}', {name:'${escapeJs(album.name || '')}', singer:'${escapeJs(singerName)}', img:'${escapeJs(img)}'})">
                    <div class="relative aspect-square overflow-hidden rounded-2xl shadow-md transition-all group-hover:shadow-xl group-hover:-translate-y-1">
                        <img src="${escapeHtml(img)}" alt="" loading="lazy"
                             class="w-full h-full object-cover dynamic-logo is-placeholder"
                             onload="this.classList.remove('is-placeholder')"
                             onerror="this.src='/music/assets/logo.png'; this.classList.add('is-placeholder');">
                        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div class="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-300">
                                <i class="fas fa-compact-disc ml-0"></i>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3">
                        <h3 class="text-sm font-bold t-text-main line-clamp-2 leading-snug group-hover:text-emerald-500 transition-colors" title="${escapeHtml(album.name)}">${escapeHtml(album.name)}</h3>
                        <p class="text-xs t-text-muted mt-1 truncate">${escapeHtml(singerName)}</p>
                        <div class="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400 font-medium">
                            ${album.size || album.count ? `<span><i class="fas fa-music text-[10px] mr-1"></i>${album.size || album.count}</span>` : ''}
                            ${album.publishTime ? `<span>${escapeHtml(album.publishTime)}</span>` : ''}
                        </div>
                    </div>
                </div>`;
    }).join('')}
        </div>
    `;

    updateSearchPaginationInfo(total, allPage, page);
}

/** 渲染歌手搜索结果卡片网格 */
function renderSearchSingerResults(singers, total, allPage, page) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const batchToolbar = document.getElementById('batch-toolbar');
    const pagination = document.getElementById('search-pagination');
    if (header) header.classList.add('hidden');
    if (batchToolbar) batchToolbar.classList.add('hidden');
    if (pagination) pagination.classList.remove('hidden');

    window.viewingPlaylist = [];

    if (!singers || singers.length === 0) {
        container.innerHTML = '<div class="text-center t-text-muted p-8">未找到相关歌手</div>';
        updateSearchPaginationInfo(0, 0, 0);
        return;
    }

    container.innerHTML = `
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 p-4">
            ${singers.map(singer => {
        const avatar = singer.picUrl || '/music/assets/logo.png';
        return `
                <div class="group cursor-pointer" onclick="openOnlineSingerDetail('${escapeJs(singer.id)}', '${escapeJs(singer.name)}', '${escapeJs(singer.source)}')">
                    <div class="relative aspect-square overflow-hidden rounded-full shadow-md transition-all group-hover:shadow-xl group-hover:-translate-y-1 mx-4">
                        <img src="${escapeHtml(avatar)}" alt="" loading="lazy"
                             class="w-full h-full object-cover dynamic-logo is-placeholder"
                             onload="this.classList.remove('is-placeholder')"
                             onerror="this.src='/music/assets/logo.png'; this.classList.add('is-placeholder');">
                        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div class="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-300">
                                <i class="fas fa-user ml-0"></i>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 text-center">
                        <h3 class="text-sm font-bold t-text-main line-clamp-2 leading-snug group-hover:text-emerald-500 transition-colors" title="${escapeHtml(singer.name)}">${escapeHtml(singer.name)}</h3>
                        <div class="flex items-center justify-center gap-3 mt-1.5 text-[11px] text-gray-400 font-medium">
                            ${singer.musicCount ? `<span><i class="fas fa-music text-[10px] mr-1"></i>${singer.musicCount}</span>` : ''}
                            ${singer.albumCount ? `<span><i class="fas fa-compact-disc text-[10px] mr-1"></i>${singer.albumCount}</span>` : ''}
                        </div>
                    </div>
                </div>`;
    }).join('')}
        </div>
    `;

    updateSearchPaginationInfo(total, allPage, page);
}

/** 更新搜索分页信息显示 */
function updateSearchPaginationInfo(total, allPage, page) {
    const paginationEl = document.getElementById('search-pagination');
    const pageInfoEl = document.getElementById('pagination-info');
    if (paginationEl) {
        if (total > 0) {
            paginationEl.classList.remove('hidden');
        } else {
            paginationEl.classList.add('hidden');
        }
    }
    if (pageInfoEl) {
        pageInfoEl.innerText = total > 0 ? `第 ${page} / ${allPage} 页 (共 ${total} 条)` : '';
    }
}


// ==================== 详情钻取 (Detail Drill-down) ====================

/** 打开在线专辑详情 (加载专辑歌曲并显示) */
async function openOnlineAlbumDetail(albumId, source, albumMeta, fromSinger = false) {
    if (!albumId) return;
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const batchToolbar = document.getElementById('batch-toolbar');
    const pagination = document.getElementById('search-pagination');

    // 保存钻取状态（仅从专辑搜索进入时覆盖；从歌手明细进入时保留歌手的搜索状态，供层层返回）
    if (!fromSinger) {
        window._searchDrillState = {
            type: 'album',
            keyword: document.getElementById('search-input')?.value.trim() || '',
            source: document.getElementById('search-source')?.value || '',
            searchType: getSearchType(),
            page: currentPage,  // 保存当前搜索页码，返回时恢复
        };
    }

    container.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';
    if (header) header.classList.add('hidden');
    if (batchToolbar) batchToolbar.classList.add('hidden');
    if (pagination) pagination.classList.add('hidden');

    try {
        const headers = {};
        if (typeof authToken !== 'undefined' && authToken) headers['x-user-token'] = authToken;
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`${API_BASE}/albumSongs?id=${encodeURIComponent(albumId)}&source=${source}`, {headers});
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const songs = data.list || [];
        const info = albumMeta || {name: data.name || '未知专辑', singer: 'Unknown', img: '/music/assets/logo.png'};

        // 设置播放列表
        window.viewingPlaylist = songs.map(s => ({...s, source}));

        // 清除搜索页 renderResults 遗留的防抖定时器，防止模板被清空
        clearTimeout(window._dbStatusFetchTimer);

        // 渲染专辑信息条 + 歌曲列表
        // 先清理旧的专辑信息条（防止重复调用时叠加）
        document.getElementById('album-online-detail-info')?.remove();

        // 清空 search-results 容器
        container.innerHTML = '';

        // 创建独立的专辑信息条，插入到 search-results-header 上方
        const albumInfoDiv = document.createElement('div');
        albumInfoDiv.id = 'album-online-detail-info';
        albumInfoDiv.innerHTML = `
            <div class="p-4 border-b t-border-main">
                <button onclick="${fromSinger ? 'backToSingerDetail()' : 'backToSearchResults()'}" class="text-emerald-600 hover:text-emerald-700 text-base mb-3 py-1 px-1 inline-flex items-center gap-1.5">
                    <i class="fas fa-arrow-left text-lg font-bold"></i><span>${fromSinger ? '返回歌手详情' : '返回搜索结果'}</span>
                </button>
                <hr class="border-t t-border-main mb-3">
                <div class="flex items-center gap-4">
                    <img src="${info.img || '/music/assets/logo.png'}" class="w-20 h-20 rounded-xl object-cover shadow-md"
                         onerror="this.src='/music/assets/logo.png'">
                    <div>
                        <h2 class="text-lg font-bold t-text-main">${escapeHtml(info.name || '未知专辑')}</h2>
                        <p class="text-sm t-text-muted mt-1">${escapeHtml(info.singer || 'Unknown')}</p>
                        <p class="text-xs t-text-muted mt-1"><i class="fas fa-music mr-1"></i>${songs.length} 首歌曲</p>
                    </div>
                </div>
            </div>
        `;
        header.parentNode.insertBefore(albumInfoDiv, header);

        // 渲染歌曲列表
        const listContainer = document.createElement('div');
        listContainer.id = 'album-songs-list';
        container.appendChild(listContainer);

        // 临时替换 search-results 来复用 renderResults
        const origContainer = document.getElementById('search-results');
        const tempId = origContainer.id;
        origContainer.id = 'search-results-temp';
        listContainer.id = 'search-results';
        if (header) header.classList.remove('hidden');
        if (batchToolbar && window.batchMode) batchToolbar.classList.remove('hidden');
        renderResults(songs, {skipDbStatusFetch: true});
        // renderResults 会覆盖 viewingPlaylist 并丢失 source，需要恢复
        window.viewingPlaylist = songs.map(s => ({...s, source}));
        listContainer.id = tempId;
        origContainer.id = 'search-results';
        // 把歌曲列表移回原容器内
        origContainer.appendChild(listContainer);
        // renderResults 会显示 pagination，专辑详情页不需要分页
        // 改用 classList.add('hidden') 替代内联 display='none'，避免返回搜索页后内联样式残留导致分页栏不可见
        if (pagination) pagination.classList.add('hidden');
        clearTimeout(window._dbStatusFetchTimer);

    } catch (err) {
        console.error('[AlbumDetail] Error:', err);
        container.innerHTML = `<div class="text-center text-red-500 p-8">${escapeHtml(err.message)}</div>`;
    }
}

/** 打开在线歌手详情 (专辑列表 + 热门歌曲) */
async function openOnlineSingerDetail(singerId, singerName, source) {
    if (!singerId) return;
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const batchToolbar = document.getElementById('batch-toolbar');
    const pagination = document.getElementById('search-pagination');

    // 保存钻取状态
    window._searchDrillState = {
        type: 'singer',
        keyword: document.getElementById('search-input')?.value.trim() || '',
        source: document.getElementById('search-source')?.value || '',
        searchType: getSearchType(),
        page: currentPage,  // 保存当前搜索页码，返回时恢复
    };
    window._onlineSingerState = {singerId, singerName, source};

    container.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';
    if (header) header.classList.add('hidden');
    if (batchToolbar) batchToolbar.classList.add('hidden');
    if (pagination) pagination.classList.add('hidden');

    try {
        const headers = {};
        if (typeof authToken !== 'undefined' && authToken) headers['x-user-token'] = authToken;
        Object.assign(headers, getUserAuthHeaders());

        // 3 个并行请求：歌手信息、专辑列表、热门歌曲
        const [artistDetailRes, artistAlbumsRes, artistSongsRes] = await Promise.allSettled([
            fetch(`${API_BASE}/artistDetail?id=${encodeURIComponent(singerId)}&source=${source}`, {headers}).then(r => r.json()),
            fetch(`${API_BASE}/artistAlbums?id=${encodeURIComponent(singerId)}&source=${source}&page=1`, {headers}).then(r => r.json()),
            fetch(`${API_BASE}/artistSongs?id=${encodeURIComponent(singerId)}&source=${source}&order=hot`, {headers}).then(r => r.json()),
        ]);

        const artistInfo = (artistDetailRes.status === 'fulfilled') ? artistDetailRes.value : {};
        if (artistInfo.error) throw new Error(artistInfo.error);

        const albumsData = (artistAlbumsRes.status === 'fulfilled') ? artistAlbumsRes.value : {};
        const albums = albumsData.list || [];
        const albumTotal = albumsData.total || albums.length;

        const songs = (artistSongsRes.status === 'fulfilled' && Array.isArray(artistSongsRes.value))
            ? artistSongsRes.value : [];
        const songTotal = songs.length;

        // 更新歌手状态（包含 songs 供 renderSingerSongs 使用）
        window._onlineSingerState.songs = songs;
        // 缓存含 source 的全量列表（renderSingerSongs 传给 renderResults，播放队列=全量，跨页续播）
        window._onlineSingerState.songsWithSource = songs.map(s => ({...s, source}));
        // 进入歌手详情重置热门歌曲分页页码
        _singerSongsPage = 1;

        // 设置歌曲播放列表
        window.viewingPlaylist = songs.map(s => ({...s, source}));

        const hasAlbums = albumTotal > 0;
        const hasSongs = songTotal > 0;

        // 默认激活哪个 Tab
        window._singerActiveTab = hasAlbums ? 'albums' : 'songs';

        // 调试: 打印歌手 API 返回的信息，方便排查头像/简介不显示问题
        // console.log('[SingerDetail] artistInfo:', artistInfo, 'albums:', albumTotal, 'songs:', songTotal);

        const avatarSrc = artistInfo.avatar || '/music/assets/logo.png';

        // 清除搜索页 renderResults 遗留的防抖定时器
        // 防止旧的 fetchCurrentPlaylistDbStatus 回调触发重渲染，把歌手详情模板清空
        clearTimeout(window._dbStatusFetchTimer);

        container.innerHTML = `
            <div class="p-4 border-b t-border-main">
                <button onclick="backToSearchResults()" class="text-emerald-600 hover:text-emerald-700 text-sm mb-3">
                    <i class="fas fa-arrow-left mr-1"></i>返回搜索结果
                </button>
                <div class="flex items-start gap-4">
                    <div class="w-20 h-20 rounded-full overflow-hidden shadow-md flex-shrink-0 bg-gray-200 dark:bg-gray-700">
                        <img src="${avatarSrc}" class="w-full h-full object-cover"
                             onerror="if(this.src!=='${window.location.origin}/music/assets/logo.png'){this.src='/music/assets/logo.png'}">
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h2 class="text-lg font-bold t-text-main">${escapeHtml(singerName)}</h2>
                        </div>
                        <p class="text-xs t-text-muted mt-1"><i class="fas fa-music mr-1"></i>${artistInfo.musicSize || 0} 首歌曲 · <i class="fas fa-compact-disc mr-1"></i>${artistInfo.albumSize || 0} 张专辑</p>
                        ${artistInfo.desc ? `<p class="text-xs t-text-muted mt-2 line-clamp-3 leading-relaxed" title="${escapeHtml(artistInfo.desc)}">${escapeHtml(artistInfo.desc)}</p>` : ''}
                    </div>
                </div>
            </div>
            <!-- 专辑 / 热门歌曲 Tab 切换 -->
            <div class="flex border-b t-border-main sticky top-0 z-10 t-bg-main">
                ${hasAlbums ? `<button id="singer-tab-albums" onclick="switchSingerTab('albums')"
                    class="flex-1 py-2.5 text-sm font-medium text-center transition-colors ${window._singerActiveTab === 'albums' ? 'text-emerald-600 border-b-2 border-emerald-500' : 't-text-muted hover:t-text-main'}">
                    <i class="fas fa-compact-disc mr-1"></i>专辑 (${albumTotal})
                </button>` : ''}
                ${hasSongs ? `<button id="singer-tab-songs" onclick="switchSingerTab('songs')"
                    class="flex-1 py-2.5 text-sm font-medium text-center transition-colors ${window._singerActiveTab === 'songs' ? 'text-emerald-600 border-b-2 border-emerald-500' : 't-text-muted hover:t-text-main'}">
                    <i class="fas fa-music mr-1"></i>热门歌曲 (${songTotal})
                </button>` : ''}
            </div>
            <!-- 专辑 Tab 内容 -->
            <div id="singer-albums-panel" style="${window._singerActiveTab === 'albums' ? '' : 'display:none'}">
                ${hasAlbums ? `
                <div class="p-4">
                    <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                        ${albums.map(album => {
            const albumImg = album.img || '/music/assets/logo.png';
            const albumName = album.name || '未知专辑';
            const albumAuthor = album.singer || singerName;
            return `
                            <div class="group cursor-pointer" onclick="openOnlineAlbumDetail('${escapeJs(album.id)}', '${escapeJs(source)}', {name:'${escapeJs(albumName)}', singer:'${escapeJs(albumAuthor)}', img:'${escapeJs(albumImg)}'}, true)">
                                <div class="relative aspect-square overflow-hidden rounded-xl shadow-sm transition-all group-hover:shadow-md group-hover:-translate-y-0.5">
                                    <img src="${albumImg}" alt="${escapeHtml(albumName)}" loading="lazy"
                                         class="w-full h-full object-cover dynamic-logo is-placeholder"
                                         onload="this.classList.remove('is-placeholder')"
                                         onerror="this.src='/music/assets/logo.png'; this.classList.add('is-placeholder');">
                                </div>
                                <p class="text-xs font-medium t-text-main mt-1.5 line-clamp-1" title="${escapeHtml(albumName)}">${escapeHtml(albumName)}</p>
                                <p class="text-[10px] t-text-muted truncate">${escapeHtml(albumAuthor)}</p>
                            </div>`;
        }).join('')}
                    </div>
                </div>` : '<div class="text-center t-text-muted p-8">暂无专辑数据</div>'}
            </div>
            <!-- 热门歌曲 Tab 内容 -->
            <div id="singer-songs-panel" style="${window._singerActiveTab === 'songs' ? '' : 'display:none'}">
                <!-- 嵌入式批量工具栏 (克隆自页面级 #batch-toolbar) -->
                <div id="singer-songs-batch-toolbar" class="hidden bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800 p-3 flex items-center justify-between">
                    ${document.getElementById('batch-toolbar').innerHTML}
                </div>
                <!-- 嵌入式表头 (克隆自页面级 #search-results-header) -->
                <div id="singer-songs-header" class="hidden grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-4 border-b t-border-main t-bg-main text-gray-500 text-sm font-medium">
                    ${document.getElementById('search-results-header').innerHTML}
                </div>
                <div id="singer-songs-list"></div>
                <!-- 热门歌曲独立分页控件 (Singer Songs Pagination) -->
                <div id="singer-songs-pagination" class="hidden h-12 border-t t-border-main flex items-center justify-between px-6 t-bg-main">
                    <button onclick="changeSingerSongsPage(-1)" class="text-gray-500 hover:text-emerald-600 disabled:opacity-30 transition-colors">
                        <i class="fas fa-chevron-left"></i> 上一页
                    </button>
                    <span id="singer-songs-pagination-info" class="text-xs t-text-muted font-mono"></span>
                    <button onclick="changeSingerSongsPage(1)" class="text-gray-500 hover:text-emerald-600 disabled:opacity-30 transition-colors">
                        下一页 <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
        `;

        // 渲染歌曲列表（仅在歌曲 Tab 激活时）
        let _singerSongsRendered = false;

        /** 渲染歌手热门歌曲列表（延迟到 songs Tab 首次激活时调用；force=true 时强制重渲染供翻页用） */
        function renderSingerSongs(force) {
            if (!force && (_singerSongsRendered || !hasSongs)) return;
            _singerSongsRendered = true;

            // 防止搜索页 ListSearch 残留过滤状态错误过滤歌手歌曲
            if (window.ListSearch && typeof window.ListSearch.resetState === 'function') {
                window.ListSearch.resetState();
            }

            const allSongs = (window._onlineSingerState && window._onlineSingerState.songsWithSource) || [];
            const songsListEl = document.getElementById('singer-songs-list');
            const songsHeader = document.getElementById('singer-songs-header');
            const songsBatchTb = document.getElementById('singer-songs-batch-toolbar');
            if (!songsListEl) return;

            const origContainer = document.getElementById('search-results');
            const pageHeader = document.getElementById('search-results-header');
            const pageBatchTb = document.getElementById('batch-toolbar');
            const pagePagination = document.getElementById('search-pagination');

            // 确保页面级元素保持隐藏
            if (pageHeader) pageHeader.classList.add('hidden');
            if (pageBatchTb) pageBatchTb.classList.add('hidden');
            if (pagePagination) pagePagination.classList.add('hidden');

            // === 完整 ID 替换：页面级元素也要改 ID，防止 renderResults 通过 getElementById 找到它们 ===
            origContainer.id = 'search-results-temp';
            songsListEl.id = 'search-results';
            if (songsHeader) songsHeader.id = 'search-results-header';
            if (songsBatchTb) songsBatchTb.id = 'batch-toolbar';
            // 页面级元素改为临时 ID（renderResults 的 getElementById 将找不到它们）
            if (pageHeader) pageHeader.id = 'page-search-results-header';
            if (pageBatchTb) pageBatchTb.id = 'page-batch-toolbar';

            // 传全量 allSongs + 受控页码 _singerSongsPage；播放队列=全量，支持跨页续播
            renderResults(allSongs, {skipDbStatusFetch: true, currentPage: _singerSongsPage});

            // 恢复页面级元素：先加 hidden，再恢复 ID
            if (pageHeader) {
                pageHeader.classList.add('hidden');
                pageHeader.id = 'search-results-header';
            }
            if (pageBatchTb) {
                pageBatchTb.classList.add('hidden');
                pageBatchTb.id = 'batch-toolbar';
            }

            // 还原面板内元素 ID
            if (songsBatchTb) songsBatchTb.id = 'singer-songs-batch-toolbar';
            if (songsHeader) songsHeader.id = 'singer-songs-header';
            songsListEl.id = 'singer-songs-list';
            origContainer.id = 'search-results';

            // renderResults 会显示全局 pagination，歌手详情页用独立分页控件，强制隐藏全局分页
            // 改用 classList.add('hidden') 替代内联 display='none'，避免返回搜索页后内联样式残留导致分页栏不可见
            if (pagePagination) pagePagination.classList.add('hidden');

            // 更新独立分页控件 #singer-songs-pagination
            const itemsPerPage = window.settings.itemsPerPage === 'all' ? allSongs.length : (parseInt(window.settings.itemsPerPage) || 20);
            const totalPages = Math.ceil(allSongs.length / (itemsPerPage || 1));
            const pgEl = document.getElementById('singer-songs-pagination');
            const pgInfo = document.getElementById('singer-songs-pagination-info');
            if (pgEl) {
                if (totalPages <= 1) {
                    pgEl.classList.add('hidden');
                } else {
                    pgEl.classList.remove('hidden');
                    const start = (_singerSongsPage - 1) * itemsPerPage + 1;
                    const end = Math.min(_singerSongsPage * itemsPerPage, allSongs.length);
                    if (pgInfo) pgInfo.textContent = `显示 ${start}-${end} / 共 ${allSongs.length} 首 (第 ${_singerSongsPage}/${totalPages} 页)`;
                    const btns = pgEl.querySelectorAll('button');
                    if (btns[0]) btns[0].disabled = _singerSongsPage <= 1;
                    if (btns[1]) btns[1].disabled = _singerSongsPage >= totalPages;
                }
            }

            // 双重保险：再次清除防抖定时器
            clearTimeout(window._dbStatusFetchTimer);
        }

        if (hasSongs && window._singerActiveTab === 'songs') {
            renderSingerSongs();
        }

        /** 切换歌手详情页的 专辑 / 热门歌曲 Tab */
        function switchSingerTab(tab) {
            window._singerActiveTab = tab;
            const albumsPanel = document.getElementById('singer-albums-panel');
            const songsPanel = document.getElementById('singer-songs-panel');
            const tabAlbums = document.getElementById('singer-tab-albums');
            const tabSongs = document.getElementById('singer-tab-songs');

            if (tab === 'albums') {
                // 显示专辑面板，隐藏歌曲面板（表头/工具栏在面板内，随面板一起隐藏）
                if (albumsPanel) albumsPanel.style.display = '';
                if (songsPanel) songsPanel.style.display = 'none';
                if (tabAlbums) {
                    tabAlbums.classList.add('text-emerald-600', 'border-b-2', 'border-emerald-500');
                    tabAlbums.classList.remove('t-text-muted');
                }
                if (tabSongs) {
                    tabSongs.classList.remove('text-emerald-600', 'border-b-2', 'border-emerald-500');
                    tabSongs.classList.add('t-text-muted');
                }
            } else {
                // 显示歌曲面板，隐藏专辑面板（表头/工具栏在面板内，随面板一起显示）
                if (albumsPanel) albumsPanel.style.display = 'none';
                if (songsPanel) songsPanel.style.display = '';
                if (tabAlbums) {
                    tabAlbums.classList.remove('text-emerald-600', 'border-b-2', 'border-emerald-500');
                    tabAlbums.classList.add('t-text-muted');
                }
                if (tabSongs) {
                    tabSongs.classList.add('text-emerald-600', 'border-b-2', 'border-emerald-500');
                    tabSongs.classList.remove('t-text-muted');
                }
                // 首次切换到歌曲 Tab 时延迟渲染歌曲列表
                renderSingerSongs();
            }
        }

        window.switchSingerTab = switchSingerTab;

        /** 热门歌曲翻页（delta = -1 上一页 / 1 下一页） */
        function changeSingerSongsPage(delta) {
            const allSongs = (window._onlineSingerState && window._onlineSingerState.songsWithSource) || [];
            if (!allSongs.length) return;
            const itemsPerPage = window.settings.itemsPerPage === 'all' ? allSongs.length : (parseInt(window.settings.itemsPerPage) || 20);
            const totalPages = Math.ceil(allSongs.length / (itemsPerPage || 1));
            let np = _singerSongsPage + delta;
            if (np < 1) np = 1;
            if (np > totalPages) np = totalPages;
            if (np === _singerSongsPage) return;
            _singerSongsPage = np;
            renderSingerSongs(true);
            const listEl = document.getElementById('singer-songs-list');
            if (listEl) listEl.scrollIntoView({block: 'start', behavior: 'smooth'});
        }

        /** 重新渲染热门歌曲（每页条数变更时调用，重置到第1页） */
        function rerenderSingerSongs() {
            _singerSongsPage = 1;
            _singerSongsRendered = false;
            if (window._singerActiveTab === 'songs') renderSingerSongs(true);
        }

        window.changeSingerSongsPage = changeSingerSongsPage;
        window.rerenderSingerSongs = rerenderSingerSongs;

    } catch (err) {
        console.error('[SingerDetail] Error:', err);
        container.innerHTML = `<div class="text-center text-red-500 p-8">${escapeHtml(err.message)}</div>`;
    }
}

/** 从详情钻取返回搜索结果 */
async function backToSearchResults() {
    const state = window._searchDrillState;
    if (!state) {
        showInitialSearchState();
        return;
    }
    // 恢复源和搜索类型
    const sourceEl = document.getElementById('search-source');
    if (sourceEl && state.source) sourceEl.value = state.source;
    const typeEl = document.getElementById('search-type');
    if (typeEl && state.searchType) typeEl.value = state.searchType;
    if (typeof updateSearchTypeVisibility === 'function') updateSearchTypeVisibility();

    // 恢复搜索关键词
    const inputEl = document.getElementById('search-input');
    if (inputEl && state.keyword) inputEl.value = state.keyword;

    // 清除钻取状态
    window._searchDrillState = null;
    window._onlineSingerState = null;
    document.getElementById('album-online-detail-info')?.remove();
    // 重置歌手热门歌曲分页页码（模块级变量，否则下次进歌手详情残留旧页码）
    _singerSongsPage = 1;

    // 重新搜索（恢复之前的页码，而非重置到第1页）
    if (state.keyword) {
        currentPage = state.page || 1;
        doSearch(currentPage);
    } else {
        showInitialSearchState();
    }
}

/** 从专辑详情层层返回到歌手明细（重新渲染歌手详情页） */
async function backToSingerDetail() {
    const state = window._onlineSingerState;
    if (!state || !state.singerId) {
        // 无歌手上下文，回退到搜索结果
        backToSearchResults();
        return;
    }
    openOnlineSingerDetail(state.singerId, state.singerName, state.source);
}

window.openOnlineAlbumDetail = openOnlineAlbumDetail;
window.openOnlineSingerDetail = openOnlineSingerDetail;
window.backToSearchResults = backToSearchResults;
window.backToSingerDetail = backToSingerDetail;
window.renderSearchAlbumResults = renderSearchAlbumResults;
window.renderSearchSingerResults = renderSearchSingerResults;

function changePage(delta) {
    const source = document.getElementById('search-source').value;
    if (source === 'all') {
        showInfo('聚合搜索模式暂不支持翻页');
        return;
    }
    const newPage = currentPage + delta;
    if (newPage < 1) return;
    doSearch(newPage);
}


// ========== 热搜功能 ==========
let hotSearchCache = null;
let hotSearchCacheTime = 0;
const HOT_SEARCH_CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

async function fetchHotSearch(source = 'mg') {
    // 检查缓存（必须匹配 source）
    if (hotSearchCache &&
        hotSearchCache.source === source && // Add checking source
        Date.now() - hotSearchCacheTime < HOT_SEARCH_CACHE_DURATION) {
        return hotSearchCache;
    }

    try {
        // [优化] 使用低优先级 fetch 获取热搜，避免阻塞主加载
        const res = await fetch(`${API_BASE}/hotSearch?source=${source}`, {priority: 'low'});
        if (!res.ok) {
            throw new Error(`获取热搜失败: ${res.status}`);
        }
        const data = await res.json();

        // 更新缓存
        hotSearchCache = data;
        // Ensure data also carries the source info if not present
        if (!hotSearchCache.source) hotSearchCache.source = source;

        hotSearchCacheTime = Date.now();

        return data;
    } catch (e) {
        console.error('[HotSearch] 获取热搜失败:', e);
        return null;
    }
}

function renderHotSearch(data) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头、批量工具栏和分页（热搜为初始状态，无搜索结果）
    if (header) {
        header.classList.add('hidden');
    }
    const batchToolbar = document.getElementById('batch-toolbar');
    if (batchToolbar) batchToolbar.classList.add('hidden');
    const searchPagination = document.getElementById('search-pagination');
    if (searchPagination) searchPagination.classList.add('hidden');

    // [Fix] If limit is 0, treat as disabled and show default state
    if (!container || !data || !data.list || data.list.length === 0 || window.settings.hotSearchLimit === 0) {
        // 显示默认空白状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
        return;
    }

    const sourceTag = getSourceTag(data.source);
    // [Fix] Correctly handle 0, do not fall back to 20 if 0 is set
    const limit = (window.settings.hotSearchLimit !== undefined && window.settings.hotSearchLimit !== null) ? window.settings.hotSearchLimit : 20;
    const keywords = data.list.slice(0, limit); // 使用设置的数量

    container.innerHTML = `
        <div class="hot-search-container p-8">
            <div class="flex items-center mb-6">
                <i class="fas fa-fire text-orange-500 text-2xl mr-3"></i>
                <h3 class="text-xl font-bold t-text-main">热门搜索</h3>
                <span class="ml-3">${sourceTag}</span>
            </div>
            <div class="hot-search-list grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                ${keywords.map((keyword, index) => `
                    <button onclick="handleHotSearchClick('${keyword.replace(/'/g, "\\'")}')" 
                            class="hot-search-item group flex items-center p-3 t-bg-panel hover:bg-emerald-50 border t-border-main hover:border-emerald-400 rounded-lg transition-all shadow-sm hover:shadow-md overflow-hidden h-14">
                        <span class="rank flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold mr-3 ${index < 3 ? 'bg-gradient-to-r from-orange-400 to-red-500 text-white' : 'bg-gray-100 text-gray-500'
    }">
                            ${index + 1}
                        </span>
                        <span class="keyword flex-1 text-left text-sm font-medium t-text-main group-hover:text-emerald-600 truncate">
                            ${keyword}
                        </span>
                        <i class="fas fa-search text-xs text-gray-300 group-hover:text-emerald-500 transition-colors ml-2"></i>
                    </button>
                `).join('')}
            </div>
            <div class="mt-6 text-center">
                <button onclick="showInitialSearchState()" 
                        class="text-sm t-text-muted hover:text-emerald-500 transition-colors">
                    <i class="fas fa-sync-alt mr-1"></i>
                    刷新热搜
                </button>
            </div>
        </div>
    `;

    // 动态检测溢出并应用滚动效果
    setTimeout(() => {
        const items = container.querySelectorAll('.hot-search-item .keyword');
        items.forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
                const text = el.textContent.trim();
                el.classList.remove('truncate');
                // 使用 mask-image 实现渐变列表
                el.innerHTML = `
                    <div class="w-full overflow-hidden relative" style="mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);">
                        <div class="inline-block whitespace-nowrap animate-marquee hover-scroll-paused" style="will-change: transform;">
                             <span>${text}</span>
                             <span class="mx-8"></span>
                             <span>${text}</span>
                             <span class="mx-8"></span>
                        </div>
                    </div>
                `;
            }
        });
    }, 0);
}

function handleHotSearchClick(keyword) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = keyword;
        doSearch();
    }
}

function showInitialSearchState() {
    document.getElementById('album-online-detail-info')?.remove();
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头、批量工具栏和分页（初始状态无搜索结果）
    if (header) {
        header.classList.add('hidden');
    }
    const batchToolbar = document.getElementById('batch-toolbar');
    if (batchToolbar) batchToolbar.classList.add('hidden');
    const searchPagination = document.getElementById('search-pagination');
    if (searchPagination) searchPagination.classList.add('hidden');

    // 显示加载状态
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
            <i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i>
            <p>正在加载热门搜索...</p>
        </div>
    `;

    // 异步获取并显示热搜
    const sourceSelect = document.getElementById('search-source');
    const source = sourceSelect ? sourceSelect.value : 'wy';

    fetchHotSearch(source).then(data => {
        renderHotSearch(data);
    }).catch(err => {
        console.error('[HotSearch] 显示热搜失败:', err);
        // 失败时显示默认状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
    });
}


function getQualityTags(item) {
    const tags = [];
    // 兼容多种音质字段位置:
    // 1. types / _types (旧版/部分源)
    // 2. qualitys / _qualitys (新版/标准，已提升到顶层)
    const rawTypes = item.types || item._types ||
        item.qualitys || item._qualitys ||
        {};

    // Normalize types check
    let has320 = false;
    let hasFlac = false;
    let hasHiRes = false;

    if (Array.isArray(rawTypes)) {
        // 数组格式: [{type: '320k', ...}, {type: 'flac', ...}]
        has320 = rawTypes.some(t => t.type === '320k');
        hasFlac = rawTypes.some(t => t.type === 'flac');
        hasHiRes = rawTypes.some(t => t.type === 'flac24bit');
    } else if (typeof rawTypes === 'object' && Object.keys(rawTypes).length > 0) {
        // 对象格式: { '320k': {size: ...}, 'flac': ... }
        has320 = !!rawTypes['320k'];
        hasFlac = !!rawTypes['flac'];
        hasHiRes = !!rawTypes['flac24bit'];
    } else {
        // 音乐库本地文件：根据 ext 字段推断音质
        const ext = (item.ext || '').toLowerCase();
        if (ext === '.flac') {
            // 区分普通 FLAC 和 Hi-Res：通过 bitDepth 或采样率
            if (item.bitDepth && item.bitDepth > 16) {
                hasHiRes = true;
            } else {
                hasFlac = true;
            }
        } else if (ext === '.wav') {
            hasHiRes = true; // WAV 通常是无损/Hi-Res
        } else if (ext === '.m4a') {
            has320 = true; // M4A 通常是 AAC 256-320k
        } else if (ext === '.mp3') {
            has320 = true; // MP3 假设高品质
        }
    }

    if (hasHiRes) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 transition-colors">Hi-Res</span>');
    else if (hasFlac) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 transition-colors">无损</span>');
    else if (has320) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 transition-colors">高品质</span>');

    return tags.join('');
}

window.getQualityTags = getQualityTags;

// 音频元信息标签（采样率/位深/码率），与 renderMusicLibList 风格一致
function getAudioMetaTag(item) {
    const parts = [];
    if (item.sampleRate) {
        const sr = item.sampleRate >= 1000
            ? (item.sampleRate / 1000).toFixed(1).replace('.0', '') + 'kHz'
            : item.sampleRate + 'Hz';
        parts.push(sr);
    }
    if (item.bitDepth) parts.push(item.bitDepth + 'Bit');
    if (item.bitRate) {
        const br = item.bitRate >= 1000
            ? (item.bitRate / 1000).toFixed(0) + 'Kbps'
            : item.bitRate + 'Bps';
        parts.push(br);
    }
    if (parts.length === 0) return '';
    return `<span class="text-[9px] t-text-muted truncate">${parts.join(' / ')}</span>`;
}

window.getAudioMetaTag = getAudioMetaTag;

// Helper for loose image paths
function getImgUrl(item) {
    if (!item) return '/music/assets/logo.png';
    const s = item;

    // 兼容各种 SDK 的原始字段（picUrl 已提升到顶层）
    const onlineImg = s.img || s.pic || s.picUrl || s.picture ||
        (s.album && (s.album.picUrl || s.album.img || s.album.pic)) ||
        (s.al && (s.al.picUrl || s.al.img));
    // console.log("获取PICMIAGE",item,'onlineImg',onlineImg)
    if (onlineImg && onlineImg.startsWith('http')) return onlineImg;
    // 本地歌曲的 img 字段可能是封面相对路径（通过 buildCoverUrl 获取嵌入封面）
    if (onlineImg && s.source) {
        return buildCoverUrl(onlineImg, s.source);
    }
    // 音乐库本地文件：通过 relativePath 从服务端获取封面
    // 不再依赖 hasCover 字段，因为 DB 中 has_cover 默认为 0，而服务端封面 API 会自动提取嵌入封面
    if (s.relativePath) {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null)
            || localStorage.getItem('lx_user_token') || '';
        return `/api/music/cache/cover?filename=${encodeURIComponent(s.relativePath)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}${s.source && String(s.source) === 'local' ? `&source=${encodeURIComponent(s.source)}&relativePath=${encodeURIComponent(s.relativePath)}` : ''}`;
    }
    return '/music/assets/logo.png';
}


// List search logic is now handled by ListSearch service in list_search.js
function renderResults(list, options) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const headerTitle = document.getElementById('header-title');
    const headerAlbum = document.getElementById('header-album');

    // 显示批量工具栏和分页（仅在批量模式激活时显示工具栏）
    const batchToolbar = document.getElementById('batch-toolbar');
    if (batchToolbar) {
        if (window.batchMode) batchToolbar.classList.remove('hidden');
        else batchToolbar.classList.add('hidden');
    }
    const searchPagination = document.getElementById('search-pagination');
    if (searchPagination) searchPagination.classList.remove('hidden');

    // 收藏视图工具栏显隐 (Favorites toolbar visibility)
    const favToolbar = document.getElementById('favorites-toolbar');
    if (favToolbar) {
        if (currentSearchScope === 'local_list' || currentSearchScope === 'local_all') {
            favToolbar.classList.remove('hidden');
            const countEl = document.getElementById('favorites-toolbar-count');
            if (countEl) countEl.textContent = `共 ${list.length} 首`;
        } else {
            favToolbar.classList.add('hidden');
        }
    }

    // 网络搜索时隐藏歌单头部信息
    if (currentSearchScope === 'network' && window.PlaylistHeader) {
        window.PlaylistHeader.hide('search-playlist-header');
    }

    // Determine if we should show the album column
    // 所有场景都显示专辑列（网络搜索和本地列表均有专辑数据）
    const showAlbum = true;

    // Update Header
    if (header) {
        header.classList.remove('hidden');
    }
    if (headerTitle) {
        if (showAlbum) {
            headerTitle.classList.remove('lg:col-span-6');
            headerTitle.classList.add('lg:col-span-4');
        } else {
            headerTitle.classList.remove('lg:col-span-4');
            headerTitle.classList.add('lg:col-span-6');
        }
    }
    if (headerAlbum) {
        if (showAlbum) {
            headerAlbum.classList.add('hidden');
            headerAlbum.classList.add('lg:block');
        } else {
            headerAlbum.classList.add('hidden');
            headerAlbum.classList.remove('lg:block');
        }
    }

    container.innerHTML = '';

    // [Fix] 确保每个歌曲都有唯一的 ID，防止批量操作时因为 ID 缺失(undefined)导致只能选中一个
    // 很多源(如酷狗、咪咕)返回的原始数据可能只有 hash 或 copyrightsId 而没有 id 字段
    if (list && list.length > 0) {
        list.forEach((item, idx) => {
            if (!item.id || item.id === 'undefined') {
                item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `temp_${Date.now()}_${idx}`;
            }
        });
    }

    window.viewingPlaylist = list;

    if (!list || list.length === 0) {
        container.innerHTML = '<div class="text-center t-text-muted p-8">未找到相关结果</div>';
        updatePaginationInfo(0, 0, 0);
        return;
    }

    // Applying Unified Filter with original index preservation BEFORE pagination
    const indexedDisplayList = window.ListSearch.getDisplayList(list);

    // Pagination
    const totalItems = indexedDisplayList.length;
    let itemsPerPage = window.settings.itemsPerPage === 'all' ? totalItems : parseInt(window.settings.itemsPerPage);
    if (itemsPerPage <= 0) itemsPerPage = 20;
    const totalPages = Math.ceil(totalItems / (itemsPerPage || 1));

    // 受控页码：传入 options.currentPage 时用局部页码，不回写全局 currentPage（歌手详情页分页用）
    const useOptPage = options && typeof options.currentPage === 'number';
    let p = useOptPage ? options.currentPage : currentPage;
    // Bounds check
    if (p > totalPages) p = totalPages || 1;
    if (p < 1) p = 1;
    if (useOptPage) {
        // 歌手详情页：同步模块级 _singerSongsPage（越界修正后保持 UI 与实际一致）
        _singerSongsPage = p;
    } else {
        currentPage = p;
    }

    const startIndex = (p - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

    const pageList = indexedDisplayList.slice(startIndex, endIndex);

    // Get download status from memory (current session tasks)
    const memoryStatusMap = window.SystemDownloadManager ? window.SystemDownloadManager.getAllDownloadStatuses() : new Map();

    // Merge with database status (for finished downloads)
    // Memory status has higher priority (active tasks)
    const downloadStatusMap = new Map(memoryStatusMap);
    if (window.dbDownloadStatusMap) {
        window.dbDownloadStatusMap.forEach((status, songId) => {
            if (!downloadStatusMap.has(songId)) {
                downloadStatusMap.set(songId, status);
            }
        });
    }

    pageList.forEach((obj, pageIndex) => {
        const {item, originalIndex: actualIndexInOriginal} = obj;
        const row = document.createElement('div');
        row.id = `gl-row-${actualIndexInOriginal}`;
        row.dataset.songId = String(item.id);

        const isMatched = window.ListSearch.isMatched(actualIndexInOriginal);
        const isCurrentMatch = window.ListSearch.isCurrentMatch(actualIndexInOriginal);
        const isSelected = window.selectedItems.has(String(item.id));

        let rowClass = 'grid grid-cols-12 gap-4 p-3 rounded-xl hover:t-bg-panel group transition-colors cursor-pointer ';
        if (isCurrentMatch) rowClass += 'search-current ';
        else if (isMatched) rowClass += 'search-match ';
        if (isSelected) rowClass += 'row-selected ring-1 ring-emerald-500/30 ';

        row.className = rowClass;

        // Add click listener for the row
        row.onclick = (e) => {
            if (window.batchMode) {
                const id = String(item.id);
                const isChecked = !window.selectedItems.has(id);
                window.handleBatchSelect(id, isChecked);
            } else {
                // If not in batch mode, clicking row plays the song
                playFromView(actualIndexInOriginal);
            }
        };

        // Image
        const imgUrl = getImgUrl(item);

        // Get download status
        const dlStatus = downloadStatusMap.get(String(item.id)) || {status: null};

        // 时长处理：优先 interval（格式化字符串），其次 duration（秒数）
        let displayDuration = item.interval || '--:--';
        if (!item.interval && typeof item.duration === 'number' && item.duration > 0) {
            displayDuration = formatDuration(item.duration);
        }
        // 文件大小：优先 item.size（字节数），其次从 _qualitys 提取
        let displaySize = '';
        if (item.size && typeof item.size === 'number') {
            displaySize = formatFileSize(item.size);
        } else if (item._qualitys) {
            const qs = item._qualitys;
            const firstQ = qs.flac24bit || qs.flac || qs['320k'] || qs['192k'] || qs['128k'];
            if (firstQ && firstQ.size) displaySize = firstQ.size;
        }
        // 是否本地歌曲（本地库或直接包含 relativePath）
        const isLocal = isLocalLibrarySong(item) || !!item.relativePath;

        // Grid Layout Adjustment
        const titleLgSpan = showAlbum ? 'lg:col-span-4' : 'lg:col-span-6';

        // 状态图标（本地歌曲或下载状态）
        const statusIcon = isLocal
            ? '<span class="text-emerald-500 text-xs" title="本地歌曲"><i class="fas fa-hard-drive"></i></span>'
            : getDownloadStatusIcon(dlStatus, item.id);

        row.innerHTML = `
            <!-- Index + Checkbox (always visible) -->
            <div class="col-span-1 text-center font-mono t-text-muted text-xs md:text-sm flex items-center justify-center gap-1">
                <input type="checkbox" 
                       class="batch-checkbox w-4 h-4 text-emerald-600 rounded flex-shrink-0" 
                       data-song-id="${item.id}"
                       ${isSelected ? 'checked' : ''}
                    onclick="event.stopPropagation(); handleBatchSelect('${String(item.id)}', this.checked);">
                <span class="index-num text-[10px] md:text-xs">${actualIndexInOriginal + 1}</span>
            </div>

            <!-- Title (Image + Text) -->
            <div class="col-span-9 sm:col-span-7 md:col-span-6 ${titleLgSpan} flex items-center overflow-hidden pr-2">
                <div class="relative w-10 h-10 mr-3 md:mr-4 flex-shrink-0 group cursor-pointer">
                     <img data-src="${imgUrl}" src="/music/assets/logo.png" 
                          loading="lazy" fetchpriority="low"
                          class="lazy-image w-full h-full rounded object-cover shadow-sm group-hover:shadow-md transition-all group-hover:scale-105 duration-300 dynamic-logo is-placeholder" 
                          alt="${item.name}"
                          onerror="this.src='/music/assets/logo.png'; this.classList.add('is-placeholder');">
                     <div class="absolute inset-0 bg-black/20 rounded hidden group-hover:flex items-center justify-center transition-all">
                        <i class="fas fa-play text-white text-xs md:text-sm"></i>
                     </div>
                </div>
                <div class="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                    <div class="font-bold t-text-main text-sm md:text-base leading-tight hover:text-emerald-600 transition-colors">
                         ${createMarqueeHtml(item.name)}
                    </div>
                    <div class="flex items-center gap-1 mt-0.5 md:mt-1 pr-2 overflow-hidden">
                         ${getSourceTag(item.source) + getQualityTags(item)}
                         ${isLocal ? getAudioMetaTag(item) : ''}
                         <span data-dl-status>${statusIcon}</span>
                         <div class="sm:hidden flex-1 min-w-0">
                            ${createMarqueeHtml(item.singer, 'text-[10px] t-text-muted')}
                         </div>
                    </div>
                </div>
            </div>

            <!-- Artist (Hidden on Mobile) -->
            <div class="hidden sm:flex sm:col-span-3 md:col-span-3 lg:col-span-3 t-text-muted text-sm md:text-base items-center hover:text-emerald-600 transition-colors cursor-pointer overflow-hidden"
                 title="${item.singer}"
                 onclick="event.stopPropagation(); document.getElementById('search-input').value = '${item.singer.replace(/'/g, "\\'")}'; doSearch();">
                ${createMarqueeHtml(item.singer)}
            </div>

            <!-- Album (Hidden until LG) -->
            ${showAlbum ? `
            <div class="hidden lg:block lg:col-span-2 t-text-muted text-sm truncate flex items-center" title="${item.albumName || item.album || ''}">
                ${item.albumName || item.album || '-'}
            </div>
            ` : ''}

            <!-- Duration + Size (Hidden until MD) -->
            <div class="hidden md:block md:col-span-1 t-text-muted text-xs font-mono text-center flex flex-col items-center justify-center">
                <span class="tabular-nums block w-full">${displayDuration}</span>
                ${displaySize ? `<span class="block w-full text-[9px] t-text-muted leading-none mt-0.5">${displaySize}</span>` : ''}
            </div>

            <!-- Actions -->
            <div class="col-span-2 sm:col-span-1 flex items-center justify-end gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="p-1 sm:p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors" 
                        title="播放" 
                        onclick="event.stopPropagation(); playFromView(${actualIndexInOriginal})">
                    <i class="fas fa-play w-3 h-3 sm:w-4 sm:h-4"></i>
                </button>
                ${!isLocal ? `
                <button class="p-1 sm:p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors" 
                        title="下载" 
                        onclick="event.stopPropagation(); downloadSong(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                    <i class="fas fa-download w-3 h-3 sm:w-4 sm:h-4"></i>
                </button>
                ` : ''}
                ${currentSearchScope !== 'network' ? `
                <button class="p-1 sm:p-1.5 hover:bg-red-50 rounded-lg text-red-600 transition-colors" 
                        title="删除" 
                        onclick="event.stopPropagation(); deleteSingleSong('${item.id}')">
                    <i class="fas fa-trash w-3 h-3 sm:w-4 sm:h-4"></i>
                </button>
                ` : ''}
            </div>
        `;

        container.appendChild(row);
    });

    // Update pagination info
    updatePaginationInfo(startIndex + 1, endIndex, totalItems);

    // Init Lazy Loader
    lazyLoadImages();
    applyMarqueeChecks();

    // [New] Fetch database download status asynchronously (will trigger re-render if new data)
    // Debounce to avoid frequent requests; skipDbStatusFetch 用于防止 fetch 回调触发的重渲染再次 fetch
    if (!options?.skipDbStatusFetch) {
        clearTimeout(window._dbStatusFetchTimer);
        // 快照当前 dbDownloadStatusMap 的 key 集合，用于 fetch 后比较是否有真正新增的数据
        const existingKeys = new Set(window.dbDownloadStatusMap ? window.dbDownloadStatusMap.keys() : []);
        window._dbStatusFetchTimer = setTimeout(() => {
            fetchCurrentPlaylistDbStatus().then(() => {
                // Only re-render if fetch actually added NEW entries (not previously known)
                if (window.dbDownloadStatusMap && window.dbDownloadStatusMap.size > 0) {
                    let hasNewData = false;
                    window.dbDownloadStatusMap.forEach((status, songId) => {
                        if (!existingKeys.has(songId)) {
                            hasNewData = true;
                        }
                    });
                    if (hasNewData) {
                        // 歌手/专辑详情页：跳过重渲染，避免覆盖详情模板
                        if (window._onlineSingerState || window._searchDrillState?.type === 'album') return;
                        renderResults(window.viewingPlaylist, {skipDbStatusFetch: true});
                    }
                }
            });
        }, 500); // 500ms debounce
    }
}

// Generic Marquee Helper
function createMarqueeHtml(text, className = '') {
    // Return a container marked for dynamic checking
    // different screens are different, so we check overflow after render
    // Added min-w-0 to prevent flex item from expanding beyond parent
    return `<div class="truncate dynamic-marquee min-w-0 ${className}" data-text="${text.replace(/"/g, '&quot;')}">${text}</div>`;
}

// 统一判断歌曲是否已下载（与"选中未下载"按钮逻辑一致）
// finished = 已下载完成; error = 已尝试下载（无论是否成功，均视为"已下载"不再选中）
function isSongDownloaded(statusInfo) {
    if (!statusInfo) return false;
    const st = statusInfo.status;
    return st === 'finished' || st === 'error';
}

window.isSongDownloaded = isSongDownloaded;

// Download Status Icon Helper
// Returns HTML for download status icon
function getDownloadStatusIcon(dlStatus, songId) {
    const {status, errorMsg, isServer} = dlStatus;

    if (!status) {
        // Not downloaded yet - show nothing or a subtle indicator
        return `<span class="text-gray-300 text-xs" title="未下载">-</span>`;
    }

    switch (status) {
        case 'finished':
            // Download complete - green checkmark
            return `<span class="text-emerald-500 text-xs" title="${isServer ? '已缓存到服务器' : '已下载完成'}">
                <i class="fas fa-check-circle"></i>
            </span>`;
        case 'error':
            // Download error - red X with error tooltip
            return `<span class="text-red-500 text-xs cursor-help" title="下载失败: ${errorMsg || '未知错误'}">
                <i class="fas fa-exclamation-circle"></i>
            </span>`;
        case 'downloading':
            // Currently downloading - spinning icon
            return `<span class="text-blue-500 text-xs" title="下载中...">
                <i class="fas fa-spinner fa-spin"></i>
            </span>`;
        case 'waiting':
            // Waiting in queue - clock icon
            return `<span class="text-orange-500 text-xs" title="等待下载">
                <i class="fas fa-clock"></i>
            </span>`;
        case 'paused':
            // Paused - pause icon
            return `<span class="text-yellow-500 text-xs" title="已暂停">
                <i class="fas fa-pause-circle"></i>
            </span>`;
        default:
            return `<span class="text-gray-300 text-xs">-</span>`;
    }
}

// 挂载到 window 以便 download_manager.js 访问
window.getDownloadStatusIcon = getDownloadStatusIcon;


/**
 * 检查歌曲在服务器 music 目录中是否存在（批量文件系统检查）
 * @param {Array} songs - 歌曲对象数组 [{ id, name, singer, albumName, source }]
 */
async function fetchDbDownloadStatus(songs) {
    if (!songs || songs.length === 0) return;

    try {
        // 限制每次最多 100 首
        const batch = songs.slice(0, 100).map(s => ({
            id: String(s.id || s.songmid || ''),
            name: s.name || '',
            singer: s.singer || 'Unknown',
            albumName: s.albumName || 'Unknown',
            source: s.source || ''
        })).filter(s => s.id && s.name);

        if (batch.length === 0) return;

        const resp = await fetch('/api/music/cache/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
            },
            body: JSON.stringify({songs: batch})
        });
        const result = await resp.json();

        if (result.success && result.data) {
            // Initialize global map if needed
            if (!window.dbDownloadStatusMap) {
                window.dbDownloadStatusMap = new Map();
            }

            // Update global map with file existence status
            Object.entries(result.data).forEach(([songId, info]) => {
                window.dbDownloadStatusMap.set(songId, {
                    status: info.exists ? 'finished' : null,
                    isServer: true,
                    relativePath: info.relativePath || '',
                    ext: info.ext || '',
                    filename: info.filename || ''
                });
            });
        }
    } catch (e) {
        console.warn('[App] Failed to fetch db download status:', e);
    }
}

/**
 * Fetch download status for current playlist (called when viewing a list)
 */
async function fetchCurrentPlaylistDbStatus() {
    if (!window.viewingPlaylist || window.viewingPlaylist.length === 0) return;
    await fetchDbDownloadStatus(window.viewingPlaylist);
}

//滚动显示
function applyMarqueeChecks() {
    // Wait for render
    setTimeout(() => {
        const elements = document.querySelectorAll('.dynamic-marquee.truncate');
        elements.forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
                const text = el.getAttribute('data-text') || el.innerText;
                const gap = '<span class="mx-8"></span>'; // 增加间距
                const isHoverScroll = el.classList.contains('hover-scroll-marquee');

                // 必须保留 overflow-hidden 以限制宽度
                el.classList.remove('truncate');
                el.classList.add('overflow-hidden');

                if (isHoverScroll) {
                    // 悬停滚动模式：默认截断显示省略号，鼠标悬停时才滚动（CSS 控制动画触发）
                    el.innerHTML = `<div class="inline-block whitespace-nowrap hover-scroll-marquee-text"><span>${text}</span>${gap}<span>${text}</span>${gap}</div>`;
                    return;
                }

                // 使用 mask-image 实现边缘渐隐效果
                const maskStyle = 'mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);';

                el.innerHTML = `
                <div class="w-full relative" style="${maskStyle}">
                    <div class="inline-block whitespace-nowrap animate-marquee hover:pause-animation">
                        <span>${text}</span>${gap}<span>${text}</span>${gap}
                    </div>
                </div>`;
            }
        });
    }, 50);
}

// Re-check marquees on resize
window.addEventListener('resize', () => {
    clearTimeout(window._marqueeResizeTimer);
    window._marqueeResizeTimer = setTimeout(applyMarqueeChecks, 300);
});

// Lazy Loading Logic
let imageObserver;

function lazyLoadImages() {
    // 禁用 lazyload 逻辑，直接遍历所有图片并快速加载
    const imagesToLoad = document.querySelectorAll('img.lazy-image');
    imagesToLoad.forEach(img => {
        const src = img.getAttribute('data-src');
        if (src) {
            if (img.src.includes('logo.png')) {
                img.classList.add('is-placeholder');
            }
            img.src = src;
            img.onload = () => {
                img.classList.remove('is-placeholder', 'opacity-0');
                img.removeAttribute('data-src');
            };
            img.onerror = () => {
                img.src = '/music/assets/logo.png';
                img.classList.add('is-placeholder');
            };
        }
    });

    return; // 短路返回，保留并禁用以下原有的交集观察者懒加载逻辑

    // If IntersectionObserver is supported
    if ('IntersectionObserver' in window) {
        if (imageObserver) {
            imageObserver.disconnect();
        }

        imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.getAttribute('data-src');

                    if (src) {
                        // If we are about to switch from placeholder, ensure is-placeholder class is present
                        if (img.src.includes('logo.png')) {
                            img.classList.add('is-placeholder');
                        }

                        img.src = src;
                        img.onload = () => {
                            img.classList.remove('is-placeholder', 'opacity-0');
                            img.removeAttribute('data-src');
                        };
                        img.onerror = () => {
                            img.src = '/music/assets/logo.png';
                            img.classList.add('is-placeholder');
                        };
                        observer.unobserve(img);
                    }
                }
            });
        }, {
            rootMargin: '100px 0px', // Load before it comes into view
            threshold: 0.01
        });

        const images = document.querySelectorAll('img.lazy-image');
        images.forEach(img => {
            imageObserver.observe(img);
        });
    } else {
        // Fallback for older browsers
        const images = document.querySelectorAll('img.lazy-image');
        images.forEach(img => {
            const src = img.getAttribute('data-src');
            if (src) img.src = src;
        });
    }
}

// List search logic is now handled by ListSearch service

// --- Segment B: 搜索建议 (原 app.js L6275-L6401) ---

let searchTipsDebounceTimer = null;
let currentSelectedTipIndex = -1;

function initSearchTips() {
    const searchInput = document.getElementById('search-input');
    const suggestionsContainer = document.getElementById('search-suggestions');

    if (!searchInput || !suggestionsContainer) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchTipsDebounceTimer);

        if (!query) {
            hideSearchSuggestions();
            return;
        }

        searchTipsDebounceTimer = setTimeout(() => {
            fetchSearchTips(query);
        }, 300);
    });

    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim();
        if (query) {
            suggestionsContainer.classList.remove('hidden');
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        const list = document.getElementById('search-suggestions-list');
        const items = list ? list.querySelectorAll('.search-tip-item') : [];

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length === 0) return;
            currentSelectedTipIndex = (currentSelectedTipIndex + 1) % items.length;
            updateTipSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length === 0) return;
            currentSelectedTipIndex = (currentSelectedTipIndex - 1 + items.length) % items.length;
            updateTipSelection(items);
        } else if (e.key === 'Enter') {
            if (currentSelectedTipIndex >= 0 && items[currentSelectedTipIndex]) {
                e.preventDefault();
                const text = items[currentSelectedTipIndex].textContent.trim();
                searchInput.value = text;
                hideSearchSuggestions();
                doSearch();
            }
        } else if (e.key === 'Escape') {
            hideSearchSuggestions();
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
            hideSearchSuggestions();
        }
    });
}

function updateTipSelection(items) {
    items.forEach((item, index) => {
        if (index === currentSelectedTipIndex) {
            item.classList.add('t-bg-muted');
            item.scrollIntoView({block: 'nearest'});
        } else {
            item.classList.remove('t-bg-muted');
        }
    });
}

async function fetchSearchTips(query) {
    const source = (document.getElementById('search-source')) ? document.getElementById('search-source').value : 'kw';
    try {
        const resp = await fetch(`/api/music/tipSearch?name=${encodeURIComponent(query)}&source=${source}`);
        const tips = await resp.json();
        renderSearchTips(tips);
    } catch (err) {
        console.error('[TipSearch] Fetch error:', err);
    }
}

function renderSearchTips(tips) {
    const container = document.getElementById('search-suggestions');
    const list = document.getElementById('search-suggestions-list');
    if (!container || !list) return;

    list.innerHTML = '';
    currentSelectedTipIndex = -1;

    if (!tips || tips.length === 0) {
        container.classList.add('hidden');
        return;
    }

    tips.forEach((tip, index) => {
        const div = document.createElement('div');
        div.className = 'search-tip-item px-4 py-2.5 hover:t-bg-muted cursor-pointer transition-colors text-sm flex items-center gap-3';
        div.innerHTML = `<i class="fas fa-search t-text-muted text-xs"></i><span class="truncate">${tip}</span>`;
        div.onclick = () => {
            document.getElementById('search-input').value = tip;
            hideSearchSuggestions();
            doSearch();
        };
        list.appendChild(div);
    });

    container.classList.remove('hidden');
}

function hideSearchSuggestions() {
    const container = document.getElementById('search-suggestions');
    if (container) container.classList.add('hidden');
    currentSelectedTipIndex = -1;
}

// Ensure initSearchTips runs on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearchTips);
} else {
    initSearchTips();
}

// --- initGlobalListSearch (原 app.js L49-L67) ---
function initGlobalListSearch() {
    if (window.ListSearch) {
        window.ListSearch.init('global', {
            renderCallback: () => renderResults(window.viewingPlaylist),
            paginationCallback: (page, index) => {
                window.goToPage(page);
                setTimeout(() => window.ListSearch.scrollToMatch(index), ANIMATION.SCROLL_DELAY);
            },
            getList: () => window.viewingPlaylist,
            itemsPerPage: window.settings.itemsPerPage === 'all' ? 999999 : parseInt(window.settings.itemsPerPage)
        });
    }
}

// Run initGlobalListSearch on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initGlobalListSearch();
    });
} else {
    initGlobalListSearch();
}

// ===== Window exports =====
// Variables
Object.defineProperty(window, 'currentPage', { get() { return currentPage; }, set(v) { currentPage = v; }, configurable: true });
Object.defineProperty(window, 'currentSearch', { get() { return currentSearch; }, set(v) { currentSearch = v; }, configurable: true });
// (viewingPlaylist, currentSearchScope, batchCollectSongs are already on window directly)

// goToPage function
window.goToPage = function (page) {
    currentPage = page;
    window.currentPage = page;
    if (typeof doSearch === 'function') doSearch(page);
};

// Functions
window.handleSearchKeyPress = handleSearchKeyPress;
window.performSearch = performSearch;
window.doSearch = doSearch;
window.renderResults = renderResults;
window.changePage = changePage;
window.showInitialSearchState = showInitialSearchState;
window.createMarqueeHtml = createMarqueeHtml;
window.applyMarqueeChecks = applyMarqueeChecks;
window.fetchDbDownloadStatus = fetchDbDownloadStatus;
window.fetchCurrentPlaylistDbStatus = fetchCurrentPlaylistDbStatus;
window.isSongDownloaded = isSongDownloaded;
window.getDownloadStatusIcon = getDownloadStatusIcon;
window.onSearchSourceChange = onSearchSourceChange;
window.handleHotSearchClick = handleHotSearchClick;
window.hideSearchSuggestions = hideSearchSuggestions;
window.initSearchTips = initSearchTips;
window.renderSearchAlbumResults = renderSearchAlbumResults;
window.renderSearchSingerResults = renderSearchSingerResults;
window.lazyLoadImages = lazyLoadImages;
