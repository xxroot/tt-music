/**
 * DLNA Media Server 浏览与播放模块 (DLNA DMS Browser)
 *
 * 提供局域网 DLNA Media Server 设备发现、ContentDirectory 分类浏览、
 * Web 本地播放及 DMR 投屏功能。
 */

// ==================== 状态 ====================

let _dmsDevices = [];
let _dmsCurrentDevice = null;
let _dmsBrowseStack = [];  // 面包屑导航栈 [{id, title}]
let _dmsCurrentItems = []; // 当前目录的音频条目（用于播放列表）
let _dmsInitialized = false;

// ==================== 初始化 ====================

/**
 * 初始化 DLNA 服务视图（由 switchTab 调用）
 */
function initDlnaServer() {
    if (_dmsInitialized) {
        // 已初始化，仅尝试加载缓存设备
        if (_dmsDevices.length === 0) {
            loadCachedDmsDevices();
        }
        return;
    }
    _dmsInitialized = true;
    loadCachedDmsDevices();
}

// ==================== 设备管理 ====================

/**
 * 加载缓存的 DMS 设备列表（不触发扫描）
 */
async function loadCachedDmsDevices() {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (typeof getUserAuthHeaders === 'function') Object.assign(headers, getUserAuthHeaders());
        const res = await fetch('/api/dms/devices', { headers });
        const data = await res.json();
        if (data.success && data.devices) {
            _dmsDevices = data.devices;
            renderDmsDeviceSelect();
        }
    } catch (err) {
        console.warn('[DMS] 加载缓存设备失败:', err.message);
    }
}

/**
 * 扫描局域网 DMS 设备
 */
async function scanDmsDevices() {
    const scanBtn = document.getElementById('dms-scan-btn');
    const scanIcon = scanBtn ? scanBtn.querySelector('.fa-search, .fa-spinner') : null;

    // 显示加载状态
    if (scanBtn) scanBtn.disabled = true;
    if (scanIcon) {
        scanIcon.classList.remove('fa-search');
        scanIcon.classList.add('fa-spinner', 'fa-spin');
    }
    showDmsEmpty('正在扫描局域网 DLNA 服务器...', true);

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (typeof getUserAuthHeaders === 'function') Object.assign(headers, getUserAuthHeaders());
        const res = await fetch('/api/dms/scan', { method: 'POST', headers });
        const data = await res.json();

        if (data.success && data.devices) {
            _dmsDevices = data.devices;
            renderDmsDeviceSelect();

            if (_dmsDevices.length === 0) {
                showDmsEmpty('未发现 DLNA 媒体服务器。请确认局域网内有开启 DLNA/UPnP 共享的设备。');
            } else {
                showDmsEmpty(`发现 ${_dmsDevices.length} 个 DLNA 服务器，请从下拉列表选择设备。`);
                // 自动选择第一个设备
                if (!_dmsCurrentDevice && _dmsDevices.length > 0) {
                    const select = document.getElementById('dms-device-select');
                    if (select) {
                        select.value = _dmsDevices[0].id;
                        onDmsDeviceChange();
                    }
                }
            }
        } else {
            showDmsEmpty('扫描失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('[DMS] 扫描失败:', err);
        showDmsEmpty('扫描失败: ' + err.message);
    } finally {
        if (scanBtn) scanBtn.disabled = false;
        if (scanIcon) {
            scanIcon.classList.remove('fa-spinner', 'fa-spin');
            scanIcon.classList.add('fa-search');
        }
    }
}

/**
 * 设备选择变更
 */
function onDmsDeviceChange() {
    const select = document.getElementById('dms-device-select');
    if (!select) return;

    const deviceId = select.value;
    if (!deviceId) {
        _dmsCurrentDevice = null;
        showDmsEmpty('请选择一个 DLNA 服务器设备。');
        return;
    }

    _dmsCurrentDevice = _dmsDevices.find(d => d.id === deviceId) || null;
    _dmsBrowseStack = [];

    if (_dmsCurrentDevice) {
        browseDms('0');
    }
}

/**
 * 渲染设备下拉选择器
 */
function renderDmsDeviceSelect() {
    const select = document.getElementById('dms-device-select');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="">-- 选择设备 --</option>';

    _dmsDevices.forEach(device => {
        const opt = document.createElement('option');
        opt.value = device.id;
        let label = device.name;
        if (device.manufacturer) label += ` (${device.manufacturer})`;
        opt.textContent = label;
        select.appendChild(opt);
    });

    // 恢复之前的选择
    if (currentValue && _dmsDevices.some(d => d.id === currentValue)) {
        select.value = currentValue;
    }
}

// ==================== 内容浏览 ====================

/**
 * 浏览 DMS 容器
 * @param {string} objectId - 容器 ObjectID
 */
async function browseDms(objectId) {
    if (!_dmsCurrentDevice) return;

    showDmsLoading(true);

    try {
        const headers = {};
        if (typeof getUserAuthHeaders === 'function') Object.assign(headers, getUserAuthHeaders());
        const params = new URLSearchParams({
            deviceId: _dmsCurrentDevice.id,
            objectId: objectId,
            start: '0',
            count: '200'
        });
        const res = await fetch(`/api/dms/browse?${params}`, { headers });
        const data = await res.json();

        if (data.success) {
            renderDmsContent(data.containers || [], data.items || []);
            // 显示刷新按钮
            const refreshBtn = document.getElementById('dms-refresh-btn');
            if (refreshBtn) refreshBtn.classList.remove('hidden');
        } else {
            showDmsEmpty('浏览失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('[DMS] 浏览失败:', err);
        showDmsEmpty('浏览失败: ' + err.message);
    } finally {
        showDmsLoading(false);
    }
}

/**
 * 刷新当前目录
 */
function refreshDmsBrowse() {
    const currentObjectId = _dmsBrowseStack.length > 0
        ? _dmsBrowseStack[_dmsBrowseStack.length - 1].id
        : '0';
    browseDms(currentObjectId);
}

/**
 * 进入子容器
 */
function dmsEnterContainer(containerId, title) {
    _dmsBrowseStack.push({ id: containerId, title: title });
    renderDmsBreadcrumb();
    browseDms(containerId);
}

/**
 * 面包屑导航跳转
 * @param {number} index - 目标层级索引 (-1 表示根)
 */
function dmsNavigateTo(index) {
    if (index < 0) {
        // 返回根
        _dmsBrowseStack = [];
        renderDmsBreadcrumb();
        browseDms('0');
    } else if (index < _dmsBrowseStack.length) {
        _dmsBrowseStack = _dmsBrowseStack.slice(0, index + 1);
        renderDmsBreadcrumb();
        browseDms(_dmsBrowseStack[_dmsBrowseStack.length - 1].id);
    }
}

/**
 * 渲染面包屑导航
 */
function renderDmsBreadcrumb() {
    const breadcrumb = document.getElementById('dms-breadcrumb');
    if (!breadcrumb) return;

    if (_dmsBrowseStack.length === 0) {
        breadcrumb.classList.add('hidden');
        return;
    }

    breadcrumb.classList.remove('hidden');
    let html = `<a href="#" onclick="dmsNavigateTo(-1); return false;" class="hover:text-emerald-500 transition-colors"><i class="fas fa-home"></i></a>`;

    _dmsBrowseStack.forEach((item, idx) => {
        html += `<span class="mx-1 opacity-40">/</span>`;
        if (idx === _dmsBrowseStack.length - 1) {
            html += `<span class="t-text-main font-medium">${escapeHtmlDms(item.title)}</span>`;
        } else {
            html += `<a href="#" onclick="dmsNavigateTo(${idx}); return false;" class="hover:text-emerald-500 transition-colors">${escapeHtmlDms(item.title)}</a>`;
        }
    });

    breadcrumb.innerHTML = html;
}

// ==================== 渲染 ====================

/**
 * 渲染 DMS 内容（容器 + 音频条目）
 */
function renderDmsContent(containers, items) {
    const contentList = document.getElementById('dms-content-list');
    const emptyState = document.getElementById('dms-empty-state');
    const containersEl = document.getElementById('dms-containers');
    const itemsEl = document.getElementById('dms-items');

    if (!contentList || !containersEl || !itemsEl) return;

    // 隐藏空状态，显示内容列表
    if (emptyState) emptyState.classList.add('hidden');
    contentList.classList.remove('hidden');

    // 保存当前条目用于播放
    _dmsCurrentItems = items;

    // 渲染容器（分类/文件夹）— 复用通用专辑风格卡片 (media-render-shared.js)，与本地专辑库保持同一套渲染代码
    if (containers.length > 0) {
        let html = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">';
        containers.forEach(container => {
            const statsItems = [];
            if (container.childCount > 0) {
                statsItems.push(`<span><i class="fas fa-music text-[10px] mr-1"></i>${container.childCount} 项</span>`);
            }
            html += buildAlbumGridCardHtml({
                coverUrl: container.albumArtUri || '',
                title: container.title,
                subtitle: '',
                statsItems: statsItems,
                onclick: `dmsEnterContainer('${escapeAttrDms(container.id)}', '${escapeAttrDms(container.title)}')`,
                overlayIcon: 'fa-folder-open'
            });
        });
        html += '</div>';
        containersEl.innerHTML = html;
    } else {
        containersEl.innerHTML = '';
    }

    // 渲染音频条目 — 复用通用专辑明细歌曲行 (media-render-shared.js)，与本地专辑明细保持同一套渲染代码
    if (items.length > 0) {
        let html = '';
        // 播放全部按钮
        if (items.length > 1) {
            html += `<div class="flex items-center gap-2 mb-3 pt-1">
                <button onclick="playAllDmsItems()" class="px-3 py-1.5 text-xs rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors flex items-center gap-1.5">
                    <i class="fas fa-play"></i> 播放全部 (${items.length})
                </button>
            </div>`;
        }

        // 投屏按钮仅在 DLNA 已连接时渲染
        const castConnected = isDlnaCastConnected();

        items.forEach((item, idx) => {
            // 音质标签：后端已将 protocolInfo 映射为 FLAC/MP3 等，直接复用通用音质映射
            const qualityTag = getQualityTagInfo(item.format);
            // 歌名下附加行：艺术家 · 专辑
            const nameExtraHtml = escapeHtmlDms(item.artist || '未知艺术家') +
                (item.album ? ' · ' + escapeHtmlDms(item.album) : '');
            // 投屏播放按钮（仅 DLNA 连接成功时显示）
            const actionsHtml = castConnected
                ? `<button onclick="event.stopPropagation(); castDmsSong(${idx})" title="投屏播放"
                           class="p-1.5 t-text-muted hover:text-emerald-500 rounded-lg transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
                       <i class="fas fa-tv text-xs"></i>
                   </button>`
                : '';

            html += buildSongRowHtml({
                displayIndex: idx + 1,
                title: item.title || '未知曲目',
                coverUrl: item.albumArtUri || '',
                qualityLabel: qualityTag.label,
                qualityColorClass: qualityTag.colorClass,
                nameExtraHtml: nameExtraHtml,
                durationStr: item.duration || '',
                onclick: `playDmsSong(${idx})`,
                actionsHtml: actionsHtml
            });
        });
        itemsEl.innerHTML = html;
    } else {
        itemsEl.innerHTML = '';
    }

    // 如果容器和条目都为空
    if (containers.length === 0 && items.length === 0) {
        contentList.classList.add('hidden');
        showDmsEmpty('此目录为空。');
    }
}

// ==================== 播放 ====================

/**
 * 判断当前 DLNA (UPnP) 投屏是否已连接设备
 * 供条目行投屏按钮条件渲染与播放分流使用。
 * @returns {boolean} 已连接返回 true
 */
function isDlnaCastConnected() {
    return typeof _upnpActiveDeviceId !== 'undefined' &&
        typeof _castDeviceType !== 'undefined' &&
        _castDeviceType === 'upnp' &&
        !!_upnpActiveDeviceId;
}

/**
 * 播放 DMS 音频条目
 * @param {number} index - 条目索引
 */
function playDmsSong(index) {
    const item = _dmsCurrentItems[index];
    if (!item || !item.url) {
        if (typeof showInfo === 'function') showInfo('该条目没有可播放的 URL');
        return;
    }

    // 检查投屏模式 — 如果正在投屏，则通过 DMC 播放
    if (isDlnaCastConnected()) {
        castDmsSong(index);
        return;
    }

    // Web 本地播放：构造 song 对象并调用主播放器
    const song = buildDmsSongObject(item);

    // 将当前目录所有条目设为播放列表
    const playlist = _dmsCurrentItems.map(i => buildDmsSongObject(i));
    window.currentPlaylist = playlist;
    window.currentIndex = index;
    window.currentPlayingScope = 'dlnaserver';

    // 调用主播放器的 playSong
    if (typeof playSong === 'function') {
        playSong(song, index);
    } else if (typeof window.playSong === 'function') {
        window.playSong(song, index);
    }
}

/**
 * 播放当前目录全部音频
 */
function playAllDmsItems() {
    if (_dmsCurrentItems.length === 0) return;
    playDmsSong(0);
}

/**
 * 投屏播放 DMS 音频条目
 * @param {number} index - 条目索引
 */
function castDmsSong(index) {
    const item = _dmsCurrentItems[index];
    if (!item || !item.url) {
        if (typeof showInfo === 'function') showInfo('该条目没有可播放的 URL');
        return;
    }

    const song = buildDmsSongObject(item);
    // 投屏时使用原始 DMS URL（DMR 设备可直接访问局域网 DMS）
    song.directUrl = item.url;

    // 通过 DLNA DMC HTTP API 投屏
    const playlist = _dmsCurrentItems.map(i => {
        const s = buildDmsSongObject(i);
        s.directUrl = i.url;  // 投屏全部使用原始 URL
        return s;
    });

    const headers = { 'Content-Type': 'application/json' };
    if (typeof getUserAuthHeaders === 'function') Object.assign(headers, getUserAuthHeaders());

    fetch('/api/dlna/play', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            song: song,
            playlist: playlist,
            index: index
        })
    }).then(res => res.json()).then(data => {
        if (data.success) {
            if (typeof showSuccess === 'function') showSuccess(`已投屏: ${item.title}`);
        } else {
            if (typeof showError === 'function') showError('投屏失败: ' + (data.message || '请先连接 DLNA 设备'));
        }
    }).catch(err => {
        console.error('[DMS] 投屏失败:', err);
        if (typeof showError === 'function') showError('投屏失败: ' + err.message);
    });
}

/**
 * 构造 song 对象（兼容主播放器和 DMC）
 * directUrl 通过服务器代理转发，避免浏览器无法直连局域网 DMS 设备
 */
function buildDmsSongObject(item) {
    // 投屏时使用原始 URL（DMR 设备可直接访问 DMS）；Web 播放通过服务器代理
    const proxyUrl = item.url
        ? `/api/dms/media-proxy?url=${encodeURIComponent(item.url)}`
        : '';
    return {
        id: `dms_${item.id}`,
        name: item.title || '未知曲目',
        singer: item.artist || '未知艺术家',
        albumName: item.album || '',
        albumId: '',
        source: 'dms',
        songmid: `dms_${item.id}`,
        interval: item.duration || '',
        quality: item.format || '',
        img: item.albumArtUri || null,
        relativePath: null,
        _isMusicLibSong: false,
        _isFromAlbumLib: false,
        directUrl: proxyUrl,           // Web 播放走服务器代理
        _dmsRawUrl: item.url || '',    // 保留原始 URL 供投屏使用
    };
}

// ==================== UI 辅助 ====================

/**
 * 显示空状态
 */
function showDmsEmpty(message, isLoading) {
    const emptyState = document.getElementById('dms-empty-state');
    const contentList = document.getElementById('dms-content-list');
    const loading = document.getElementById('dms-loading');

    if (loading) loading.classList.add('hidden');
    if (contentList) contentList.classList.add('hidden');
    if (emptyState) {
        emptyState.classList.remove('hidden');
        emptyState.innerHTML = `
            <i class="fas ${isLoading ? 'fa-spinner fa-spin' : 'fa-broadcast-tower'} text-5xl mb-4 opacity-20"></i>
            <p class="text-sm mb-2">${escapeHtmlDms(message)}</p>
            ${!isLoading ? '<p class="text-xs opacity-60">支持 NAS、Windows Media Player、Kodi、Plex 等设备</p>' : ''}`;
    }
}

/**
 * 显示/隐藏加载状态
 */
function showDmsLoading(show) {
    const loading = document.getElementById('dms-loading');
    const emptyState = document.getElementById('dms-empty-state');
    const contentList = document.getElementById('dms-content-list');

    if (show) {
        if (loading) { loading.classList.remove('hidden'); loading.classList.add('flex'); }
        if (emptyState) emptyState.classList.add('hidden');
        if (contentList) contentList.classList.add('hidden');
    } else {
        if (loading) { loading.classList.add('hidden'); loading.classList.remove('flex'); }
    }
}

/**
 * HTML 转义
 */
function escapeHtmlDms(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 属性转义
 */
function escapeAttrDms(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
