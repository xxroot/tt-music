// ========== Singer Library - 歌手库管理 ==========
// 歌手库模块：负责歌手列表加载、搜索、排序、分页、同步及点击跳转专辑视图
// ============================================================================

// 歌手库状态变量
let _singerLibList = [];       // 当前页数据
let _singerLibTotal = 0;       // 服务端返回的总数
let _singerLibLoaded = false;
let _singerLibPage = 1;
let _singerLibPageSize = 25;
let _singerSyncTaskId = null;
let _singerSyncPollingTimer = null;
// 歌手过滤模式: 点击歌手跳转到专辑视图时，用于过滤专辑
let _singerFilterName = null;

// 歌手详情页状态 (Singer Detail View State)
let _singerDetailActive = false;
let _singerDetailName = '';
let _singerDetailAlbums = [];     // 该歌手的专辑分组列表
let _singerDetailAllSongs = [];   // 该歌手所有歌曲（扁平列表）
let _singerDetailSongsPage = 1;
let _singerDetailSongsPageSize = 30;
let _singerDetailActiveTab = 'albums';  // 'albums' | 'songs'
let _singerDetailSingerId = '';
let _singerDetailSource = '';
let _singerDetailGender = '';

// 歌手库排序/搜索状态 (服务端分页)
let _singerLibSort = 'name';
let _singerLibOrder = 'asc';
let _singerLibKeyword = '';
let _singerLibSourceFilter = '';  // 来源筛选

async function loadSingerLib() {
    const container = document.getElementById('singerlib-container');
    const countEl = document.getElementById('singerlib-count');
    if (!container) return;

    container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-user-music text-5xl mb-4 opacity-20"></i><p class="text-base font-medium animate-pulse">加载中...</p></div>';
    ;

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const params = new URLSearchParams({
            page: _singerLibPage,
            limit: _singerLibPageSize,
            sort: _singerLibSort,
            order: _singerLibOrder
        });
        if (_singerLibKeyword) params.set('keyword', _singerLibKeyword);
        if (_singerLibSourceFilter) params.set('source', _singerLibSourceFilter);
        const res = await fetch(`/api/music/singer/list?${params}`, {headers});
        const result = await res.json();
        if (result.code === 0 && result.data) {
            _singerLibList = result.data.list || [];
            _singerLibTotal = result.data.total || 0;
            _singerLibLoaded = true;
            renderSingerLibList();
            if (countEl) countEl.textContent = `共 ${_singerLibTotal} 位歌手`;
            ;
        } else {
            _singerLibList = [];
            _singerLibTotal = 0;
            _singerLibPage = 1;
            container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-user-music text-5xl mb-4 opacity-20"></i><p class="text-base font-medium">暂无歌手信息</p></div>';
            ;
            if (countEl) countEl.textContent = '共 0 位歌手';
        }
    } catch (err) {
        console.error('[SingerLib] Failed to load:', err);
        container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-exclamation-circle text-5xl mb-4 opacity-20 text-red-400"></i><p class="text-base font-medium">加载失败</p></div>';
        ;
    }
}

function filterSingerLib() {
    _singerLibKeyword = (document.getElementById('singerlib-search-input')?.value || '').toLowerCase().trim();
    _singerLibPage = 1;
    loadSingerLib();
}

function filterSingerLibBySource() {
    const select = document.getElementById('singerlib-source-filter');
    if (!select) return;
    _singerLibSourceFilter = select.value;
    _singerLibPage = 1;
    loadSingerLib();
}

window.filterSingerLibBySource = filterSingerLibBySource;

function sortSingerLib() {
    const sortSelect = document.getElementById('singerlib-sort-select');
    _singerLibSort = sortSelect?.value || 'name';
    // 保持当前排序方向不变（与专辑列表行为一致）
    _singerLibPage = 1;
    loadSingerLib();
}

// 切换歌手排序方向
function toggleSingerLibSortOrder() {
    const orderBtn = document.getElementById('singerlib-sort-order-btn');
    if (!orderBtn) return;

    // 切换排序方向
    _singerLibOrder = _singerLibOrder === 'asc' ? 'desc' : 'asc';

    // 更新图标
    const icon = orderBtn.querySelector('i');
    if (_singerLibOrder === 'asc') {
        icon.className = 'fas fa-sort-amount-up text-sm';
        orderBtn.title = '当前: 正序 (点击切换为倒序)';
    } else {
        icon.className = 'fas fa-sort-amount-down text-sm';
        orderBtn.title = '当前: 倒序 (点击切换为正序)';
    }

    // 重新加载列表
    _singerLibPage = 1;
    loadSingerLib();
}

window.toggleSingerLibSortOrder = toggleSingerLibSortOrder;

function renderSingerLibList() {
    const container = document.getElementById('singerlib-container');
    if (!container) return;

    // 退出详情模式：恢复网格布局
    _singerDetailActive = false;
    container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-4 md:gap-6';
    const singerGrid = document.getElementById('singerlib-grid');
    if (singerGrid) singerGrid.style.overflow = '';
    const pagination = document.getElementById('singerlib-pagination');
    if (pagination) pagination.classList.remove('hidden');

    if (!_singerLibList.length) {
        container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-user-music text-5xl mb-4 opacity-20"></i><p class="text-base font-medium">没有匹配的歌手</p></div>';
        ;
        updateSingerLibPagination();
        return;
    }

    container.innerHTML = _singerLibList.map((singer) => {
        const avatarUrl = singer.avatar || '/music/assets/logo.png';
        const sourceIcon = singer.source === 'wy' ? '网易云音乐' : (singer.source === 'tx' ? 'QQ音乐' : singer.source);
        return `
            <div class="group cursor-pointer" data-singer-name="${escapeHtml(singer.name)}"
                 data-singer-avatar="${escapeHtml(singer.avatar || '')}"
                 data-singer-desc="${escapeHtml(singer.desc || '')}"
                 data-singer-musiccount="${singer.musicCount || 0}"
                 data-singer-albumcount="${singer.albumCount || 0}"
                 data-singer-id="${singer.singerId || ''}"
                 data-singer-source="${singer.source || ''}"
                 data-singer-gender="${singer.gender || ''}"
                 onclick="openSingerDetail(this.dataset.singerName, this.dataset.singerAvatar, this.dataset.singerDesc, parseInt(this.dataset.singerMusiccount), parseInt(this.dataset.singerAlbumcount), this.dataset.singerId, this.dataset.singerSource, this.dataset.singerGender)">
                <div class="relative aspect-square overflow-hidden rounded-full shadow-md transition-all group-hover:shadow-xl group-hover:-translate-y-1">
                    <img src="${avatarUrl}" alt="" loading="lazy"
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
                    <h3 class="text-sm font-bold t-text-main line-clamp-2 leading-snug group-hover:text-emerald-500 transition-colors" title="${escapeHtml(singer.name)}">${escapeHtml(singer.name)}</h3>
                    <p class="text-xs t-text-muted mt-1.5 truncate">${sourceIcon}</p>
                    <div class="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400 font-medium">
                        ${singer.musicCount ? `<span><i class="fas fa-music text-[10px] mr-1"></i>${singer.musicCount}</span>` : ''}
                        ${singer.albumCount ? `<span><i class="fas fa-compact-disc text-[10px] mr-1"></i>${singer.albumCount}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    updateSingerLibPagination();
}

// ===== 歌手库分页 (由 pagination-factory.js 工厂生成) =====
const _singerLibPaginator = createLibPaginator({
    getPage: () => _singerLibPage, setPage: (p) => { _singerLibPage = p; },
    getPageSize: () => _singerLibPageSize, setPageSize: (s) => { _singerLibPageSize = s; },
    getTotal: () => _singerLibTotal, getTotalPages: () => 0,
    loadFn: loadSingerLib, prefix: 'singerlib', itemLabel: '位歌手',
    defaultPageSize: 25
});
const updateSingerLibPagination = _singerLibPaginator.updatePagination;
const singerLibPrevPage = _singerLibPaginator.prevPage;
const singerLibNextPage = _singerLibPaginator.nextPage;
const singerLibGoToPage = _singerLibPaginator.goToPage;
const singerLibChangePageSize = _singerLibPaginator.changePageSize;

/**
 * 显示歌手同步阶段选择弹窗 (Singer sync phase selection dialog)
 * 返回用户选中的阶段数组，取消返回 null
 */
function showSyncPhaseDialog() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">同步歌手信息</h3>
                    <button id="sync-modal-close" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-5">
                    <p class="text-sm t-text-muted leading-relaxed mb-4">请选择要执行的同步阶段：</p>
                    <label class="flex items-start gap-3 p-3 rounded-xl border t-border-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 cursor-pointer transition-colors mb-3">
                        <input type="checkbox" id="sync-phase-1" checked class="mt-0.5 w-4 h-4 accent-emerald-500 flex-shrink-0">
                        <div>
                            <div class="text-sm font-medium t-text-main">阶段1 - 新增歌手</div>
                            <div class="text-xs t-text-muted mt-0.5">从下载记录中识别缺失的歌手并同步信息</div>
                        </div>
                    </label>
                    <label class="flex items-start gap-3 p-3 rounded-xl border t-border-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 cursor-pointer transition-colors">
                        <input type="checkbox" id="sync-phase-2" checked class="mt-0.5 w-4 h-4 accent-emerald-500 flex-shrink-0">
                        <div>
                            <div class="text-sm font-medium t-text-main">阶段2 - 补全信息</div>
                            <div class="text-xs t-text-muted mt-0.5">对已有但不完整的歌手记录补全头像、简介等</div>
                        </div>
                    </label>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="sync-modal-ok" class="flex-1 py-2.5 text-sm font-bold text-white bg-emerald-500 hover:opacity-90 rounded-xl shadow-lg transition-all active:scale-95">
                        开始同步
                    </button>
                    <button id="sync-modal-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        取消
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) content.classList.add('scale-95', 'opacity-0');
            modal.classList.add('opacity-0');
            setTimeout(() => { modal.remove(); resolve(result); }, 200);
        };

        modal.querySelector('#sync-modal-ok').onclick = () => {
            const phases = [];
            if (modal.querySelector('#sync-phase-1').checked) phases.push(1);
            if (modal.querySelector('#sync-phase-2').checked) phases.push(2);
            if (phases.length === 0) {
                showToast('warning', '请至少选择一个同步阶段');
                return;
            }
            close(phases);
        };
        modal.querySelector('#sync-modal-cancel').onclick = () => close(null);
        modal.querySelector('#sync-modal-close').onclick = () => close(null);
        modal.querySelector('.absolute').onclick = () => close(null);
    });
}

/**
 * 同步歌手信息 - 启动异步任务 + 进度轮询
 */
async function syncSingerInfo() {
    // 同步阶段选择对话框 (Sync phase selection dialog)
    const phases = await showSyncPhaseDialog();
    if (!phases) return;

    const syncBtn = document.getElementById('singerlib-sync-btn');
    const progressEl = document.getElementById('singerlib-sync-progress');

    if (syncBtn) syncBtn.disabled = true;

    // 如果有正在轮询的任务，先停止
    if (_singerSyncPollingTimer) {
        clearInterval(_singerSyncPollingTimer);
        _singerSyncPollingTimer = null;
    }

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        Object.assign(headers, {'Content-Type': 'application/json'});

        const res = await fetch('/api/music/singer/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify({ phases }),
        });
        const result = await res.json();

        if (result.code !== 0 || !result.data?.taskId) {
            showToast('error', '启动同步任务失败');
            if (syncBtn) syncBtn.disabled = false;
            return;
        }

        _singerSyncTaskId = result.data.taskId;

        // 显示进度条
        if (progressEl) progressEl.classList.remove('hidden');
        updateSyncProgressUI('正在同步...', 0, 0);

        // 开始轮询
        _singerSyncPollingTimer = setInterval(async () => {
            try {
                const pollRes = await fetch(`/api/music/singer/sync-progress?taskId=${_singerSyncTaskId}`, {headers});
                const pollResult = await pollRes.json();

                if (pollResult.code !== 0 || !pollResult.data) {
                    clearInterval(_singerSyncPollingTimer);
                    _singerSyncPollingTimer = null;
                    if (syncBtn) syncBtn.disabled = false;
                    updateSyncProgressUI('同步失败', 0, 0);
                    return;
                }

                const progress = pollResult.data;
                const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
                // 根据阶段展示不同状态文本 (Phase-aware status text)
                const phaseLabel = progress.phase === 1 ? '新增歌手' : '补全信息';
                const totalPhaseCount = (progress.selectedPhases || [1, 2]).length;
                const currentPhaseIdx = (progress.selectedPhases || [1, 2]).indexOf(progress.phase) + 1;
                const statusText = progress.status === 'done' ? '同步完成'
                    : progress.status === 'error' ? '同步出错'
                    : totalPhaseCount === 1 ? `${phaseLabel}...`
                    : `阶段${currentPhaseIdx}/${totalPhaseCount} - ${phaseLabel}...`;
                updateSyncProgressUI(
                    statusText,
                    percent,
                    progress.processed,
                    progress.total,
                    progress.synced,
                    progress.skipped,
                    progress.failed
                );

                if (progress.status === 'done' || progress.status === 'error') {
                    clearInterval(_singerSyncPollingTimer);
                    _singerSyncPollingTimer = null;
                    _singerSyncTaskId = null;
                    if (syncBtn) syncBtn.disabled = false;

                    // 3秒后隐藏进度条
                    setTimeout(() => {
                        if (progressEl) progressEl.classList.add('hidden');
                    }, 3000);

                    // 同步完成后刷新列表
                    loadSingerLib();
                }
            } catch (pollErr) {
                console.error('[SingerSync] Poll error:', pollErr);
            }
        }, 2000);
    } catch (err) {
        console.error('[SingerSync] Failed to start:', err);
        showToast('error', '启动同步任务失败');
        if (syncBtn) syncBtn.disabled = false;
    }
}

function updateSyncProgressUI(statusText, percent, processed, total, synced, skipped, failed) {
    const statusEl = document.getElementById('singerlib-sync-status');
    const statsEl = document.getElementById('singerlib-sync-stats');
    const barEl = document.getElementById('singerlib-sync-bar');

    if (statusEl) statusEl.textContent = statusText;
    if (barEl) barEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;

    if (statsEl) {
        const parts = [];
        if (typeof total === 'number' && total > 0) parts.push(`${processed}/${total}`);
        if (typeof synced === 'number') parts.push(`新增${synced}`);
        if (typeof skipped === 'number') parts.push(`跳过${skipped}`);
        if (typeof failed === 'number' && failed > 0) parts.push(`失败${failed}`);
        statsEl.textContent = parts.join(' · ');
    }
}

/**
 * 点击歌手 → 打开歌手详情页 (Singer detail view: header + Albums/Songs tabs)
 */
async function openSingerDetail(singerName, avatar, desc, musicCount, albumCount, singerId, source, gender) {
    if (!singerName) return;

    _singerDetailActive = true;
    _singerDetailName = singerName;
    _singerDetailActiveTab = 'albums';
    _singerDetailSongsPage = 1;
    _singerDetailSingerId = singerId || '';
    _singerDetailSource = source || '';
    _singerDetailGender = gender || '';

    const container = document.getElementById('singerlib-container');
    const pagination = document.getElementById('singerlib-pagination');
    if (!container) return;

    // 隐藏分页
    if (pagination) pagination.classList.add('hidden');

    // 切换到详情模式：让容器脱离网格布局，父级grid不滚动
    container.className = 'flex flex-col h-full';
    const singerGrid = document.getElementById('singerlib-grid');
    if (singerGrid) singerGrid.style.overflow = 'hidden';

    // 显示加载
    container.innerHTML = `<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>`;

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`/api/music/singer/albums?singerName=${encodeURIComponent(singerName)}`, {headers});
        const result = await res.json();

        if (result.code !== 0) throw new Error(result.msg || '获取歌手数据失败');

        _singerDetailAlbums = result.data || [];

        // 展开所有歌曲为扁平列表
        _singerDetailAllSongs = [];
        for (const album of _singerDetailAlbums) {
            if (album.songs) {
                for (const song of album.songs) {
                    song._albumName = album.name || '未知专辑';
                    _singerDetailAllSongs.push(song);
                }
            }
        }

        // 用 API 返回的实际数量修正统计
        const actualMusicCount = _singerDetailAllSongs.length;
        const actualAlbumCount = _singerDetailAlbums.length;

        renderSingerDetail(avatar, desc, actualMusicCount || musicCount, actualAlbumCount || albumCount);
    } catch (err) {
        console.error('[SingerDetail] Error:', err);
        container.innerHTML = `<div class="text-center text-red-500 p-8">${escapeHtml(err.message)}</div>`;
    }
}

/**
 * 渲染歌手详情页整体结构 (Render singer detail page structure)
 */
function renderSingerDetail(avatar, desc, musicCount, albumCount) {
    const container = document.getElementById('singerlib-container');
    if (!container) return;

    const avatarSrc = avatar || '/music/assets/logo.png';
    const hasAlbums = albumCount > 0;
    const hasSongs = musicCount > 0;

    // 歌手性别标签 (Gender badge)
    let genderBadgeHtml = '';
    if (_singerDetailGender) {
        const g = _singerDetailGender;
        let bgClass = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
        if (g === '男') bgClass = 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
        else if (g === '女') bgClass = 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300';
        else if (g === '组合') bgClass = 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
        genderBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bgClass}"><i class="fas fa-venus-mars mr-1 text-[10px]"></i>${escapeHtml(g)}</span>`;
    }

    container.innerHTML = `
        <!-- 歌手头部信息 + 返回按钮 + 操作按钮 (Singer detail header with action buttons) -->
        <div class="flex-shrink-0 p-4 border-b t-border-main">
            <div class="flex items-center justify-between mb-3">
                <button onclick="backToSingerList()" class="text-emerald-600 hover:text-emerald-700 text-sm">
                    <i class="fas fa-arrow-left mr-1"></i>返回歌手列表
                </button>
                <div class="flex items-center gap-2">
                    <button onclick="editSinger()" class="px-2.5 py-1.5 text-xs rounded-lg border t-border-main hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 hover:text-blue-700 transition-colors" title="手动编辑歌手信息">
                        <i class="fas fa-pen mr-1"></i>编辑
                    </button>
                    <button onclick="deleteSinger()" class="px-2.5 py-1.5 text-xs rounded-lg border t-border-main hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 hover:text-red-600 transition-colors" title="删除歌手">
                        <i class="fas fa-trash-alt mr-1"></i>删除
                    </button>
                    <button onclick="updateSinger()" class="px-2.5 py-1.5 text-xs rounded-lg border t-border-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600 hover:text-emerald-700 transition-colors" title="从在线源更新歌手信息">
                        <i class="fas fa-sync-alt mr-1"></i>更新
                    </button>
                </div>
            </div>
            <div class="flex items-start gap-4">
                <div class="w-20 h-20 rounded-full overflow-hidden shadow-md flex-shrink-0 bg-gray-200 dark:bg-gray-700">
                    <img src="${avatarSrc}" class="w-full h-full object-cover"
                         onerror="if(this.src!=='${window.location.origin}/music/assets/logo.png'){this.src='/music/assets/logo.png'}">
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <h2 class="text-lg font-bold t-text-main">${escapeHtml(_singerDetailName)}</h2>
                        ${genderBadgeHtml}
                    </div>
                    <p class="text-xs t-text-muted mt-1">
                        <i class="fas fa-music mr-1"></i>${musicCount} 首歌曲 ·
                        <i class="fas fa-compact-disc mr-1"></i>${albumCount} 张专辑
                    </p>
                    ${desc ? `<div class="text-xs t-text-muted mt-2 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar pr-1" title="${escapeHtml(desc)}">${escapeHtml(desc)}</div>` : ''}
                </div>
            </div>
        </div>

        <!-- Tab 切换条 -->
        <div class="flex-shrink-0 flex border-b t-border-main sticky top-0 z-10 t-bg-main">
            ${hasAlbums ? `<button id="local-singer-tab-albums" onclick="switchLocalSingerTab('albums')"
                class="flex-1 py-2.5 text-sm font-medium text-center transition-colors ${_singerDetailActiveTab === 'albums' ? 'text-emerald-600 border-b-2 border-emerald-500' : 't-text-muted hover:t-text-main'}">
                <i class="fas fa-compact-disc mr-1"></i>专辑 (${albumCount})
            </button>` : ''}
            ${hasSongs ? `<button id="local-singer-tab-songs" onclick="switchLocalSingerTab('songs')"
                class="flex-1 py-2.5 text-sm font-medium text-center transition-colors ${_singerDetailActiveTab === 'songs' ? 'text-emerald-600 border-b-2 border-emerald-500' : 't-text-muted hover:t-text-main'}">
                <i class="fas fa-music mr-1"></i>歌曲 (${musicCount})
            </button>` : ''}
        </div>

        <!-- 专辑 Tab 面板 -->
        <div id="local-singer-albums-panel" class="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6" style="${_singerDetailActiveTab === 'albums' ? '' : 'display:none'}">
            <div id="local-singer-albums-content"></div>
        </div>

        <!-- 歌曲 Tab 面板 -->
        <div id="local-singer-songs-panel" class="flex-1 overflow-y-auto custom-scrollbar" style="${_singerDetailActiveTab === 'songs' ? '' : 'display:none'}">
            <div id="local-singer-songs-content" class="flex flex-col h-full"></div>
        </div>
    `;

    // 渲染激活的 Tab
    if (_singerDetailActiveTab === 'albums') {
        renderSingerAlbumsPanel();
    } else {
        renderSingerSongsPanel();
    }
}

/**
 * 渲染专辑 Tab 面板 (Render albums tab panel)
 */
function renderSingerAlbumsPanel() {
    const container = document.getElementById('local-singer-albums-content');
    if (!container) return;

    if (!_singerDetailAlbums.length) {
        container.innerHTML = '<div class="text-center t-text-muted py-12">暂无专辑数据</div>';
        return;
    }

    container.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-4 md:gap-6 py-4">
            ${_singerDetailAlbums.map(album => {
                const coverUrl = (album.img && album.img.startsWith('http')) ? album.img : album.cover || '/music/assets/logo.png';
                const albumName = album.name || '未知专辑';
                const albumSinger = album.singer || _singerDetailName;
                const songCount = album.songs ? album.songs.length : 0;
                return `
                    <div class="group cursor-pointer" onclick="openSingerAlbumDetail('${escapeJs(albumName)}', '${escapeJs(albumSinger)}', '${escapeJs(coverUrl)}', ${songCount})">
                        <div class="relative aspect-square overflow-hidden rounded-xl shadow-sm transition-all group-hover:shadow-md group-hover:-translate-y-0.5">
                            <img src="${coverUrl}" alt="${escapeHtml(albumName)}" loading="lazy"
                                 class="w-full h-full object-cover dynamic-logo is-placeholder"
                                 onload="this.classList.remove('is-placeholder')"
                                 onerror="this.src='/music/assets/logo.png'; this.classList.add('is-placeholder');">
                        </div>
                        <p class="text-xs font-medium t-text-main mt-1.5 line-clamp-1" title="${escapeHtml(albumName)}">${escapeHtml(albumName)}</p>
                        <p class="text-[10px] t-text-muted truncate">${escapeHtml(albumSinger)} · ${songCount}首</p>
                    </div>`;
            }).join('')}
        </div>
    `;
}

/**
 * 从歌手详情打开专辑 (Open album from singer detail)
 */
async function openSingerAlbumDetail(albumName, albumSinger, coverUrl, songCount) {
    // 设置层层返回上下文，让专辑详情的返回按钮能回到歌手详情
    window._albumLibFromSinger = {
        singerName: _singerDetailName,
        avatar: '',  // avatar URL will be read from current DOM
        desc: '',
        musicCount: _singerDetailAllSongs.length,
        albumCount: _singerDetailAlbums.length,
        singerId: _singerDetailSingerId,
        source: _singerDetailSource,
        gender: _singerDetailGender
    };

    // 使用通用的 openAlbumByName，需要构造 albumInfo 对象
    const albumInfo = {
        album: albumName,
        singer: albumSinger,
        singCount: songCount,
        duration: 0,
        genre: '',
        year: '',
        albumArtist: albumSinger,
        source: '',
        img: coverUrl
    };
    if (typeof openAlbumByName === 'function') {
        await openAlbumByName(albumInfo);
    }
}

/**
 * 渲染歌曲 Tab 面板 (Render songs tab panel with embedded header + pagination)
 */
function renderSingerSongsPanel() {
    const container = document.getElementById('local-singer-songs-content');
    if (!container) return;

    if (!_singerDetailAllSongs.length) {
        container.innerHTML = '<div class="text-center t-text-muted py-12 flex-1">暂无歌曲数据</div>';
        return;
    }

    const totalItems = _singerDetailAllSongs.length;
    const totalPages = Math.ceil(totalItems / _singerDetailSongsPageSize);

    // 边界检查
    if (_singerDetailSongsPage > totalPages) _singerDetailSongsPage = totalPages || 1;
    if (_singerDetailSongsPage < 1) _singerDetailSongsPage = 1;

    const startIdx = (_singerDetailSongsPage - 1) * _singerDetailSongsPageSize;
    const endIdx = Math.min(startIdx + _singerDetailSongsPageSize, totalItems);
    const pageSongs = _singerDetailAllSongs.slice(startIdx, endIdx);

    container.innerHTML = `
        <!-- 嵌入式表头 (Embedded song list header) -->
        <div class="flex-shrink-0 grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-4 border-b t-border-main t-bg-main text-gray-500 text-xs md:text-sm font-medium sticky top-0 z-10">
            <div class="col-span-1 text-center text-[10px] md:text-xs">#</div>
            <div class="col-span-5 md:col-span-5 text-[10px] md:text-xs">歌曲名</div>
            <div class="hidden md:block md:col-span-2 text-[10px] md:text-xs">歌手</div>
            <div class="col-span-2 md:col-span-1 text-center text-[10px] md:text-xs">时长</div>
            <div class="col-span-4 md:col-span-3 text-right text-[10px] md:text-xs">操作</div>
        </div>

        <!-- 歌曲列表 (Song rows) -->
        <div class="flex-1 overflow-y-auto custom-scrollbar" id="local-singer-songs-list">
            ${pageSongs.map((song, displayIndex) => renderSingerSongRow(song, startIdx + displayIndex)).join('')}
        </div>

        <!-- 内嵌分页 (Embedded pagination) -->
        <div class="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t t-border-main t-bg-panel/80 text-xs t-text-muted">
            <button onclick="singerDetailSongsPrevPage()"
                class="px-2 md:px-3 py-1.5 rounded-lg border t-border-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                ${_singerDetailSongsPage <= 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left mr-1"></i>上一页
            </button>
            <div class="flex items-center gap-1">
                <input type="number" id="singer-detail-songs-page-input" min="1" max="${totalPages}" value="${_singerDetailSongsPage}"
                    onkeydown="if(event.key==='Enter') singerDetailSongsGoToPage(parseInt(this.value))"
                    class="w-10 md:w-12 text-center px-1 py-1 rounded border t-border-main t-bg-input t-text-main text-xs">
                <span>/ ${totalPages} 页 (共 ${totalItems} 首)</span>
            </div>
            <select id="singer-detail-songs-pagesize" onchange="singerDetailSongsChangePageSize(this.value)"
                class="px-1 md:px-2 py-1 rounded border t-border-main t-bg-input t-text-main text-xs">
                <option value="20" ${_singerDetailSongsPageSize === 20 ? 'selected' : ''}>20首/页</option>
                <option value="30" ${_singerDetailSongsPageSize === 30 ? 'selected' : ''}>30首/页</option>
                <option value="50" ${_singerDetailSongsPageSize === 50 ? 'selected' : ''}>50首/页</option>
                <option value="100" ${_singerDetailSongsPageSize === 100 ? 'selected' : ''}>100首/页</option>
            </select>
            <button onclick="singerDetailSongsNextPage()"
                class="px-2 md:px-3 py-1.5 rounded-lg border t-border-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                ${_singerDetailSongsPage >= totalPages ? 'disabled' : ''}>
                下一页<i class="fas fa-chevron-right ml-1"></i>
            </button>
        </div>
    `;
}

/**
 * 渲染单个歌曲行 (Render single song row)
 */
function renderSingerSongRow(song, globalIndex) {
    const qualityMap = {
        '128k': '128k', '192k': '192k', '320k': '320k',
        'flac': 'FLAC', 'ape': 'APE', 'wav': 'WAV', 'ogg': 'OGG', 'm4a': 'M4A',
        'flac24bit': 'Hi-Res', 'dsf': 'DSF', 'dff': 'DFF',
        'aiff': 'AIFF', 'aif': 'AIFF', 'dts': 'DTS', 'wv': 'WV', 'wma': 'WMA',
    };
    const qualityLower = (song.quality || '').toLowerCase();
    const qualityLabel = song.quality ? (qualityMap[qualityLower] || qualityLower.toUpperCase()) : '';
    const hiResFormats = ['flac24bit', 'dsf', 'dff', 'aiff', 'aif', 'dts', 'wv', 'wma'];
    let qualityColorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 transition-colors';
    if (qualityLower === 'flac24bit' || hiResFormats.includes(qualityLower)) {
        qualityColorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 transition-colors';
    } else if (qualityLower === 'flac') {
        qualityColorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 transition-colors';
    }

    const durationStr = song.duration ? formatDuration(song.duration) : '--:--';
    const sizeStr = song.size ? formatFileSize(song.size) : '';
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

    const coverUrl = (song.img?.startsWith && song.img.startsWith('http') && song.img) ||
        (song.relativePath && typeof buildCoverUrl === 'function' ? buildCoverUrl(song.relativePath, song.source) : '') ||
        (song.coverPath ? `/api/music/cache/cover?filename=${encodeURIComponent(song.coverPath)}` : '') || '';

    const isActive = isCurrentPlayingSong(song);

    const displayIdx = globalIndex + 1;
    return `
        <div class="grid grid-cols-12 gap-2 md:gap-4 px-3 md:px-4 py-3 rounded-xl items-center transition-all duration-200 hover:t-bg-track group hover:shadow-sm hover:scale-[1.005] ${isActive ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 't-bg-item-hover'}"
            ondblclick="playSingerDetailSong(${globalIndex})" onclick="event.stopPropagation()">
            <div class="col-span-1 text-center">
                <span class="text-xs t-text-muted font-mono">${displayIdx}</span>
            </div>
            <div class="col-span-5 md:col-span-5 flex items-center gap-2 min-w-0">
                ${coverUrl ? `<div class="relative w-10 h-10 flex-shrink-0"><img src="${escapeHtml(coverUrl)}" alt="" loading="lazy" class="w-10 h-10 rounded object-cover" onerror="this.style.display='none'"></div>` : ''}
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="truncate text-sm ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 't-text-main'} font-medium cursor-pointer" onclick="playSingerDetailSong(${globalIndex})">${escapeHtml(song.name || 'Unknown')}</span>
                    <div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">
                        ${song.source ? getSourceTag(song.source) : ''}
                        ${qualityLabel ? `<span class="text-[9px] px-1.5 py-0.5 rounded ${qualityColorClass} font-bold flex-shrink-0">${qualityLabel}</span>` : ''}
                        ${audioMetaStr ? `<span class="text-[9px] t-text-muted truncate">${audioMetaStr}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="hidden md:block md:col-span-2 truncate text-sm t-text-muted">${escapeHtml(song.singer || _singerDetailName)}</div>
            <div class="col-span-2 md:col-span-1 text-center flex flex-col items-center">
                <span class="text-xs t-text-muted font-mono tabular-nums">${durationStr}</span>
                ${sizeStr ? `<span class="text-[9px] t-text-muted">${sizeStr}</span>` : ''}
            </div>
            <div class="col-span-4 md:col-span-3 text-right flex items-center justify-end gap-1">
                <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-400 hover:text-blue-500 transition-all" title="收藏" onclick="event.stopPropagation()">
                    <i class="fas fa-heart text-[10px]"></i>
                </button>
                <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-emerald-400 hover:text-emerald-500 transition-all" title="播放" onclick="playSingerDetailSong(${globalIndex})">
                    <i class="fas fa-play text-[10px]"></i>
                </button>
            </div>
        </div>
    `;
}

/**
 * 播放歌手详情中的歌曲 (Play song from singer detail)
 */
async function playSingerDetailSong(songIndex) {
    if (songIndex < 0 || songIndex >= _singerDetailAllSongs.length) return;
    const song = _singerDetailAllSongs[songIndex];

    // 构建 playSong 兼容的 song 对象，保留所有元数据字段
    const playableSong = Object.assign({}, song, {
        id: song.songId || song.id || `singer_${songIndex}`,
        name: song.name || 'Unknown',
        singer: song.singer || _singerDetailName,
        albumName: song.albumName || song.album || song._albumName || '未知专辑',
        _serverCachePath: song.relativePath,
        _isMusicLibSong: true,
        quality: song.quality,
        ext: song.ext,
        size: song.size,
        sampleRate: song.sampleRate,
        bitDepth: song.bitDepth,
        channels: song.channels,
        bitRate: song.bitRate,
    });

    // 设置播放列表为所有歌曲
    currentPlaylist = _singerDetailAllSongs.map((s, i) => {
        return Object.assign({}, s, {
            id: s.songId || s.id || `singer_${i}`,
            name: s.name || 'Unknown',
            singer: s.singer || _singerDetailName,
            albumName: s.albumName || s.album || s._albumName || '未知专辑',
            _serverCachePath: s.relativePath,
            _isMusicLibSong: true,
        });
    });

    if (playMode === 'random') {
        if (typeof resetShuffleState === 'function') resetShuffleState(songIndex);
    }

    currentPlayingScope = 'local_list';
    _currentAlbumIndex = -1;

    if (typeof syncPlaylistToDmc === 'function') {
        syncPlaylistToDmc(currentPlaylist, songIndex, true);
    }

    if ((!_upnpActiveDeviceId || _castDeviceType !== 'upnp') && typeof playSong === 'function') {
        playSong(playableSong, songIndex, null, false, false, true);
    }
}

/**
 * 切换本地歌手详情 Tab (Switch between Albums/Songs tabs)
 */
function switchLocalSingerTab(tab) {
    _singerDetailActiveTab = tab;
    const albumsPanel = document.getElementById('local-singer-albums-panel');
    const songsPanel = document.getElementById('local-singer-songs-panel');
    const tabAlbums = document.getElementById('local-singer-tab-albums');
    const tabSongs = document.getElementById('local-singer-tab-songs');

    if (tab === 'albums') {
        if (albumsPanel) albumsPanel.style.display = '';
        if (songsPanel) songsPanel.style.display = 'none';
        if (tabAlbums) {
            tabAlbums.className = 'flex-1 py-2.5 text-sm font-medium text-center transition-colors text-emerald-600 border-b-2 border-emerald-500';
        }
        if (tabSongs) {
            tabSongs.className = 'flex-1 py-2.5 text-sm font-medium text-center transition-colors t-text-muted hover:t-text-main';
        }
        renderSingerAlbumsPanel();
    } else {
        if (albumsPanel) albumsPanel.style.display = 'none';
        if (songsPanel) songsPanel.style.display = '';
        if (tabAlbums) {
            tabAlbums.className = 'flex-1 py-2.5 text-sm font-medium text-center transition-colors t-text-muted hover:t-text-main';
        }
        if (tabSongs) {
            tabSongs.className = 'flex-1 py-2.5 text-sm font-medium text-center transition-colors text-emerald-600 border-b-2 border-emerald-500';
        }
        // 重置歌曲分页
        _singerDetailSongsPage = 1;
        renderSingerSongsPanel();
    }
}

/**
 * 返回歌手列表 (Back to singer list)
 */
function backToSingerList() {
    _singerDetailActive = false;
    _singerDetailName = '';
    _singerDetailAlbums = [];
    _singerDetailAllSongs = [];
    _singerDetailSongsPage = 1;

    // 恢复网格布局类名
    const container = document.getElementById('singerlib-container');
    if (container) container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-4 md:gap-6';
    const singerGrid = document.getElementById('singerlib-grid');
    if (singerGrid) singerGrid.style.overflow = '';

    const pagination = document.getElementById('singerlib-pagination');
    if (pagination) pagination.classList.remove('hidden');

    loadSingerLib();
}

// 歌曲 Tab 分页操作 (Song tab pagination helpers)
function singerDetailSongsPrevPage() {
    if (_singerDetailSongsPage > 1) {
        _singerDetailSongsPage--;
        renderSingerSongsPanel();
    }
}

function singerDetailSongsNextPage() {
    const totalPages = Math.ceil(_singerDetailAllSongs.length / _singerDetailSongsPageSize);
    if (_singerDetailSongsPage < totalPages) {
        _singerDetailSongsPage++;
        renderSingerSongsPanel();
    }
}

function singerDetailSongsGoToPage(page) {
    const totalPages = Math.ceil(_singerDetailAllSongs.length / _singerDetailSongsPageSize);
    const target = Math.max(1, Math.min(Math.floor(page) || 1, totalPages));
    if (target !== _singerDetailSongsPage) {
        _singerDetailSongsPage = target;
        renderSingerSongsPanel();
    }
}

function singerDetailSongsChangePageSize(size) {
    const newSize = parseInt(size) || 30;
    if (newSize !== _singerDetailSongsPageSize) {
        _singerDetailSongsPageSize = newSize;
        _singerDetailSongsPage = 1;
        renderSingerSongsPanel();
    }
}

// 保留旧函数兼容性（通过详情页替代）
async function openSingerAlbums(singerName) {
    return openSingerDetail(singerName, '', '', 0, 0, '', '', '');
}

/**
 * 编辑歌手信息对话框 (Edit singer dialog with form fields)
 */
async function editSinger() {
    if (!_singerDetailActive || !_singerDetailName) return;

    // 构建编辑表单弹窗
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[101] flex items-center justify-center p-4 animate-fade-in';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
        <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
            <!-- Header -->
            <div class="px-5 py-4 border-b t-border-main flex justify-between items-center bg-blue-50/50 dark:bg-blue-900/10">
                <h3 class="text-sm font-bold t-text-main"><i class="fas fa-pen mr-2 text-blue-500"></i>编辑歌手信息</h3>
                <button id="edit-modal-close-x" class="t-text-muted hover:text-blue-500 transition-colors">
                    <i class="fas fa-times text-lg"></i>
                </button>
            </div>
            <!-- Body: 编辑表单 (Edit form) -->
            <div class="p-5 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div>
                    <label class="block text-xs font-medium t-text-main mb-1">歌手名称</label>
                    <input type="text" id="edit-singer-name" value="${escapeHtml(_singerDetailName)}"
                        class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-medium t-text-main mb-1">来源 (source)</label>
                        <input type="text" id="edit-singer-source" value="${escapeHtml(_singerDetailSource)}"
                            class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                    </div>
                    <div>
                        <label class="block text-xs font-medium t-text-main mb-1">歌手 ID (singer_id)</label>
                        <input type="text" id="edit-singer-id" value="${escapeHtml(_singerDetailSingerId)}"
                            class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium t-text-main mb-1">头像 URL</label>
                    <input type="text" id="edit-singer-avatar" value=""
                        class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                </div>
                <div>
                    <label class="block text-xs font-medium t-text-main mb-1">描述</label>
                    <textarea id="edit-singer-desc" rows="3"
                        class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-y"></textarea>
                </div>
                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="block text-xs font-medium t-text-main mb-1">性别</label>
                        <select id="edit-singer-gender"
                            class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                            <option value="">未知</option>
                            <option value="男" ${_singerDetailGender === '男' ? 'selected' : ''}>男</option>
                            <option value="女" ${_singerDetailGender === '女' ? 'selected' : ''}>女</option>
                            <option value="组合" ${_singerDetailGender === '组合' ? 'selected' : ''}>组合</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium t-text-main mb-1">歌曲数</label>
                        <input type="number" id="edit-singer-musiccount" value="${_singerDetailAllSongs.length || 0}" min="0"
                            class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                    </div>
                    <div>
                        <label class="block text-xs font-medium t-text-main mb-1">专辑数</label>
                        <input type="number" id="edit-singer-albumcount" value="${_singerDetailAlbums.length || 0}" min="0"
                            class="w-full px-3 py-2 text-sm border t-border-main rounded-lg t-bg-input t-text-main focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                    </div>
                </div>
            </div>
            <!-- Footer -->
            <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                <button id="edit-confirm-save" class="flex-1 py-2.5 text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 rounded-xl shadow-lg transition-all active:scale-95">
                    保存
                </button>
                <button id="edit-confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                    取消
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const close = (result) => {
        const content = modal.querySelector('.max-w-lg');
        if (content) content.classList.add('scale-95', 'opacity-0');
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 200);
        return result;
    };

    const doSave = async () => {
        const fields = {
            name: modal.querySelector('#edit-singer-name')?.value?.trim() || '',
            avatar: modal.querySelector('#edit-singer-avatar')?.value?.trim() || '',
            desc: modal.querySelector('#edit-singer-desc')?.value?.trim() || '',
            gender: modal.querySelector('#edit-singer-gender')?.value || '',
            musicCount: parseInt(modal.querySelector('#edit-singer-musiccount')?.value) || 0,
            albumCount: parseInt(modal.querySelector('#edit-singer-albumcount')?.value) || 0
        };

        if (!fields.name) {
            showToast('error', '歌手名称不能为空');
            return;
        }

        close();
        showToast('info', '正在保存...');

        try {
            const headers = { 'Content-Type': 'application/json' };
            Object.assign(headers, getUserAuthHeaders());
            const res = await fetch('/api/music/singer', {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    singerName: _singerDetailName,
                    source: modal.querySelector('#edit-singer-source')?.value?.trim() || _singerDetailSource,
                    singerId: modal.querySelector('#edit-singer-id')?.value?.trim() || _singerDetailSingerId,
                    fields
                })
            });
            const result = await res.json();
            if (result.code === 0 && result.data?.singer) {
                const s = result.data.singer;
                _singerDetailName = s.name || fields.name;
                _singerDetailSource = s.source || _singerDetailSource;
                _singerDetailSingerId = s.singerId || _singerDetailSingerId;
                _singerDetailGender = s.gender || fields.gender;
                showToast('success', '歌手信息已更新');
                // 刷新详情显示
                renderSingerDetail(s.avatar || '', s.desc || '', s.musicCount || fields.musicCount, s.albumCount || fields.albumCount);
            } else {
                showToast('error', result.msg || '保存失败');
            }
        } catch (err) {
            console.error('[SingerEdit] Save failed:', err);
            showToast('error', '保存失败: ' + (err.message || '网络错误'));
        }
    };

    modal.querySelector('#edit-confirm-save').onclick = doSave;
    modal.querySelector('#edit-confirm-cancel').onclick = () => close();
    modal.querySelector('#edit-modal-close-x').onclick = () => close();
    modal.querySelector('div:first-child').onclick = () => close();

    // 尝试从 API 获取完整 singer info 预填表单
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        // 获取 desc/avatar - 从现有歌手列表找匹配项
        for (const singer of _singerLibList) {
            if (singer.name === _singerDetailName) {
                modal.querySelector('#edit-singer-avatar').value = singer.avatar || '';
                modal.querySelector('#edit-singer-desc').value = singer.desc || '';
                if (!_singerDetailGender && singer.gender) {
                    modal.querySelector('#edit-singer-gender').value = singer.gender;
                }
                break;
            }
        }
    } catch (e) { /* ignore prefill errors */ }
}

/**
 * 删除歌手确认对话框 (Delete singer confirmation dialog)
 */
async function deleteSinger() {
    if (!_singerDetailActive || !_singerDetailName) return;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[101] flex items-center justify-center p-4 animate-fade-in';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
        <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
            <!-- Header -->
            <div class="px-5 py-4 border-b t-border-main flex justify-between items-center bg-red-50/50 dark:bg-red-900/10">
                <h3 class="text-sm font-bold t-text-main"><i class="fas fa-trash-alt mr-2 text-red-500"></i>删除歌手</h3>
                <button id="del-modal-close-x" class="t-text-muted hover:text-red-500 transition-colors">
                    <i class="fas fa-times text-lg"></i>
                </button>
            </div>
            <!-- Body -->
            <div class="p-5">
                <div class="flex items-start gap-3 mb-4">
                    <div class="w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/30 text-red-500 flex items-center justify-center shrink-0">
                        <i class="fas fa-exclamation-triangle text-lg"></i>
                    </div>
                    <div>
                        <p class="text-sm t-text-main font-medium">确定要删除歌手「${escapeHtml(_singerDetailName)}」吗？</p>
                        <p class="text-xs t-text-muted mt-1">请选择删除方式：</p>
                    </div>
                </div>
                <div class="flex flex-col gap-2">
                    <button id="del-only-singer" class="w-full py-2.5 text-sm font-bold border t-border-main hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-all">
                        <i class="fas fa-user-slash mr-2"></i>仅删除歌手信息
                    </button>
                    <button id="del-singer-and-songs" class="w-full py-2.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-lg transition-all active:scale-95">
                        <i class="fas fa-trash-alt mr-2"></i>删除歌手及全部歌曲
                    </button>
                </div>
            </div>
            <!-- Footer: 取消按钮 -->
            <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex justify-center">
                <button id="del-confirm-cancel" class="px-8 py-2 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                    取消
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const close = (result) => {
        const content = modal.querySelector('.max-w-sm');
        if (content) content.classList.add('scale-95', 'opacity-0');
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 200);
        return result;
    };

    const doDelete = async (deleteSongs) => {
        if (deleteSongs) {
            // 二次确认 (Double confirm for destructive action)
            const confirmed = await new Promise(resolve => {
                const modal2 = document.createElement('div');
                modal2.className = 'fixed inset-0 z-[102] flex items-center justify-center p-4 animate-fade-in';
                modal2.innerHTML = `
                    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
                    <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                        <div class="px-5 py-4 border-b t-border-main flex justify-between items-center bg-red-50/50 dark:bg-red-900/10">
                            <h3 class="text-sm font-bold text-red-600"><i class="fas fa-exclamation-triangle mr-2"></i>二次确认</h3>
                            <button id="del2-close-x" class="t-text-muted hover:text-red-500 transition-colors"><i class="fas fa-times text-lg"></i></button>
                        </div>
                        <div class="p-5">
                            <p class="text-sm t-text-main">此操作将<span class="text-red-500 font-bold">永久删除</span>该歌手的所有歌曲文件，不可恢复！</p>
                            <p class="text-xs t-text-muted mt-2">确定要继续吗？</p>
                        </div>
                        <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                            <button id="del2-confirm" class="flex-1 py-2.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-lg transition-all active:scale-95">确认删除</button>
                            <button id="del2-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">取消</button>
                        </div>
                    </div>`;
                document.body.appendChild(modal2);
                const close2 = (r) => {
                    modal2.classList.add('opacity-0');
                    setTimeout(() => modal2.remove(), 200);
                    resolve(r);
                };
                modal2.querySelector('#del2-confirm').onclick = () => close2(true);
                modal2.querySelector('#del2-cancel').onclick = () => close2(false);
                modal2.querySelector('#del2-close-x').onclick = () => close2(false);
                modal2.querySelector('div:first-child').onclick = () => close2(false);
            });
            if (!confirmed) return;
        }

        close();
        showToast('info', '正在删除...');

        try {
            const headers = { 'Content-Type': 'application/json' };
            Object.assign(headers, getUserAuthHeaders());
            const res = await fetch('/api/music/singer', {
                method: 'DELETE',
                headers,
                body: JSON.stringify({
                    singerName: _singerDetailName,
                    source: _singerDetailSource,
                    singerId: _singerDetailSingerId,
                    deleteSongs
                })
            });
            const result = await res.json();
            if (result.code === 0) {
                const deletedSongs = result.data?.deletedSongs || 0;
                showToast('success', `已删除歌手${deleteSongs && deletedSongs > 0 ? `及 ${deletedSongs} 首歌曲` : ''}`);
                backToSingerList();
            } else {
                showToast('error', result.msg || '删除失败');
            }
        } catch (err) {
            console.error('[SingerDelete] Failed:', err);
            showToast('error', '删除失败: ' + (err.message || '网络错误'));
        }
    };

    modal.querySelector('#del-only-singer').onclick = () => doDelete(false);
    modal.querySelector('#del-singer-and-songs').onclick = () => doDelete(true);
    modal.querySelector('#del-confirm-cancel').onclick = () => close();
    modal.querySelector('#del-modal-close-x').onclick = () => close();
    modal.querySelector('div:first-child').onclick = () => close();
}

/**
 * 更新歌手信息 (Update singer from online source)
 */
async function updateSinger() {
    if (!_singerDetailActive || !_singerDetailName) return;

    // tx/wy 源且有 singerId → 直接 SDK 更新
    if ((_singerDetailSource === 'tx' || _singerDetailSource === 'wy') && _singerDetailSingerId) {
        showToast('info', '正在获取歌手最新信息...');
        try {
            const headers = { 'Content-Type': 'application/json' };
            Object.assign(headers, getUserAuthHeaders());
            const res = await fetch('/api/music/singer/update', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    singerName: _singerDetailName,
                    source: _singerDetailSource,
                    singerId: _singerDetailSingerId
                })
            });
            const result = await res.json();
            if (result.code === 0 && result.data?.singer) {
                const s = result.data.singer;
                _singerDetailName = s.name || _singerDetailName;
                _singerDetailGender = s.gender || _singerDetailGender;
                showToast('success', '歌手信息已更新');
                renderSingerDetail(s.avatar || '', s.desc || '', s.musicCount || 0, s.albumCount || 0);
            } else {
                showToast('error', result.msg || '更新失败');
            }
        } catch (err) {
            console.error('[SingerUpdate] Failed:', err);
            showToast('error', '更新失败: ' + (err.message || '网络错误'));
        }
    } else {
        // 非 tx/wy 源 → 跨源搜索选择对话框
        showSingerSearchDialog();
    }
}

/**
 * 跨源搜索歌手对话框 (Cross-source singer search & select dialog)
 */
async function showSingerSearchDialog() {
    if (!_singerDetailName) return;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[101] flex items-center justify-center p-4 animate-fade-in';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
        <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main flex flex-col" style="max-height: 80vh;">
            <!-- Header -->
            <div class="flex-shrink-0 px-5 py-4 border-b t-border-main flex justify-between items-center bg-emerald-50/50 dark:bg-emerald-900/10">
                <h3 class="text-sm font-bold t-text-main"><i class="fas fa-search mr-2 text-emerald-500"></i>搜索并选择歌手</h3>
                <button id="search-modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                    <i class="fas fa-times text-lg"></i>
                </button>
            </div>
            <!-- Body: 搜索等待 / 结果列表 -->
            <div id="search-modal-body" class="flex-1 overflow-y-auto custom-scrollbar p-4">
                <div class="flex flex-col items-center justify-center py-10">
                    <i class="fas fa-spinner fa-spin text-3xl text-emerald-500 mb-3"></i>
                    <p class="text-sm t-text-muted">正在搜索 QQ音乐 和 网易云...</p>
                    <p class="text-xs t-text-muted mt-1">关键词: ${escapeHtml(_singerDetailName)}</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const close = (result) => {
        const content = modal.querySelector('.max-w-md');
        if (content) content.classList.add('scale-95', 'opacity-0');
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 200);
        return result;
    };

    const onSelectItem = async (item) => {
        close();
        showToast('info', '正在更新歌手信息...');
        try {
            const headers = { 'Content-Type': 'application/json' };
            Object.assign(headers, getUserAuthHeaders());
            const res = await fetch('/api/music/singer/update', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    singerName: _singerDetailName,
                    source: item.source,
                    singerId: item.id
                })
            });
            const result = await res.json();
            if (result.code === 0 && result.data?.singer) {
                const s = result.data.singer;
                _singerDetailName = s.name || _singerDetailName;
                _singerDetailSource = s.source || item.source;
                _singerDetailSingerId = s.singerId || item.id;
                _singerDetailGender = s.gender || '';
                showToast('success', '歌手信息已更新');
                // 重新加载歌手详情
                await openSingerDetail(_singerDetailName, s.avatar || '', s.desc || '', s.musicCount || 0, s.albumCount || 0, _singerDetailSingerId, _singerDetailSource, _singerDetailGender);
            } else {
                showToast('error', result.msg || '更新失败');
            }
        } catch (err) {
            console.error('[SingerSearch] Update failed:', err);
            showToast('error', '更新失败: ' + (err.message || '网络错误'));
        }
    };

    modal.querySelector('#search-modal-close-x').onclick = () => close();
    modal.querySelector('div:first-child').onclick = () => close();

    // 异步搜索
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`/api/music/singer/search-external?name=${encodeURIComponent(_singerDetailName)}`, { headers });
        const result = await res.json();

        const bodyEl = modal.querySelector('#search-modal-body');
        if (!bodyEl) return;

        if (result.code !== 0 || !result.data?.list?.length) {
            bodyEl.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10">
                    <i class="fas fa-search text-4xl text-gray-300 dark:text-gray-600 mb-3"></i>
                    <p class="text-sm t-text-muted">未找到匹配的歌手</p>
                    <p class="text-xs t-text-muted mt-1">请尝试使用更准确的歌手名称</p>
                </div>`;
            return;
        }

        const list = result.data.list;
        bodyEl.innerHTML = `
            <p class="text-xs t-text-muted mb-3">找到 ${list.length} 个匹配歌手，点击选择：</p>
            <div class="space-y-1">
                ${list.map(item => {
                    const sourceLabel = item.source === 'tx' ? 'QQ音乐' : (item.source === 'wy' ? '网易云' : item.source);
                    const sourceColor = item.source === 'tx' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
                    return `
                        <div class="flex items-center gap-3 p-3 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 cursor-pointer transition-all border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800" data-item='${escapeHtml(JSON.stringify(item))}'>
                            <div class="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-gray-200 dark:bg-gray-700">
                                <img src="${escapeHtml(item.picUrl || '/music/assets/logo.png')}" class="w-full h-full object-cover" onerror="this.src='/music/assets/logo.png'" alt="">
                            </div>
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-medium t-text-main truncate">${escapeHtml(item.name)}</p>
                                <p class="text-xs t-text-muted">${item.albumSize ? item.albumSize + ' 张专辑' : ''}</p>
                            </div>
                            <span class="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${sourceColor}">${sourceLabel}</span>
                        </div>`;
                }).join('')}
            </div>`;

        // 绑定点击事件
        bodyEl.querySelectorAll('[data-item]').forEach(el => {
            el.onclick = () => {
                try {
                    const item = JSON.parse(el.getAttribute('data-item'));
                    onSelectItem(item);
                } catch (e) { /* ignore */ }
            };
        });
    } catch (err) {
        console.error('[SingerSearch] Search failed:', err);
        const bodyEl = modal.querySelector('#search-modal-body');
        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10">
                    <i class="fas fa-exclamation-circle text-4xl text-red-400 mb-3"></i>
                    <p class="text-sm t-text-muted">搜索失败</p>
                    <p class="text-xs text-red-400 mt-1">${escapeHtml(err.message || '网络错误')}</p>
                </div>`;
        }
    }
}

// ========== Window exports - 供 HTML onclick 或其他模块调用 ==========
window.loadSingerLib = loadSingerLib;
window.singerLibPrevPage = singerLibPrevPage;
window.singerLibNextPage = singerLibNextPage;
window.singerLibGoToPage = singerLibGoToPage;
window.singerLibChangePageSize = singerLibChangePageSize;
window.renderSingerLibList = renderSingerLibList;
window.syncSingerInfo = syncSingerInfo;
window.openSingerAlbums = openSingerAlbums;
window.openSingerDetail = openSingerDetail;
window.sortSingerLib = sortSingerLib;
window.filterSingerLib = filterSingerLib;
// 歌手详情页导出
window.switchLocalSingerTab = switchLocalSingerTab;
window.backToSingerList = backToSingerList;
window.openSingerAlbumDetail = openSingerAlbumDetail;
window.playSingerDetailSong = playSingerDetailSong;
window.singerDetailSongsPrevPage = singerDetailSongsPrevPage;
window.singerDetailSongsNextPage = singerDetailSongsNextPage;
window.singerDetailSongsGoToPage = singerDetailSongsGoToPage;
window.singerDetailSongsChangePageSize = singerDetailSongsChangePageSize;
// 歌手详情操作
window.editSinger = editSinger;
window.deleteSinger = deleteSinger;
window.updateSinger = updateSinger;
window.showSingerSearchDialog = showSingerSearchDialog;
