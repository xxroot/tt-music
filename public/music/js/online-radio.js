/**
 * 在线电台管理模块 (Online Radio Manager)
 * 接入 radio-browser.info 公共 API，提供全球在线电台搜索、浏览和播放功能
 * 支持收藏功能，收藏数据存储在用户目录
 */
const OnlineRadioManager = (function () {
    // ==================== 状态 ====================
    let _initialized = false;
    let _onlineResults = [];   // 在线搜索结果
    let _favoriteList = [];   // 收藏列表（一次性加载全部）
    let _showFavorites = false; // 当前是否显示收藏
    let _currentPage = 1;
    let _lastOnlinePage = 1;  // 在线模式上次页码
    let _lastFavPage = 1;     // 收藏模式上次页码
    let _pageSize = 10;
    let _currentStation = null;
    let _isPlaying = false;
    let _durationTimer = null;
    let _durationSeconds = 0;
    let _isLoading = false;
    let _noMore = false;       // 是否已加载全部（无更多数据可加载）
    let _corsRetried = false;  // 是否已尝试过 CORS 回退（防止无限重试）
    let _streamModeQueried = false;  // 是否已查询过流模式（防止 playing 事件重复触发）
    let _currentMode = 'leaderboard';  // 'leaderboard' | 'search'
    let _lastSearchParams = null;      // 上次搜索参数，供 loadMore 使用

    const audio = document.getElementById('audio-player');

    /** 构建流代理 URL（附带 stationuuid 供后端缓存使用） */
    function buildStreamProxyUrl(streamUrl, stationuuid) {
        let url = '/api/online-radio/stream?url=' + encodeURIComponent(streamUrl);
        if (stationuuid) url += '&id=' + encodeURIComponent(stationuuid);
        return url;
    }

    // ==================== 可视化 ====================

    // ==================== 工具函数 ====================

    /** 国家代码转 Emoji 国旗 */
    function countryToFlag(countrycode) {
        if (!countrycode || countrycode.length !== 2) return '';
        try {
            return String.fromCodePoint(
                ...[...countrycode.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
            );
        } catch (e) {
            return '';
        }
    }

    /** 获取编码 badge 颜色 class（与 album-lib.js 一致） */
    function getCodecBadgeClass(codec) {
        if (!codec) return '';
        const lower = codec.toLowerCase();
        if (lower === 'flac') {
            return 't-badge-green border-emerald-200 dark:border-emerald-500/30';
        }
        const hiResFormats = ['flac24bit', 'dsf', 'dff', 'aiff', 'aif', 'dts', 'wv', 'wma'];
        if (hiResFormats.includes(lower)) {
            return 't-badge-yellow border-yellow-200 dark:border-yellow-500/30';
        }
        return 't-badge-blue border-blue-200 dark:border-blue-500/30';
    }

    /** 统一的 badge 基础 class */
    const BADGE_BASE = 'flex-shrink-0 px-1 py-0 rounded text-[10px] border transition-colors';

    /** 创建编码 badge HTML */
    function codecBadgeHtml(codec) {
        if (!codec) return '';
        const cls = getCodecBadgeClass(codec);
        return `<span class="${BADGE_BASE} ${cls}">${escapeHtml(codec.toUpperCase())}</span>`;
    }

    /** 创建码率 badge HTML */
    function bitrateBadgeHtml(bitrate) {
        if (!bitrate) return '';
        return `<span class="${BADGE_BASE} t-badge-blue border-blue-200 dark:border-blue-500/30">${bitrate}k</span>`;
    }

    /** 检查电台是否已收藏 */
    function isFavorited(stationuuid) {
        return _favoriteList.some(s => s.stationuuid === stationuuid);
    }

    // ==================== API 层 ====================

    async function apiSearchStations(params) {
        const qs = new URLSearchParams(params).toString();
        return apiGetJson('/api/online-radio/stations/search?' + qs);
    }

    async function apiTopVote(limit, offset = 0) {
        return apiGetJson('/api/online-radio/stations/topvote?limit=' + limit + '&offset=' + offset);
    }

    async function apiTopClick(limit, offset = 0) {
        return apiGetJson('/api/online-radio/stations/topclick?limit=' + limit + '&offset=' + offset);
    }

    async function apiRecent(limit, offset = 0) {
        return apiGetJson('/api/online-radio/stations/recent?limit=' + limit + '&offset=' + offset);
    }

    async function apiCategory(type, params) {
        const qs = new URLSearchParams(params || {}).toString();
        return apiGetJson('/api/online-radio/' + type + (qs ? '?' + qs : ''));
    }

    async function apiClickStation(stationuuid) {
        return apiPostJson('/api/online-radio/click', {stationuuid});
    }

    async function apiVoteStation(stationuuid) {
        return apiPostJson('/api/online-radio/vote', {stationuuid});
    }

    /** 获取收藏列表 */
    async function apiGetFavorites() {
        return apiGetJson('/api/online-radio/favorites');
    }

    /** 添加收藏 */
    async function apiAddFavorite(station) {
        return apiPostJson('/api/online-radio/favorites', station);
    }

    /** 移除收藏 */
    async function apiRemoveFavorite(uuid) {
        const res = await fetch('/api/online-radio/favorites/' + uuid, {method: 'DELETE'});
        return res.json();
    }

    // ==================== 数据加载 ====================

    /** 加载默认列表（获取 200 条缓存） */
    async function loadDefaultList() {
        _currentMode = 'leaderboard';
        _lastSearchParams = null;
        _currentPage = 1;
        _onlineResults = [];
        _noMore = false;
        showListLoading();
        try {
            const sortEl = document.getElementById('online-radio-sort');
            const sortVal = sortEl ? sortEl.value : 'topvote';

            let result;
            if (sortVal === 'topvote') {
                result = await apiTopVote(200);
            } else if (sortVal === 'topclick') {
                result = await apiTopClick(200);
            } else if (sortVal === 'lastchange') {
                result = await apiRecent(200);
            } else if (sortVal === 'lastclick') {
                result = await apiSearchStations({
                    limit: '200',
                    offset: '0',
                    hidebroken: 'true',
                    order: 'clicktimestamp',
                    reverse: 'true'
                });
            } else {
                result = await apiTopVote(200);
            }

            if (result && result.success) {
                _onlineResults = result.data || [];
                renderCurrentPage();
                updateCount();
            }
        } catch (err) {
            console.error('[OnlineRadio] Load failed:', err);
            showListError('加载失败: ' + err.message);
        }
    }

    /** 加载更多（排行榜按排序追加 200 条，搜索追加 100 条） */
    async function loadMore() {
        if (_isLoading || _showFavorites || _noMore) return;
        _isLoading = true;
        updateLoadMoreBtn();
        try {
            const offset = _onlineResults.length;
            let result;
            let limit = 200;
            if (_currentMode === 'leaderboard') {
                // 排行榜模式：按当前排序方式从 offset 处追加
                const sortEl = document.getElementById('online-radio-sort');
                const sortVal = sortEl ? sortEl.value : 'topvote';
                if (sortVal === 'topvote') {
                    result = await apiTopVote(limit, offset);
                } else if (sortVal === 'topclick') {
                    result = await apiTopClick(limit, offset);
                } else if (sortVal === 'lastchange') {
                    result = await apiRecent(limit, offset);
                } else if (sortVal === 'lastclick') {
                    result = await apiSearchStations({
                        limit: '200',
                        offset: String(offset),
                        hidebroken: 'true',
                        order: 'clicktimestamp',
                        reverse: 'true'
                    });
                } else {
                    result = await apiTopVote(limit, offset);
                }
            } else {
                const params = {..._lastSearchParams, offset: String(offset)};
                limit = parseInt(params.limit) || 100;
                result = await apiSearchStations(params);
            }
            if (result && result.success) {
                const newData = result.data || [];
                if (newData.length < limit) _noMore = true;  // 返回不足一页说明已到尽头
                _onlineResults = _onlineResults.concat(newData);
                renderCurrentPage();
                updateCount();
            }
        } catch (err) {
            console.error('[OnlineRadio] LoadMore failed:', err);
        } finally {
            _isLoading = false;
            updateLoadMoreBtn();
        }
    }

    /** 搜索（获取 100 条缓存） */
    async function search() {
        const inputEl = document.getElementById('online-radio-search-input');
        const countryEl = document.getElementById('online-radio-filter-country');
        const tagEl = document.getElementById('online-radio-filter-tag');
        const langEl = document.getElementById('online-radio-filter-language');
        const codecEl = document.getElementById('online-radio-filter-codec');
        const orderEl = document.getElementById('online-radio-order');

        const name = inputEl ? inputEl.value.trim() : '';
        const country = countryEl ? countryEl.value : '';
        const tag = tagEl ? tagEl.value : '';
        const language = langEl ? langEl.value : '';
        const codec = codecEl ? codecEl.value : '';

        _currentMode = 'search';
        _currentPage = 1;
        _onlineResults = [];
        _noMore = false;
        showListLoading();

        try {
            const params = {limit: '100', offset: '0', hidebroken: 'true'};
            if (name) params.name = name;
            if (country) params.country = country;
            if (tag) params.tag = tag;
            if (language) params.language = language;
            if (codec) params.codec = codec;
            params.order = orderEl ? orderEl.value : 'name';
            _lastSearchParams = {...params};

            const result = await apiSearchStations(params);
            if (result && result.success) {
                _onlineResults = result.data || [];
                renderCurrentPage();
                updateCount();
            }
        } catch (err) {
            console.error('[OnlineRadio] Search failed:', err);
            showListError('搜索失败: ' + err.message);
        }
    }

    /** 重置筛选 */
    async function resetFilters() {
        const inputEl = document.getElementById('online-radio-search-input');
        const countryEl = document.getElementById('online-radio-filter-country');
        const tagEl = document.getElementById('online-radio-filter-tag');
        const langEl = document.getElementById('online-radio-filter-language');
        const codecEl = document.getElementById('online-radio-filter-codec');
        const sortEl = document.getElementById('online-radio-sort');
        const orderEl = document.getElementById('online-radio-order');

        if (inputEl) inputEl.value = '';
        if (countryEl) countryEl.value = '';
        if (tagEl) tagEl.value = '';
        if (langEl) langEl.value = '';
        if (codecEl) codecEl.value = '';
        if (orderEl) orderEl.value = 'name';
        if (sortEl) {
            sortEl.value = '';
            await onSortChange(sortEl.value);
        } else {
            await loadDefaultList();
        }
    }

    /** 排行榜下拉变化时触发 */
    async function onSortChange(value) {
        await loadDefaultList();
    }

    /** 加载分类下拉选项 */
    async function loadCategories() {
        try {
            const [countriesRes, tagsRes, languagesRes, codecsRes] = await Promise.all([
                apiCategory('countries', {limit: '200', order: 'stationcount', reverse: 'true'}),
                apiCategory('tags', {limit: '100', order: 'stationcount', reverse: 'true'}),
                apiCategory('languages', {limit: '100', order: 'stationcount', reverse: 'true'}),
                apiCategory('codecs', {limit: '50', order: 'stationcount', reverse: 'true'})
            ]);

            // 国家下拉特殊处理：显示 emoji 国旗
            fillCountrySelect('online-radio-filter-country', countriesRes, '全部国家');
            fillSelect('online-radio-filter-tag', tagsRes, 'name', '全部标签');
            fillSelect('online-radio-filter-language', languagesRes, 'name', '全部语言');
            fillSelect('online-radio-filter-codec', codecsRes, 'name', '全部编码');
        } catch (err) {
            console.error('[OnlineRadio] LoadCategories failed:', err);
        }
    }

    /** 国家下拉：显示 emoji 国旗 */
    function fillCountrySelect(selectId, result, defaultLabel) {
        const el = document.getElementById(selectId);
        if (!el || !result || !result.success) return;
        const items = result.data || [];
        el.innerHTML = `<option value="">${defaultLabel}</option>`;
        items.forEach(item => {
            const val = item.name || '';
            if (!val) return;
            const flag = countryToFlag(item.iso_3166_1);
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = flag ? `${flag} ${val}` : val;
            el.appendChild(opt);
        });
    }

    function fillSelect(selectId, result, key, defaultLabel) {
        const el = document.getElementById(selectId);
        if (!el || !result || !result.success) return;
        const items = result.data || [];
        el.innerHTML = `<option value="">${defaultLabel}</option>`;
        items.forEach(item => {
            const val = item[key] || item.name || '';
            if (!val) return;
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            el.appendChild(opt);
        });
    }

    // ==================== 收藏管理 ====================

    /** 加载收藏列表 */
    async function loadFavorites() {
        try {
            const result = await apiGetFavorites();
            if (result && result.success) {
                _favoriteList = result.data || [];
            }
        } catch (err) {
            console.error('[OnlineRadio] LoadFavorites failed:', err);
        }
    }

    /** 切换收藏状态 */
    async function toggleFavorite() {
        if (!_currentStation) return;
        const uuid = _currentStation.stationuuid;
        const favorited = isFavorited(uuid);

        try {
            if (favorited) {
                await apiRemoveFavorite(uuid);
                _favoriteList = _favoriteList.filter(s => s.stationuuid !== uuid);
            } else {
                await apiAddFavorite(_currentStation);
                if (!isFavorited(uuid)) {
                    _favoriteList.push(_currentStation);
                }
            }
            updateFavoriteBtn();
            // 如果在收藏模式下，刷新列表
            if (_showFavorites) {
                renderCurrentPage();
                updateCount();
            }
        } catch (err) {
            console.error('[OnlineRadio] ToggleFavorite failed:', err);
        }
    }

    /** 切换在线/收藏模式 */
    async function toggleMode() {
        // 保存当前模式的页码
        if (_showFavorites) {
            _lastFavPage = _currentPage;
        } else {
            _lastOnlinePage = _currentPage;
        }
        _showFavorites = !_showFavorites;
        // 恢复目标模式的页码
        if (_showFavorites) {
            _currentPage = _lastFavPage;
            await loadFavorites();
        } else {
            _currentPage = _lastOnlinePage;
        }
        renderCurrentPage();
        updateCount();
    }

    /** 更新收藏按钮图标 */
    function updateFavoriteBtn() {
        const btn = document.getElementById('online-radio-fav-btn');
        if (!btn || !_currentStation) return;
        const favorited = isFavorited(_currentStation.stationuuid);
        if (favorited) {
            btn.innerHTML = '<i class="fas fa-heart text-red-400"></i>';
            btn.title = '取消收藏';
        } else {
            btn.innerHTML = '<i class="far fa-heart"></i>';
            btn.title = '收藏';
        }
    }

    // ==================== 分页 ====================

    /** 获取当前数据源 */
    function getCurrentDataSource() {
        return _showFavorites ? _favoriteList : _onlineResults;
    }

    /** 获取总页数 */
    function getTotalPages() {
        const data = getCurrentDataSource();
        return Math.max(1, Math.ceil(data.length / _pageSize));
    }

    /** 获取当前页数据 */
    function getCurrentPageData() {
        const data = getCurrentDataSource();
        const start = (_currentPage - 1) * _pageSize;
        return data.slice(start, start + _pageSize);
    }

    /** 跳转到指定页（在线模式翻过最后一页时自动加载更多） */
    async function goToPage(page) {
        let total = getTotalPages();
        if (page < 1) page = 1;
        // 在线模式：尝试翻页超过当前最后一页时，先加载更多再跳转
        if (!_showFavorites && !_noMore && page > total && _onlineResults.length > 0) {
            await loadMore();
            total = getTotalPages();
        }
        if (page > total) page = total;
        _currentPage = page;
        // 同步记录当前模式的页码
        if (_showFavorites) {
            _lastFavPage = page;
        } else {
            _lastOnlinePage = page;
        }
        renderCurrentPage();
    }

    /** 渲染当前页列表 + 分页控件 */
    function renderCurrentPage() {
        const pageData = getCurrentPageData();
        renderStationList(pageData);
        renderPagination();
    }

    /** 渲染分页控件（三段式：左导航 | 中切换 | 右加载更多） */
    function renderPagination() {
        const pagEl = document.getElementById('online-radio-pagination');
        if (!pagEl) return;

        const data = getCurrentDataSource();
        const total = getTotalPages();

        // 始终显示分页栏（包含切换按钮），即使数据为空
        pagEl.classList.remove('hidden');

        // 左侧: 上一页/下一页 + 页码信息（有数据时才显示）
        const navEl = document.getElementById('online-radio-nav-btns');
        if (navEl) {
            if (data.length > 0) {
                // 在线模式且有更多数据时，下一页始终可点（翻过最后一页会自动加载更多）
                const nextDisabled = (_currentPage === total && (_showFavorites || _noMore)) || _isLoading;
                navEl.innerHTML = `
                    <button title="上一页" onclick="window.OnlineRadioManager.goToPage(${_currentPage - 1})" class="pg-btn" ${_currentPage === 1 ? 'disabled' : ''}>‹</button>
                    <button title="下一页" onclick="window.OnlineRadioManager.goToPage(${_currentPage + 1})" class="pg-btn" ${nextDisabled ? 'disabled' : ''}>›</button>
                    <span class="text-[10px] t-text-dim px-1.5">${_currentPage}/${total}</span>
                `;
            } else {
                navEl.innerHTML = '';
            }
        }

        // 中间: 在线/收藏切换（始终显示）
        const toggleEl = document.getElementById('online-radio-mode-toggle');
        if (toggleEl) {
            const onlineActive = !_showFavorites;
            const favActive = _showFavorites;
            toggleEl.innerHTML = `
                <button onclick="window.OnlineRadioManager.switchMode(false)"
                title="在线"
                        class="px-2 py-0.5 text-[11px] rounded-l border transition-colors ${onlineActive ? 'bg-emerald-500 text-white border-emerald-500' : 't-text-muted hover:t-bg-main t-border-main'}">
                    <i class="fas fa-globe mr-0.5"></i>
                </button>
                <button onclick="window.OnlineRadioManager.switchMode(true)"
                title="收藏"
                        class="px-2 py-0.5 text-[11px] rounded-r border-t border-b border-r transition-colors ${favActive ? 'bg-red-500 text-white border-red-500' : 't-text-muted hover:t-bg-main t-border-main'}">
                    <i class="fas fa-heart mr-0.5"></i>
                </button>
            `;
        }

        // 右侧: 加载更多（仅在线模式且有数据时显示）
        const loadMoreEl = document.getElementById('online-radio-load-more');
        if (loadMoreEl) {
            if (_showFavorites || data.length === 0) {
                loadMoreEl.innerHTML = '';
            } else if (_noMore) {
                // 已加载全部
                loadMoreEl.innerHTML = `
                    <button disabled class="pg-btn text-[10px] px-2 opacity-40 cursor-not-allowed">
                        <i class="fas fa-chevron-down"></i> 已加载全部
                    </button>`;
            } else {
                // 排行榜/搜索模式：正常加载更多
                loadMoreEl.innerHTML = `
                    <button onclick="window.OnlineRadioManager.loadMore()" id="online-radio-load-more-btn"
                            class="pg-btn text-[10px] px-2" ${_isLoading ? 'disabled' : ''}>
                        ${_isLoading ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-chevron-down"></i>'}
                        加载更多
                    </button>
                `;
            }
        }
    }

    /** 切换模式（公开接口） */
    async function switchMode(showFav) {
        if (_showFavorites === showFav) return;
        await toggleMode();
    }

    /** 更新加载更多按钮状态 */
    function updateLoadMoreBtn() {
        const btn = document.getElementById('online-radio-load-more-btn');
        if (btn) {
            btn.disabled = _isLoading;
            btn.innerHTML = _isLoading
                ? '<i class="fas fa-spinner fa-spin"></i> 加载中...'
                : '<i class="fas fa-chevron-down"></i> 加载更多';
        }
    }

    // ==================== 渲染层 ====================

    /** 渲染电台列表（仅当前页数据） */
    function renderStationList(stations) {
        const listEl = document.getElementById('online-radio-station-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (!stations || stations.length === 0) {
            const emptyMsg = _showFavorites
                ? '<p>暂无收藏</p><p class="text-xs mt-1">点击电台详情中的 ❤ 按钮添加收藏</p>'
                : '<p>暂无结果</p><p class="text-xs mt-1">尝试调整搜索条件</p>';
            listEl.innerHTML = `
                <div class="p-4 text-center t-text-muted text-sm">
                    <i class="fas fa-globe text-2xl mb-2 opacity-30"></i>
                    ${emptyMsg}
                </div>`;
            return;
        }

        stations.forEach((station, index) => {
            // 电台之间添加细分隔线（第一项之前不加）
            if (index > 0) {
                const divider = document.createElement('div');
                divider.className = 'border-b t-border-main opacity-20 mx-3';
                listEl.appendChild(divider);
            }
            listEl.appendChild(createStationItem(station, index));
        });
    }

    /** 创建电台列表项 */
    function createStationItem(station, index) {
        const div = document.createElement('div');
        div.className = 'group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:t-bg-main transition-colors border border-transparent hover:t-border-main';
        div.dataset.uuid = station.stationuuid;

        const isActive = _currentStation && _currentStation.stationuuid === station.stationuuid;
        if (isActive) {
            // 当前正在播放的电台：非常明显的高亮样式
            div.className = 'group flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border-l-4';
            div.classList.add(
                'bg-emerald-500/25', 'dark:bg-emerald-500/30',
                'border-l-emerald-500', 'border-t-emerald-500/30', 'border-r-emerald-500/30', 'border-b-emerald-500/30',
                'shadow-sm', 'shadow-emerald-500/10'
            );
        }

        // 封面（正在播放时显示动态 EQ 图标）
        let coverHtml;
        if (isActive) {
            // 正在播放：显示 EQ 动画覆盖层
            coverHtml = `
                <div class="relative w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden">
                    ${station.favicon
                ? `<img src="${escapeHtml(station.favicon)}" class="w-full h-full object-cover" onerror="this.style.display='none'">`
                : `<div class="w-full h-full t-bg-main flex items-center justify-center"><i class="fas fa-globe text-sm t-text-dim opacity-40"></i></div>`
            }
                    <div class="absolute inset-0 bg-black/40 flex items-end justify-center pb-0.5 gap-0.5">
                        <span class="w-0.5 bg-emerald-400 animate-eq-bar" style="animation-delay: 0s"></span>
                        <span class="w-0.5 bg-emerald-400 animate-eq-bar" style="animation-delay: 0.2s"></span>
                        <span class="w-0.5 bg-emerald-400 animate-eq-bar" style="animation-delay: 0.4s"></span>
                        <span class="w-0.5 bg-emerald-400 animate-eq-bar" style="animation-delay: 0.1s"></span>
                    </div>
                </div>`;
        } else {
            coverHtml = station.favicon
                ? `<img src="${escapeHtml(station.favicon)}" class="w-10 h-10 rounded-lg object-cover flex-shrink-0 t-bg-main" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                   <div class="w-10 h-10 rounded-lg t-bg-main flex items-center justify-center flex-shrink-0 hidden"><i class="fas fa-globe text-sm t-text-dim opacity-40"></i></div>`
                : `<div class="w-10 h-10 rounded-lg t-bg-main flex items-center justify-center flex-shrink-0"><i class="fas fa-globe text-sm t-text-dim opacity-40"></i></div>`;
        }

        // 信息
        const name = escapeHtml(station.name || '未知电台');
        const flag = countryToFlag(station.countrycode);
        const country = station.country ? escapeHtml(station.country) : '';
        const tags = station.tags ? escapeHtml(station.tags.substring(0, 40)) : '';
        const votes = station.votes || 0;
        const codecBadge = codecBadgeHtml(station.codec);
        const bitrateBadge = bitrateBadgeHtml(station.bitrate);

        // 名称（正在播放时加粗并显示指示器）
        const nameClass = isActive ? 'text-xs font-bold text-emerald-600 dark:text-emerald-400 truncate' : 'text-xs font-medium t-text-main truncate';
        const playingTag = isActive ? '<span class="text-[9px] bg-emerald-500 text-white px-1 py-0 rounded ml-1">播放中</span>' : '';

        div.innerHTML = `
            ${coverHtml}
            <div class="flex-1 min-w-0">
                <div class="${nameClass}">${name}${playingTag}</div>
                <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    ${flag ? `<span class="text-xs">${flag}</span>` : ''}
                    ${country ? `<span class="text-[10px] t-text-dim truncate">${country}</span>` : ''}
                    ${codecBadge}
                    ${bitrateBadge}
                </div>
                ${tags ? `<div class="text-[10px] t-text-dim truncate mt-0.5">${tags}</div>` : ''}
            </div>
            <div class="flex-shrink-0 text-[10px] t-text-dim flex items-center gap-1">
                <i class="fas fa-thumbs-up opacity-40"></i>
                <span>${votes}</span>
            </div>`;

        div.onclick = () => selectStation(station);
        return div;
    }

    /** 选中电台 */
    function selectStation(station) {
        _currentStation = station;
        // 重新渲染列表以更新播放状态样式
        renderCurrentPage();
        renderDetail(station);
        playStation(station);
        // 手机模式 sidebar 常驻显示，不再关闭抽屉
    }

    /** 高亮当前选中电台（简单版本，用于不需要完全重绘的场景） */
    function highlightCurrentStation() {
        const listEl = document.getElementById('online-radio-station-list');
        if (!listEl) return;
        // 完全重绘列表以显示正确的播放状态
        renderCurrentPage();
    }

    /** 渲染详情面板 */
    function renderDetail(station) {
        const emptyEl = document.getElementById('online-radio-detail-empty');
        const contentEl = document.getElementById('online-radio-detail-content');
        if (emptyEl) emptyEl.classList.add('hidden');
        if (contentEl) contentEl.classList.remove('hidden');

        // 名称
        const nameEl = document.getElementById('online-radio-detail-name');
        if (nameEl) nameEl.textContent = station.name || '未知电台';

        // 主页
        const homepageEl = document.getElementById('online-radio-detail-homepage');
        if (homepageEl) {
            if (station.homepage) {
                homepageEl.href = station.homepage;
                homepageEl.textContent = station.homepage;
                homepageEl.title = station.homepage;
                homepageEl.classList.remove('hidden');
            } else {
                homepageEl.classList.add('hidden');
            }
        }

        // 封面
        const coverEl = document.getElementById('online-radio-detail-cover');
        if (coverEl) {
            if (station.favicon) {
                coverEl.innerHTML = `<img src="${escapeHtml(station.favicon)}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-music text-2xl t-text-dim opacity-40\\'></i>'">`;
            } else {
                coverEl.innerHTML = '<i class="fas fa-music text-2xl t-text-dim opacity-40"></i>';
            }
        }

        // 编码 badge（系统 badge 样式）
        const codecEl = document.getElementById('online-radio-detail-codec');
        if (codecEl) {
            if (station.codec) {
                const cls = getCodecBadgeClass(station.codec);
                codecEl.className = `${BADGE_BASE} ${cls}`;
                codecEl.textContent = station.codec.toUpperCase();
                codecEl.classList.remove('hidden');
            } else {
                codecEl.classList.add('hidden');
            }
        }

        // 码率 badge
        const bitrateEl = document.getElementById('online-radio-detail-bitrate');
        if (bitrateEl) {
            if (station.bitrate) {
                bitrateEl.textContent = station.bitrate + 'k';
                bitrateEl.classList.remove('hidden');
            } else {
                bitrateEl.classList.add('hidden');
            }
        }

        // 票数
        const votesEl = document.getElementById('online-radio-detail-votes');
        if (votesEl) {
            votesEl.textContent = station.votes ? `❤ ${station.votes} 票` : '';
        }

        // 国家（含国旗 emoji）
        const flag = countryToFlag(station.countrycode);
        const countryEl = document.getElementById('online-radio-detail-country');
        if (countryEl) {
            const countryText = station.country ? `${flag} ${station.country}` : '';
            countryEl.textContent = countryText;
        }

        // 语言/标签
        const langEl = document.getElementById('online-radio-detail-language');
        if (langEl) langEl.textContent = station.language ? `🗣 ${station.language}` : '';
        const tagsEl = document.getElementById('online-radio-detail-tags');
        if (tagsEl) tagsEl.textContent = station.tags ? `🏷 ${station.tags}` : '';

        // 信息面板（去重 + 两列 + 流 URL）
        renderInfoPanel(station);

        // 更新收藏按钮状态
        updateFavoriteBtn();

        // 重置播放状态
        updatePlayBtn();
        const statusEl = document.getElementById('online-radio-play-status');
        if (statusEl) statusEl.textContent = '未播放';
        hideStreamModeDisplay();
        const durationEl = document.getElementById('online-radio-play-duration');
        if (durationEl) durationEl.classList.add('hidden');
        const bufferingEl = document.getElementById('online-radio-buffering');
        if (bufferingEl) bufferingEl.classList.add('hidden');
        const errorEl = document.getElementById('online-radio-error');
        if (errorEl) errorEl.classList.add('hidden');
    }

    /** 渲染详细信息面板（简洁 label-value 风格，与 radio-info-panel 一致） */
    function renderInfoPanel(station) {
        const panelEl = document.getElementById('online-radio-info-panel');
        if (!panelEl) return;

        const rows = [];
        if (station.state) rows.push(['地区', station.state]);
        if (station.url) rows.push(['流 URL', station.url, true]);
        if (station.tags) rows.push(['标签', station.tags]);
        if (station.lastchangetime) rows.push(['最后更新', new Date(station.lastchangetime).toLocaleString()]);

        let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
        rows.forEach(([label, value, isLink]) => {
            html += `<div class="flex items-center gap-2 text-xs">
                <span class="t-text-muted font-medium min-w-[60px] flex-shrink-0">${label}</span>
                ${isLink
                ? `<a href="${escapeHtml(value)}" target="_blank" class="text-gray-600 dark:text-gray-300 hover:text-blue-500 truncate" title="${escapeHtml(value)}">${escapeHtml(value)}</a>`
                : `<span class="text-gray-700 dark:text-gray-300 break-words">${escapeHtml(String(value))}</span>`
            }
            </div>`;
        });
        html += '</div>';

        panelEl.innerHTML = html;
    }

    // ==================== 投屏推流 (DLNA / AirPlay Casting) ====================

    /** 检查投屏设备并推流到 DLNA/AirPlay */
    function checkAndCastToScreen(station) {
        // 检查 DLNA 投屏
        if (window._upnpActiveDeviceId && window._upnpPlaySongHook) {
            const castSong = buildCastSong(station);
            if (window._upnpPlaySongHook(castSong, station.url)) {
                _isPlaying = true;
                updatePlayBtn();
                startDurationTimer();
                updateBottomBar(station);
                apiClickStation(station.stationuuid).catch(() => {
                });
                const statusEl = document.getElementById('online-radio-play-status');
                if (statusEl) statusEl.textContent = '投屏播放中';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = '投屏播放中';
                return true;
            }
        }
        // 检查 AirPlay 投屏
        if (window.AirPlayState && window.AirPlayState.activeDeviceId && window._upnpPlaySongHook) {
            const castSong = buildCastSong(station);
            if (window._upnpPlaySongHook(castSong, station.url)) {
                _isPlaying = true;
                updatePlayBtn();
                startDurationTimer();
                updateBottomBar(station);
                apiClickStation(station.stationuuid).catch(() => {
                });
                const statusEl = document.getElementById('online-radio-play-status');
                if (statusEl) statusEl.textContent = 'AirPlay 投屏中';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = 'AirPlay 投屏中';
                return true;
            }
        }
        return false;
    }

    /** 构建投屏用的 song 对象 */
    function buildCastSong(station) {
        return {
            id: 'online_radio_' + station.stationuuid,
            name: station.name,
            singer: '',
            albumName: station.country || '在线电台',
            source: 'online-radio',
            songmid: 'online_radio_' + station.stationuuid,
            interval: '',
            quality: station.codec || '',
            img: station.favicon || null,
            relativePath: null,
            _isMusicLibSong: false,
            directUrl: station.url,
        };
    }

    // ==================== 播放控制 ====================

    function playStation(station) {
        if (!station || !station.url) return;

        // 检查投屏模式
        if (checkAndCastToScreen(station)) return;

        // [Fix] 使用 removeAttribute('src') 而非 src=''，避免虚假 error 事件
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
        }

        window.currentPlayingScope = 'online-radio';
        window.currentPlayingSong = null;
        // 清除上一首歌曲的 UI 残留（侧边栏/音频标签/详情页/收藏按钮）
        if (typeof window.clearSongPlayerInfo === 'function') window.clearSongPlayerInfo();
        // 隐藏底部 Footer Visualizer（电台有自己的可视化组件）
        const vizContainer = document.getElementById('visualizer-container');
        if (vizContainer) vizContainer.style.display = 'none';
        _corsRetried = false;
        _streamModeQueried = false;

        if (audio) {
            audio.volume = typeof window.currentVolume !== 'undefined' ? window.currentVolume : 0.75;
            audio.muted = false;

            // 检查 Web Audio API 的 MediaElementSource 是否已在之前的歌曲播放中创建
            // 如果已创建，跨域音频会被 Web Audio 静音（输出零值），必须走服务端代理（同源）
            const hasMediaSource = !!(window.soundEffects && window.soundEffects.getAudioContext());
            console.log('[OnlineRadio]', hasMediaSource ? 'proxy (Web Audio active)' : 'direct', '|', station.url);

            // 代理 URL 同源 → 设置 crossorigin（可视化可用）
            // 直连跨域 URL → 移除 crossorigin（避免 CORS block，可视化不可用）
            if (hasMediaSource) {
                audio.setAttribute('crossorigin', 'anonymous');
            } else {
                audio.removeAttribute('crossorigin');
            }

            // 智能选择 URL：MediaElementSource 已存在时走代理（同源），否则直连
            const streamUrl = hasMediaSource ? buildStreamProxyUrl(station.url, station.stationuuid) : station.url;
            audio.src = streamUrl;

            // 直连场景：立即显示默认值（不涉及后端缓存）
            // 代理场景：交给 playing 事件延迟查询（等后端写完 streamInfo 缓存）
            if (!hasMediaSource) {
                updateStreamModeDisplay('direct', 'passthrough', station.codec || '', station.codec || '', false);
            }

            const playPromise = audio.play();
            if (playPromise) {
                playPromise.then(() => {
                    _isPlaying = true;
                    updatePlayBtn();
                    startDurationTimer();
                    updateBottomBar(station);
                    startVisualizer();
                    apiClickStation(station.stationuuid).catch(() => {
                    });
                }).catch(err => {
                    if (err.name === 'AbortError') return;
                    if (!_corsRetried) {
                        console.error('[OnlineRadio] Play failed:', err.message);
                        _isPlaying = false;
                        updatePlayBtn();
                        showPlayError(err.message || '播放失败');
                    }
                });
            }
        }
    }

    function pauseStation() {
        if (audio) audio.pause();
        _isPlaying = false;
        updatePlayBtn();
        stopDurationTimer();
        const statusEl = document.getElementById('online-radio-play-status');
        if (statusEl) statusEl.textContent = '已暂停';
        const playerStatusEl = document.getElementById('player-status');
        if (playerStatusEl) playerStatusEl.textContent = '在线电台已暂停';
    }

    function togglePlay() {
        if (!_currentStation) return;

        // DLNA 投屏：通过 WS 控制 DMC 暂停/恢复（pauseStation 只暂停本地 audio，对投屏设备无效）
        if (typeof _upnpActiveDeviceId !== 'undefined' && _upnpActiveDeviceId) {
            const isPlaying = typeof _dlnaLastPlayState !== 'undefined'
                && (_dlnaLastPlayState === 'PLAYING' || _dlnaLastPlayState === 'TRANSITIONING');
            if (isPlaying) {
                window.sendDlnaCommand('pause', {});
                _isPlaying = false;
                updatePlayBtn();
                stopDurationTimer();
                const statusEl = document.getElementById('online-radio-play-status');
                if (statusEl) statusEl.textContent = '已暂停';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = '在线电台已暂停';
            } else {
                window.sendDlnaCommand('resume', {});
                _isPlaying = true;
                updatePlayBtn();
                startDurationTimer();
                const statusEl = document.getElementById('online-radio-play-status');
                if (statusEl) statusEl.textContent = '投屏播放中';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = '投屏播放中';
            }
            return;
        }

        // AirPlay 投屏：通过 AirPlay WS 控制
        if (typeof AirPlayState !== 'undefined' && AirPlayState.activeDeviceId
            && typeof _castDeviceType !== 'undefined' && _castDeviceType === 'airplay') {
            const isPlaying = typeof AirPlayState.lastPlayState !== 'undefined'
                && (AirPlayState.lastPlayState === 'PLAYING' || AirPlayState.lastPlayState === 'TRANSITIONING');
            if (isPlaying) {
                window.sendAirPlayCommand('pause', {});
                _isPlaying = false;
                updatePlayBtn();
                stopDurationTimer();
                const statusEl = document.getElementById('online-radio-play-status');
                if (statusEl) statusEl.textContent = '已暂停';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = '在线电台已暂停';
            } else {
                window.sendAirPlayCommand('resume', {});
                _isPlaying = true;
                updatePlayBtn();
                startDurationTimer();
                const statusEl = document.getElementById('online-radio-play-status');
                if (statusEl) statusEl.textContent = 'AirPlay 投屏中';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = 'AirPlay 投屏中';
            }
            return;
        }

        // 非投屏：原有逻辑
        if (_isPlaying) {
            pauseStation();
        } else {
            playStation(_currentStation);
        }
    }

    /** 切换到下一个电台（底部播放栏上一首/下一首） */
    function playNextStation() {
        const data = getCurrentDataSource();
        if (!data.length || !_currentStation) return;
        const idx = data.findIndex(s => s.stationuuid === _currentStation.stationuuid);
        const nextIdx = (idx + 1) % data.length;
        selectStation(data[nextIdx]);
    }

    /** 切换到上一个电台 */
    function playPrevStation() {
        const data = getCurrentDataSource();
        if (!data.length || !_currentStation) return;
        const idx = data.findIndex(s => s.stationuuid === _currentStation.stationuuid);
        const prevIdx = (idx - 1 + data.length) % data.length;
        selectStation(data[prevIdx]);
    }

    function updatePlayBtn() {
        const btn = document.getElementById('online-radio-play-btn');
        if (btn) {
            btn.innerHTML = _isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
        }
    }

    function startDurationTimer() {
        stopDurationTimer();
        _durationSeconds = 0;
        const durationEl = document.getElementById('online-radio-play-duration');
        if (durationEl) durationEl.classList.remove('hidden');

        _durationTimer = setInterval(() => {
            _durationSeconds++;
            const h = String(Math.floor(_durationSeconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((_durationSeconds % 3600) / 60)).padStart(2, '0');
            const s = String(_durationSeconds % 60).padStart(2, '0');
            if (durationEl) durationEl.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    function stopDurationTimer() {
        if (_durationTimer) {
            clearInterval(_durationTimer);
            _durationTimer = null;
        }
    }

    function showPlayError(msg) {
        const errorEl = document.getElementById('online-radio-error');
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
        }
        const statusEl = document.getElementById('online-radio-play-status');
        if (statusEl) statusEl.textContent = '播放失败';
        hideStreamModeDisplay();
    }

    // ==================== 底部播放栏同步 ====================

    function updateBottomBar(station) {
        const titleEl = document.getElementById('player-title');
        if (titleEl) {
            titleEl.textContent = station.name;
            titleEl.setAttribute('data-text', station.name);
        }
        const artistEl = document.getElementById('player-artist');
        if (artistEl) {
            const artistText = [station.country, station.language].filter(Boolean).join(' / ') || '在线电台';
            artistEl.textContent = artistText;
            artistEl.setAttribute('data-text', artistText);
        }
        const coverEl = document.getElementById('player-cover');
        if (coverEl) {
            if (station.favicon) {
                coverEl.src = station.favicon;
                coverEl.style.display = '';
            } else {
                coverEl.style.display = 'none';
            }
        }
        const sourceEl = document.getElementById('player-source');
        if (sourceEl) {
            /*      const codecInfo = station.codec ? `${station.codec}` : '';
                  const bitrateInfo = station.bitrate ? ` ${station.bitrate}k` : '';
                  sourceEl.textContent = codecInfo || bitrateInfo
                      ? `在线电台 · ${codecInfo}${bitrateInfo}`.trim()
                      : '在线电台';*/
            sourceEl.innerHTML = '<i class="fas fa-globe text-blue-500 text-xs md:text-sm">'
        }

        const footerAudioInfo = document.getElementById('footer-audio-info');
        if (footerAudioInfo) {
            // 构造 audio-tag 标签，与歌曲播放时的 updateAudioInfoTags() 样式保持一致
            const tags = [];
            if (station.codec) tags.push(`<span class="audio-tag">${station.codec.toUpperCase()}</span>`);
            if (station.bitrate) tags.push(`<span class="audio-tag">${station.bitrate}Kbps</span>`);
            footerAudioInfo.innerHTML = tags.join('');
            footerAudioInfo.style.display = tags.length > 0 ? 'flex' : 'none';
        }
        const statusEl = document.getElementById('player-status');
        if (statusEl) statusEl.textContent = '播放中';
        if (typeof applyMarqueeChecks === 'function') applyMarqueeChecks();
    }

    // ==================== 流模式信息显示 ====================

    /** 更新流模式显示（直连/代理 · 透传/转码 · 缓存TAG） */
    function updateStreamModeDisplay(connection, mode, sourceCodec, targetCodec, cached) {
        const el = document.getElementById('online-radio-stream-mode');
        if (!el) return;
        const connLabel = connection === 'proxy' ? '代理' : '直连';
        let modeLabel;
        if (mode === 'passthrough' || mode === 'copy') {
            modeLabel = '透传';
        } else if (mode === 'transcode') {
            const src = (sourceCodec || '?').toUpperCase();
            const tgt = (targetCodec || '?').toUpperCase();
            modeLabel = `转码 ${src}→${tgt}`;
        } else if (mode === 'remux') {
            const src = (sourceCodec || '?').toUpperCase();
            const tgt = (targetCodec || '?').toUpperCase();
            modeLabel = `重封装 ${src}→${tgt}`;
        } else {
            modeLabel = mode;
        }
        let text = `${connLabel} · ${modeLabel}`;
        if (cached) text += ' <span class="inline-block px-1 py-0.5 rounded text-[10px] leading-none bg-green-500/20 text-green-500 font-medium align-middle">缓存</span>';
        el.innerHTML = text;
        el.classList.remove('hidden');
    }

    /** 隐藏流模式显示 */
    function hideStreamModeDisplay() {
        const el = document.getElementById('online-radio-stream-mode');
        if (el) {
            el.textContent = '';
            el.classList.add('hidden');
        }
    }

    /** 播放成功后延迟查询流模式信息（读后端缓存，无上游连接）
     *  直连透传不写缓存，2s 后读不到 → 默认"直连 · 透传" */
    function queryStreamModeInfo(stationId) {
        setTimeout(async () => {
            if (!stationId || window.currentPlayingScope !== 'online-radio') return;
            try {
                const res = await fetch(`/api/online-radio/stream-info?id=${encodeURIComponent(stationId)}`);
                if (res.ok) {
                    const {data} = await res.json();
                    if (data) {
                        updateStreamModeDisplay(data.connection, data.mode, data.sourceCodec, data.targetCodec, data.cached);
                        return;
                    }
                }
            } catch (_) {
            }
            // 未查到（直连透传不缓存 / 后端尚未就绪）→ 默认显示
            updateStreamModeDisplay('direct', 'passthrough', '', '', false);
        }, 1000);
    }

    // ==================== 音频事件监听 ====================

    function bindAudioEvents() {
        if (!audio) return;

        audio.addEventListener('playing', () => {
            if (window.currentPlayingScope !== 'online-radio') return;
            _isPlaying = true;
            updatePlayBtn();
            const statusEl = document.getElementById('online-radio-play-status');
            if (statusEl) statusEl.textContent = '正在播放';
            const bufferingEl = document.getElementById('online-radio-buffering');
            if (bufferingEl) bufferingEl.classList.add('hidden');
            const errorEl = document.getElementById('online-radio-error');
            if (errorEl) errorEl.classList.add('hidden');

            if (window.soundEffects && window.soundEffects.getAudioContext) {
                const ctx = window.soundEffects.getAudioContext();
                if (ctx && ctx.state === 'suspended') ctx.resume();
            }

            // 代理场景：audio 真正播放后延迟 2s 查询流模式（后端已写入缓存）
            if (!_streamModeQueried && window.soundEffects && window.soundEffects.getAudioContext()) {
                _streamModeQueried = true;
                queryStreamModeInfo(_currentStation ? _currentStation.stationuuid : null);
            }
        });

        audio.addEventListener('waiting', () => {
            if (window.currentPlayingScope !== 'online-radio') return;
            const bufferingEl = document.getElementById('online-radio-buffering');
            if (bufferingEl) bufferingEl.classList.remove('hidden');
            const statusEl = document.getElementById('online-radio-play-status');
            if (statusEl) statusEl.textContent = '缓冲中...';
        });

        audio.addEventListener('error', () => {
            if (window.currentPlayingScope !== 'online-radio') return;
            if (!audio.currentSrc) return;
            if (audio.error && audio.error.code === MediaError.MEDIA_ERR_ABORTED) return;

            console.warn('[OnlineRadio] error: code=' + (audio.error ? audio.error.code : 'null'),
                '| currentSrc:', audio.currentSrc, '| _corsRetried:', _corsRetried);

            // [Fix] 智能回退：首次失败时尝试服务端代理
            // 原因可能是：1) CORS 阻止 2) URL 返回 HTML 页面而非音频流（如 radio.co /listen）
            // 代理可以解析 HTML 提取实际流地址，同时解决 CORS 问题
            if (!_corsRetried && audio.error &&
                audio.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                _corsRetried = true;
                const proxyUrl = buildStreamProxyUrl(_currentStation ? _currentStation.url : audio.currentSrc, _currentStation ? _currentStation.stationuuid : null);
                console.warn('[OnlineRadio] Stream not supported, retrying via proxy:', proxyUrl);
                audio.setAttribute('crossorigin', 'anonymous');
                audio.src = proxyUrl;
                _streamModeQueried = false;  // 重置标志位，等 playing 事件触发后重新查询
                audio.load();
                audio.play().catch(() => {
                });
                return;
            }

            _isPlaying = false;
            updatePlayBtn();
            stopDurationTimer();
            const bufferingEl = document.getElementById('online-radio-buffering');
            if (bufferingEl) bufferingEl.classList.add('hidden');

            let errMsg = '播放失败';
            if (audio.error) {
                switch (audio.error.code) {
                    case MediaError.MEDIA_ERR_NETWORK:
                        errMsg = '网络错误';
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errMsg = '解码错误';
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errMsg = '音频格式不支持或流不可用';
                        break;
                }
            }
            showPlayError(errMsg);
        });

        audio.addEventListener('pause', () => {
            if (window.currentPlayingScope !== 'online-radio') return;
        });
    }

    // ==================== 可视化 ====================

    function initVisualizer() {
        // 无需手动初始化，由 visualizer.js renderTo() 内部处理
    }

    function startVisualizer() {
        const canvas = document.getElementById('online-radio-visualizer');
        if (!canvas || !window.musicVisualizer) return;
        // 无 crossorigin 时音频数据跨域，Web Audio API 无法访问（可视化不可用）
        if (!audio.hasAttribute('crossorigin')) return;
        // 确保 soundEffects 已初始化，否则 musicVisualizer.init() 会创建独立的 mediaSource，
        // 导致后续 soundEffects.init() 失败（同一 audio 元素不能创建两个 MediaElementSource）
        if (window.soundEffects && typeof window.soundEffects.init === 'function') {
            window.soundEffects.init();
        }
        const style = (window.settings || {}).footerVisualizerStyle || 'bars';
        window.musicVisualizer.renderTo(canvas, style);
    }

    function stopVisualizer() {
        const canvas = document.getElementById('online-radio-visualizer');
        if (canvas && window.musicVisualizer) {
            window.musicVisualizer.stopRender(canvas);
        }
    }

    /** 初始化 Visualizer 样式切换器（pill 箭头指示器，匹配全屏设计） */
    function renderVisStyleBar() {
        const bar = document.getElementById('online-radio-vis-style-bar');
        const container = document.getElementById('online-radio-visualizer-container');
        if (!bar || !container) return;

        const styles = (window.musicVisualizer && window.musicVisualizer.SPECTRUM_STYLES) || [];
        if (!styles.length) return;

        // 构建 pill 指示器 DOM（只创建一次）
        bar.innerHTML = `
            <button id="or-vis-arrow-left" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span id="or-vis-style-name" style="color:rgba(255,255,255,0.8);font-size:13px;font-weight:500;min-width:80px;text-align:center;letter-spacing:0.5px;"></span>
            <button id="or-vis-arrow-right" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        // 绑定箭头点击
        bar.querySelector('#or-vis-arrow-left').addEventListener('click', (e) => {
            e.stopPropagation();
            cycleVisStyle(-1);
        });
        bar.querySelector('#or-vis-arrow-right').addEventListener('click', (e) => {
            e.stopPropagation();
            cycleVisStyle(1);
        });

        // 初始化显示当前样式名
        updateVisStyleName();

        // --- JS mouseenter/mouseleave：同时控制样式栏和颜色模式栏 ---
        const colorBar = document.getElementById('online-radio-vis-colormode-bar');
        let _hideTimer = null;

        container.addEventListener('mouseenter', () => {
            clearTimeout(_hideTimer);
            bar.style.opacity = '1';
            bar.style.pointerEvents = 'auto';
            if (colorBar) {
                colorBar.style.opacity = '1';
                colorBar.style.pointerEvents = 'auto';
            }
        });

        container.addEventListener('mouseleave', () => {
            _hideTimer = setTimeout(() => {
                bar.style.opacity = '0';
                bar.style.pointerEvents = 'none';
                if (colorBar) {
                    colorBar.style.opacity = '0';
                    colorBar.style.pointerEvents = 'none';
                }
            }, 200);
        });
    }

    /** 初始化颜色模式切换器（pill 箭头指示器，与样式切换栏配对） */
    function renderColorModeBar() {
        const bar = document.getElementById('online-radio-vis-colormode-bar');
        if (!bar) return;

        const modes = (window.musicVisualizer && window.musicVisualizer.COLOR_MODES) || [];
        if (!modes.length) return;

        // 构建 pill 指示器 DOM（只创建一次）
        bar.innerHTML = `
            <button id="or-vis-colormode-arrow-left" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span id="or-vis-colormode-name" style="color:rgba(255,255,255,0.8);font-size:13px;font-weight:500;min-width:70px;text-align:center;letter-spacing:0.5px;"></span>
            <button id="or-vis-colormode-arrow-right" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        // 绑定箭头点击
        bar.querySelector('#or-vis-colormode-arrow-left').addEventListener('click', (e) => {
            e.stopPropagation();
            cycleColorMode(-1);
        });
        bar.querySelector('#or-vis-colormode-arrow-right').addEventListener('click', (e) => {
            e.stopPropagation();
            cycleColorMode(1);
        });

        // 初始化显示当前颜色模式名
        updateColorModeName();
    }

    /** 更新颜色模式指示器名称 */
    function updateColorModeName() {
        const modes = (window.musicVisualizer && window.musicVisualizer.COLOR_MODES) || [];
        const current = ((window.settings || {}).visualizerColorMode) || 'theme';
        const entry = modes.find(e => e.value === current);
        const nameEl = document.getElementById('or-vis-colormode-name');
        if (nameEl) nameEl.textContent = entry ? entry.name : current;
    }

    /** 循环切换颜色模式（方向：1=下一个，-1=上一个） */
    function cycleColorMode(direction) {
        if (window.musicVisualizer && typeof window.musicVisualizer.cycleColorMode === 'function') {
            window.musicVisualizer.cycleColorMode(direction);
        } else {
            // Fallback：内联实现
            const modes = (window.musicVisualizer && window.musicVisualizer.COLOR_MODES) || [];
            if (!modes.length) return;
            const current = ((window.settings || {}).visualizerColorMode) || 'theme';
            const idx = modes.findIndex(e => e.value === current);
            const newIdx = (idx + direction + modes.length) % modes.length;
            if (typeof window.updateSetting === 'function') {
                window.updateSetting('visualizerColorMode', modes[newIdx].value);
            }
        }
        // 更新本地指示器名称
        updateColorModeName();
        // 重启在线电台可视化以应用新颜色
        startVisualizer();
    }

    /** 更新指示器显示的样式名称 */
    function updateVisStyleName() {
        const styles = (window.musicVisualizer && window.musicVisualizer.SPECTRUM_STYLES) || [];
        const currentStyle = (window.settings || {}).footerVisualizerStyle || 'bars';
        const entry = styles.find(e => e.value === currentStyle);
        const nameEl = document.getElementById('or-vis-style-name');
        if (nameEl) nameEl.textContent = entry ? entry.name : currentStyle;
    }

    /** 循环切换可视化样式（方向：1=下一个，-1=上一个） */
    function cycleVisStyle(direction) {
        // 复用 visualizer.js 的 cycleSpectrumStyle（更新 setting + 同步全屏指示器）
        if (window.musicVisualizer && typeof window.musicVisualizer.cycleSpectrumStyle === 'function') {
            window.musicVisualizer.cycleSpectrumStyle(direction);
        } else {
            // Fallback：内联实现（visualizer.js 未加载时的安全网）
            const styles = (window.musicVisualizer && window.musicVisualizer.SPECTRUM_STYLES) || [];
            if (!styles.length) return;
            const currentStyle = (window.settings || {}).footerVisualizerStyle || 'bars';
            const idx = styles.findIndex(e => e.value === currentStyle);
            const newIdx = (idx + direction + styles.length) % styles.length;
            if (typeof window.updateSetting === 'function') {
                window.updateSetting('footerVisualizerStyle', styles[newIdx].value);
            }
        }
        // 更新本地指示器名称
        updateVisStyleName();
        // 重启在线电台可视化以应用新样式
        startVisualizer();
    }

    // ==================== 投票 ====================

    async function vote() {
        if (!_currentStation) return;
        try {
            await apiVoteStation(_currentStation.stationuuid);
            const btn = document.getElementById('online-radio-vote-btn');
            if (btn) {
                btn.classList.add('text-yellow-500');
                btn.innerHTML = '<i class="fas fa-thumbs-up"></i> 已投票';
                setTimeout(() => {
                    btn.classList.remove('text-yellow-500');
                    btn.innerHTML = '<i class="fas fa-thumbs-up"></i>';
                }, 3000);
            }
        } catch (err) {
            console.error('[OnlineRadio] Vote failed:', err);
        }
    }

    // ==================== UI 辅助 ====================

    function updateCount() {
        const data = getCurrentDataSource();
        const countEl = document.getElementById('online-radio-count');
        if (countEl) {
            countEl.textContent = data.length > 0 ? `(${data.length})` : '';
        }
        const listTitleEl = document.getElementById('online-radio-list-title');
        if (listTitleEl) {
            const modeText = _showFavorites ? '收藏列表' : '电台列表';
            listTitleEl.textContent = data.length > 0 ? `${modeText} (${data.length})` : modeText;
        }
    }

    function showListLoading() {
        const listEl = document.getElementById('online-radio-station-list');
        if (!listEl) return;
        listEl.innerHTML = `
            <div class="p-8 text-center t-text-muted text-sm">
                <i class="fas fa-spinner fa-spin text-2xl mb-3 opacity-40"></i>
                <p>正在加载电台列表...</p>
            </div>`;
        const pagEl = document.getElementById('online-radio-pagination');
        if (pagEl) pagEl.classList.add('hidden');
    }

    function showListError(msg) {
        const listEl = document.getElementById('online-radio-station-list');
        if (!listEl) return;
        listEl.innerHTML = `
            <div class="p-4 text-center t-text-muted text-sm">
                <i class="fas fa-exclamation-triangle text-2xl mb-2 opacity-30 text-red-400"></i>
                <p>${escapeHtml(msg)}</p>
                <button onclick="window.OnlineRadioManager.search()"
                        class="mt-2 px-3 py-1 text-xs t-text-muted hover:t-bg-main rounded-lg border t-border-main">
                    重试
                </button>
            </div>`;
        const pagEl = document.getElementById('online-radio-pagination');
        if (pagEl) pagEl.classList.add('hidden');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ==================== 初始化 ====================

    async function init() {
        if (_initialized) return;
        _initialized = true;

        bindAudioEvents();
        initVisualizer();
        renderVisStyleBar();
        renderColorModeBar();

        loadCategories().catch(() => {
        });
        // 首次打开界面时通过排行榜下拉的 onchange 触发加载，走排行榜流程而非 search
        const sortEl = document.getElementById('online-radio-sort');
        if (sortEl) {
            onSortChange(sortEl.value).catch(() => {
            });
        } else {
            loadDefaultList().catch(() => {
            });
        }
    }

    // ==================== 代理设置 (Proxy Settings) ====================

    /** 打开代理设置弹窗，加载当前配置 */
    async function openProxySettings() {
        const modal = document.getElementById('radio-proxy-modal');
        const content = document.getElementById('radio-proxy-modal-content');
        if (!modal) return;

        // 重置测试结果
        const resultEl = document.getElementById('radio-proxy-test-result');
        if (resultEl) {
            resultEl.classList.add('hidden');
            resultEl.textContent = '';
        }

        // 加载当前配置
        try {
            const resp = await fetch('/api/online-radio/proxy-config', {
                headers: {'x-user-token': window._userToken || ''}
            });
            const data = await resp.json();
            if (data.success && data.data) {
                document.getElementById('radio-proxy-enabled').checked = !!data.data.enabled;
                document.getElementById('radio-proxy-address').value = data.data.address || '';
            }
        } catch (e) {
            console.error('[OnlineRadio] Failed to load proxy config:', e);
        }

        // 显示弹窗
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        requestAnimationFrame(() => {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        });
    }

    /** 关闭代理设置弹窗 */
    function closeProxySettings() {
        const modal = document.getElementById('radio-proxy-modal');
        const content = document.getElementById('radio-proxy-modal-content');
        if (!modal) return;
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }, 200);
    }

    /** 保存代理设置 */
    async function saveProxySettings() {
        const enabled = document.getElementById('radio-proxy-enabled').checked;
        const address = document.getElementById('radio-proxy-address').value.trim();

        try {
            const resp = await fetch('/api/online-radio/proxy-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-token': window._userToken || ''
                },
                body: JSON.stringify({enabled, address})
            });
            const data = await resp.json();
            if (data.success) {
                if (window.showToast) window.showToast('代理设置已保存', 'success');
                closeProxySettings();
            } else {
                if (window.showToast) window.showToast('保存失败: ' + (data.message || '未知错误'), 'error');
            }
        } catch (e) {
            console.error('[OnlineRadio] Failed to save proxy config:', e);
            if (window.showToast) window.showToast('保存失败: ' + e.message, 'error');
        }
    }

    /** 测试代理连通性 */
    async function testProxy() {
        const address = document.getElementById('radio-proxy-address').value.trim();
        const resultEl = document.getElementById('radio-proxy-test-result');
        const btn = document.getElementById('radio-proxy-test-btn');
        if (!address) {
            resultEl.classList.remove('hidden');
            resultEl.className = 'text-xs mt-2 text-red-500';
            resultEl.textContent = '请输入代理地址';
            return;
        }

        // 禁用按钮，显示加载状态
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>测试中...</span>';
        resultEl.classList.remove('hidden');
        resultEl.className = 'text-xs mt-2 t-text-muted';
        resultEl.textContent = '正在测试连接...';

        try {
            const resp = await fetch('/api/online-radio/proxy-test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-token': window._userToken || ''
                },
                body: JSON.stringify({address})
            });
            const data = await resp.json();
            resultEl.classList.remove('hidden');
            if (data.success) {
                resultEl.className = 'text-xs mt-2 text-green-500';
                resultEl.textContent = '✓ ' + data.message;
            } else {
                resultEl.className = 'text-xs mt-2 text-red-500';
                resultEl.textContent = '✗ ' + data.message;
            }
        } catch (e) {
            resultEl.classList.remove('hidden');
            resultEl.className = 'text-xs mt-2 text-red-500';
            resultEl.textContent = '✗ 请求失败: ' + e.message;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-vial"></i><span>测试连接</span>';
        }
    }

    // ==================== 公开接口 ====================

    return {
        init,
        search,
        onSortChange,
        resetFilters,
        goToPage,
        loadMore,
        switchMode,
        toggleFavorite,
        selectStation,
        togglePlay,
        playNextStation,
        playPrevStation,
        vote,
        cycleVisStyle,
        openProxySettings,
        closeProxySettings,
        saveProxySettings,
        testProxy,
        get initialized() {
            return _initialized;
        },
        get currentStation() {
            return _currentStation;
        },
        get isPlaying() {
            return _isPlaying;
        },
    };
})();

window.OnlineRadioManager = OnlineRadioManager;

/** 切换在线电台手机端侧边栏 */
function toggleOnlineRadioSidebar(forceState) {
    const sidebar = document.getElementById('online-radio-sidebar');
    const overlay = document.getElementById('online-radio-sidebar-overlay');
    if (!sidebar) return;

    const isHidden = sidebar.classList.contains('-translate-x-full');
    const shouldShow = forceState !== undefined ? forceState : isHidden;

    if (shouldShow) {
        sidebar.classList.remove('-translate-x-full');
        if (overlay) {
            overlay.classList.remove('hidden', 'opacity-0');
            overlay.classList.add('opacity-100');
        }
    } else {
        sidebar.classList.add('-translate-x-full');
        if (overlay) {
            overlay.classList.add('opacity-0');
            overlay.classList.remove('opacity-100');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    }
}
