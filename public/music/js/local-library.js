// ==================== Local Library Management - 本地库管理 ====================
// 本模块包含本地音乐库的所有管理功能：多库管理、扫描、监听、目录浏览、来源筛选等。
// 依赖: getUserAuthHeaders, showSuccess, showError, showInfo, showSelect, loadMusicLib (来自 app.js / toast-dialog.js)

/** 当前扫描 ID */
let _currentScanId = null;
/** 扫描进度 SSE 连接 */
let _scanEventSource = null;
/** 库列表缓存 (渲染与操作共用) */
let _librariesCache = [];
/** 目录浏览: 当前浏览路径 */
let _browseCurrentPath = null;
/** 目录浏览: 当前选中要添加的目录 */
let _browseSelectedPath = null;
/** 目录浏览: 当前路径的上级路径 (无则 null) */
let _browseParentPath = null;

/** 初始化扫描进度 SSE 监听 */
function initScanSSE() {
    if (_scanEventSource) {
        _scanEventSource.close();
    }
    _scanEventSource = new EventSource('/api/music/local/scan/events');

    _scanEventSource.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'local_scan_progress') {
                if (!_currentScanId && msg.scanId) _currentScanId = msg.scanId;
                showScanProgress();
                updateScanProgress(msg.progress, msg.currentFile);
            } else if (msg.type === 'local_scan_complete') {
                _currentScanId = null;
                // 先更新到 100% 再隐藏，让用户看到完整进度
                if (msg.result) {
                    const total = msg.result.added + msg.result.skipped + msg.result.errors;
                    updateScanProgress(
                        { total: total, scanned: total, added: msg.result.added, skipped: msg.result.skipped, errors: msg.result.errors },
                        ''
                    );
                }
                setTimeout(function() { hideScanProgress(); }, 300);
                resetScanButtons();
                loadLibraryList();
                loadMusicLib();
                // 刷新文件夹视图 (目录树 + 当前选中目录歌曲列表)
                if (typeof refreshFolderTree === 'function') refreshFolderTree();
                if (typeof loadFolderSongs === 'function' && window._folderSelectedPath) {
                    loadFolderSongs();
                }
                const r = msg.result;
                if (r && typeof showSuccess === 'function') {
                    showSuccess(`扫描完成: ${r.added} 新增, ${r.skipped} 跳过, ${r.errors} 错误`);
                }
            } else if (msg.type === 'local_watcher_progress') {
                showScanProgress();
                updateScanProgress(msg.progress, msg.currentFile);
                // 修改标签区分 watcher
                const labelEl = document.getElementById('local-scan-label');
                if (labelEl) labelEl.textContent = '监听更新中...';
                const hLabel = document.getElementById('header-scan-tooltip-label');
                if (hLabel) hLabel.textContent = '监听更新中...';
                // 隐藏取消按钮 (watcher 不可取消)
                const cancelBtn = document.querySelector('#header-scan-tooltip button[onclick="cancelLocalScan()"]');
                if (cancelBtn) cancelBtn.style.display = 'none';
            } else if (msg.type === 'local_watcher_complete') {
                // 先更新到 100% 再隐藏，让用户看到完整进度
                if (msg.result) {
                    const total = msg.result.added + msg.result.errors + (msg.result.deleted || 0);
                    updateScanProgress(
                        { total: total, scanned: total, added: msg.result.added, skipped: msg.result.deleted || 0, errors: msg.result.errors },
                        ''
                    );
                }
                setTimeout(function() { hideScanProgress(); }, 300);
                resetScanButtons();
                loadLibraryList();
                loadMusicLib();
                // 刷新文件夹视图 (目录树 + 当前选中目录歌曲列表)
                if (typeof refreshFolderTree === 'function') refreshFolderTree();
                if (typeof loadFolderSongs === 'function' && window._folderSelectedPath) {
                    loadFolderSongs();
                }
                const r = msg.result;
                if (r && typeof showSuccess === 'function') {
                    showSuccess(`监听更新完成: ${r.added} 新增, ${r.deleted} 删除, ${r.errors} 错误`);
                }
            }
        } catch (e) {
        }
    };

    _scanEventSource.onerror = () => {
        // EventSource 内置自动重连 (retry: 10000)
        console.warn('[LocalScan] SSE connection error, will auto-reconnect');
    };
}

// 页面加载即启动扫描进度 SSE (HEADER 指示器 + watcher 自动更新 均需实时接收)
initScanSSE();

/** 来源筛选: onchange 处理 */
function filterMusicLibBySource() {
    const select = document.getElementById('musiclib-source-select');
    if (!select) return;
    window._currentSourceFilter = select.value;
    window._musicLibPage = 1; // 切换来源时回到第一页
    loadMusicLib();
}

/** 加载来源列表 (从 /api/music/local/sources 动态获取) */
async function loadAvailableSources() {
    try {
        const res = await fetch('/api/music/local/sources', {
            headers: getUserAuthHeaders()
        });
        const data = await res.json();
        if (data.code === 0 && data.data?.sources) {
            window.availableSources = data.data.sources;
            renderSourceFilters();
        }
    } catch (err) {
        console.error('[Sources] Load failed:', err);
    }
}

/** 渲染所有来源筛选下拉框选项 */
function renderSourceFilters() {
    const options = [
        '<option value="">全部来源</option>',
        '<option value="download">下载</option>',
        ...window.availableSources
            .filter(s => s.type === 'local')
            .map(s => `<option value="${s.name}">${s.label}</option>`)
    ].join('');

    // 更新三个视图的下拉框 (单曲/专辑/歌手)
    ['musiclib-source-select', 'albumlib-source-filter', 'singerlib-source-filter'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = options;
            select.value = currentValue; // 保持之前的选择
        }
    });
}

// ==================== 多库列表 ====================

/** 加载本地库列表并渲染 (多库卡片) */
async function loadLibraryList() {
    try {
        const res = await fetch('/api/music/local/library/status', {
            headers: getUserAuthHeaders()
        });
        const json = await res.json();
        if (json.code !== 0 || !json.data) return;

        const { libraries, enableScraping } = json.data;
        _librariesCache = libraries || [];

        // Acoustid 刮削全局开关
        const scrapeToggle = document.getElementById('local-scrape-toggle');
        if (scrapeToggle) scrapeToggle.checked = enableScraping !== false;

        const listEl = document.getElementById('local-library-list');
        if (!listEl) return;

        if (_librariesCache.length === 0) {
            listEl.innerHTML = `<div class="flex flex-col items-center justify-center py-8 t-text-muted border t-border-main rounded-xl">
                <i class="fas fa-folder-open text-2xl mb-2 opacity-30"></i>
                <p class="text-xs font-medium">暂无本地库</p>
                <p class="text-[10px] mt-1 opacity-70">点击右上角"添加本地库"浏览服务器目录并添加</p>
            </div>`;
            return;
        }

        listEl.innerHTML = _librariesCache.map(lib => renderLibraryCard(lib)).join('');
    } catch (err) {
        console.error('[LocalLibrary] Load list failed:', err);
    }
}

/** 渲染单库卡片 */
function renderLibraryCard(lib) {
    const statusMap = {
        scanning: ['扫描中', 'text-amber-500'],
        error: ['错误', 'text-red-500'],
        idle: ['空闲', 't-text-muted'],
    };
    const [statusText, statusColor] = statusMap[lib.status] || ['空闲', 't-text-muted'];
    const isScanning = lib.status === 'scanning';

    return `
        <div class="p-4 t-bg-main rounded-xl border t-border-main space-y-3">
            <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-bold t-text-main truncate">${escapeHtml(lib.name)}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded-full t-badge-blue border border-blue-200 dark:border-blue-500/30 flex-shrink-0">${escapeHtml(lib.id)}</span>
                    </div>
                    <div class="text-[10px] t-text-muted truncate mt-0.5 font-mono" title="${escapeHtml(lib.path)}">${escapeHtml(lib.path)}</div>
                </div>
                <span class="text-[10px] font-bold flex-shrink-0 ${statusColor}">${statusText}</span>
            </div>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3 text-[10px] t-text-muted">
                    <span><i class="fas fa-music mr-1"></i>${lib.songCount || 0} 首</span>
                    <span><i class="fas fa-clock mr-1"></i>${lib.lastScanAt ? '扫描于 ' + escapeHtml(lib.lastScanAt) : '未扫描'}</span>
                </div>
                <label class="relative inline-flex items-center cursor-pointer flex-shrink-0 w-9 h-5" title="自动监听">
                    <input type="checkbox" ${lib.autoWatch ? 'checked' : ''} data-lib-id="${escapeHtml(lib.id)}"
                           onchange="toggleLibWatch('${escapeJs(lib.id)}', this.checked)"
                           class="sr-only peer">
                    <div class="absolute inset-0 rounded-full bg-gray-200 dark:bg-gray-700 peer-checked:bg-blue-500 transition-colors"></div>
                    <span class="absolute top-[2px] left-[2px] w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4"></span>
                </label>
            </div>
            <div class="flex items-center gap-2 pt-1">
                <button onclick="startScan('${escapeJs(lib.id)}')" id="local-scan-btn-${escapeHtml(lib.id)}" ${isScanning ? 'disabled' : ''}
                        class="flex-1 py-1.5 t-bg-main t-text-main rounded-lg text-[10px] font-bold border t-border-main transition-all hover:bg-emerald-50 dark:hover:bg-emerald-900/20 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">
                    ${isScanning ? '<i class="fas fa-spinner fa-spin mr-1"></i> 扫描中...' : '<i class="fas fa-search mr-1"></i> 扫描'}
                </button>
                <button onclick="removeLibraryById('${escapeJs(lib.id)}')"
                        class="px-3 py-1.5 t-bg-main t-text-main rounded-lg text-[10px] font-bold border t-border-main transition-all hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 active:scale-95">
                    <i class="fas fa-trash-alt mr-1"></i> 删除
                </button>
            </div>
        </div>
    `;
}

/** 库列表变更后的联动刷新 (来源筛选 + 音乐库 + 文件夹树) */
function afterLibraryChange() {
    loadLibraryList();
    if (typeof loadAvailableSources === 'function') loadAvailableSources();
    if (typeof loadMusicLib === 'function') loadMusicLib();
    if (typeof refreshFolderLib === 'function') refreshFolderLib();
}

// ==================== 多库操作 ====================

/** 启动指定库的扫描 */
async function startScan(libraryId) {
    if (!libraryId) {
        if (typeof showError === 'function') showError('未指定本地库');
        return;
    }
    try {
        const res = await fetch('/api/music/local/scan', {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/json'}, getUserAuthHeaders()),
            body: JSON.stringify({libraryId: libraryId})
        });
        const json = await res.json();
        if (json.code === 0 && json.data?.scanId) {
            _currentScanId = json.data.scanId;
            setScanButtonState(libraryId, true);
            showScanProgress();
            if (typeof showSuccess === 'function') showSuccess('扫描已启动');
        } else {
            if (typeof showError === 'function') showError(json.msg || '启动失败');
        }
    } catch (err) {
        if (typeof showError === 'function') showError('启动失败: ' + err.message);
    }
}

/** 设置指定库扫描按钮状态 (scanning=true 时禁用并显示"正在扫描中") */
function setScanButtonState(libraryId, scanning) {
    const btn = document.getElementById('local-scan-btn-' + libraryId);
    if (!btn) return;
    btn.disabled = scanning;
    if (scanning) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 正在扫描中...';
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        btn.innerHTML = '<i class="fas fa-search mr-1"></i> 扫描';
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

/** 恢复所有库扫描按钮 (扫描完成/取消后调用) */
function resetScanButtons() {
    for (const lib of _librariesCache) {
        setScanButtonState(lib.id, false);
    }
}

/** 切换指定库的自动监听 */
async function toggleLibWatch(libraryId, enable) {
    if (!libraryId) {
        if (typeof showError === 'function') showError('未指定本地库');
        return;
    }
    try {
        const endpoint = enable ? '/api/music/local/watch/start' : '/api/music/local/watch/stop';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/json'}, getUserAuthHeaders()),
            body: JSON.stringify({libraryId: libraryId})
        });
        const json = await res.json();
        if (json.code === 0) {
            if (typeof showSuccess === 'function') showSuccess(enable ? '已开启监听' : '已关闭监听');
            loadLibraryList();
        } else if (res.status === 401) {
            // 认证失效：提示重新登录，并回滚开关状态
            const cb = document.querySelector(`#local-library-list input[data-lib-id="${libraryId}"]`);
            if (cb) cb.checked = !enable;
            if (typeof showError === 'function') showError('登录状态已失效，请重新登录后再操作');
        } else {
            const cb = document.querySelector(`#local-library-list input[data-lib-id="${libraryId}"]`);
            if (cb) cb.checked = !enable;
            if (typeof showError === 'function') showError(json.msg || '操作失败');
        }
    } catch (err) {
        const cb = document.querySelector(`#local-library-list input[data-lib-id="${libraryId}"]`);
        if (cb) cb.checked = !enable;
        if (typeof showError === 'function') showError('操作失败: ' + err.message);
    }
}

/** 删除指定库 (确认后清理该库 DB 记录) */
async function removeLibraryById(libraryId) {
    const lib = _librariesCache.find(l => l.id === libraryId);
    const name = lib ? lib.name : '该本地库';
    const count = lib ? lib.songCount || 0 : 0;

    const confirmed = await showSelect(
        '删除本地库',
        `确定要删除本地库「${escapeHtml(name)}」吗？删除后将清理该库的 ${count} 首歌曲记录，需要重新扫描才能恢复。`,
        { confirmText: '删除', danger: true }
    );
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/music/local/libraries/${encodeURIComponent(libraryId)}`, {
            method: 'DELETE',
            headers: getUserAuthHeaders()
        });
        const json = await res.json();
        if (json.code === 0) {
            if (typeof showSuccess === 'function') showSuccess(`已删除本地库，清理了 ${json.data?.deletedRecords || 0} 条记录`);
            afterLibraryChange();
        } else {
            if (typeof showError === 'function') showError(json.msg || '删除失败');
        }
    } catch (err) {
        if (typeof showError === 'function') showError('删除失败: ' + err.message);
    }
}

/** 添加本地库 (按路径，供目录浏览器与外部调用) */
async function addLibraryByPath(path, name) {
    try {
        const res = await fetch('/api/music/local/libraries', {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/json'}, getUserAuthHeaders()),
            body: JSON.stringify({ path: path, name: name })
        });
        const json = await res.json();
        if (json.code === 0) {
            if (typeof showSuccess === 'function') showSuccess('已添加本地库');
            afterLibraryChange();
            return json.data?.library || null;
        } else {
            if (typeof showError === 'function') showError(json.msg || '添加失败');
            return null;
        }
    } catch (err) {
        if (typeof showError === 'function') showError('添加失败: ' + err.message);
        return null;
    }
}

/** 切换本地库启用/禁用 (旧接口兼容，已由多库管理替代) */
async function toggleLocalLibrary(enabled) {}

// ==================== 目录浏览 (添加本地库) ====================

/** 打开目录浏览 Modal */
function openBrowseModal() {
    const modal = document.getElementById('local-library-browse-modal');
    const content = document.getElementById('local-library-browse-modal-content');
    if (!modal || !content) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });
    _browseSelectedPath = null;
    loadBrowse();
}

/** 关闭目录浏览 Modal */
function closeBrowseModal() {
    const modal = document.getElementById('local-library-browse-modal');
    const content = document.getElementById('local-library-browse-modal-content');
    if (!modal || !content) return;
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

/** 加载浏览目录 (path 为空时返回根列表) */
async function loadBrowse(dirPath) {
    const listEl = document.getElementById('browse-directory-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="text-xs t-text-muted text-center py-6"><i class="fas fa-spinner fa-spin mr-1"></i>加载中...</div>';

    try {
        const url = dirPath ? `/api/music/local/browse?path=${encodeURIComponent(dirPath)}` : '/api/music/local/browse';
        const res = await fetch(url, { headers: getUserAuthHeaders() });
        const json = await res.json();
        if (json.code !== 0) {
            listEl.innerHTML = `<div class="text-xs text-red-500 text-center py-6"><i class="fas fa-exclamation-circle mr-1"></i>${escapeHtml(json.msg || '加载失败')}</div>`;
            return;
        }

        const { currentPath, parentPath, roots, directories } = json.data;
        _browseCurrentPath = currentPath;
        _browseParentPath = parentPath || null;
        // 进入新目录后清空选中
        _browseSelectedPath = null;

        // 当前路径
        const pathEl = document.getElementById('browse-current-path');
        if (pathEl) pathEl.textContent = currentPath;

        // 根切换条
        const rootsBar = document.getElementById('browse-roots-bar');
        if (rootsBar && roots) {
            rootsBar.innerHTML = roots.map(r => {
                const active = r.path === currentPath || currentPath.startsWith(r.path.endsWith('/') ? r.path : r.path + '/');
                return `<button onclick="loadBrowse('${escapeJs(r.path)}')"
                        class="px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all active:scale-95 ${active ? 'bg-emerald-500 text-white border-emerald-500' : 't-bg-main t-text-muted t-border-main hover:t-text-main'}">
                    ${escapeHtml(r.name)}
                </button>`;
            }).join('');
        }

        // 返回上级按钮
        const upBtn = document.getElementById('browse-up-btn');
        if (upBtn) upBtn.disabled = !parentPath;

        // 目录列表 (系统保留目录/已添加库不可选中)
        if (!directories || directories.length === 0) {
            listEl.innerHTML = '<div class="text-xs t-text-muted text-center py-6"><i class="fas fa-folder-open mr-1 opacity-40"></i>此目录下没有子文件夹</div>';
        } else {
            listEl.innerHTML = directories.map(d => {
                const disabled = d.isSystemDir || d.isAdded;
                const badge = d.isSystemDir
                    ? '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 t-text-muted flex-shrink-0">系统目录</span>'
                    : (d.isAdded ? '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex-shrink-0">已在库中</span>' : '');
                return `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer t-bg-item-hover transition-all group ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:t-bg-track'}"
                     data-browse-path="${escapeHtml(d.path)}"
                     data-disabled="${disabled ? '1' : ''}"
                     onclick="selectBrowseDir('${escapeJs(d.path)}')">
                    <i class="fas fa-folder text-amber-500 text-xs flex-shrink-0 ${disabled ? 'opacity-40' : ''}"></i>
                    <span class="text-xs t-text-main truncate flex-1">${escapeHtml(d.name)}</span>
                    ${badge}
                    ${d.hasSubDirs ? `<button type="button" onclick="event.stopPropagation(); loadBrowse('${escapeJs(d.path)}')"
                            class="flex-shrink-0 p-1 -mr-1 rounded-lg t-text-muted hover:text-emerald-500 hover:bg-emerald-500/10 transition-all cursor-pointer"
                            title="进入子目录">
                        <i class="fas fa-chevron-right text-[9px]"></i>
                    </button>` : ''}
                </div>
            `;
            }).join('');
        }

        // 添加按钮恢复禁用
        const addBtn = document.getElementById('browse-add-btn');
        if (addBtn) addBtn.disabled = true;
    } catch (err) {
        console.error('[LocalLibrary] Browse failed:', err);
        listEl.innerHTML = `<div class="text-xs text-red-500 text-center py-6"><i class="fas fa-exclamation-circle mr-1"></i>加载失败: ${escapeHtml(err.message)}</div>`;
    }
}

/** 返回上级目录 */
function browseUp() {
    if (_browseParentPath) {
        loadBrowse(_browseParentPath);
    }
}

/** 选中目录 (启用"添加为本地库"按钮并高亮；系统保留目录/已添加库不可选中) */
function selectBrowseDir(dirPath) {
    // 禁用目录 (系统保留目录/已在库中) 不可选中
    const listEl = document.getElementById('browse-directory-list');
    const targetEl = listEl ? Array.from(listEl.querySelectorAll('[data-browse-path]')).find(el => el.dataset.browsePath === dirPath) : null;
    if (targetEl && targetEl.dataset.disabled === '1') return;

    _browseSelectedPath = dirPath;
    const addBtn = document.getElementById('browse-add-btn');
    if (addBtn) addBtn.disabled = !dirPath;

    // 高亮选中项
    if (listEl) {
        listEl.querySelectorAll('[data-browse-path]').forEach(el => {
            const isSelected = el.dataset.browsePath === dirPath;
            el.classList.toggle('bg-emerald-50', isSelected);
            el.classList.toggle('dark:bg-emerald-900/20', isSelected);
        });
    }
}

/** 将当前选中目录添加为本地库 (名称默认取目录名) */
async function addLibraryFromBrowse() {
    if (!_browseSelectedPath) {
        if (typeof showInfo === 'function') showInfo('请先选择一个文件夹');
        return;
    }
    const lib = await addLibraryByPath(_browseSelectedPath);
    if (lib) {
        closeBrowseModal();
    }
}

// ==================== 扫描进度 (保留) ====================

/** 显示扫描进度条 (同时显示 header 指示器) */
function showScanProgress() {
    const el = document.getElementById('local-scan-progress');
    if (el) el.classList.remove('hidden');
    const headerIndicator = document.getElementById('header-scan-indicator');
    if (headerIndicator) headerIndicator.classList.remove('hidden');
    // 手动扫描时显示取消按钮 (watcher 消息中会隐藏)
    const cancelBtn = document.querySelector('#header-scan-tooltip button[onclick="cancelLocalScan()"]');
    if (cancelBtn) cancelBtn.style.display = '';
}

/** 隐藏扫描进度条 (同时隐藏 header 指示器) */
function hideScanProgress() {
    const el = document.getElementById('local-scan-progress');
    if (el) el.classList.add('hidden');
    const headerIndicator = document.getElementById('header-scan-indicator');
    if (headerIndicator) headerIndicator.classList.add('hidden');
    // 扫描结束 (完成/取消)，恢复扫描按钮可用
    resetScanButtons();
}

/** 更新扫描进度 (同步更新音乐库进度条和 header 指示器) */
function updateScanProgress(progress, currentFile) {
    if (!progress) return;
    const pct = progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;
    // 音乐库视图进度条
    const barEl = document.getElementById('local-scan-bar');
    const percentEl = document.getElementById('local-scan-percent');
    const fileEl = document.getElementById('local-scan-file');
    const labelEl = document.getElementById('local-scan-label');
    if (barEl) barEl.style.width = pct + '%';
    if (percentEl) percentEl.textContent = pct + '%';
    if (labelEl) labelEl.textContent = `扫描中: ${progress.added} 新增, ${progress.skipped} 跳过, ${progress.errors} 错误`;
    if (fileEl) fileEl.textContent = currentFile || '';
    // Header 指示器
    const hPercent = document.getElementById('header-scan-percent');
    const hBar = document.getElementById('header-scan-tooltip-bar');
    const hStats = document.getElementById('header-scan-tooltip-stats');
    const hPercentTip = document.getElementById('header-scan-tooltip-percent');
    const hFile = document.getElementById('header-scan-tooltip-file');
    if (hPercent) hPercent.textContent = pct + '%';
    if (hBar) hBar.style.width = pct + '%';
    if (hStats) hStats.textContent = `${progress.added} 新增, ${progress.skipped} 跳过, ${progress.errors} 错误`;
    if (hPercentTip) hPercentTip.textContent = pct + '%';
    if (hFile) hFile.textContent = currentFile || '';
}

/** 取消扫描 */
async function cancelLocalScan() {
    if (!_currentScanId) return;
    try {
        await fetch(`/api/music/local/scan/cancel/${_currentScanId}`, {
            method: 'POST',
            headers: getUserAuthHeaders()
        });
        if (typeof showSuccess === 'function') showSuccess('已取消扫描');
    } catch (err) {
        console.error('[LocalScan] Cancel error:', err);
    }
}

// ==================== 刮削开关 ====================
/** 切换 Acoustid 刮削开关 */
async function toggleLocalScraping(enabled) {
    try {
        const res = await fetch('/api/music/local/scraping', {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/json'}, getUserAuthHeaders()),
            body: JSON.stringify({ enableScraping: enabled })
        });
        const json = await res.json();
        if (json.code === 0) {
            if (typeof showSuccess === 'function') showSuccess(enabled ? '已启用刮削' : '已禁用刮削');
        } else {
            const toggle = document.getElementById('local-scrape-toggle');
            if (toggle) toggle.checked = !enabled;
            if (typeof showError === 'function') showError(json.msg || '保存配置失败');
        }
    } catch (err) {
        const toggle = document.getElementById('local-scrape-toggle');
        if (toggle) toggle.checked = !enabled;
        if (typeof showError === 'function') showError('操作失败: ' + err.message);
    }
}

// ==================== Window 导出 ====================
window.filterMusicLibBySource = filterMusicLibBySource;
window.toggleLocalLibrary = toggleLocalLibrary;
window.startScan = startScan;
window.cancelLocalScan = cancelLocalScan;
window.toggleLibWatch = toggleLibWatch;
window.removeLibraryById = removeLibraryById;
window.addLibraryByPath = addLibraryByPath;
window.loadLibraryList = loadLibraryList;
window.loadAvailableSources = loadAvailableSources;
window.renderSourceFilters = renderSourceFilters;
window.showScanProgress = showScanProgress;
window.hideScanProgress = hideScanProgress;
window.updateScanProgress = updateScanProgress;
window.openBrowseModal = openBrowseModal;
window.closeBrowseModal = closeBrowseModal;
window.loadBrowse = loadBrowse;
window.browseUp = browseUp;
window.selectBrowseDir = selectBrowseDir;
window.addLibraryFromBrowse = addLibraryFromBrowse;
window.toggleLocalScraping = toggleLocalScraping;
