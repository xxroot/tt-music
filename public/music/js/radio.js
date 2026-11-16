/**
 * RadioManager - 电台管理模块
 * 负责电台的 CRUD、M3U 导入、播放控制、分组管理、收藏、筛选、投屏推流
 *
 * @module RadioManager
 */
const RadioManager = (function () {
    // ============================================================================
    // 状态管理 (State)
    // ============================================================================
    let _initialized = false;
    let _stations = [];           // 全部电台列表
    let _groups = [];             // 分组列表
    let _favorites = [];          // 收藏列表
    let _currentStation = null;   // 当前选中的电台
    let _isPlaying = false;       // 是否正在播放
    let _durationTimer = null;    // 播放时长计时器
    let _durationSeconds = 0;     // 播放秒数
    let _filterOptions = {};      // 过滤选项 {genres:[], countries:[]}
    let _currentFilters = { genres: '', country: '' }; // 当前过滤条件
    let _coverUploadUrl = '';     // 对话框中临时封面 URL
    let _groupMode = 'group_name';  // 分组维度: group_name | city | genres | country | language | region | station_type
    let _virtualExpanded = {};      // 虚拟分组展开/折叠状态 (非 group_name 模式)
    let _corsRetried = false;       // 是否已尝试过 CORS 回退（防止无限重试）

    const audio = document.getElementById('audio-player');

    /** 构建流代理 URL（保留供将来使用） */
    function buildStreamProxyUrl(streamUrl) {
        return '/api/online-radio/stream?url=' + encodeURIComponent(streamUrl);
    }

    // ============================================================================
    // Combo Box Helper (DataList 可编辑下拉辅助)
    // ============================================================================

    /** 生成 datalist HTML */
    function renderDatalist(id, options) {
        return `<datalist id="${id}">${options.map(o =>
            `<option value="${escapeHtml(o)}">`).join('')}</datalist>`;
    }

    /** 从现有电台中提取某字段的唯一值 */
    function getUniqueFieldValues(field, splitter) {
        const vals = new Set();
        _stations.forEach(s => {
            const v = s[field];
            if (!v) return;
            if (splitter) {
                v.split(splitter).forEach(x => { const t = x.trim(); if (t) vals.add(t); });
            } else {
                vals.add(v);
            }
        });
        return [...vals].sort();
    }

    // ============================================================================
    // API 层 (API Layer)
    // ============================================================================

    /** PUT 请求辅助函数 */
    async function apiPutJson(url, body = null) {
        const opts = { method: 'PUT', headers: {} };
        if (typeof window.getUserAuthHeaders === 'function') {
            Object.assign(opts.headers, window.getUserAuthHeaders());
        }
        opts.headers['Content-Type'] = 'application/json';
        if (body !== null) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        return res.json();
    }

    /** DELETE 请求辅助函数 */
    async function apiDeleteJson(url) {
        const opts = { method: 'DELETE', headers: {} };
        if (typeof window.getUserAuthHeaders === 'function') {
            Object.assign(opts.headers, window.getUserAuthHeaders());
        }
        const res = await fetch(url, opts);
        return res.json();
    }

    /**
     * 为封面图片 URL 追加认证 token 查询参数。
     * <img> 标签无法发送自定义 Header，因此通过 query string 传递 token。
     */
    function authImageUrl(url) {
        if (!url || !window.userToken) return url;
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}token=${encodeURIComponent(window.userToken)}`;
    }

    async function fetchStations() {
        const result = await apiGetJson('/api/radio/stations');
        if (result.success) _stations = result.data || [];
        return _stations;
    }

    async function fetchGroups() {
        const result = await apiGetJson('/api/radio/groups');
        if (result.success) _groups = result.data || [];
        return _groups;
    }

    async function fetchFavorites() {
        const result = await apiGetJson('/api/radio/favorites');
        if (result.success) _favorites = result.data || [];
        return _favorites;
    }

    async function fetchFilterOptions() {
        const result = await apiGetJson('/api/radio/filter-options');
        if (result.success) _filterOptions = result.data || {};
        return _filterOptions;
    }

    async function addStationApi(data) {
        console.log('[Radio] API addStation request:', data.name, data.url);
        const result = await apiPostJson('/api/radio/stations', data);
        console.log('[Radio] API addStation response:', result);
        return result;
    }

    async function updateStationApi(id, data) {
        console.log('[Radio] API updateStation request:', id, data);
        const result = await apiPutJson(`/api/radio/stations/${id}`, data);
        console.log('[Radio] API updateStation response:', result);
        return result;
    }

    async function deleteStationApi(id) {
        return await apiDeleteJson(`/api/radio/stations/${id}`);
    }

    async function toggleFavoriteApi(id) {
        return await apiPutJson(`/api/radio/stations/${id}/favorite`);
    }

    async function updatePlayStatusApi(id, status) {
        return await apiPutJson(`/api/radio/stations/${id}/status`, { status });
    }

    async function importStationsApi(stations) {
        return await apiPostJson('/api/radio/import', { stations });
    }

    async function importJsonStationsApi(stations) {
        return await apiPostJson('/api/radio/import-json', { stations });
    }

    async function createGroupApi(name) {
        return await apiPostJson('/api/radio/groups', { name });
    }

    async function toggleGroupExpandedApi(id) {
        return await apiPutJson(`/api/radio/groups/${id}/expand`);
    }

    // ============================================================================
    // M3U 解析器 (M3U Parser)
    // ============================================================================

    function parseM3U(content) {
        const lines = content.split(/\r?\n/);
        const stations = [];
        let current = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith('#EXTINF:')) {
                current = {};
                // 提取属性
                const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
                let match;
                while ((match = attrRegex.exec(line)) !== null) {
                    const key = match[1].toLowerCase();
                    const val = match[2];
                    if (key === 'tvg-name') current.name = val;
                    else if (key === 'group-title') current.group_name = val;
                    else if (key === 'tvg-genre') current.genres = val;
                    else if (key === 'tvg-country') current.country = val;
                    else if (key === 'tvg-region') current.region = val;
                    else if (key === 'tvg-city') current.city = val;
                    else if (key === 'tvg-language') current.language = val;
                    else if (key === 'tvg-logo') current.cover = val;
                }
                // 提取逗号后的名称
                const commaIdx = line.lastIndexOf(',');
                if (commaIdx !== -1) {
                    const afterComma = line.substring(commaIdx + 1).trim();
                    if (afterComma && !current.name) current.name = afterComma;
                    else if (afterComma) current._displayName = afterComma;
                }
            } else if (line.startsWith('#')) {
                // 忽略其他注释行
                continue;
            } else {
                // URL 行
                if (current) {
                    current.url = line;
                    if (!current.name) current.name = current._displayName || line.split('/').pop() || 'Unknown';
                    if (current._displayName) delete current._displayName;
                    if (!current.group_name) current.group_name = '默认分组';
                    stations.push(current);
                    current = null;
                } else {
                    // 没有 #EXTINF 的裸 URL
                    stations.push({
                        name: line.split('/').pop() || 'Unknown',
                        url: line,
                        group_name: '默认分组',
                    });
                }
            }
        }
        return stations;
    }

    // ============================================================================
    // 渲染 — 左侧分组列表 (Render Sidebar Groups)
    // ============================================================================

    function getStatusIcon(station) {
        const isCurrentlyPlaying = _isPlaying && _currentStation && _currentStation.id === station.id;
        if (isCurrentlyPlaying) {
            return '<span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"></span>';
        }
        switch (station.last_play_status) {
            case 'success':
                return '<i class="fas fa-check-circle text-emerald-500 text-[10px] flex-shrink-0"></i>';
            case 'failed':
                return '<i class="fas fa-times-circle text-red-400 text-[10px] flex-shrink-0"></i>';
            default:
                return '<i class="far fa-circle text-gray-300 text-[10px] flex-shrink-0"></i>';
        }
    }

    function renderCoverThumb(station, size = 'w-6 h-6') {
        if (station.cover) {
            return `<img src="${escapeHtml(authImageUrl(station.cover))}" class="${size} rounded object-cover flex-shrink-0" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                    <div class="${size} rounded t-bg-main items-center justify-center flex-shrink-0 hidden"><i class="fas fa-music text-[8px] t-text-dim opacity-40"></i></div>`;
        }
        return `<div class="${size} rounded t-bg-main flex items-center justify-center flex-shrink-0"><i class="fas fa-music text-[8px] t-text-dim opacity-40"></i></div>`;
    }

    function renderStationItem(station, isActive) {
        const activeClass = isActive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 't-text-muted hover:t-bg-main';
        return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-xs ${activeClass}"
                     onclick="window.RadioManager.selectStation(${station.id})" data-station-id="${station.id}">
                    ${renderCoverThumb(station)}
                    <span class="truncate flex-1 min-w-0">${escapeHtml(station.name)}</span>
                    ${station.quality ? `<span class="px-1 py-0.5 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[8px] rounded flex-shrink-0">${escapeHtml(station.quality)}</span>` : ''}
                    ${getStatusIcon(station)}
                </div>`;
    }

    function renderGroups() {
        const container = document.getElementById('radio-groups-list');
        if (!container) return;

        // 过滤后的电台
        const filtered = getFilteredStations();

        if (filtered.length === 0 && _stations.length === 0) {
            container.innerHTML = `<div class="p-4 text-center t-text-muted text-sm">
                <i class="fas fa-broadcast-tower text-2xl mb-2 opacity-30"></i>
                <p>暂无电台</p>
                <p class="text-xs mt-1">导入 M3U 文件或手动添加</p>
            </div>`;
            return;
        }

        // 按当前分组维度归类
        const groupMap = {};
        filtered.forEach(s => {
            let keys;
            if (_groupMode === 'genres') {
                // genres 是逗号分隔，一个电台可出现在多个分组
                keys = (s.genres || '').split(/[,，;；]/).map(g => g.trim()).filter(Boolean);
                if (keys.length === 0) keys = ['未分类'];
            } else {
                const val = s[_groupMode];
                keys = [val || '未知'];
            }
            keys.forEach(key => {
                if (!groupMap[key]) groupMap[key] = [];
                groupMap[key].push(s);
            });
        });

        // 排序分组
        const sortedGroupNames = Object.keys(groupMap).sort((a, b) => {
            if (_groupMode === 'group_name') {
                const ga = _groups.find(g => g.name === a);
                const gb = _groups.find(g => g.name === b);
                return (ga?.sort_order || 0) - (gb?.sort_order || 0);
            }
            return a.localeCompare(b, 'zh');
        });

        let html = '';
        sortedGroupNames.forEach(gn => {
            let isExpanded;
            if (_groupMode === 'group_name') {
                const group = _groups.find(g => g.name === gn);
                isExpanded = group ? group.is_expanded : true;
            } else {
                isExpanded = _virtualExpanded[gn] !== false; // 默认展开
            }
            const stationsInGroup = groupMap[gn];
            const arrowIcon = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
            const listClass = isExpanded ? '' : 'hidden';

            html += `<div class="mb-1" data-group-name="${escapeHtml(gn)}">
                <div class="flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer t-text-muted hover:t-bg-main transition-colors text-xs"
                     onclick="window.RadioManager.toggleGroup('${escapeHtml(gn)}')">
                    <i class="fas ${arrowIcon} text-[8px] w-3 transition-transform"></i>
                    <span class="truncate flex-1 font-medium">${escapeHtml(gn)}</span>
                    <span class="text-[10px] t-text-dim flex-shrink-0">${stationsInGroup.length}</span>
                </div>
                <div class="mt-0.5 space-y-0.5 ${listClass}">`;

            stationsInGroup.forEach(s => {
                const isActive = _currentStation && _currentStation.id === s.id;
                html += renderStationItem(s, isActive);
            });

            html += `</div></div>`;
        });

        container.innerHTML = html;

        // 更新电台总数
        const countEl = document.getElementById('radio-station-count');
        if (countEl) countEl.textContent = `(${_stations.length})`;
    }

    // ============================================================================
    // 渲染 — 收藏列表 (Render Favorites)
    // ============================================================================

    function renderFavorites() {
        const section = document.getElementById('radio-favorites-section');
        const list = document.getElementById('radio-favorites-list');
        const countEl = document.getElementById('radio-fav-count');
        if (!section || !list) return;

        const favs = _stations.filter(s => s.is_favorite);
        if (favs.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        if (countEl) countEl.textContent = favs.length;

        let html = '';
        favs.forEach(s => {
            const isActive = _currentStation && _currentStation.id === s.id;
            html += renderStationItem(s, isActive);
        });
        list.innerHTML = html;
    }

    // ============================================================================
    // 渲染 — 右侧详情 (Render Station Detail)
    // ============================================================================

    function renderStationDetail(station) {
        if (!station) {
            document.getElementById('radio-detail-empty')?.classList.remove('hidden');
            document.getElementById('radio-detail-content')?.classList.add('hidden');
            return;
        }

        document.getElementById('radio-detail-empty')?.classList.add('hidden');
        const content = document.getElementById('radio-detail-content');
        if (!content) return;
        content.classList.remove('hidden');

        // 封面
        const coverEl = document.getElementById('radio-detail-cover');
        if (coverEl) {
            if (station.cover) {
                coverEl.innerHTML = `<img src="${escapeHtml(authImageUrl(station.cover))}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-music text-2xl t-text-dim opacity-40\\'></i>'">`;
            } else {
                coverEl.innerHTML = '<i class="fas fa-music text-2xl t-text-dim opacity-40"></i>';
            }
        }

        // 名称、URL
        const nameEl = document.getElementById('radio-detail-name');
        if (nameEl) nameEl.textContent = station.name;
        const urlEl = document.getElementById('radio-detail-url');
        if (urlEl) urlEl.textContent = station.url;

        // 音质 Badge
        const qualityEl = document.getElementById('radio-detail-quality');
        if (qualityEl) {
            if (station.quality) {
                qualityEl.textContent = station.quality;
                qualityEl.classList.remove('hidden');
            } else {
                qualityEl.classList.add('hidden');
            }
        }

        // 分组标签
        const groupEl = document.getElementById('radio-detail-group');
        if (groupEl) groupEl.textContent = station.group_name || '默认分组';

        // Genres / Country / City
        const genresEl = document.getElementById('radio-detail-genres');
        if (genresEl) genresEl.textContent = station.genres ? `🎵 ${station.genres}` : '';
        const countryEl = document.getElementById('radio-detail-country');
        if (countryEl) countryEl.textContent = station.country ? `🌍 ${station.country}` : '';

        // 收藏按钮
        updateFavoriteBtn(station.is_favorite);

        // 播放按钮状态
        updatePlayBtn();

        // 电台信息面板
        renderInfoPanel(station);

        // 清除错误
        const errorEl = document.getElementById('radio-error');
        if (errorEl) { errorEl.classList.add('hidden'); errorEl.textContent = ''; }
    }

    function renderInfoPanel(station) {
        const panel = document.getElementById('radio-info-panel');
        if (!panel) return;

        const rows = [];
        if (station.region) rows.push(['地区', station.region]);
        if (station.city) rows.push(['城市', station.city]);
        if (station.language) rows.push(['语言', station.language]);
        rows.push(['分组', station.group_name || '默认分组']);
        rows.push(['播放次数', station.play_count || 0]);
        if (station.last_play_time) rows.push(['上次播放', station.last_play_time]);
        if (station.created_at) rows.push(['添加时间', station.created_at]);

        let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
        rows.forEach(([label, value]) => {
            html += `<div class="flex items-center gap-2 text-xs">
                <span class="t-text-muted font-medium min-w-[60px]">${label}</span>
                <span class="t-text-main">${escapeHtml(String(value))}</span>
            </div>`;
        });
        html += '</div>';

        // 删除按钮
  /*      html += `<div class="pt-4 border-t t-border-main mt-4">
            <button onclick="window.RadioManager.deleteCurrentStation()"
                    class="px-4 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors border border-red-200 dark:border-red-800">
                <i class="fas fa-trash-alt mr-1"></i> 删除电台
            </button>
        </div>`;*/

        panel.innerHTML = html;
    }

    function updateFavoriteBtn(isFav) {
        const btn = document.getElementById('radio-fav-btn');
        if (!btn) return;
        if (isFav) {
            btn.innerHTML = '<i class="fas fa-heart text-red-400"></i>';
            btn.title = '取消收藏';
        } else {
            btn.innerHTML = '<i class="far fa-heart"></i>';
            btn.title = '收藏';
        }
    }

    function updatePlayBtn() {
        const btn = document.getElementById('radio-play-btn');
        if (!btn) return;
        if (_isPlaying && _currentStation) {
            btn.innerHTML = '<i class="fas fa-pause"></i>';
        } else {
            btn.innerHTML = '<i class="fas fa-play"></i>';
        }
    }

    // ============================================================================
    // 过滤 (Filter)
    // ============================================================================

    function getFilteredStations() {
        let list = _stations;
        if (_currentFilters.genres) {
            list = list.filter(s => s.genres && s.genres.toLowerCase().includes(_currentFilters.genres.toLowerCase()));
        }
        if (_currentFilters.country) {
            list = list.filter(s => s.country && s.country.toLowerCase().includes(_currentFilters.country.toLowerCase()));
        }
        return list;
    }

    function renderFilterOptions() {
        const genresSelect = document.getElementById('radio-filter-genres');
        const countrySelect = document.getElementById('radio-filter-country');
        if (!genresSelect || !countrySelect) return;

        // 保存当前选择
        const curGenres = genresSelect.value;
        const curCountry = countrySelect.value;

        // 从数据中提取唯一值
        const genres = new Set();
        const countries = new Set();
        _stations.forEach(s => {
            if (s.genres) s.genres.split(/[,，;；]/).forEach(g => { const t = g.trim(); if (t) genres.add(t); });
            if (s.country) countries.add(s.country);
        });

        let genresHtml = '<option value="">全部类型</option>';
        [...genres].sort().forEach(g => {
            genresHtml += `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`;
        });
        genresSelect.innerHTML = genresHtml;
        genresSelect.value = curGenres;

        let countryHtml = '<option value="">全部国家</option>';
        [...countries].sort().forEach(c => {
            countryHtml += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
        });
        countrySelect.innerHTML = countryHtml;
        countrySelect.value = curCountry;
    }

    function applyFilters() {
        const genresSelect = document.getElementById('radio-filter-genres');
        const countrySelect = document.getElementById('radio-filter-country');
        _currentFilters.genres = genresSelect ? genresSelect.value : '';
        _currentFilters.country = countrySelect ? countrySelect.value : '';
        renderGroups();
        renderFavorites();
    }

    // ============================================================================
    // 交互 — 选择电台 / 分组切换 (Interactions)
    // ============================================================================

    function selectStation(id) {
        const station = _stations.find(s => s.id === id);
        if (!station) return;
        _currentStation = station;
        renderStationDetail(station);
        renderGroups();
        renderFavorites();
        playRadio(station);
        // 手机端自动关闭侧边栏
        if (window.innerWidth <= 768) toggleRadioSidebar(false);
    }

    function toggleGroup(groupName) {
        if (_groupMode !== 'group_name') {
            // 虚拟分组模式：内存记录展开/折叠状态
            _virtualExpanded[groupName] = _virtualExpanded[groupName] === undefined ? false : !_virtualExpanded[groupName];
            renderGroups();
            return;
        }
        const group = _groups.find(g => g.name === groupName);
        if (!group) return;
        toggleGroupExpandedApi(group.id).then(result => {
            if (result.success) {
                group.is_expanded = group.is_expanded ? 0 : 1;
                renderGroups();
            }
        });
    }

    // ============================================================================
    // 播放控制 (Playback Control)
    // ============================================================================

    function playRadio(station) {
        if (!station || !station.url) return;

        // 检查投屏模式
        if (checkAndCastToScreen(station)) return;

        // 停止之前的播放
        // [Fix] 使用 removeAttribute('src') 而非 src=''，避免虚假 error 事件
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
        }

        // 设置播放范围标记
        window.currentPlayingScope = 'radio';
        window.currentPlayingSong = null;
        // 清除上一首歌曲的 UI 残留（侧边栏/音频标签/详情页/收藏按钮）
        if (typeof window.clearSongPlayerInfo === 'function') window.clearSongPlayerInfo();
        // 隐藏底部 Footer Visualizer（电台有自己的可视化组件）
        const vizContainer = document.getElementById('visualizer-container');
        if (vizContainer) vizContainer.style.display = 'none';
        _corsRetried = false;

        // 确保音量已设置（macOS 无声修复）
        if (audio) {
            audio.volume = typeof window.currentVolume !== 'undefined' ? window.currentVolume : 0.75;
            audio.muted = false;

            // 检查 Web Audio API 的 MediaElementSource 是否已在之前的歌曲播放中创建
            // 如果已创建，跨域音频会被 Web Audio 静音（输出零值），必须走服务端代理（同源）
            const hasMediaSource = !!(window.soundEffects && window.soundEffects.getAudioContext());

            // 代理 URL 同源 → 设置 crossorigin（可视化可用）
            // 直连跨域 URL → 移除 crossorigin（避免 CORS block，可视化不可用）
            if (hasMediaSource) {
                audio.setAttribute('crossorigin', 'anonymous');
            } else {
                audio.removeAttribute('crossorigin');
            }

            // 智能选择 URL：MediaElementSource 已存在时走代理（同源），否则直连
            const streamUrl = hasMediaSource ? buildStreamProxyUrl(station.url) : station.url;
            console.log('[Radio] Playing:', hasMediaSource ? 'proxy (Web Audio active)' : 'direct');
            audio.src = streamUrl;
            const playPromise = audio.play();
            if (playPromise) {
                playPromise.then(() => {
                    _isPlaying = true;
                    updatePlayBtn();
                    startDurationTimer();
                    updatePlayStatusApi(station.id, 'success');
                    station.last_play_status = 'success';
                    station.play_count = (station.play_count || 0) + 1;
                    renderGroups();
                    renderFavorites();
                    // 同步信息到底部播放栏
                    updateBottomBarForRadio(station);
                }).catch(err => {
                    if (err.name === 'AbortError') return;
                    // error handler 已处理 CORS 回退，这里仅在回退已执行后显示错误
                    if (!_corsRetried) {
                        console.error('[Radio] Play failed:', err);
                        _isPlaying = false;
                        updatePlayBtn();
                        showPlayError(err.message || '播放失败');
                        updatePlayStatusApi(station.id, 'failed');
                        station.last_play_status = 'failed';
                        renderGroups();
                        renderFavorites();
                    }
                });
            }
        }
    }

    function pauseRadio() {
        if (audio) {
            audio.pause();
        }
        _isPlaying = false;
        updatePlayBtn();
        stopDurationTimer();
        const statusEl = document.getElementById('radio-play-status');
        if (statusEl) statusEl.textContent = '已暂停';
        // 同步底部播放栏状态
        const playerStatusEl = document.getElementById('player-status');
        if (playerStatusEl) playerStatusEl.textContent = '电台已暂停';
    }

    function toggleRadioPlay() {
        if (!_currentStation) return;

        // DLNA 投屏：通过 WS 控制 DMC 暂停/恢复（pauseRadio 只暂停本地 audio，对投屏设备无效）
        if (typeof _upnpActiveDeviceId !== 'undefined' && _upnpActiveDeviceId) {
            const isPlaying = typeof _dlnaLastPlayState !== 'undefined'
                && (_dlnaLastPlayState === 'PLAYING' || _dlnaLastPlayState === 'TRANSITIONING');
            if (isPlaying) {
                window.sendDlnaCommand('pause', {});
                _isPlaying = false;
                updatePlayBtn();
                stopDurationTimer();
                const statusEl = document.getElementById('radio-play-status');
                if (statusEl) statusEl.textContent = '已暂停';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = '电台已暂停';
            } else {
                window.sendDlnaCommand('resume', {});
                _isPlaying = true;
                updatePlayBtn();
                startDurationTimer();
                const statusEl = document.getElementById('radio-play-status');
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
                const statusEl = document.getElementById('radio-play-status');
                if (statusEl) statusEl.textContent = '已暂停';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = '电台已暂停';
            } else {
                window.sendAirPlayCommand('resume', {});
                _isPlaying = true;
                updatePlayBtn();
                startDurationTimer();
                const statusEl = document.getElementById('radio-play-status');
                if (statusEl) statusEl.textContent = 'AirPlay 投屏中';
                const playerStatusEl = document.getElementById('player-status');
                if (playerStatusEl) playerStatusEl.textContent = 'AirPlay 投屏中';
            }
            return;
        }

        // 非投屏：原有逻辑
        if (_isPlaying) {
            pauseRadio();
        } else {
            playRadio(_currentStation);
        }
    }

    /** 切换到下一个电台（底部播放栏下一首） */
    function playNextStation() {
        const list = getFilteredStations();
        if (!list.length || !_currentStation) return;
        const idx = list.findIndex(s => s.id === _currentStation.id);
        const nextIdx = (idx + 1) % list.length;
        selectStation(list[nextIdx].id);
    }

    /** 切换到上一个电台 */
    function playPrevStation() {
        const list = getFilteredStations();
        if (!list.length || !_currentStation) return;
        const idx = list.findIndex(s => s.id === _currentStation.id);
        const prevIdx = (idx - 1 + list.length) % list.length;
        selectStation(list[prevIdx].id);
    }

    function startDurationTimer() {
        stopDurationTimer();
        _durationSeconds = 0;
        const durationEl = document.getElementById('radio-play-duration');
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
        const errorEl = document.getElementById('radio-error');
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
        }
        const statusEl = document.getElementById('radio-play-status');
        if (statusEl) statusEl.textContent = '播放失败';
    }

    // ============================================================================
    // 音质自动检测 (Quality Auto-Detection)
    // ============================================================================

    /** MIME 类型到音质标签的映射 */
    const QUALITY_MIME_MAP = {
        'audio/mpeg': 'MP3', 'audio/mp3': 'MP3',
        'audio/aac': 'AAC', 'audio/aacp': 'AAC+',
        'audio/ogg': 'OGG', 'audio/flac': 'FLAC',
        'audio/x-mpegurl': 'MP3', 'audio/wav': 'WAV',
        'audio/x-wav': 'WAV', 'audio/mp4': 'AAC',
    };

    /** 检测电台流实际音质并通过 HEAD 请求获取 Content-Type */
    async function detectQualityFromUrl(url) {
        if (!_currentStation) return;
        // 如果已有手动设置的音质则不自动覆盖
        if (_currentStation.quality) return;
        try {
            const headers = {};
            if (typeof window.getUserAuthHeaders === 'function') {
                Object.assign(headers, window.getUserAuthHeaders());
            }
            const res = await fetch(url, { method: 'HEAD', headers, mode: 'cors' });
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            // 取主类型（去掉 ;charset 等参数）
            const mime = contentType.split(';')[0].trim();
            const detected = QUALITY_MIME_MAP[mime];
            console.log('[Radio] Quality detection — Content-Type:', contentType, '→ mapped:', detected || 'unknown');
            if (detected && _currentStation) {
                _currentStation.quality = detected;
                // 刷新 UI：详情 badge + 侧边栏
                const qualityEl = document.getElementById('radio-detail-quality');
                if (qualityEl) {
                    qualityEl.textContent = detected;
                    qualityEl.classList.remove('hidden');
                }
                renderGroups();
                renderFavorites();
                // 写入 DB
                updateStationApi(_currentStation.id, { quality: detected });
            }
        } catch (err) {
            console.log('[Radio] Quality detection failed (non-critical):', err.message);
        }
    }

    // ============================================================================
    // 音频事件监听 (Audio Event Listeners)
    // ============================================================================

    function bindAudioEvents() {
        if (!audio) return;

        audio.addEventListener('playing', () => {
            if (window.currentPlayingScope !== 'radio') return;
            _isPlaying = true;
            updatePlayBtn();
            const statusEl = document.getElementById('radio-play-status');
            if (statusEl) statusEl.textContent = '正在播放';
            const bufferingEl = document.getElementById('radio-buffering');
            if (bufferingEl) bufferingEl.classList.add('hidden');
            const errorEl = document.getElementById('radio-error');
            if (errorEl) errorEl.classList.add('hidden');

            // 恢复 AudioContext（双重保障）
            if (window.soundEffects && window.soundEffects.getAudioContext) {
                const ctx = window.soundEffects.getAudioContext();
                if (ctx && ctx.state === 'suspended') ctx.resume();
            }

            // 音质自动检测
            if (_currentStation) detectQualityFromUrl(_currentStation.url);
        });

        audio.addEventListener('waiting', () => {
            if (window.currentPlayingScope !== 'radio') return;
            const bufferingEl = document.getElementById('radio-buffering');
            if (bufferingEl) bufferingEl.classList.remove('hidden');
            const statusEl = document.getElementById('radio-play-status');
            if (statusEl) statusEl.textContent = '缓冲中...';
        });

        audio.addEventListener('error', (e) => {
            if (window.currentPlayingScope !== 'radio') return;
            if (!audio.currentSrc) return;
            if (audio.error && audio.error.code === MediaError.MEDIA_ERR_ABORTED) return;

            // [Fix] CORS 智能回退：首次 CORS 失败时移除 crossorigin 重试
            // 移除 crossorigin 后音频可播放但可视化频谱不可用
            if (!_corsRetried && audio.error &&
                audio.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                _corsRetried = true;
                audio.removeAttribute('crossorigin');
                console.warn('[Radio] CORS blocked, retrying without crossorigin...');
                audio.src = audio.currentSrc;
                audio.load();
                audio.play().catch(() => {});
                return;
            }

            _isPlaying = false;
            updatePlayBtn();
            stopDurationTimer();
            const bufferingEl = document.getElementById('radio-buffering');
            if (bufferingEl) bufferingEl.classList.add('hidden');

            let errMsg = '播放失败';
            if (audio.error) {
                switch (audio.error.code) {
                    case MediaError.MEDIA_ERR_NETWORK: errMsg = '网络错误'; break;
                    case MediaError.MEDIA_ERR_DECODE: errMsg = '解码错误'; break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: errMsg = '音频格式不支持或流不可用'; break;
                }
            }
            showPlayError(errMsg);

            if (_currentStation) {
                updatePlayStatusApi(_currentStation.id, 'failed');
                _currentStation.last_play_status = 'failed';
                renderGroups();
                renderFavorites();
            }
        });

        audio.addEventListener('pause', () => {
            if (window.currentPlayingScope !== 'radio') return;
            // 不更新 UI — 可能是 pauseRadio() 已处理
        });
    }

    // ============================================================================
    // 底部播放栏同步 (Bottom Player Bar Sync)
    // ============================================================================

    /** 更新底部播放栏显示电台信息 */
    function updateBottomBarForRadio(station) {
        // 标题
        const titleEl = document.getElementById('player-title');
        if (titleEl) {
            titleEl.textContent = station.name;
            titleEl.setAttribute('data-text', station.name);
        }
        // 艺术家 → 显示分组名
        const artistEl = document.getElementById('player-artist');
        if (artistEl) {
            artistEl.textContent = station.group_name || '电台';
            artistEl.setAttribute('data-text', station.group_name || '电台');
        }
        // 封面
        const coverEl = document.getElementById('player-cover');
        if (coverEl) {
            if (station.cover) {
                coverEl.src = authImageUrl(station.cover);
                coverEl.style.display = '';
            } else {
                coverEl.style.display = 'none';
            }
        }
        // 来源标签 → 显示 "电台" + 音质
        const sourceEl = document.getElementById('player-source');
        if (sourceEl) {
            sourceEl.textContent = station.quality ? `电台 · ${station.quality}` : '电台';
        }
        // 状态
        const statusEl = document.getElementById('player-status');
        if (statusEl) statusEl.textContent = '电台播放中';
        // 跑马灯检测
        if (typeof applyMarqueeChecks === 'function') applyMarqueeChecks();
    }

    // ============================================================================
    // 投屏推流 (DLNA / AirPlay Casting)
    // ============================================================================

    function checkAndCastToScreen(station) {
        // 检查 DLNA 投屏
        if (window._upnpActiveDeviceId && window._upnpPlaySongHook) {
            const castSong = buildCastSong(station);
            if (window._upnpPlaySongHook(castSong, station.url)) {
                _isPlaying = true;
                updatePlayBtn();
                startDurationTimer();
                updatePlayStatusApi(station.id, 'success');
                station.last_play_status = 'success';
                station.play_count = (station.play_count || 0) + 1;
                renderGroups();
                renderFavorites();
                const statusEl = document.getElementById('radio-play-status');
                if (statusEl) statusEl.textContent = '投屏播放中';
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
                updatePlayStatusApi(station.id, 'success');
                station.last_play_status = 'success';
                station.play_count = (station.play_count || 0) + 1;
                renderGroups();
                renderFavorites();
                const statusEl = document.getElementById('radio-play-status');
                if (statusEl) statusEl.textContent = 'AirPlay 投屏中';
                return true;
            }
        }
        return false;
    }

    function buildCastSong(station) {
        return {
            id: 'radio_' + station.id,
            name: station.name,
            singer: '',
            albumName: station.group_name || '电台',
            source: 'radio',
            songmid: 'radio_' + station.id,
            interval: '',
            quality: station.quality || '',
            img: station.cover || null,
            relativePath: null,
            _isMusicLibSong: false,
            directUrl: station.url,
        };
    }

    // ============================================================================
    // 对话框 — M3U 导入 (Import Dialog)
    // ============================================================================

    function showImportDialog() {
        // 构建分组选项
        let groupOptions = '<option value="">选择分组...</option>';
        const existingGroups = [...new Set(_stations.map(s => s.group_name || '默认分组'))];
        existingGroups.forEach(g => {
            groupOptions += `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`;
        });

        const html = `<div id="radio-import-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick="if(event.target===this)closeRadioDialog()">
            <div class="t-bg-panel rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 border t-border-main">
                <h3 class="text-lg font-bold t-text-main mb-4"><i class="fas fa-file-import text-emerald-500 mr-2"></i>导入 M3U 文件</h3>
                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">分组名称</label>
                        <select id="radio-import-group" class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${groupOptions}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">或输入新分组名</label>
                        <input type="text" id="radio-import-new-group" placeholder="新分组名称..."
                               class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    </div>
                    <div class="text-xs t-text-dim">
                        <i class="fas fa-info-circle mr-1"></i> 选择 .m3u 或 .m3u8 文件，将自动解析其中的电台信息
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-6">
                    <button onclick="closeRadioDialog()" class="px-4 py-2 text-sm t-text-muted hover:t-bg-main rounded-lg transition-colors">取消</button>
                    <button onclick="document.getElementById('radio-m3u-input').click()"
                            class="px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors font-medium">
                        <i class="fas fa-folder-open mr-1"></i> 选择文件导入
                    </button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
    }

    async function handleM3UFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';  // 重置以允许重复选择同一文件

        // 确定分组名
        const newGroupInput = document.getElementById('radio-import-new-group');
        const groupSelect = document.getElementById('radio-import-group');
        let groupName = '';
        if (newGroupInput && newGroupInput.value.trim()) {
            groupName = newGroupInput.value.trim();
        } else if (groupSelect && groupSelect.value) {
            groupName = groupSelect.value;
        } else {
            groupName = '默认分组';
        }

        try {
            const text = await file.text();
            const parsed = parseM3U(text);
            if (parsed.length === 0) {
                showError('M3U 文件中没有找到有效的电台');
                closeRadioDialog();
                return;
            }

            // 设置分组
            parsed.forEach(s => { s.group_name = groupName; });

            showInfo(`正在导入 ${parsed.length} 个电台...`);
            const result = await importStationsApi(parsed);
            if (result.success) {
                showSuccess(`成功导入 ${result.data?.imported || parsed.length} 个电台`);
                closeRadioDialog();
                await refreshAll();
            } else {
                showError('导入失败: ' + (result.message || '未知错误'));
            }
        } catch (err) {
            console.error('[Radio] M3U import failed:', err);
            showError('导入失败: ' + err.message);
        }
    }

    // ============================================================================
    // 对话框 — JSON 导入 (JSON Import Dialog)
    // ============================================================================

    function showJsonImportDialog() {
        const html = `<div id="radio-json-import-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick="if(event.target===this)closeRadioDialog()">
            <div class="t-bg-panel rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 border t-border-main">
                <h3 class="text-lg font-bold t-text-main mb-4"><i class="fas fa-file-code text-blue-500 mr-2"></i>导入 JSON 文件</h3>
                <div class="space-y-4">
                    <div class="text-xs t-text-dim">
                        <i class="fas fa-info-circle mr-1"></i> 导入 JSON 格式的电台数据，支持字段：name, url, group_name, genres, country, region, city, language, logo, cover, quality
                    </div>
                    <div class="text-xs t-text-dim bg-gray-800/30 p-3 rounded-lg">
                        <div class="font-medium mb-1">示例格式：</div>
                        <pre class="text-[10px] overflow-x-auto">[{
  "name": "电台名称",
  "url": "https://...",
  "group_name": "分组",
  ...
}]</pre>
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-6">
                    <button onclick="closeRadioDialog()" class="px-4 py-2 text-sm t-text-muted hover:t-bg-main rounded-lg transition-colors">取消</button>
                    <button onclick="document.getElementById('radio-json-input').click()"
                            class="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors font-medium">
                        <i class="fas fa-folder-open mr-1"></i> 选择 JSON 文件
                    </button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
    }

    async function handleJsonFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';  // 重置以允许重复选择同一文件

        try {
            const text = await file.text();
            let stations;
            
            try {
                stations = JSON.parse(text);
            } catch (e) {
                showError('JSON 格式错误: ' + e.message);
                closeRadioDialog();
                return;
            }

            if (!Array.isArray(stations)) {
                showError('JSON 文件必须包含一个数组');
                closeRadioDialog();
                return;
            }

            if (stations.length === 0) {
                showError('JSON 数组为空');
                closeRadioDialog();
                return;
            }

            // 验证必填字段
            for (let i = 0; i < stations.length; i++) {
                const s = stations[i];
                if (!s.name || !s.url) {
                    showError(`第 ${i + 1} 条记录缺少必填字段 name 或 url`);
                    closeRadioDialog();
                    return;
                }
            }

            showInfo(`正在导入 ${stations.length} 个电台...`);
            const result = await importJsonStationsApi(stations);
            
            if (result.success) {
                const data = result.data || {};
                showSuccess(`成功导入 ${data.inserted || 0} 个电台，更新 ${data.updated || 0} 个电台`);
                closeRadioDialog();
                await refreshAll();
            } else {
                showError('导入失败: ' + (result.message || '未知错误'));
            }
        } catch (err) {
            console.error('[Radio] JSON import failed:', err);
            showError('导入失败: ' + err.message);
        }
    }

    // ============================================================================
    // 对话框 — 手动添加电台 (Manual Add Dialog)
    // ============================================================================

    function showManualAddDialog() {
        _coverUploadUrl = '';

        // 提取已有值作为 datalist 选项
        const groupValues = getUniqueFieldValues('group_name');
        const genreValues = getUniqueFieldValues('genres', ',');
        const countryValues = getUniqueFieldValues('country');
        const regionValues = getUniqueFieldValues('region');
        const cityValues = getUniqueFieldValues('city');
        const languageValues = getUniqueFieldValues('language');
        const typeValues = [...new Set([...getUniqueFieldValues('station_type'), '音乐', '故事', '综合', '新闻', '体育', '教育', '娱乐'].filter(Boolean))];

        const html = `<div id="radio-add-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick="if(event.target===this)closeRadioDialog()">
            <div class="t-bg-panel rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border t-border-main max-h-[90vh] overflow-y-auto custom-scrollbar">
                <h3 class="text-lg font-bold t-text-main mb-4"><i class="fas fa-plus-circle text-emerald-500 mr-2"></i>添加电台</h3>
                <div class="space-y-3">
                    <!-- 封面 -->
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">封面</label>
                        <div class="flex items-center gap-3">
                            <div id="radio-add-cover-preview" class="w-16 h-16 rounded-lg t-bg-main flex items-center justify-center overflow-hidden flex-shrink-0 border t-border-main">
                                <i class="fas fa-music text-xl t-text-dim opacity-30"></i>
                            </div>
                            <div class="flex-1 space-y-2">
                                <input type="file" id="radio-add-cover-file" accept="image/*" onchange="window.RadioManager.handleCoverFileSelect(event)"
                                       class="hidden">
                                <button onclick="document.getElementById('radio-add-cover-file').click()"
                                        class="px-3 py-1 text-xs t-text-muted hover:t-bg-main rounded border t-border-main transition-colors">
                                    <i class="fas fa-upload mr-1"></i> 上传图片
                                </button>
                                <input type="text" id="radio-add-cover-url" placeholder="或输入图片 URL..."
                                       onchange="window.RadioManager.updateCoverPreview(this.value)"
                                       class="w-full px-3 py-1.5 text-xs border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            </div>
                        </div>
                    </div>
                    <!-- 名称 -->
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">电台名称 <span class="text-red-400">*</span></label>
                        <input type="text" id="radio-add-name" placeholder="电台名称"
                               class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    </div>
                    <!-- URL -->
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">电台地址 <span class="text-red-400">*</span></label>
                        <input type="text" id="radio-add-url" placeholder="http://..."
                               class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono">
                    </div>

                    <!-- 两列 -->
                    <div class="grid grid-cols-2 gap-3">
                         <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">分组</label>
                            <input type="text" id="radio-add-group" list="radio-add-group-list" value="默认分组"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-group-list', groupValues.length ? groupValues : ['默认分组'])}
                        </div>
                        <!-- 类型 -->
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">类型</label>
                            <input type="text" id="radio-add-type" list="radio-add-type-list" placeholder="音乐/故事/综合..."
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-type-list', typeValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">音质</label>
                            <input type="text" id="radio-add-quality" list="radio-add-quality-list" placeholder="MP3/AAC..."
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-quality-list', ['MP3', 'AAC', 'AAC+', 'OGG', 'FLAC', 'WMA'])}
                        </div>
             
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Genres</label>
                            <input type="text" id="radio-add-genres" list="radio-add-genres-list" placeholder="流行, 摇滚..."
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-genres-list', genreValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Country</label>
                            <input type="text" id="radio-add-country" list="radio-add-country-list" placeholder="中国"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-country-list', countryValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Region</label>
                            <input type="text" id="radio-add-region" list="radio-add-region-list" placeholder="亚洲"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-region-list', regionValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">City</label>
                            <input type="text" id="radio-add-city" list="radio-add-city-list" placeholder="北京"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-city-list', cityValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Language</label>
                            <input type="text" id="radio-add-language" list="radio-add-language-list" placeholder="中文"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-add-language-list', languageValues)}
                        </div>
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-6">
                    <button onclick="closeRadioDialog()" class="px-4 py-2 text-sm t-text-muted hover:t-bg-main rounded-lg transition-colors">取消</button>
                    <button onclick="window.RadioManager.submitAddStation()"
                            class="px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors font-medium">
                        <i class="fas fa-plus mr-1"></i> 添加
                    </button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
    }

    async function submitAddStation() {
        const name = document.getElementById('radio-add-name')?.value.trim();
        const url = document.getElementById('radio-add-url')?.value.trim();
        if (!name || !url) {
            showError('请填写电台名称和地址');
            return;
        }

        // 获取封面：优先上传 URL，其次文件上传的 URL
        const coverUrlInput = document.getElementById('radio-add-cover-url');
        let cover = coverUrlInput?.value.trim() || _coverUploadUrl || '';

        const data = {
            name,
            url,
            cover,
            quality: document.getElementById('radio-add-quality')?.value.trim() || '',
            station_type: document.getElementById('radio-add-type')?.value.trim() || '',
            group_name: document.getElementById('radio-add-group')?.value.trim() || '默认分组',
            genres: document.getElementById('radio-add-genres')?.value.trim() || '',
            country: document.getElementById('radio-add-country')?.value.trim() || '',
            region: document.getElementById('radio-add-region')?.value.trim() || '',
            city: document.getElementById('radio-add-city')?.value.trim() || '',
            language: document.getElementById('radio-add-language')?.value.trim() || '',
        };

        console.log('[Radio] submitAddStation data:', data);
        const result = await addStationApi(data);
        console.log('[Radio] submitAddStation result:', result);
        if (result.success) {
            showSuccess('电台添加成功');
            closeRadioDialog();
            await refreshAll();
        } else {
            showError('添加失败: ' + (result.message || '未知错误'));
        }
    }

    // ============================================================================
    // 对话框 — 编辑电台 (Edit Dialog)
    // ============================================================================

    function editCurrentStation() {
        if (!_currentStation) return;
        const s = _currentStation;
        _coverUploadUrl = s.cover || '';

        // 提取已有值作为 datalist 选项
        const groupValues = getUniqueFieldValues('group_name');
        if (!groupValues.includes(s.group_name)) groupValues.push(s.group_name);
        const qualityValues = ['MP3', 'AAC', 'AAC+', 'OGG', 'FLAC', 'WMA'];
        const genreValues = getUniqueFieldValues('genres', ',');
        const countryValues = getUniqueFieldValues('country');
        const regionValues = getUniqueFieldValues('region');
        const cityValues = getUniqueFieldValues('city');
        const languageValues = getUniqueFieldValues('language');
        const typeValues = [...new Set([...getUniqueFieldValues('station_type'), '音乐', '故事', '综合', '新闻', '体育', '教育', '娱乐'].filter(Boolean))];

        const html = `<div id="radio-edit-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick="if(event.target===this)closeRadioDialog()">
            <div class="t-bg-panel rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border t-border-main max-h-[90vh] overflow-y-auto custom-scrollbar">
                <h3 class="text-lg font-bold t-text-main mb-4"><i class="fas fa-edit text-emerald-500 mr-2"></i>编辑电台</h3>
                <div class="space-y-3">
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">封面</label>
                        <div class="flex items-center gap-3">
                            <div id="radio-edit-cover-preview" class="w-16 h-16 rounded-lg t-bg-main flex items-center justify-center overflow-hidden flex-shrink-0 border t-border-main">
                                ${s.cover ? `<img src="${escapeHtml(authImageUrl(s.cover))}" class="w-full h-full object-cover">` : '<i class="fas fa-music text-xl t-text-dim opacity-30"></i>'}
                            </div>
                            <div class="flex-1 space-y-2">
                                <input type="file" id="radio-edit-cover-file" accept="image/*" onchange="window.RadioManager.handleCoverFileSelectEdit(event)" class="hidden">
                                <button onclick="document.getElementById('radio-edit-cover-file').click()"
                                        class="px-3 py-1 text-xs t-text-muted hover:t-bg-main rounded border t-border-main transition-colors">
                                    <i class="fas fa-upload mr-1"></i> 上传图片
                                </button>
                                <input type="text" id="radio-edit-cover-url" value="${escapeHtml(s.cover || '')}" placeholder="或输入图片 URL..."
                                       onchange="window.RadioManager.updateCoverPreviewEdit(this.value)"
                                       class="w-full px-3 py-1.5 text-xs border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            </div>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">电台名称 <span class="text-red-400">*</span></label>
                        <input type="text" id="radio-edit-name" value="${escapeHtml(s.name)}"
                               class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    </div>
                    <div>
                        <label class="block text-xs font-medium t-text-muted mb-1">电台地址 <span class="text-red-400">*</span></label>
                        <input type="text" id="radio-edit-url" value="${escapeHtml(s.url)}"
                               class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono">
                    </div>
  
                    <!-- 两列 -->
                    <div class="grid grid-cols-2 gap-3">
                         <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">分组</label>
                            <input type="text" id="radio-edit-group" list="radio-edit-group-list" value="${escapeHtml(s.group_name || '默认分组')}"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-group-list', groupValues.length ? groupValues : ['默认分组'])}
                        </div>
                        <!-- 类型 -->
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">类型</label>
                            <input type="text" id="radio-edit-type" list="radio-edit-type-list" value="${escapeHtml(s.station_type || '')}" placeholder="音乐/故事/综合..."
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-type-list', typeValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">音质</label>
                            <input type="text" id="radio-edit-quality" list="radio-edit-quality-list" value="${escapeHtml(s.quality || '')}" placeholder="MP3/AAC..."
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-quality-list', qualityValues)}
                        </div>

                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Genres</label>
                            <input type="text" id="radio-edit-genres" list="radio-edit-genres-list" value="${escapeHtml(s.genres || '')}" placeholder="流行, 摇滚..."
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-genres-list', genreValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Country</label>
                            <input type="text" id="radio-edit-country" list="radio-edit-country-list" value="${escapeHtml(s.country || '')}" placeholder="中国"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-country-list', countryValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Region</label>
                            <input type="text" id="radio-edit-region" list="radio-edit-region-list" value="${escapeHtml(s.region || '')}" placeholder="亚洲"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-region-list', regionValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">City</label>
                            <input type="text" id="radio-edit-city" list="radio-edit-city-list" value="${escapeHtml(s.city || '')}" placeholder="北京"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-city-list', cityValues)}
                        </div>
                        <div>
                            <label class="block text-xs font-medium t-text-muted mb-1">Language</label>
                            <input type="text" id="radio-edit-language" list="radio-edit-language-list" value="${escapeHtml(s.language || '')}" placeholder="中文"
                                   class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
                            ${renderDatalist('radio-edit-language-list', languageValues)}
                        </div>
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-6">
                    <button onclick="closeRadioDialog()" class="px-4 py-2 text-sm t-text-muted hover:t-bg-main rounded-lg transition-colors">取消</button>
                    <button onclick="window.RadioManager.submitEditStation()"
                            class="px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors font-medium">
                        <i class="fas fa-save mr-1"></i> 保存
                    </button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
    }

    async function submitEditStation() {
        if (!_currentStation) return;
        const name = document.getElementById('radio-edit-name')?.value.trim();
        const url = document.getElementById('radio-edit-url')?.value.trim();
        if (!name || !url) {
            showError('请填写电台名称和地址');
            return;
        }

        const coverUrlInput = document.getElementById('radio-edit-cover-url');
        let cover = coverUrlInput?.value.trim() || _coverUploadUrl || '';

        const data = {
            name,
            url,
            cover,
            quality: document.getElementById('radio-edit-quality')?.value.trim() || '',
            station_type: document.getElementById('radio-edit-type')?.value.trim() || '',
            group_name: document.getElementById('radio-edit-group')?.value.trim() || '默认分组',
            genres: document.getElementById('radio-edit-genres')?.value.trim() || '',
            country: document.getElementById('radio-edit-country')?.value.trim() || '',
            region: document.getElementById('radio-edit-region')?.value.trim() || '',
            city: document.getElementById('radio-edit-city')?.value.trim() || '',
            language: document.getElementById('radio-edit-language')?.value.trim() || '',
        };

        console.log('[Radio] submitEditStation data:', data);
        const result = await updateStationApi(_currentStation.id, data);
        console.log('[Radio] submitEditStation result:', result);
        if (result.success) {
            showSuccess('电台已更新');
            Object.assign(_currentStation, data);
            closeRadioDialog();
            await refreshAll();
            renderStationDetail(_currentStation);
        } else {
            showError('更新失败: ' + (result.message || '未知错误'));
        }
    }

    // ============================================================================
    // 对话框 — 新建分组 (Create Group Dialog)
    // ============================================================================

    function showCreateGroupDialog() {
        const html = `<div id="radio-group-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick="if(event.target===this)closeRadioDialog()">
            <div class="t-bg-panel rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border t-border-main">
                <h3 class="text-lg font-bold t-text-main mb-4"><i class="fas fa-folder-plus text-emerald-500 mr-2"></i>新建分组</h3>
                <div>
                    <label class="block text-xs font-medium t-text-muted mb-1">分组名称</label>
                    <input type="text" id="radio-new-group-name" placeholder="输入分组名称..."
                           class="w-full px-3 py-2 text-sm border t-border-main t-bg-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                           onkeydown="if(event.key==='Enter')window.RadioManager.submitCreateGroup()">
                </div>
                <div class="flex justify-end gap-3 mt-6">
                    <button onclick="closeRadioDialog()" class="px-4 py-2 text-sm t-text-muted hover:t-bg-main rounded-lg transition-colors">取消</button>
                    <button onclick="window.RadioManager.submitCreateGroup()"
                            class="px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors font-medium">
                        创建
                    </button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        // 自动聚焦
        setTimeout(() => document.getElementById('radio-new-group-name')?.focus(), 100);
    }

    async function submitCreateGroup() {
        const name = document.getElementById('radio-new-group-name')?.value.trim();
        if (!name) {
            showError('请输入分组名称');
            return;
        }
        const result = await createGroupApi(name);
        if (result.success) {
            showSuccess('分组已创建');
            closeRadioDialog();
            await fetchGroups();
            renderGroups();
        } else {
            showError('创建失败: ' + (result.message || '未知错误'));
        }
    }

    // ============================================================================
    // 封面上传 (Cover Upload)
    // ============================================================================

    async function uploadCover(file) {
        if (!file) return null;
        if (file.size > 5 * 1024 * 1024) {
            showError('封面图片不能超过 5MB');
            return null;
        }

        const formData = new FormData();
        formData.append('cover', file);

        try {
            const headers = {};
            if (typeof window.getUserAuthHeaders === 'function') {
                Object.assign(headers, window.getUserAuthHeaders());
            }
            const res = await fetch('/api/radio/cover-upload', { method: 'POST', headers, body: formData });
            const result = await res.json();
            if (result.success) {
                return result.data?.url || '';
            } else {
                showError('封面上传失败: ' + (result.message || ''));
                return null;
            }
        } catch (err) {
            console.error('[Radio] Cover upload failed:', err);
            showError('封面上传失败: ' + err.message);
            return null;
        }
    }

    function renderCoverPreview(containerId, url) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (url) {
            el.innerHTML = `<img src="${escapeHtml(authImageUrl(url))}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-music text-xl t-text-dim opacity-30\\'></i>'">`;
        } else {
            el.innerHTML = '<i class="fas fa-music text-xl t-text-dim opacity-30"></i>';
        }
    }

    async function handleCoverFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const url = await uploadCover(file);
        if (url) {
            _coverUploadUrl = url;
            renderCoverPreview('radio-add-cover-preview', url);
            const urlInput = document.getElementById('radio-add-cover-url');
            if (urlInput) urlInput.value = url;
        }
    }

    async function handleCoverFileSelectEdit(event) {
        const file = event.target.files[0];
        if (!file) return;
        const url = await uploadCover(file);
        if (url) {
            _coverUploadUrl = url;
            renderCoverPreview('radio-edit-cover-preview', url);
            const urlInput = document.getElementById('radio-edit-cover-url');
            if (urlInput) urlInput.value = url;
        }
    }

    function updateCoverPreview(url) {
        _coverUploadUrl = url;
        renderCoverPreview('radio-add-cover-preview', url);
    }

    function updateCoverPreviewEdit(url) {
        _coverUploadUrl = url;
        renderCoverPreview('radio-edit-cover-preview', url);
    }

    // ============================================================================
    // 收藏 / 删除 (Favorites / Delete)
    // ============================================================================

    async function toggleCurrentFavorite() {
        if (!_currentStation) return;
        const result = await toggleFavoriteApi(_currentStation.id);
        if (result.success) {
            _currentStation.is_favorite = result.data?.is_favorite ? 1 : 0;
            updateFavoriteBtn(_currentStation.is_favorite);
            await refreshAll();
            renderStationDetail(_currentStation);
        }
    }

    async function deleteCurrentStation() {
        if (!_currentStation) return;
        if (!confirm(`确定要删除电台 "${_currentStation.name}" 吗？`)) return;

        // 如果正在播放，先停止
        if (_isPlaying && _currentStation) {
            pauseRadio();
        }

        const result = await deleteStationApi(_currentStation.id);
        if (result.success) {
            showSuccess('电台已删除');
            _currentStation = null;
            renderStationDetail(null);
            await refreshAll();
        } else {
            showError('删除失败: ' + (result.message || '未知错误'));
        }
    }

    // ============================================================================
    // 辅助函数 (Helpers)
    // ============================================================================

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    async function refreshAll() {
        await Promise.all([fetchStations(), fetchGroups(), fetchFavorites()]);
        renderGroups();
        renderFavorites();
        renderFilterOptions();
    }

    function showAddMenu() {
        // 简单：直接弹出手动添加对话框
        showManualAddDialog();
    }

    // ============================================================================
    // 可视化 (Visualizer)
    // ============================================================================

    let _radioVisAnimId = null;
    let _radioVisCtx = null;
    let _radioVisAnalyser = null;
    let _radioVisDataArray = null;

    function initRadioVisualizer() {
        const canvas = document.getElementById('radio-visualizer');
        if (!canvas) return;

        _radioVisCtx = canvas.getContext('2d');

        // 复用全局 audio context 的 analyser
        if (window.soundEffects && window.soundEffects.getAnalyser()) {
            _radioVisAnalyser = window.soundEffects.getAnalyser();
        } else if (window.musicVisualizer && window.musicVisualizer.getAnalyser) {
            _radioVisAnalyser = window.musicVisualizer.getAnalyser();
        }

        if (!_radioVisAnalyser) return;

        _radioVisDataArray = new Uint8Array(_radioVisAnalyser.frequencyBinCount);
        drawRadioVisualizer();
    }

    function drawRadioVisualizer() {
        if (!_radioVisCtx || !_radioVisAnalyser || !_radioVisDataArray) return;

        const canvas = document.getElementById('radio-visualizer');
        if (!canvas) return;

        // 只在电台视图可见时绘制
        const viewRadio = document.getElementById('view-radio');
        if (!viewRadio || viewRadio.classList.contains('hidden')) {
            _radioVisAnimId = requestAnimationFrame(drawRadioVisualizer);
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            _radioVisCtx.scale(dpr, dpr);
        }

        const cw = rect.width;
        const ch = rect.height;

        _radioVisAnalyser.getByteFrequencyData(_radioVisDataArray);

        _radioVisCtx.clearRect(0, 0, cw, ch);

        const barCount = Math.min(64, _radioVisDataArray.length);
        const barWidth = cw / barCount * 0.7;
        const gap = cw / barCount * 0.3;

        for (let i = 0; i < barCount; i++) {
            const val = _radioVisDataArray[i] / 255;
            const barHeight = val * ch * 0.9;
            const x = i * (barWidth + gap) + gap / 2;
            const y = ch - barHeight;

            const hue = 150 + (i / barCount) * 30; // 绿色色调范围
            _radioVisCtx.fillStyle = `hsla(${hue}, 70%, 55%, ${0.6 + val * 0.4})`;
            _radioVisCtx.fillRect(x, y, barWidth, barHeight);
        }

        _radioVisAnimId = requestAnimationFrame(drawRadioVisualizer);
    }

    function stopRadioVisualizer() {
        if (_radioVisAnimId) {
            cancelAnimationFrame(_radioVisAnimId);
            _radioVisAnimId = null;
        }
    }

    // ============================================================================
    // 初始化 (Init)
    // ============================================================================

    /** 切换分组维度（分组/城市/类型/国家/语言/地区） */
    function switchGroupMode(mode) {
        _groupMode = mode;
        _virtualExpanded = {}; // 切换时重置虚拟展开状态
        renderGroups();
    }

    async function init() {
        if (_initialized) return;
        _initialized = true;

        bindAudioEvents();

        try {
            await refreshAll();
        } catch (err) {
            console.error('[Radio] Init failed:', err);
        }

        initRadioVisualizer();
    }

    // ============================================================================
    // 公共 API (Public API)
    // ============================================================================

    return {
        init,
        selectStation,
        toggleGroup,
        toggleRadioPlay,
        playNextStation,
        playPrevStation,
        toggleCurrentFavorite,
        editCurrentStation: editCurrentStation,
        deleteCurrentStation,
        showImportDialog,
        showJsonImportDialog,
        showManualAddDialog,
        showCreateGroupDialog,
        showAddMenu,
        handleM3UFileSelect,
        handleJsonFileSelect,
        handleCoverFileSelect,
        handleCoverFileSelectEdit,
        updateCoverPreview,
        updateCoverPreviewEdit,
        submitAddStation,
        submitEditStation,
        submitCreateGroup,
        applyFilters,
        switchGroupMode,
        parseM3U,
        // 暴露给外部
        get initialized() { return _initialized; },
        get currentStation() { return _currentStation; },
        get isPlaying() { return _isPlaying; },
    };
})();

// ============================================================================
// 全局函数 — 侧边栏切换 (Toggle Sidebar for Mobile)
// ============================================================================

function toggleRadioSidebar(show) {
    const sidebar = document.getElementById('radio-sidebar');
    const overlay = document.getElementById('radio-sidebar-overlay');
    if (!sidebar) return;

    const isHidden = sidebar.classList.contains('-translate-x-full');
    const shouldShow = show !== undefined ? show : isHidden;

    if (shouldShow) {
        sidebar.classList.remove('-translate-x-full');
        if (overlay) {
            overlay.classList.remove('hidden');
            requestAnimationFrame(() => overlay.classList.remove('opacity-0'));
        }
    } else {
        sidebar.classList.add('-translate-x-full');
        if (overlay) {
            overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    }
}

// ============================================================================
// 全局函数 — 关闭对话框 (Close Dialog)
// ============================================================================

function closeRadioDialog() {
    document.querySelectorAll('[id^="radio-"][id$="-dialog"]').forEach(el => el.remove());
}

// ============================================================================
// 暴露到全局 (Expose to Global Scope)
// ============================================================================

window.RadioManager = RadioManager;
window.toggleRadioSidebar = toggleRadioSidebar;
window.closeRadioDialog = closeRadioDialog;
