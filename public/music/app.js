/*
 * Copyright 2026 xcq0607 (https://github.com/xcq0607)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ============================================================================
// 常量定义已提取到 js/constants.js
// ============================================================================

// ============================================================================
// 通用工具函数已提取到 js/utils.js
// ============================================================================

// ============================================================================
// 全局状态与配置 (Global State & Configuration)
// ============================================================================

// --- 播放状态 (Playback State) ---
// audio 已在 playback.js 中声明为全局 const，此处直接导出到 window
window.audio = audio;

// ============================================================================
// DEFAULT_SETTINGS / settings / 歌词数据 已提取到 js/settings.js
// ============================================================================

// --- UI 状态 (UI State) ---
window.batchMode = false;
window.selectedItems = new Set();
window.selectedSongObjects = new Map();
let expandBtnTimeout = null;
let toggleLyricsBtnTimeout = null;

// ============================================================================
// 认证管理已提取到 js/auth.js
// ============================================================================

// ============================================================================
// Web 全屏模式 (Web Fullscreen)
// ============================================================================
// 切换 Web 播放器全屏状态，使用浏览器 Fullscreen API
function toggleWebFullscreen() {
    const icon = document.getElementById('web-fullscreen-icon');
    if (!document.fullscreenElement) {
        // 进入全屏
        document.documentElement.requestFullscreen().then(() => {
            if (icon) {
                icon.className = 'fas fa-compress text-lg';
            }
        }).catch(err => {
            console.error('[Fullscreen] 进入全屏失败:', err);
        });
    } else {
        // 退出全屏
        document.exitFullscreen().then(() => {
            if (icon) {
                icon.className = 'fas fa-expand text-lg';
            }
        }).catch(err => {
            console.error('[Fullscreen] 退出全屏失败:', err);
        });
    }
}

// 监听全屏状态变化，同步图标（用户按 ESC 退出时也需更新）
document.addEventListener('fullscreenchange', () => {
    const icon = document.getElementById('web-fullscreen-icon');
    if (!icon) return;
    icon.className = document.fullscreenElement ? 'fas fa-compress text-lg' : 'fas fa-expand text-lg';
});

// ============================================================================
// UI 交互与事件处理 (UI Interaction & Event Handling)
// ============================================================================

// [DOMContentLoaded 合并到文件底部统一初始化]

// Dragging Logic
// ============================================================================
// 拖拽控制 (Drag Controls - Progress & Volume)
// ============================================================================
let isDragging = null;
let dragPercentage = 0;
let lastSeekTime = 0;
let lastSeekPct = -1;
const SEEK_THROTTLE_MS = 100;

function startDragging(e, type) {
    if (e.type === 'touchstart') e.preventDefault();
    isDragging = type;
    if (type === 'progress') lastSeekPct = -1;
    handleDragMove(e);
}

function stopDragging() {
    if (isDragging === 'progress' && Number.isFinite(dragPercentage)) {
        if (Math.abs(dragPercentage - lastSeekPct) > 0.001) {
            if (_upnpActiveDeviceId && _dlnaLastDuration > 0) {
                upnpSeekTo(dragPercentage * _dlnaLastDuration);
                if (typeof lyricPlayer !== 'undefined' && lyricPlayer) lyricPlayer.play(dragPercentage * _dlnaLastDuration * 1000);
            } else {
                audio.currentTime = dragPercentage * audio.duration;
                if (typeof lyricPlayer !== 'undefined' && lyricPlayer) lyricPlayer.play(audio.currentTime * 1000);
            }
        }
    }
    isDragging = null;
    lastSeekPct = -1;
}

function handleDragMove(e) {
    if (!isDragging) return;
    if (e.type === 'touchmove') e.preventDefault();
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    if (isDragging === 'progress') handleProgressDrag(clientX);
    else if (isDragging === 'volume') handleVolumeDrag(clientX);
}

function handleProgressDrag(clientX) {
    const activeDuration = (_upnpActiveDeviceId && _dlnaLastDuration > 0) ? _dlnaLastDuration : audio.duration;
    const container = document.getElementById('progress-container');
    if (!container || !activeDuration || !Number.isFinite(activeDuration)) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    dragPercentage = pct;
    document.getElementById('progress-bar').style.width = `${pct * 100}%`;
    document.getElementById('time-current').innerText = formatTime(pct * activeDuration);
    const now = Date.now();
    if (now - lastSeekTime > SEEK_THROTTLE_MS) {
        if (Math.abs(pct - lastSeekPct) > 0.001) {
            if (_upnpActiveDeviceId && _dlnaLastDuration > 0) {
                upnpSeekTo(pct * _dlnaLastDuration);
            } else {
                audio.currentTime = pct * audio.duration;
            }
            if (typeof lyricPlayer !== 'undefined' && lyricPlayer) {
                lyricPlayer.play(audio.currentTime * 1000);
                scrollToActiveLine(true);
            }
            lastSeekTime = now;
            lastSeekPct = pct;
        }
    }
}

function handleVolumeDrag(clientX) {
    const container = document.getElementById('volume-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    currentVolume = pct;
    audio.volume = pct;
    isMuted = false;
    updateVolumeUI();
    localStorage.setItem('lx_volume', currentVolume.toString());
}

function changeProxyPlayback(enabled) {
    updateSetting('enableProxyPlayback', enabled);
}

function changeProxyDownload(enabled) {
    updateSetting('enableProxyDownload', enabled);
}

function changeAutoProxy(enabled) {
    updateSetting('enableAutoProxy', enabled);
}

function changeCustomProxy(enabled) {
    updateSetting('enableCustomProxy', enabled);
    const customProxyRow = document.getElementById('custom-proxy-url-row');
    if (customProxyRow) customProxyRow.classList.toggle('hidden', !enabled);
}

function changeCustomProxyUrl(value) {
    updateSetting('customProxyUrl', value.trim());
}

function changeHotSearchLimit(value) {
    const limit = parseInt(value);
    if (!isNaN(limit) && limit >= 0 && limit <= 50) {
        updateSetting('hotSearchLimit', limit);
    } else {
        showError('请输入 0 到 50 之间的数字');
    }
}

function changeLyricFontSize(value) {
    const size = parseFloat(value);
    if (!isNaN(size)) {
        updateSetting('lyricFontSize', size);
    }
}

// 读取本地字体
/**
 * 通用加载本地字体逻辑
 * @param {string} targetSelectId - 目标下拉框的 ID，默认为设置页的 'lyric-font-family-select'
 * @param {HTMLElement} btnEl - 触发按钮的引用，用于显示加载动画
 */
async function loadLocalFonts(targetSelectId = 'lyric-font-family-select', btnEl = null) {
    if (!('queryLocalFonts' in window)) {
        showError('抱歉，您的浏览器不支持读取本地字体功能 (Local Font Access API)。\n建议使用 Chrome / Edge 浏览器，并确保在 HTTPS 环境下使用。');
        return;
    }

    const btn = btnEl || document.querySelector('button[onclick="loadLocalFonts()"]');
    const originalText = btn ? btn.innerHTML : '';

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>读取中...';
        }

        const fonts = await window.queryLocalFonts();
        const fontSelect = document.getElementById(targetSelectId);
        if (!fontSelect) return;

        // Use a set to store unique families
        const fontFamilies = new Set();
        fonts.forEach(font => fontFamilies.add(font.family));

        // Sort alphabetically
        const sortedFamilies = Array.from(fontFamilies).sort();

        if (sortedFamilies.length === 0) {
            showError('未能获取到字体列表');
            return;
        }

        // Remove existing local fonts group if exists
        const oldGroup = fontSelect.querySelector('optgroup[data-source="local"]');
        if (oldGroup) {
            oldGroup.remove();
        }

        // Create a single group for local fonts
        const group = document.createElement('optgroup');
        group.dataset.source = 'local';
        group.label = `本地已安装字体 (${sortedFamilies.length})`;

        sortedFamilies.forEach(family => {
            const option = document.createElement('option');
            // 如果是歌词卡片，保持带引号格式；如果是设置页，保持原样（lyric-card.js 会处理字体族名称）
            option.value = targetSelectId === 'lc-font-select' ? `"${family}", sans-serif` : family;
            option.textContent = family;
            group.appendChild(option);
        });
        fontSelect.appendChild(group);

        showSuccess(`成功获取 ${sortedFamilies.length} 个本地字体！`);

    } catch (err) {
        console.error('[Font] Error loading fonts:', err);
        showError('获取字体失败: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

function changeLyricFontFamily(value) {
    updateSetting('lyricFontFamily', value.trim());
}

// 切换音质偏好
function changeQualityPreference(quality) {
    updateSetting('preferredQuality', quality);
}


// Tab Switching
function switchTab(tabId, filterParam) {
    document.querySelectorAll('[id^="view-"]').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
    });
    // special handling for favorites — always route through handleFavoritesClick
    // so it can show either the grid (logged in) or the empty guide (not logged in)
    if (tabId === 'favorites') {
        handleFavoritesClick();
        return;
    }

    const activeView = document.getElementById(`view-${tabId}`);
    if (!activeView) return;

    activeView.classList.remove('hidden');
    // small delay to allow display block to apply before opacity transition
    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
    }, 10);

    // [新增] 切换到设置页面时刷新一次管理员状态和设置项 UI
    if (tabId === 'settings') {
        if (typeof syncSettingsUI === 'function') syncSettingsUI();
        else if (typeof updateAdminUI === 'function') updateAdminUI();
    }

    // Reset Sidebar Highlight
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'active-sub-item', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    // For musiclib/albumlib/singerlib/folderlib, highlight the parent tab-musiclib
    let effectiveTabId = tabId;
    if (tabId === 'albumlib' || tabId === 'singerlib' || tabId === 'folderlib' || tabId === 'dlnaserver') effectiveTabId = 'musiclib';
    const activeTab = document.getElementById(`tab-${effectiveTabId}`);
    if (activeTab) {
        activeTab.classList.add('active-tab');
        activeTab.classList.remove('t-text-muted');
    }

    // Clear any pending timeouts
    if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
    if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);

    // Auto-exit secondary modes (search/batch) when switching tabs
    exitListSecondaryModes();

    // Mobile: Close sidebar when switching tabs except for favorites (which should show sub-lists)
    if (window.innerWidth <= 1024 && tabId !== 'favorites' && tabId !== 'musiclib' && tabId !== 'albumlib' && tabId !== 'singerlib' && tabId !== 'folderlib' && tabId !== 'dlnaserver') {
        const sidebar = document.getElementById('main-sidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }

    // Always clear sub-item highlight when switching top-level tabs
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });

    // Reset Search Scope if switching to search/settings explicitly
    if (tabId === 'search') {
        initGlobalListSearch(); // [New] 强制重置 ListSearch 为 'global' 模式
        currentSearchScope = 'network';
        document.getElementById('search-source').classList.remove('hidden');
        if (typeof updateSearchTypeVisibility === 'function') updateSearchTypeVisibility();
        // 隐藏歌单头部信息（网络搜索视图不需要）
        if (window.PlaylistHeader) window.PlaylistHeader.hide('search-playlist-header');
        // 清除钻取状态
        window._searchDrillState = null;
        window._onlineSingerState = null;
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.placeholder = "搜索歌曲、歌手...";
            // 如果搜索框内容为空，则展示初始热搜状态，避免由于重用搜索界面展示本地列表导致的残留
            if (!searchInput.value.trim()) {
                showInitialSearchState();
            }
            // 自动聚焦搜索框（移动端会弹出键盘）
            setTimeout(() => searchInput.focus(), 100);
        }
        document.getElementById('page-title').innerText = "搜索音乐";
    }

    if (tabId === 'songlist') {
        document.getElementById('page-title').innerText = "歌单";
    }

    if (tabId === 'leaderboard') {
        document.getElementById('page-title').innerText = "排行榜";
        if (window.LeaderboardManager && !window.LeaderboardManager.initialized) {
            window.LeaderboardManager.init();
        }
    }

    if (tabId === 'radio') {
        document.getElementById('page-title').innerText = "电台";
        if (window.RadioManager && !window.RadioManager.initialized) {
            window.RadioManager.init();
        }
    }

    if (tabId === 'online-radio') {
        document.getElementById('page-title').innerText = "在线电台";
        if (window.OnlineRadioManager && !window.OnlineRadioManager.initialized) {
            window.OnlineRadioManager.init();
        }
    }

    if (tabId === 'musiclib') {
        document.getElementById('page-title').innerText = "音乐库";
        if (typeof loadAvailableSources === 'function') loadAvailableSources();
        loadMusicLib();
        // Highlight the "所有音乐" sub-item
        const songsTab = document.getElementById('tab-musiclib-songs');
        const albumTab = document.getElementById('tab-albumlib');
        const folderTab = document.getElementById('tab-folderlib');
        if (songsTab) {
            songsTab.classList.add('active-sub-item');
            songsTab.classList.remove('t-text-muted');
        }
        if (albumTab) {
            albumTab.classList.remove('active-sub-item');
            albumTab.classList.add('t-text-muted');
        }
        if (folderTab) {
            folderTab.classList.remove('active-sub-item');
            folderTab.classList.add('t-text-muted');
        }
        // Expand the musiclib sub-menu
        const children = document.getElementById('musiclib-children');
        const arrow = document.getElementById('musiclib-arrow');
        if (children) children.style.height = children.scrollHeight + 'px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }

    if (tabId === 'albumlib') {
        document.getElementById('page-title').innerText = "专辑";
        if (typeof loadAvailableSources === 'function') loadAvailableSources();
        // Reset to grid view (close any open detail)
        closeAlbumDetail();
        // 清除歌手过滤模式并移除返回按钮
        if (_singerFilterName) {
            _singerFilterName = null;
            document.getElementById('singer-back-btn')?.remove();
        }
        loadAlbumLib(filterParam);
        // Highlight the "专辑" sub-item
        const songsTab = document.getElementById('tab-musiclib-songs');
        const albumTab = document.getElementById('tab-albumlib');
        const singerTab = document.getElementById('tab-singerlib');
        const folderTab = document.getElementById('tab-folderlib');
        if (albumTab) {
            albumTab.classList.add('active-sub-item');
            albumTab.classList.remove('t-text-muted');
        }
        if (songsTab) {
            songsTab.classList.remove('active-sub-item');
            songsTab.classList.add('t-text-muted');
        }
        if (singerTab) {
            singerTab.classList.remove('active-sub-item');
            singerTab.classList.add('t-text-muted');
        }
        if (folderTab) {
            folderTab.classList.remove('active-sub-item');
            folderTab.classList.add('t-text-muted');
        }
        // Expand the musiclib sub-menu
        const children = document.getElementById('musiclib-children');
        const arrow = document.getElementById('musiclib-arrow');
        if (children) children.style.height = children.scrollHeight + 'px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }

    if (tabId === 'singerlib') {
        document.getElementById('page-title').innerText = "歌手";
        if (typeof loadAvailableSources === 'function') loadAvailableSources();
        _singerFilterName = null; // 清除歌手过滤模式
        document.getElementById('singer-back-btn')?.remove();
        loadSingerLib();
        // Highlight the "歌手" sub-item
        const songsTab = document.getElementById('tab-musiclib-songs');
        const albumTab = document.getElementById('tab-albumlib');
        const singerTab = document.getElementById('tab-singerlib');
        const folderTab = document.getElementById('tab-folderlib');
        if (singerTab) {
            singerTab.classList.add('active-sub-item');
            singerTab.classList.remove('t-text-muted');
        }
        if (songsTab) {
            songsTab.classList.remove('active-sub-item');
            songsTab.classList.add('t-text-muted');
        }
        if (albumTab) {
            albumTab.classList.remove('active-sub-item');
            albumTab.classList.add('t-text-muted');
        }
        if (folderTab) {
            folderTab.classList.remove('active-sub-item');
            folderTab.classList.add('t-text-muted');
        }
        // Expand the musiclib sub-menu
        const children = document.getElementById('musiclib-children');
        const arrow = document.getElementById('musiclib-arrow');
        if (children) children.style.height = children.scrollHeight + 'px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }

    if (tabId === 'folderlib') {
        document.getElementById('page-title').innerText = "文件夹";
        // 刷新文件夹树 (保留展开/选中状态，首次进入自动构建；本地库新增文件/目录后切回即可见)
        if (typeof refreshFolderTree === 'function') refreshFolderTree();
        else if (typeof loadFolderTree === 'function') loadFolderTree();
        // Highlight the "文件夹" sub-item
        const songsTab = document.getElementById('tab-musiclib-songs');
        const albumTab = document.getElementById('tab-albumlib');
        const singerTab = document.getElementById('tab-singerlib');
        const folderTab = document.getElementById('tab-folderlib');
        if (folderTab) {
            folderTab.classList.add('active-sub-item');
            folderTab.classList.remove('t-text-muted');
        }
        if (songsTab) {
            songsTab.classList.remove('active-sub-item');
            songsTab.classList.add('t-text-muted');
        }
        if (albumTab) {
            albumTab.classList.remove('active-sub-item');
            albumTab.classList.add('t-text-muted');
        }
        if (singerTab) {
            singerTab.classList.remove('active-sub-item');
            singerTab.classList.add('t-text-muted');
        }
        // Expand the musiclib sub-menu
        const children = document.getElementById('musiclib-children');
        const arrow = document.getElementById('musiclib-arrow');
        if (children) children.style.height = children.scrollHeight + 'px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }

    if (tabId === 'dlnaserver') {
        document.getElementById('page-title').innerText = "DLNA服务";
        if (typeof initDlnaServer === 'function') initDlnaServer();
        // Highlight the "DLNA服务" sub-item
        const songsTab = document.getElementById('tab-musiclib-songs');
        const albumTab = document.getElementById('tab-albumlib');
        const singerTab = document.getElementById('tab-singerlib');
        const folderTab = document.getElementById('tab-folderlib');
        const dlnaTab = document.getElementById('tab-dlnaserver');
        if (dlnaTab) {
            dlnaTab.classList.add('active-sub-item');
            dlnaTab.classList.remove('t-text-muted');
        }
        if (songsTab) { songsTab.classList.remove('active-sub-item'); songsTab.classList.add('t-text-muted'); }
        if (albumTab) { albumTab.classList.remove('active-sub-item'); albumTab.classList.add('t-text-muted'); }
        if (singerTab) { singerTab.classList.remove('active-sub-item'); singerTab.classList.add('t-text-muted'); }
        if (folderTab) { folderTab.classList.remove('active-sub-item'); folderTab.classList.add('t-text-muted'); }
        // Expand the musiclib sub-menu
        const children = document.getElementById('musiclib-children');
        const arrow = document.getElementById('musiclib-arrow');
        if (children) children.style.height = children.scrollHeight + 'px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }

    // Collapse Favorites if leaving
    if (tabId !== 'favorites') {
        const favList = document.getElementById('favorites-children');
        const arrow = document.getElementById('favorites-arrow');
        if (favList && favList.style.height !== '0px') {
            favList.style.height = '0px';
            if (arrow) arrow.style.transform = 'rotate(-90deg)';
        }
    }

    // Collapse MusicLib sub-menu if leaving
    if (tabId !== 'musiclib' && tabId !== 'albumlib' && tabId !== 'singerlib' && tabId !== 'folderlib' && tabId !== 'dlnaserver') {
        const mlList = document.getElementById('musiclib-children');
        const mlArrow = document.getElementById('musiclib-arrow');
        if (mlList && mlList.style.height !== '0px') {
            mlList.style.height = '0px';
            if (mlArrow) mlArrow.style.transform = 'rotate(-90deg)';
        }
    }

    // Title update (handled above for search, others here)
    if (tabId === 'settings') {
        document.getElementById('page-title').innerText = '设置';
        // 确保设置界面的自定义源列表是最新的
        if (typeof loadCustomSources === 'function') {
            loadCustomSources();
        }
    }

    if (tabId === 'about') {
        document.getElementById('page-title').innerText = '关于';
        loadAboutContent();
    }

    if (tabId === 'home') {
        document.getElementById('page-title').innerText = '首页';
        if (typeof loadHomePage === 'function') loadHomePage();
    }

    // Auto-exit batch mode when switching tabs (Redundant but safe)
    if (window.batchMode && typeof toggleBatchMode === 'function') {
        toggleBatchMode();
    }
}

/**
 * 退出列表的二级模式（搜索框和批量模式）
 */
function exitListSecondaryModes() {
    if (window.ListSearch && window.ListSearch.state.active) {
        window.ListSearch.resetState();
    }
    if (window.batchMode) {
        window.batchMode = false;
        // 隐藏所有批量工具栏
        document.querySelectorAll('#batch-toolbar, #sl-batch-toolbar, #lb-batch-toolbar').forEach(el =>
            el.classList.add('hidden'));
        // 移除所有 batch-mode class
        ['view-search', 'songlist-detail-view', 'lb-songs-container'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('batch-mode');
        });
        // 清除选择
        window.selectedItems.clear();
        window.selectedSongObjects.clear();
        if (typeof refreshBatchUI === 'function') refreshBatchUI();
        if (typeof updateBatchToolbar === 'function') updateBatchToolbar();
    }
}
window.exitListSecondaryModes = exitListSecondaryModes;

// [音乐库已提取到 js/music-lib.js]
// ============================================================================
// 专辑库管理 (Album Library Management)
// ============================================================================
// [专辑库段A已提取到 js/album-lib.js]

// [歌手库已提取到 js/singer-lib.js]

// [专辑编辑器已提取到 js/album-editor.js]

// [专辑库段B已提取到 js/album-lib.js]

// [TAG 编辑器已提取到 js/tag-editor.js]

// 专辑补全功能
window.completeAlbumSongs = completeAlbumSongs;
window.downloadVirtualSongs = downloadVirtualSongs;
window.refreshAlbumDetail = refreshAlbumDetail;
window.toggleVirtualSong = toggleVirtualSong;



// Load About Content
async function loadAboutContent() {
    const aboutContainer = document.getElementById('about-content');
    if (!aboutContainer) return;

    try {
        const response = await fetch('/music/about.md');
        if (!response.ok) throw new Error('Failed to load about.md');
        const text = await response.text();

        // Render Markdown
        if (window.marked) {
            // Replace {{version}} and {{buildHash}} placeholder
            const version = (window.CONFIG && window.CONFIG.version) || 'v1.0.0';
            const buildHash = (window.CONFIG && window.CONFIG.buildHash) || 'unknown';
            let content = text.replace(/{{version}}/g, version);
            content = content.replace(/{{buildHash}}/g, buildHash);
            aboutContainer.innerHTML = window.marked.parse(content);
        } else {
            aboutContainer.innerText = text; // Fallback
        }
        aboutContainer.classList.remove('animate-pulse');
    } catch (e) {
        console.error('Failed to load about content:', e);
        aboutContainer.innerHTML = '<p class="text-red-500">加载关于页面失败，请稍后重试。</p>';
    }
}

// [DOMContentLoaded 合并到文件底部统一初始化]

// [播放队列管理已提取到 js/queue.js]
// ===============================================

// [搜索功能已提取到 js/search.js]


// [核心播放已提取到 js/playback.js]

// Update pagination information display
function updatePaginationInfo(start, end, total) {
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = '暂无数据';
        } else {
            infoEl.textContent = `显示 ${start}-${end} 条，共 ${total} 条`;
        }
    }
}

// Load settings from localStorage
function loadSettings() {
    try {
        const saved = localStorage.getItem('lx_settings');
        if (saved) {
            const loaded = JSON.parse(saved);
            settings = {...settings, ...loaded};
        }
    } catch (e) {
        console.error('[Settings] 加载设置失败:', e);
    }

    // 同步 UI 状态
    syncSettingsUI();
}

// ============================================================================
// 键盘快捷键 (Keyboard Shortcuts)
// ============================================================================
// ========== 键盘快捷键逻辑 ==========
let seekTimer = null;
let isLongPress = false;

function handleSeekKey(direction, action) {
    if (action === 'down') {
        if (seekTimer) return; // 已经在处理中

        // 初始步长跳转 (默认 5% 长度)
        let delta = direction === 'forward' ? 10 : -10;
        if (audio.duration && Number.isFinite(audio.duration)) {
            delta = audio.duration * (direction === 'forward' ? 0.05 : -0.05);
        }

        audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));

        // 设置长按逻辑 (500ms 后进入连续推进模式)
        seekTimer = setTimeout(() => {
            isLongPress = true;
            seekTimer = setInterval(() => {
                const step = direction === 'forward' ? 2 : -2; // 每 100ms 推进 2s = 20s/s
                audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + step));
            }, 100);
        }, 500);
    } else {
        // 松开按键，重置状态
        if (seekTimer) {
            if (isLongPress) clearInterval(seekTimer);
            else clearTimeout(seekTimer);
            seekTimer = null;
            isLongPress = false;
        }
    }
}

function changeVolume(delta) {
    currentVolume = Math.max(0, Math.min(1, currentVolume + delta));
    audio.volume = currentVolume;
    isMuted = false;
    updateVolumeUI();
    try {
        localStorage.setItem('lx_volume', currentVolume.toString());
    } catch (e) {
    }
}

// 注册全局键盘监听
document.addEventListener('keydown', (e) => {
    if (!settings.enableKeyboardShortcuts) return;

    // 如果焦点在输入框中，忽略快捷键
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
    }

    switch (e.code) {
        case 'Space':
            e.preventDefault();
            togglePlay();
            break;
        case 'ArrowUp':
            e.preventDefault();
            changeVolume(0.05);
            break;
        case 'ArrowDown':
            e.preventDefault();
            changeVolume(-0.05);
            break;
        case 'ArrowLeft':
            e.preventDefault();
            handleSeekKey('backward', 'down');
            break;
        case 'ArrowRight':
            e.preventDefault();
            handleSeekKey('forward', 'down');
            break;
        case 'BracketLeft': // '['
            playPrev();
            break;
        case 'BracketRight': // ']'
            playNext();
            break;
        case 'KeyL':
            toggleLyrics();
            break;
        case 'Digit1':
            if (e.altKey) switchTab('search');
            break;
        case 'Digit2':
            if (e.altKey) switchTab('songlist');
            break;
        case 'Digit3':
            if (e.altKey) switchTab('leaderboard');
            break;
        case 'Digit4':
            if (e.altKey) switchTab('musiclib');
            break;
        case 'Digit5':
            if (e.altKey) switchTab('favorites');
            break;
        case 'Digit6':
            if (e.altKey) switchTab('settings');
            break;
        case 'Digit7':
            if (e.altKey) switchTab('about');
            break;
        case 'Digit0':
            if (e.altKey) switchTab('home');
            break;
        case 'KeyF':
            updateSetting('showFooterVisualizer', !settings.showFooterVisualizer);
            break;
        case 'KeyG':
            updateSetting('showDetailVisualizer', !settings.showDetailVisualizer);
            break;
        case 'KeyH':
            if (typeof toggleCacheDrawer === 'function') toggleCacheDrawer();
            break;
        case 'KeyJ':
            if (typeof toggleDownloadDrawer === 'function') toggleDownloadDrawer();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    if (!settings.enableKeyboardShortcuts) return;
    if (e.code === 'ArrowLeft') handleSeekKey('backward', 'up');
    if (e.code === 'ArrowRight') handleSeekKey('forward', 'up');
});

// ============================================================================
// 设置管理 UI (Settings UI Management)
// ============================================================================
async function updateSetting(key, value) {
    const restrictedKeys = ['enableServerCache', 'enableServerLyricCache'];
    const isPublic = !currentListData?.username || currentListData?.username === 'default';
    const enablePublicRestriction = window.lx_config?.['user.enablePublicRestriction'];
    const isAdmin = !!localStorage.getItem('lx_admin_password');

    // [新增] 权限校验：受限公开用户修改核心设置
    if (restrictedKeys.includes(key) && isPublic && enablePublicRestriction && !isAdmin) {
        showError('权限不足：公共用户修改该设置受限，请先验证管理员。');
        const authorized = await handleAdminAuth('该设置项受限，请输入管理员密码以修改');
        if (!authorized) {
            syncSettingsUI(key, settings[key]); // 还原 UI
            return;
        }
    }

    settings[key] = value;
    window.settings = settings; // 确保全局引用同步
    try {
        localStorage.setItem('lx_settings', JSON.stringify(settings));
    } catch (e) {
        console.error('[Settings] 保存设置失败:', e);
    }
    // 实时同步 UI 并应用效果
    syncSettingsUI(key, value);

    // [New] Push to server if enabled
    if (settings.saveAccountSettingsToFile) {
        pushSettingsToServer();
    }

    // Special handlers for visual changes
    if (key.includes('Visualizer') || key.startsWith('visualizer')) {
        if (window.musicVisualizer) {
            // 如果正在播放且开启了开关，尝试强制初始化 (防止第一次点击开关没反应)
            if (typeof audio !== 'undefined' && !audio.paused && (settings.showFooterVisualizer || settings.showDetailVisualizer)) {
                window.musicVisualizer.init();
            }
            window.musicVisualizer.applySettings();
        }

        // 更新透明度数值显示
        if (key === 'visualizerOpacity') {
            const el = document.getElementById('visualizer-opacity-value');
            if (el) el.innerText = value;
        }
        // 更新自定义颜色选择器可见性
        if (key === 'visualizerColorMode') {
            const pickerRow = document.getElementById('visualizer-custom-color-row');
            if (pickerRow) pickerRow.classList.toggle('hidden', value !== 'custom');
        }
    }

    if (key === 'playerBackground') {
        applyPlayerBackground(value);
    }

    if (key === 'enablePublicSources') {
        if (typeof updateSourceScopeUI === 'function') updateSourceScopeUI();
        if (typeof renderCustomSources === 'function') renderCustomSources();
    }
}

//缓存设置
// 核心设置项映射表: [key]: { id: 'element-id', type: 'checkbox|value|custom', action: (val) => { ... } }
const SETTINGS_UI_MAP = {
    // 逻辑 (Logic)
    switchPlaylistOnSearchPlay: {id: 'setting-switch-playlist-search', type: 'checkbox'},
    switchPlaylistOnSongListPlay: {id: 'setting-switch-playlist-songlist', type: 'checkbox'},
    autoResume: {id: 'setting-auto-resume', type: 'checkbox'},
    autoCompactPlaybar: {id: 'setting-auto-compact-playbar', type: 'checkbox'},
    enableAutoSwitchSource: {id: 'setting-auto-switch-source', type: 'checkbox'},
    enableAutoSkipOnError: {id: 'setting-auto-skip-on-error', type: 'checkbox'},
    enablePreloader: {id: 'setting-enable-preloader', type: 'checkbox'},
    enableSmtcLyric: {
        id: 'setting-enable-smtc-lyric',
        type: 'checkbox',
        action: (v) => {
            // 关闭时立即恢复 MediaSession title / artist 为歌曲名 / 歌手名
            if (!v && 'mediaSession' in navigator && navigator.mediaSession.metadata && currentPlayingSong) {
                try {
                    navigator.mediaSession.metadata.title = currentPlayingSong.name;
                    navigator.mediaSession.metadata.artist = currentPlayingSong.singer;
                } catch (e) { /* ignore */
                }
            }
        }
    },
    downloadConcurrency: {
        id: 'setting-download-concurrency',
        type: 'value',
        action: (v) => {
            if (window.SystemDownloadManager) {
                window.SystemDownloadManager.updateMaxConcurrent(parseInt(v));
            }
        }
    },
    enableKeyboardShortcuts: {id: 'setting-enable-shortcuts', type: 'checkbox'},
    enableCrossfade: {id: 'setting-enable-crossfade', type: 'checkbox'},
    keepScreenAwake: {
        id: 'setting-keep-screen-awake',
        type: 'checkbox',
        action: (v) => toggleNoSleep(v && !audio.paused)
    },
    enablePersistentToken: {
        id: 'setting-enable-persistent-token',
        type: 'checkbox',
        action: (v) => {
            const container = document.getElementById('token-list-container');
            if (container) {
                if (v) {
                    container.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
                } else {
                    container.classList.add('hidden', 'opacity-50', 'pointer-events-none');
                }
            }
        }
    },

    // 显示 (Display)
    showSidebarSongInfo: {
        id: 'setting-show-sidebar-info',
        type: 'checkbox',
        action: (v) => {
            const sidebarInfo = document.querySelector('.sidebar-song-info-wrapper');
            if (sidebarInfo) v ? sidebarInfo.classList.add('md:block') : sidebarInfo.classList.remove('md:block');
        }
    },
    showLyricTranslation: {
        id: 'setting-show-lyric-translation',
        type: 'checkbox',
        action: () => (lyricPlayer && currentRawLrc) && applyLyricUpdate()
    },
    showLyricRoma: {
        id: 'setting-show-lyric-roma',
        type: 'checkbox',
        action: () => (lyricPlayer && currentRawLrc) && applyLyricUpdate()
    },
    swapLyricTransRoma: {
        id: 'setting-swap-lyric-trans-roma',
        type: 'checkbox',
        action: () => (lyricPlayer && currentRawLrc) && applyLyricUpdate()
    },
    enableLyricGlow: {
        id: 'setting-enable-lyric-glow',
        type: 'checkbox',
        action: (v) => {
            // 同时更新歌词详情容器和歌词内容容器，实现实时生效
            const dv = document.getElementById('view-player-detail');
            if (dv) v ? dv.classList.add('enable-lyric-glow') : dv.classList.remove('enable-lyric-glow');
            const lc = document.getElementById('lyric-content');
            if (lc) v ? lc.classList.add('enable-lyric-glow') : lc.classList.remove('enable-lyric-glow');
        }
    },
    playerBackground: {
        id: 'setting-player-background',
        type: 'value',
        action: (v) => applyPlayerBackground(v)
    },
    lyricFontSize: {
        id: 'lyric-font-size-slider',
        type: 'value',
        action: (v) => {
            const valEl = document.getElementById('lyric-font-size-value');
            if (valEl) valEl.innerText = v;
            document.documentElement.style.setProperty('--lyric-font-size', `${v}rem`);
        }
    },
    lyricFontFamily: {
        id: 'lyric-font-family-select',
        type: 'value',
        action: (v) => document.documentElement.style.setProperty('--lyric-font-family', v || 'inherit')
    },

    // 视觉效果 (Visualizer)
    showFooterVisualizer: {id: 'setting-show-footer-visualizer', type: 'checkbox'},
    footerVisualizerStyle: {id: 'setting-footer-visualizer-style', type: 'value'},
    showDetailVisualizer: {id: 'setting-show-detail-visualizer', type: 'checkbox'},
    detailVisualizerStyle: {id: 'setting-detail-visualizer-style', type: 'value'},
    visualizerGlobalStyle: {id: 'setting-visualizer-global-style', type: 'value'},
    visualizerColorMode: {
        id: 'setting-visualizer-color-mode',
        type: 'value',
        action: (v) => {
            const pickerRow = document.getElementById('visualizer-custom-color-row');
            if (pickerRow) pickerRow.classList.toggle('hidden', v !== 'custom');
            // 同步全屏 / 在线电台的颜色模式 pill 名称
            if (window.musicVisualizer && typeof window.musicVisualizer.cycleColorMode === 'function') {
                // 触发指示器更新（通过读取当前设置来刷新）
                const modes = window.musicVisualizer.COLOR_MODES || [];
                const entry = modes.find(e => e.value === v);
                ['fullscreen-colormode-name', 'or-vis-colormode-name'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el && entry) el.textContent = entry.name;
                });
            }
        }
    },
    visualizerCustomColor: {id: 'setting-visualizer-custom-color', type: 'value'},
    visualizerOpacity: {
        id: 'setting-visualizer-opacity',
        type: 'value',
        action: (v) => {
            const valEl = document.getElementById('visualizer-opacity-value');
            if (valEl) valEl.innerText = v;
        }
    },

    // VU 表 (VU Meter)
    showSidebarVU: {
        id: 'setting-show-sidebar-vu',
        type: 'checkbox',
        action: (v) => {
            const container = document.getElementById('sidebar-vu-container');
            if (container) container.style.display = v ? '' : 'none';
            if (v && window.VUMeterController) {
                window.VUMeterController.start();
            } else if (window.VUMeterController) {
                window.VUMeterController.stopSidebar();
            }
        }
    },
    sidebarVUStyle: {
        id: 'setting-sidebar-vu-style',
        type: 'value',
        action: (v) => {
            if (window.VUMeterController) window.VUMeterController.setStyle(v);
        }
    },
    showFullscreenVU: {id: 'setting-show-fullscreen-vu', type: 'checkbox'},

    // 系统 & 网络 (System & Network)
    autoUpdateNetworkList: {id: 'setting-auto-update-list', type: 'checkbox'},
    saveAccountSettingsToFile: {id: 'setting-save-settings-to-file', type: 'checkbox'},
    enableLyricCache: {id: 'setting-enable-lyric-cache', type: 'checkbox'},
    enableSongUrlCache: {id: 'setting-enable-url-cache', type: 'checkbox'},
    enableServerCache: {id: 'setting-enable-server-cache', type: 'checkbox'},
    enableServerLyricCache: {id: 'setting-enable-server-lyric-cache', type: 'checkbox'},
    preferServerCache: {id: 'setting-prefer-server-cache', type: 'checkbox'},
    enableProxyPlayback: {id: 'toggle-proxy-playback', type: 'checkbox'},
    enableProxyDownload: {id: 'toggle-proxy-download', type: 'checkbox'},
    enableAutoProxy: {id: 'toggle-auto-proxy', type: 'checkbox'},
    enableCustomProxy: {
        id: 'toggle-custom-proxy',
        type: 'checkbox',
        action: (v) => {
            const row = document.getElementById('custom-proxy-url-row');
            if (row) row.classList.toggle('hidden', !v);
        }
    },
    customProxyUrl: {id: 'custom-proxy-url-input', type: 'value'},
    enablePublicSources: {id: 'toggle-public-sources', type: 'checkbox'},
    preferredQuality: {
        id: 'quality-select',
        type: 'value',
        action: (v, isSingle) => {
            if (isSingle && window.showSuccess && window.QualityManager) {
                window.showSuccess(`默认音质已设置为: ${window.QualityManager.getQualityDisplayName(v)}`);
            }
        }
    },
    hotSearchLimit: {
        id: 'hot-search-limit-input',
        type: 'value',
        action: () => document.getElementById('search-results-header')?.classList.contains('hidden') && showInitialSearchState()
    },
    itemsPerPage: {id: 'items-per-page-select', type: 'value'},
    enableClientModeSync: {id: 'setting-client-mode-sync', type: 'checkbox'}
};

//缓存设置项
function syncSettingsUI(key = null, value = null) {
    const isPublic = !currentListData?.username || currentListData?.username === 'default';
    const enablePublicRestriction = window.lx_config?.['user.enablePublicRestriction'];
    const isAdmin = !!localStorage.getItem('lx_admin_password');
    const restrictedKeys = ['enableServerCache', 'enableServerLyricCache'];

    const updateItem = (itemKey, itemValue, isSingle) => {
        const config = SETTINGS_UI_MAP[itemKey];
        if (!config) return;

        const el = document.getElementById(config.id);
        if (el) {
            if (config.type === 'checkbox') el.checked = !!itemValue;
            else el.value = itemValue;

            // [新增] 禁用受限设置项
            if (restrictedKeys.includes(itemKey) && isPublic && enablePublicRestriction && !isAdmin) {
                el.disabled = true;
                // 查找父级 label 或容器进行置灰
                const container = el.closest('.flex.items-center.justify-between') || el.parentElement;
                if (container) container.classList.add('opacity-40', 'pointer-events-none');
            } else {
                el.disabled = false;
                const container = el.closest('.flex.items-center.justify-between') || el.parentElement;
                if (container) container.classList.remove('opacity-40', 'pointer-events-none');
            }
        }

        if (config.action) config.action(itemValue, isSingle);
    };

    // [新增] 更新管理员 UI 状态 (标签、按钮)
    if (typeof updateAdminUI === 'function') updateAdminUI();

    if (key !== null && value !== null) {
        // 单项更新
        updateItem(key, value, true);
    } else {
        // 全局同步
        Object.keys(SETTINGS_UI_MAP).forEach(itemKey => {
            const val = settings[itemKey];
            // 处理默认值逻辑 (如果 settings 中没有，则可能需要 fallback 或跳过)
            if (val !== undefined) {
                updateItem(itemKey, val, false);
            }
        });
    }

    // 更新存储统计与缓存大小
    updateStorageStatsUI();
    updateServerCacheSize();
}
window.syncSettingsUI = syncSettingsUI;

/**
 * 应用播放页背景样式
 * @param {string} mode - 'blur', 'solid', 'dark'
 */
function applyPlayerBackground(mode) {
    const detailBg = document.getElementById('view-player-detail');
    const bgCover = document.getElementById('detail-bg-cover');
    const bgOverlay = document.getElementById('player-detail-bg-overlay');
    if (!detailBg || !bgCover || !bgOverlay) return;


    // 重置默认状态
    bgCover.style.display = 'block';
    bgOverlay.className = 'absolute inset-0 t-bg-panel/30 backdrop-blur-3xl';
    bgOverlay.style.backgroundColor = '';
    bgOverlay.style.backdropFilter = '';
    detailBg.style.backgroundColor = '';

    if (mode === 'solid') {
        bgCover.style.display = 'none';
        bgOverlay.className = 'absolute inset-0 t-bg-panel';
        bgOverlay.style.backdropFilter = 'none';
    } else if (mode === 'dark') {
        bgCover.style.display = 'none';
        bgOverlay.className = 'absolute inset-0';
        bgOverlay.style.backgroundColor = '#000000';
        bgOverlay.style.backdropFilter = 'none';
    }
    // 'blur' 模式由上面的重置逻辑处理
}

// [缓存统计与管理已提取到 js/cache-manager.js]


// 函数导出已统一移至文件底部 "导出函数到 window" 区域
// --- Lyrics & Detail View Logic ---

let currentLyricLines = [];
let isLyricViewOpen = false;
let currentLyricIndex = -1;
let wordAnimationId = null; // 用于逐词歌词动画
let lyricPlayer = null; // LinePlayer instance for parsing and syncing
let isUserScrolling = false; // 用户是否正在手动滚动
let scrollLockTimeout = null; // 滚动锁定计时器
let isProgrammaticScroll = false; // 标记是否为程序自动滚动
const SCROLL_LOCK_DURATION = 5000; // 5秒后解除锁定

function toggleLyrics() {
    isLyricViewOpen = !isLyricViewOpen;
    const view = document.getElementById('view-player-detail');

    if (isLyricViewOpen) {
        // 若 VU 面板已打开，先关闭 VU 面板（互斥）
        const vuOverlay = document.getElementById('visualizer-fullscreen-overlay');
        if (vuOverlay && vuOverlay.style.display !== 'none' && window.musicVisualizer && window.musicVisualizer.toggleFullscreen) {
            window.musicVisualizer.toggleFullscreen();
        }

        view.classList.remove('hidden');
        // Trigger reflow
        void view.offsetWidth;
        view.classList.remove('translate-y-[100%]', 'opacity-0');

        // 开始歌词按钮淡化倒计时
        startToggleLyricsBtnTimer();

        // Update UI
        if (currentPlayingSong) {
            updateDetailInfo(currentPlayingSong);
            // If no lyrics yet, try fetch
            if (currentLyricLines.length === 0) {
                fetchLyric(currentPlayingSong);
            }
            // 仅在音频正在播放时才启动歌词滚动，防止暂停时打开详情页歌词自走
            if (lyricPlayer && !audio.paused) {
                lyricPlayer.play(audio.currentTime * 1000);
            }
            setTimeout(() => scrollToActiveLine(true), 100);
        }

        // Notify visualizer to switch canvas
        setTimeout(() => {
            if (window.musicVisualizer) window.musicVisualizer.applySettings();
        }, 300);

        // 如果开启了自动精简，且在手机端进入详情页，则自动精简
        if (settings.autoCompactPlaybar !== false && window.innerWidth < 1025) {
            window.setCompactPlaybar(true);
        }
    } else {
        view.classList.add('translate-y-[100%]', 'opacity-0');
        setTimeout(() => {
            view.classList.add('hidden');
            // Notify visualizer to switch back to footer
            if (window.musicVisualizer) window.musicVisualizer.applySettings();
        }, 600); // match transition duration

        // 关闭详情页自动展开控制栏
        if (settings.autoCompactPlaybar !== false && window.innerWidth < 1025) {
            window.setCompactPlaybar(false);
        }
    }
}

function updateDetailInfo(song) {
    document.getElementById('detail-title').innerText = song.name;
    document.getElementById('detail-artist').innerText = song.singer;
    const imgUrl = getImgUrl(song);
    // Use high res image if possible or same URL
    setImg('detail-cover', imgUrl);
    setImg('detail-bg-cover', imgUrl);
}

async function fetchLyric(song, quality = null) {
    if (!song || (song.source && song.source === 'local')) {
        return;
    }

    // 统一准备好认证 headers
    const headers = {};
    Object.assign(headers, getUserAuthHeaders());

    // 支持两种数据结构:
    // 1. 搜索结果: song.songmid, song.source 在顶层
    // 2. 收藏列表: songId 已提升到顶层，meta 中也有备份
    // 3. 不同平台字段名差异: songmid vs songId
    let songmid = song.songmid || song.songId;
    let source = song.source;

    // 如果还是没有必要的数据, 直接返回
    if (!songmid || !source) {
        console.log('无歌词', song)
        renderLyric([], '暂无歌词');
        return;
    }

    // [Optimize] 如果歌曲未变化且已有歌词，跳过完整加载流程逻辑
    const currentLyricKey = `${source}_${songmid} `;
    if (lastLyricSongId === currentLyricKey && currentLyricLines.length > 0) {
        if (lyricPlayer) {
            applyLyricUpdate();
        }
        return;
    }
    lastLyricSongId = currentLyricKey;

    document.getElementById('lyric-content').innerHTML = '<p class="t-text-muted text-lg animate-pulse">正在加载歌词...</p>';
    currentLyricLines = [];

    // ===== 1. 尝试读取浏览器本地缓存 (最高优先级) =====
    const cacheKey = `lx_lyric_${source}_${songmid} `;
    if (settings.enableLyricCache !== false) {
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                currentRawLrc = data.lrc || '';
                currentRawTlrc = data.tlyric || '';
                currentRawRlrc = data.rlyric || '';
                currentRawKlrc = data.klyric || data.lxlyric || '';

                initLyricPlayer();
                applyLyricUpdate();
                return; // 命中缓存，直接返回
            }
        } catch (e) {
            console.warn('[Lyric] 读取浏览器本地缓存失败:', e);
            localStorage.removeItem(cacheKey);
        }
    }

    // ===== 2. 尝试读取服务器端缓存歌词 =====
    const username = currentListData?.username || '';

    if (settings.enableServerLyricCache !== false) {
        try {
            const serverCacheUrl = `${API_BASE}/cache/lyric?name=${song.name}&singer=${song.singer}&albumName=${song.album || song.albumName || ''}`;
            const scRes = await fetch(serverCacheUrl, {headers});
            if (scRes.ok) {
                const scData = await scRes.json();
                if (scData.success && scData.data) {
                    currentRawLrc = scData.data.lyric || scData.data.lrc || '';
                    currentRawTlrc = scData.data.tlyric || '';
                    currentRawRlrc = scData.data.rlyric || '';
                    currentRawKlrc = scData.data.klyric || scData.data.lxlyric || '';


                    // 同步到浏览器本地缓存
                    if (settings.enableLyricCache !== false && currentRawLrc) {
                        localStorage.setItem(cacheKey, JSON.stringify({
                            lrc: currentRawLrc, tlyric: currentRawTlrc, rlyric: currentRawRlrc, klyric: currentRawKlrc
                        }));
                    }

                    initLyricPlayer();
                    applyLyricUpdate();
                    return;
                }
            }
        } catch (e) {
            console.warn('[Lyric] 读取服务器端缓存失败:', e);
        }
    }

    // ===== 3. 从网络抓取最新歌词 =====
    // DMS 源没有在线歌词服务，跳过网络抓取
    if (source === 'dms') {
        renderLyric([], '暂无歌词');
        return;
    }
    try {
        const params = new URLSearchParams({
            source,
            songmid,
            name: song.name || song.songname || '',
            singer: song.singer || song.singername || '',
            hash: song.hash || '',
            interval: song.interval || song.duration || '',
            copyrightId: song.copyrightId || '',
            albumId: song.albumId || '',
            lrcUrl: song.lrcUrl || '',
            mrcUrl: song.mrcUrl || '',
            trcUrl: song.trcUrl || ''
        });

        const url = `${API_BASE}/lyric?${params.toString()}`;
        // [优化] 使用低优先级 fetch 获取歌词，避免阻塞主进程加载和 PWA 安装按钮出现
        const res = await fetch(url, {headers, priority: 'low'});

        if (!res.ok) {
            throw new Error(`Fetch lyric failed: ${res.status}`);
        }

        const data = await res.json();
        currentRawLrc = data.lyric || data.lrc || '';
        currentRawTlrc = data.tlyric || '';
        currentRawRlrc = data.rlyric || '';
        currentRawKlrc = data.klyric || data.lxlyric || '';


        // ===== 4. 写入缓存 (浏览器本地 + 服务器端) =====
        if (currentRawLrc) {
            const cacheData = {
                lrc: currentRawLrc,
                tlyric: currentRawTlrc,
                rlyric: currentRawRlrc,
                klyric: currentRawKlrc
            };

            // 写入浏览器本地
            if (settings.enableLyricCache !== false) {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                    updateStorageStatsUI();
                } catch (e) {
                    console.warn('[Lyric] 写入本地缓存失败:', e);
                }
            }

            // 写入服务器端
            if (settings.enableServerLyricCache !== false) {
                try {
                    fetch(`${API_BASE}/cache/lyric`, {
                        method: 'POST',
                        headers: {
                            ...headers,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            songInfo: {
                                ...song,
                                quality: (typeof quality !== 'undefined' ? quality : (typeof currentQuality !== 'undefined' ? currentQuality : null))
                            },
                            lyricsObj: {
                                lyric: currentRawLrc,
                                tlyric: currentRawTlrc,
                                rlyric: currentRawRlrc,
                                lxlyric: currentRawKlrc
                            }
                        })
                    }).catch(e => console.warn('[Lyric] 上传服务端缓存失败:', e));
                } catch (e) {
                }
            }
        }

        if (!currentRawLrc) {
            renderLyric([]);
            return;
        }

        // Initialize LinePlayer
        initLyricPlayer();
        applyLyricUpdate();

    } catch (e) {
        console.error('[Lyric] Failed:', e);
        renderLyric([], '暂无歌词');
    }
}

// 辅助函数：根据当前设置应用歌词更新
function applyLyricUpdate() {
    if (!lyricPlayer || !currentRawLrc) return;

    const extendedLyrics = [];
    const showTrans = settings.showLyricTranslation !== false;
    const showRoma = settings.showLyricRoma === true;
    const isSwap = settings.swapLyricTransRoma === true;

    if (showTrans && currentRawTlrc && showRoma && currentRawRlrc) {
        if (isSwap) {
            extendedLyrics.push(currentRawRlrc);
            extendedLyrics.push(currentRawTlrc);
        } else {
            extendedLyrics.push(currentRawTlrc);
            extendedLyrics.push(currentRawRlrc);
        }
    } else if (showTrans && currentRawTlrc) {
        extendedLyrics.push(currentRawTlrc);
    } else if (showRoma && currentRawRlrc) {
        extendedLyrics.push(currentRawRlrc);
    }

    // 优先使用逐字歌词 (klyric/lxlyric)，如果不存在则使用普通歌词
    const mainLyric = currentRawKlrc || currentRawLrc;
    lyricPlayer.setLyric(mainLyric, extendedLyrics);

    // [Fix] 仅在音频真正播放时才启动歌词滚动
    if (!audio.paused) {
        lyricPlayer.play(audio.currentTime * 1000);
    } else {
        lyricPlayer.pause(); // 确保强制同步到暂停状态
    }
}

// 辅助函数：初始化歌词播放器
function initLyricPlayer() {
    if (!window.LinePlayer) {
        console.error('[Lyric] LinePlayer not loaded');
        return;
    }

    if (!lyricPlayer) {
        lyricPlayer = new window.LinePlayer({
            offset: 0,
            rate: currentPlaybackRate || 1,
            onPlay: (lineNum, text, curTime) => {
                syncLyricByLineNum(lineNum);
            },
            onSetLyric: (lines, offset) => {
                currentLyricLines = lines;
                window.currentLyricLines = lines; // expose for lyric-card.js
                renderLyric(lines);
            }
        });
    }
}

// Helper function to calculate lyric offset (Center Line)
function getLyricOffset() {
    const containerBox = document.getElementById('lyric-container');
    if (!containerBox) return 0;

    // 无论桌面还是移动端，显示还是隐藏封面，统一使用固定比例参考线
    // 这样可以保证指示器(indicator)高度在切换模式时保持绝对稳定
    const footer = document.getElementById('player-footer');
    const isFooterHidden = footer && footer.classList.contains('translate-y-[110%]');

    // 使用 0.35 作为黄金分割参考线位置 [lyric-scroll-indicator]
    const ratio = 0.25;
    return containerBox.clientHeight * ratio;
}

// Helper to scroll to active line
function scrollToActiveLine(force = false) {
    if (isUserScrolling && !force) return;

    const containerBox = document.getElementById('lyric-container');
    const lyricContent = document.getElementById('lyric-content');
    if (!containerBox || !lyricContent) return;

    const lines = lyricContent.children;
    if (lines.length === 0) return;

    // Use currentLyricIndex, default to 0 if invalid
    let targetIndex = currentLyricIndex;
    if (targetIndex < 0 || targetIndex >= lines.length) targetIndex = 0;

    const currentLine = lines[targetIndex];
    if (!currentLine) return;

    const lineTop = currentLine.offsetTop;

    // 计算目标参考线位置
    const offsetInContainer = getLyricOffset();

    const targetScroll = lineTop - offsetInContainer;

    // 标记为程序滚动
    isProgrammaticScroll = true;

    // Clear any existing forced cleanup timer
    if (window.programmaticScrollTimer) clearTimeout(window.programmaticScrollTimer);

    containerBox.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
    });

    // 1500ms 后清除标记 (给予平滑滚动足够的时间)
    window.programmaticScrollTimer = setTimeout(() => {
        isProgrammaticScroll = false;
        window.programmaticScrollTimer = null;
    }, 1500);
}

// Sync lyric by line number (called by LinePlayer)
function syncLyricByLineNum(lineNum) {
    // Always update the highlight classes regardless of scroll
    const container = document.getElementById('lyric-content');
    if (!container) return;

    const lines = container.children;

    // Check if index actually changed to update classes
    if (lineNum !== currentLyricIndex) {
        currentLyricIndex = lineNum;
        window.currentLyricIndex = lineNum;   // expose for lyric-card.js
        window.currentLyricLines = currentLyricLines; // expose for lyric-card.js

        // Remove active class from previous line
        const prev = container.querySelector('.active');
        if (prev) prev.classList.remove('active');

        // Add active class to current line
        if (lineNum >= 0 && lineNum < lines.length) {
            lines[lineNum].classList.add('active');
        }

        // SMTC 歌词显示：将当前歌词行写入 MediaSession metadata.title，artist 显示「歌曲名 - 歌手名」
        if ('mediaSession' in navigator && navigator.mediaSession.metadata && settings.enableSmtcLyric) {
            try {
                const lyricText = (lineNum >= 0 && currentLyricLines && currentLyricLines[lineNum])
                    ? currentLyricLines[lineNum].text
                    : '';
                const song = currentPlayingSong;
                const songTitle = song ? song.name : '';
                navigator.mediaSession.metadata.title = lyricText || songTitle;
                // artist 字段保留「歌曲名 - 歌手名」，让用户知道当前播放的歌曲
                if (song) {
                    navigator.mediaSession.metadata.artist = `${song.name} - ${song.singer}`;
                }
            } catch (e) {
                // ignore
            }
        }
    }

    // 仅在正在播放且有逐字歌词时，才启动动画循环
    if (wordAnimationId) cancelAnimationFrame(wordAnimationId);
    if (!audio.paused && lineNum >= 0 && lineNum < lines.length) {
        const lineData = currentLyricLines[lineNum];
        if (lineData && lineData.words && lineData.words.length > 0) {
            startWordProgressUpdate(lineNum, lines[lineNum], lineData);
        }
    }

    // Perform scroll (scrollToActiveLine handles isUserScrolling check)
    scrollToActiveLine();
}

/**
 * 启动逐字动画更新循环 (仅针对有逐字数据的行)
 */
function startWordProgressUpdate(lineIndex, lineEl, lineData) {
    const wordSpans = lineEl.querySelectorAll('.word-item');
    if (!wordSpans.length) return;

    const lineStartTime = lineData.time;

    // 获取该行最后一个字结束的真实时长作为整行时长
    let lineDuration = 5000;
    const lastWord = lineData.words[lineData.words.length - 1];
    if (lastWord) {
        lineDuration = lastWord.startTime + lastWord.duration;
    }
    if (lineDuration <= 0) lineDuration = 5000;

    // 提前计算本行所有字的总演唱时长，用于翻译进度的精准映射
    let totalWordsDuration = 0;
    wordSpans.forEach(span => {
        totalWordsDuration += parseInt(span.dataset.duration) || 0;
    });

    function update() {
        // 如果当前播放行已改变，或音频暂停，停止动画
        if (currentLyricIndex !== lineIndex || audio.paused) {
            return;
        }

        const curTimeMs = audio.currentTime * 1000;
        const relativeTime = curTimeMs - lineStartTime;

        let sungDuration = 0;

        // 2. 更新逐字进度
        wordSpans.forEach(span => {
            const start = parseInt(span.dataset.start);
            const duration = parseInt(span.dataset.duration);

            if (relativeTime >= start + duration) {
                // 已播放完
                sungDuration += duration;
                span.style.setProperty('--word-progress', '100%');
                span.classList.add('passed');
                span.classList.remove('playing');
            } else if (relativeTime >= start) {
                // 正在播放中
                sungDuration += (relativeTime - start);
                const progress = Math.min(100, Math.max(0, ((relativeTime - start) / duration) * 100));
                span.style.setProperty('--word-progress', `${progress}%`);
                span.classList.add('playing');
                span.classList.remove('passed');
            } else {
                // 尚未播放
                span.style.setProperty('--word-progress', '0%');
                span.classList.remove('passed', 'playing');
            }
        });

        // 1. 更新整行进度 (用于带有逐字数据的翻译/罗马音平滑扫过)
        // 通过 实际已唱时长 / 总发声时长，实现翻译和原词进度严丝合缝对齐，消除"晚来早走"现象
        const lineProgress = totalWordsDuration > 0 ? (sungDuration / totalWordsDuration) * 100 : Math.min(100, Math.max(0, (relativeTime / lineDuration) * 100));
        lineEl.style.setProperty('--line-progress', `${lineProgress}%`);

        // 2. 更新扩展歌词逐字类 (翻译/罗马音) - 实现与主词同步的平滑“染色”
        const extSpans = lineEl.querySelectorAll('.extended');
        extSpans.forEach(ext => {
            const items = ext.querySelectorAll('.ext-item');
            const itemCount = items.length;
            if (itemCount > 0) {
                const perItemWeight = 100 / itemCount;
                items.forEach((item, idx) => {
                    const itemStart = idx * perItemWeight;
                    const itemEnd = (idx + 1) * perItemWeight;

                    if (lineProgress >= itemEnd) {
                        item.style.setProperty('--word-progress', '100%');
                        item.classList.add('passed');
                        item.classList.remove('playing');
                    } else if (lineProgress >= itemStart) {
                        // 正在该字符/单词内平滑填充
                        const progress = ((lineProgress - itemStart) / perItemWeight) * 100;
                        item.style.setProperty('--word-progress', `${progress}%`);
                        item.classList.add('playing');
                        item.classList.remove('passed');
                    } else {
                        item.style.setProperty('--word-progress', '0%');
                        item.classList.remove('passed', 'playing');
                    }
                });
            }
        });

        wordAnimationId = requestAnimationFrame(update);
    }

    wordAnimationId = requestAnimationFrame(update);
}

// 节流函数
let scrollThrottleTimer = null;

// 用户手动滚动歌词
function handleLyricScroll() {
    // 忽略程序自动滚动
    if (isProgrammaticScroll) {
        return;
    }

    // 标记用户正在滚动
    isUserScrolling = true;

    // 显示指示器
    const indicator = document.getElementById('lyric-scroll-indicator');
    const container = document.getElementById('lyric-container');
    if (indicator && container) {
        // [Fix] 每次显示时动态更新高度，确保与自动滚动对齐点一致
        // indicator 是绝对定位在 lyrics-wrapper 内 (父容器)
        // offset 是相对于 lyric-container 顶部的距离 (子容器)
        // lyric-container 顶部可能有 Title 占据空间，因此需要加上 container.offsetTop
        const offset = getLyricOffset();
        indicator.style.top = `${container.offsetTop + offset}px`;

        indicator.classList.remove('hidden');
        indicator.style.display = 'flex';
    }

    // 清除之前的计时器
    if (scrollLockTimeout) {
        clearTimeout(scrollLockTimeout);
    }

    // 优化：如果有正在等待的帧，直接返回，不重复计算 (Leading throttle behavior)
    if (scrollThrottleTimer) {
        return;
    }

    // 使用 requestAnimationFrame 实时更新（约16ms一次，流畅无延迟）
    scrollThrottleTimer = requestAnimationFrame(() => {
        updateScrollIndicator();
        scrollThrottleTimer = null;
    });

    // 5秒后恢复自动滚动并隐藏指示器
    scrollLockTimeout = setTimeout(() => {
        isUserScrolling = false;
        scrollLockTimeout = null;

        // 隐藏指示器
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.style.display = 'none';
        }

        // 清除滚动目标高亮
        const lyricContent = document.getElementById('lyric-content');
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }

        // 恢复后立即同步到当前播放位置
        if (lyricPlayer && !audio.paused) {
            // 确保内部状态同步
            lyricPlayer.play(audio.currentTime * 1000);
        }

        // [Fix] 立即滚动回当前歌词，不等待下一句更新
        scrollToActiveLine(true);

    }, SCROLL_LOCK_DURATION);
}

// 更新滚动指示器（显示当前对准的歌词时间）
function updateScrollIndicator() {
    const container = document.getElementById('lyric-container');
    const indicator = document.getElementById('lyric-scroll-indicator');
    const lyricContent = document.getElementById('lyric-content');

    // 如果不在滚动状态，清除所有高亮并返回
    if (!container || !indicator || !lyricContent || !isUserScrolling) {
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }
        return;
    }


    // [Refactor] 虚线位置已在 handleLyricScroll 中动态设置，这里不再需要一次性初始化
    // 且现在完全依赖 getLyricOffset() 保证位置统一

    // 直接获取虚线的实际屏幕位置
    const indicatorRect = indicator.getBoundingClientRect();
    const referenceY = indicatorRect.top + indicatorRect.height / 2;

    const lines = lyricContent.children;
    let overlapIndex = -1;
    let closestIndex = -1;
    let minDist = Infinity;

    // 遍历查找重叠或最近的歌词行
    // 改为纯几何碰撞检测，比 elementFromPoint 更可靠
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const rect = line.getBoundingClientRect();

        // 1. 检查是否重叠 (Green line inside the rect)
        if (referenceY >= rect.top && referenceY <= rect.bottom) {
            overlapIndex = i;
        }

        // 2. 检查距离 (Fallback)
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - referenceY);
        if (dist < minDist) {
            minDist = dist;
            closestIndex = i;
        }
    }

    // 优先使用重叠的行，其次使用距离最近的行
    const targetIndex = overlapIndex !== -1 ? overlapIndex : closestIndex;

    let targetTime = 0;
    if (targetIndex !== -1 && lines[targetIndex]) {
        targetTime = parseFloat(lines[targetIndex].dataset.time) / 1000;
    }

    // 高亮对应的歌词行
    for (let i = 0; i < lines.length; i++) {
        if (i === targetIndex) {
            lines[i].classList.add('scroll-target');
        } else {
            lines[i].classList.remove('scroll-target');
        }
    }

    // 更新时间显示
    const timeDisplay = indicator.querySelector('.time-display');
    if (timeDisplay && targetTime > 0) {
        const minutes = Math.floor(targetTime / 60);
        const seconds = Math.floor(targetTime % 60);
        timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// renderLyric function - generates DOM elements for each lyric line
function renderLyric(lines, emptyMsg = '暂无歌词') {
    const container = document.getElementById('lyric-content');
    container.innerHTML = '';

    if (lines.length === 0) {
        container.innerHTML = `<p class="t-text-muted text-lg font-medium">${emptyMsg}</p>`;
        return;
    }

    // 根据设置决定是否开启荧光效果
    if (settings.enableLyricGlow !== false) {
        container.classList.add('enable-lyric-glow');
    } else {
        container.classList.remove('enable-lyric-glow');
    }

    // Create fragment for better performance
    const frag = document.createDocumentFragment();

    lines.forEach((line, idx) => {
        const div = document.createElement('div');
        div.className = `lyric-line relative py-2 px-1 text-center md:text-left transition-all duration-300`;
        div.dataset.time = line.time;
        div.dataset.index = idx;

        // Click to seek
        div.onclick = () => {
            // line.time 是毫秒，audio.currentTime 需要秒
            audio.currentTime = line.time / 1000;

            // 立即更新 UI 高亮和位置，提供即时反馈
            syncLyricByLineNum(idx);
            scrollToActiveLine(true);

            // 解除滚动锁定
            isUserScrolling = false;
            if (scrollLockTimeout) {
                clearTimeout(scrollLockTimeout);
                scrollLockTimeout = null;
            }

            // 隐藏指示器
            const indicator = document.getElementById('lyric-scroll-indicator');
            if (indicator) {
                indicator.classList.add('hidden');
                indicator.style.display = 'none';
            }

            // [Fix] 清除所有的高亮样式 (scroll-target)
            const allLines = document.querySelectorAll('.lyric-line');
            allLines.forEach(l => l.classList.remove('scroll-target'));


        };

        // Inner content wrapper
        const contentDiv = document.createElement('div');
        contentDiv.className = 'line-content';

        // Main lyric text
        const span = document.createElement('span');
        span.className = 'font-lrc text-gray-500 transition-all block w-fit mx-auto md:ml-0';

        if (line.words && line.words.length > 0) {
            div.classList.add('has-words');
            line.words.forEach(word => {
                const wordSpan = document.createElement('span');
                wordSpan.className = 'word-item';
                wordSpan.textContent = word.text;
                wordSpan.dataset.start = word.startTime;
                wordSpan.dataset.duration = word.duration;
                span.appendChild(wordSpan);
            });
        } else {
            span.textContent = line.text;
            span.classList.add('plain-lyric');
        }

        contentDiv.appendChild(span);

        // Extended Lyrics (Translation, Romanization, etc.)
        if (line.extendedLyrics && line.extendedLyrics.length > 0) {
            line.extendedLyrics.forEach(extText => {
                if (!extText) return;
                const extSpan = document.createElement('span');
                extSpan.className = 'extended t-text-muted block w-fit mx-auto md:ml-0';

                // 逐字/逐字符拆分：中日韩按字符，其他按空格
                const hasCJK = /[\u4e00-\u9fa5]|[\u3040-\u309f]|[\u30a0-\u30ff]/.test(extText);
                const segments = hasCJK ? extText.split('') : extText.split(/(\s+)/).filter(s => s.length > 0);

                segments.forEach(seg => {
                    const s = document.createElement('span');
                    s.className = 'ext-item';
                    s.textContent = seg;
                    extSpan.appendChild(s);
                });

                contentDiv.appendChild(extSpan);
            });
        }

        div.appendChild(contentDiv);
        frag.appendChild(div);
    });

    container.appendChild(frag);

    // [Fix] Ensure we are in auto-scroll mode and centered on load
    isUserScrolling = false;

    // If audio is already playing, sync the player immediately to highlight the right line
    if (lyricPlayer && !audio.paused) {
        lyricPlayer.play(audio.currentTime * 1000);
    }

    // Force a scroll update after a short delay to ensure layout is ready
    setTimeout(() => {
        scrollToActiveLine(true);
    }, 100);
}


// ============================================================================
// 歌词处理 (Lyrics Processing)
// ============================================================================
// syncLyric removed - LinePlayer handles all syncing via syncLyricByLineNum callback
// Audio timeupdate listener removed - LinePlayer automatically syncs lyrics

// Hook into updatePlayerInfo to update detail view and lyrics
const _originalUpdatePlayerInfo = updatePlayerInfo;
updatePlayerInfo = function (song) {
    _originalUpdatePlayerInfo(song);
    // Detail View update
    updateDetailInfo(song);
    // fetchLyric(song); // [Moved] 移至 playSong 中精确控制时机
};

window.toggleLyrics = toggleLyrics;

// Initial

// [收藏与列表已提取到 js/favorites-lists.js]

// [DOMContentLoaded 合并到文件底部统一初始化]  // Auto-restore


// ========================================
// 导出函数到 window (ES Module 需要显式暴露)
// ========================================

// Custom Source functions (已提取到 js/custom-source.js)

// Custom Source aliases (已提取到 js/custom-source.js)

// Core functions
window.switchTab = switchTab;
window.handleSearchKeyPress = handleSearchKeyPress;
window.doSearch = doSearch;
window.changePage = changePage;
window.handleHotSearchClick = handleHotSearchClick;
window.playSong = playSong;
window.togglePlay = togglePlay;
window.handleDownloadClick = handleDownloadClick;
window.playNext = playNext;
window.playPrev = playPrev;
window.seek = seek;
window.changeQualityPreference = changeQualityPreference;
window.changeProxyPlayback = changeProxyPlayback;
window.changeProxyDownload = changeProxyDownload;
window.changeLyricFontSize = changeLyricFontSize;

// Volume
window.setVolume = setVolume;
window.toggleMute = toggleMute;
window.setPlayMode = setPlayMode;

// Lyrics (already exported above at L2118)

// Favorites & Lists (已提取到 js/favorites-lists.js)

// Sync functions (已提取到 js/favorites-lists.js)

// Comment functions (已提取到 js/comments.js)


// [自定义源管理已提取到 js/custom-source.js]

/**
 * 播放栏下载/缓存按钮点击处理
 */
async function handleDownloadClick(event) {
    if (event) event.stopPropagation();

    if (!currentPlayingSong) {
        showInfo('当前没有正在播放的歌曲');
        return;
    }

    const song = currentPlayingSong;
    const options = ['浏览器下载', '缓存到服务器'];
    const selected = await showOptions('下载与缓存', `选择对 [${song.name}] 的操作：`, options);

    if (selected === '浏览器下载') {
        if (typeof downloadSong === 'function') {
            downloadSong(song, null, false, '浏览器下载');
        } else {
            showError('下载功能未就绪');
        }
    } else if (selected === '缓存到服务器') {
        // [新增] 权限校验：受限公开用户需要验证管理员
        const isPublic = !window.currentListData?.username || window.currentListData?.username === 'default';
        const enablePublicRestriction = window.lx_config?.['user.enablePublicRestriction'];
        const isAdmin = !!localStorage.getItem('lx_admin_password');
        const isServerCacheAllowed = window.settings?.enableServerCache === true;

        if (isPublic && enablePublicRestriction && !isServerCacheAllowed && !isAdmin) {
            showError('权限限制：缓存到服务器需要验证管理员。');
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('缓存到服务器需要验证管理员身份');
                if (!authorized) return;
            } else {
                return;
            }
        }

        if (typeof downloadSong === 'function') {
            downloadSong(song, null, false, '缓存到服务器');
        } else {
            showError('服务器缓存逻辑未就绪');
        }
    }
}

// [Toast/Dialog 函数已提取到 js/toast-dialog.js]


// [Sleep Timer 函数已提取到 js/sleep-timer.js]

// 监听窗口大小变化
window.addEventListener('resize', () => {
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.dataset.positioned = '';
    }
});

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', () => {

    // 预加载自定义源数据，确保设置界面和模态框打开时有数据
    loadCustomSources();

    // 加载本地库来源列表，填充来源筛选下拉框
    if (typeof loadAvailableSources === 'function') {
        loadAvailableSources();
    }

    // [优化] 此处不再立即调用 showInitialSearchState()，移至下方的 setTimeout 中

    // [Fix] Listen to scroll event for real-time highlighting
    const lyricContainer = document.getElementById('lyric-container');
    if (lyricContainer) {
        // Core user interaction detection
        // 只有当用户真的 "摸" 了或者是 "滑" 了，才认为是用户滚动
        // 纯 scroll 事件会被 scrollTo 触发，所以不能仅依赖 scroll 事件来 *启动* 手动模式
        const setUserInteracting = () => {
            // 强制清除程序滚动标记，因为用户干预了
            isProgrammaticScroll = false;
            if (window.programmaticScrollTimer) {
                clearTimeout(window.programmaticScrollTimer);
                window.programmaticScrollTimer = null;
            }
        };

        lyricContainer.addEventListener('mousedown', setUserInteracting, {passive: true});
        lyricContainer.addEventListener('touchstart', setUserInteracting, {passive: true});
        lyricContainer.addEventListener('touchmove', setUserInteracting, {passive: true});
        lyricContainer.addEventListener('wheel', setUserInteracting, {passive: true});
        lyricContainer.addEventListener('keydown', setUserInteracting, {passive: true}); // Keyboard arrow keys

        // 使用 passive: true 提高滚动性能
        lyricContainer.addEventListener('scroll', handleLyricScroll, {passive: true});
    }

    // [优化] 延迟执行非关键初始化逻辑（设置恢复、状态重置、自动登录等）
    // 允许浏览器先完成主要的渲染和 load 事件，释放 PWA 安装按钮并显示刷新图标
    setTimeout(() => {
        restorePlaybackState();

        // [UPNP] Restore cast device connection after page refresh
        setTimeout(() => {
            restoreUpnpConnection();
        }, 2000); // Delay to allow UPNP scan to find devices first

        // [新增] 延迟显示热搜，避免启动请求堆积
        if (typeof showInitialSearchState === 'function') {
            showInitialSearchState();
        }

        // 监听源切换，自动刷新热搜
        const searchSourceSelect = document.getElementById('search-source');
        if (searchSourceSelect) {
            searchSourceSelect.addEventListener('change', () => {
                const searchInput = document.getElementById('search-input');
                // 仅当搜索框为空（即处于显示热搜状态）时刷新
                if (!searchInput || !searchInput.value.trim()) {
                    showInitialSearchState();
                }
            });
        }

        // [Fix] Auto-Login logic (Restore Session)
        const savedMode = localStorage.getItem('lx_sync_mode');
        if (savedMode === 'local') {
            const u = localStorage.getItem('lx_sync_user');
            const p = localStorage.getItem('lx_sync_pass');
            if (u && p) {
                // [优化] 如果已经有有效的 Token，不再重复登录
                if (userToken) {
                    return;
                }
                // 直接调用登录函数，无需表单元素
                handleDialogLogin(u, p);
            }
        } else if (savedMode === 'remote') {
            const url = localStorage.getItem('lx_sync_url');
            const code = localStorage.getItem('lx_sync_code');
            if (url && code) {
                // Fill UI
                const remoteUrlInput = document.getElementById('sync-remote-url');
                const remoteStep1 = document.getElementById('sync-remote-step1');
                const remoteStep2 = document.getElementById('sync-remote-step2');
                const remoteCodeInput = document.getElementById('sync-remote-code');

                if (remoteUrlInput) remoteUrlInput.value = url;
                if (remoteStep1) remoteStep1.classList.add('hidden');
                if (remoteStep2) remoteStep2.classList.remove('hidden');
                if (remoteCodeInput) remoteCodeInput.value = code;

                // Trigger connect
                handleRemoteConnect();
            }
        }
    }, 100);

    // [New] 长按播放键隐藏播放栏内容 (精简模式)
    const btnPlay = document.getElementById('btn-play');
    if (btnPlay) {
        let pressTimer;
        const infoEl = document.getElementById('player-song-info');

        const startPress = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return; // 仅限左键
            window.playBtnIsLongPress = false;
            pressTimer = setTimeout(() => {
                window.playBtnIsLongPress = true;
                if (navigator.vibrate) navigator.vibrate(50);

                if (infoEl) {
                    const isHidden = infoEl.style.display === 'none';
                    window.setCompactPlaybar(!isHidden, true);
                }
            }, 600); // 600ms = 长按
        };

        const cancelPress = () => {
            if (pressTimer) clearTimeout(pressTimer);
        };

        // 事件绑定
        btnPlay.addEventListener('mousedown', startPress);
        btnPlay.addEventListener('touchstart', startPress, {passive: true});
        btnPlay.addEventListener('mouseup', cancelPress);
        btnPlay.addEventListener('touchend', cancelPress);
        btnPlay.addEventListener('mouseleave', cancelPress);
        btnPlay.addEventListener('touchcancel', cancelPress);
    }
});

// ========================================
// Global Overrides
// ========================================

// Override batch_pagination.js helper to access local currentSearchScope
window.getCurrentActiveListId = function () {
    if (currentSearchScope === 'local_list') return window.currentViewingListId;
    if (currentSearchScope === 'local_all') return 'love';
    return null;
};


// ========================================
// Mobile Optimization Logic
// ========================================

// Mobile Sidebar Toggle
function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        backdrop.classList.remove('hidden');
    } else {
        // Close
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
    }
}

window.toggleSidebar = toggleSidebar;

// Sidebar Collapse Toggle (Desktop: shrink to icon column)
let _sidebarCollapsed = localStorage.getItem('lx_sidebar_collapsed') === 'true';
Object.defineProperty(window, '_sidebarCollapsed', { get() { return _sidebarCollapsed; }, set(v) { _sidebarCollapsed = v; }, configurable: true });

function toggleSidebarCollapse() {
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) return;

    _sidebarCollapsed = !_sidebarCollapsed;
    localStorage.setItem('lx_sidebar_collapsed', _sidebarCollapsed);
    applySidebarCollapse();
}

function applySidebarCollapse() {
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) return;

    if (_sidebarCollapsed) {
        sidebar.classList.add('sidebar-collapsed');
    } else {
        sidebar.classList.remove('sidebar-collapsed');
    }
}
window.applySidebarCollapse = applySidebarCollapse;

// ========== DOMContentLoaded 统一初始化（合并 #1, #2, #3, #5） ==========
document.addEventListener('DOMContentLoaded', () => {

    // 加载设置
    loadSettings();

    // 音质选择器初始化
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect && settings.preferredQuality) {
        qualitySelect.value = settings.preferredQuality;
    }

    // Initialize Proxy Settings UI
    const proxyPlayback = document.getElementById('toggle-proxy-playback');
    if (proxyPlayback) proxyPlayback.checked = settings.enableProxyPlayback;

    const proxyDownload = document.getElementById('toggle-proxy-download');
    if (proxyDownload) proxyDownload.checked = settings.enableProxyDownload;

    const autoProxy = document.getElementById('toggle-auto-proxy');
    if (autoProxy) autoProxy.checked = settings.enableAutoProxy;

    // Initialize Custom Proxy UI
    const customProxyToggle = document.getElementById('toggle-custom-proxy');
    if (customProxyToggle) customProxyToggle.checked = settings.enableCustomProxy;
    const customProxyInput = document.getElementById('custom-proxy-url-input');
    if (customProxyInput) customProxyInput.value = settings.customProxyUrl || '';
    const customProxyRow = document.getElementById('custom-proxy-url-row');
    if (customProxyRow) customProxyRow.classList.toggle('hidden', !settings.enableCustomProxy);

    const hotSearchLimitInput = document.getElementById('hot-search-limit-input');
    if (hotSearchLimitInput) {
        hotSearchLimitInput.value = (settings.hotSearchLimit !== undefined && settings.hotSearchLimit !== null) ? settings.hotSearchLimit : 20;
    }

    // Initialize SongList Manager
    if (window.SongListManager) {
        window.SongListManager.init();
    }

    // Initialize Lyric Font Size UI
    const lyricFontSizeSlider = document.getElementById('lyric-font-size-slider');
    const lyricFontSizeValue = document.getElementById('lyric-font-size-value');
    if (lyricFontSizeSlider && lyricFontSizeValue) {
        const size = settings.lyricFontSize || 1.25;
        lyricFontSizeSlider.value = size;
        lyricFontSizeValue.innerText = size;
        document.documentElement.style.setProperty('--lyric-font-size', `${size}rem`);
    }

    // Initialize Lyric Font Family UI
    const lyricFontFamilySelect = document.getElementById('lyric-font-family-select');
    if (lyricFontFamilySelect) {
        const fontFamily = settings.lyricFontFamily || '';
        if (fontFamily) {
            let exists = Array.from(lyricFontFamilySelect.options).some(opt => opt.value === fontFamily);
            if (!exists) {
                const option = document.createElement('option');
                option.value = fontFamily;
                option.textContent = fontFamily;
                lyricFontFamilySelect.add(option, null);
            }
            lyricFontFamilySelect.value = fontFamily;
            document.documentElement.style.setProperty('--lyric-font-family', fontFamily);
        }
    }

    // Initialize Progress & Volume Dragging
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.addEventListener('mousedown', (e) => startDragging(e, 'progress'));
        progressContainer.addEventListener('touchstart', (e) => startDragging(e, 'progress'), {passive: false});
    }

    const volumeContainer = document.getElementById('volume-container');
    if (volumeContainer) {
        volumeContainer.addEventListener('mousedown', (e) => startDragging(e, 'volume'));
        volumeContainer.addEventListener('touchstart', (e) => startDragging(e, 'volume'), {passive: false});
    }

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('touchmove', handleDragMove, {passive: false});
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    // 设置版本号
   /* if (window.CONFIG && window.CONFIG.version) {
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.innerText = window.CONFIG.version + ' Web';
        }
    }*/

    // 为展开按钮添加悬放恢复逻辑
    const expandBtn = document.getElementById('btn-expand-panel');
    if (expandBtn) {
        expandBtn.addEventListener('mouseenter', () => {
            if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
            expandBtn.classList.remove('faint');
        });
        expandBtn.addEventListener('mouseleave', () => {
            const footer = document.getElementById('player-footer');
            if (footer && footer.classList.contains('translate-y-[110%]')) {
                startExpandBtnTimer();
            }
        });
    }

    // 为歌词按钮添加悬停恢复逻辑
    const toggleLyricsBtn = document.getElementById('btn-toggle-lyrics');
    if (toggleLyricsBtn) {
        toggleLyricsBtn.addEventListener('mouseenter', () => {
            if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);
            toggleLyricsBtn.classList.remove('faint');
        });
        toggleLyricsBtn.addEventListener('mouseleave', () => {
            const view = document.getElementById('view-player-detail');
            if (view && !view.classList.contains('translate-y-[100%]')) {
                startToggleLyricsBtnTimer();
            }
        });
    }

    // 同步所有设置 UI
    syncSettingsUI();

    // 初始化播放列表虚拟滚动
    initQueueVirtualScroll();

    // Checkbox State
    const pubToggle = document.getElementById('toggle-public-sources');
    if (pubToggle) {
        pubToggle.checked = settings.enablePublicSources !== false;
    }

    // Update UI to match settings
    const selectEl = document.getElementById('items-per-page-select');
    if (selectEl && settings.itemsPerPage) {
        selectEl.value = settings.itemsPerPage.toString();
    }

    // 恢复音量设置
    try {
        const savedVolume = localStorage.getItem('lx_volume');
        if (savedVolume) {
            currentVolume = parseFloat(savedVolume);
            audio.volume = currentVolume;
            updateVolumeUI();
        }
    } catch (e) {
        console.error('[Volume] 恢复音量设置失败:', e);
    }

    // 恢复播放模式设置（优先从用户设置读取，兼容旧版 localStorage）
    try {
        const validModes = ['list', 'single', 'random', 'order'];
        const settingsMode = settings.playMode;
        const savedMode = localStorage.getItem('lx_play_mode');
        const mode = (settingsMode && validModes.includes(settingsMode))
            ? settingsMode
            : (savedMode && validModes.includes(savedMode) ? savedMode : 'order');
        playMode = mode;
        updatePlayModeUI();
    } catch (e) {
        console.error('[PlayMode] 恢复播放模式失败:', e);
    }

    // 应用侧边栏折叠状态
    applySidebarCollapse();

    // 加载首页作为默认视图
    if (typeof loadHomePage === 'function') {
        loadHomePage();
    }
});

// Auto-adjust layout on resize
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar && window.innerWidth >= 1025) {
        // Reset styles for desktop
        sidebar.classList.remove('-translate-x-full', 'translate-x-0');
        if (backdrop) backdrop.classList.add('hidden');
    } else if (sidebar) {
        // Ensure default closed state for mobile if not explicitly open
        if (!sidebar.classList.contains('translate-x-0')) {
            sidebar.classList.add('-translate-x-full');
        }
    }
});

// 切换详情页封面显示（移动端优化）
function toggleDetailCover() {
    const cover = document.getElementById('mobile-player-cover-container');
    const container = document.getElementById('player-detail-container');
    const lyricsWrapper = document.getElementById('lyrics-wrapper');
    const lyricContent = document.getElementById('lyric-content');
    const detailTitle = document.getElementById('detail-title');

    // 获取标题区域父容器
    const titleParent = lyricsWrapper ? lyricsWrapper.querySelector('div:first-child') : null;

    if (!cover || !container) return;

    // 根据 cover 的透明度状态判断当前是否隐藏
    const isHidden = cover.classList.contains('opacity-0');

    if (!isHidden) {
        // --- 隐藏封面 ---
        cover.style.display = 'none'; // 彻底移除渲染占位
        cover.classList.add('opacity-0', 'scale-90', 'border-0');

        // 隐藏封面时，不再需要那么大的 pt-8/md:pt-32。
        // 保留 md:pt-10 左右以避开顶部 Now Playing 即可，让歌词有更多纵向空间
        container.classList.remove('pt-8', 'mt-4', 'md:pt-0', 'md:pt-24');
        container.classList.add('pt-4', 'md:pt-10');

        if (lyricsWrapper) {
            lyricsWrapper.classList.remove('md:w-auto', 'md:max-w-[50%]', 'md:w-[500px]', 'lg:w-[600px]', 'flex-shrink-0');
            lyricsWrapper.classList.add('md:w-2/3', 'mx-auto', 'lyrics-centered');
            // 隐藏封面时允许歌词区域更高
            lyricsWrapper.style.maxHeight = '85vh';
        }

        if (lyricContent) {
            lyricContent.classList.remove('md:items-start', 'md:text-left', 'md:pl-6');
            lyricContent.classList.add('items-center', 'text-center');
        }

        if (titleParent) {
            titleParent.classList.remove('md:text-left', 'md:pl-6');
            titleParent.classList.add('text-center');
        }

        if (detailTitle) {
            detailTitle.classList.remove('md:mx-0');
            detailTitle.classList.add('mx-auto');
        }

        container.classList.add('has-centered-lyrics');

    } else {
        // --- 显示封面 ---
        cover.style.display = 'block'; // 恢复显示
        cover.classList.remove('opacity-0', 'scale-90', 'border-0');

        container.classList.remove('has-centered-lyrics');

        // 恢复当前使用的固定间距
        container.classList.add('gap-4', 'md:gap-20');
        container.classList.remove('pt-8', 'md:pt-32', 'md:pt-10'); // 移除纯歌词专用间距

        // 手机端恢复默认 pt
        if (window.innerWidth < 1025) {
            container.classList.add('pt-8', 'mt-4');
        }


        if (lyricsWrapper) {
            lyricsWrapper.classList.remove('md:w-auto', 'md:max-w-[50%]', 'md:w-2/3', 'mx-auto', 'lyrics-centered');
            // 锁定桌面端宽度，防止长短歌词导致封面抖动
            lyricsWrapper.classList.add('md:w-[500px]', 'lg:w-[600px]', 'flex-shrink-0');
            lyricsWrapper.style.maxHeight = ''; // 恢复默认值
        }

        if (lyricContent) {
            lyricContent.classList.add('items-center', 'md:items-start', 'text-center', 'md:text-left', 'md:pl-6');
        }

        if (titleParent) {
            titleParent.classList.add('text-center', 'md:text-left', 'md:pl-6');
        }

        if (detailTitle) {
            detailTitle.classList.add('md:mx-0');
        }
    }
}

// 启动展开按钮淡化计时器
function startExpandBtnTimer() {
    const expandBtn = document.getElementById('btn-expand-panel');
    if (!expandBtn) return;

    if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
    expandBtn.classList.remove('faint');

    expandBtnTimeout = setTimeout(() => {
        // 只有当播放栏仍处于隐藏状态时才淡化
        const footer = document.getElementById('player-footer');
        if (footer && footer.classList.contains('translate-y-[110%]')) {
            expandBtn.classList.add('faint');
        }
    }, 3000);
}

// 启动歌词按钮淡化计时器
function startToggleLyricsBtnTimer() {
    const toggleBtn = document.getElementById('btn-toggle-lyrics');
    if (!toggleBtn) return;

    if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);
    toggleBtn.classList.remove('faint');

    toggleLyricsBtnTimeout = setTimeout(() => {
        // 只有当歌词页面处于显示状态时才淡化
        const view = document.getElementById('view-player-detail');
        if (view && !view.classList.contains('translate-y-[100%]')) {
            toggleBtn.classList.add('faint');
        }
    }, 3000);
}

// 切换底部播放栏显示/隐藏 (移动端)
function togglePlayerPanel() {
    const footer = document.getElementById('player-footer');
    const expandBtn = document.getElementById('btn-expand-panel');
    const container = document.getElementById('player-detail-container');

    if (!footer || !expandBtn) return;

    // 检查是否已经隐藏 (通过 transform 判断)
    // 注意: Tailwind 的 translate-y-full 等同于 transform: translateY(100%)
    const isHidden = footer.classList.contains('translate-y-[110%]');

    const views = ['view-search', 'view-settings', 'view-favorites', 'view-about', 'main-sidebar', 'view-songlist', 'songlist-detail-view'];
    const playerDetail = document.getElementById('view-player-detail');
    const lyricsWrapper = document.getElementById('lyrics-wrapper');

    if (isHidden) {
        // 显示播放栏
        footer.classList.remove('translate-y-[110%]');
        footer.style.opacity = '1';
        footer.style.pointerEvents = 'auto';

        // 隐藏展开按钮
        expandBtn.classList.remove('translate-y-0', 'scale-100', 'opacity-100');
        expandBtn.classList.add('translate-y-20', 'scale-75', 'opacity-0');

        // 重置状态
        if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
        expandBtn.classList.remove('faint');

        // 恢复内容底部 Padding
        views.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('pb-32', 'pb-44', 'md:pb-32');
                el.classList.add('pb-44', 'md:pb-32');
            }
        });

        // 歌词页: 增加底部 Padding (避开播放栏)
        if (playerDetail) {
            playerDetail.classList.add('pb-24');
            playerDetail.classList.remove('pb-0');
        }

        // 桌面端: 恢复 md:pt-0 (垂直居中, 无顶部Padding)
        if (container) {
            container.classList.remove('translate-y-12', 'opacity-80', 'scale-95');
            container.classList.remove('md:pt-24', 'md:pt-12');
            container.classList.add('md:pt-0');
        }
    } else {
        // 隐藏播放栏 (向下移出屏幕)
        footer.classList.add('translate-y-[110%]');
        footer.style.opacity = '0';
        footer.style.pointerEvents = 'none';

        // 停止动画并清除可视化画布，防止在偏移后仍有残留渲染
        if (window.musicVisualizer && window.musicVisualizer.clear) {
            window.musicVisualizer.clear('footer');
        }
        setTimeout(() => {
            expandBtn.classList.remove('translate-y-20', 'scale-75', 'opacity-0');
            expandBtn.classList.add('translate-y-0', 'scale-100', 'opacity-100');
        }, 300);

        // 开启 3s 自动淡化计时器
        startExpandBtnTimer();

        // 移除内容底部 Padding (内容延伸到底部)
        views.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('pb-32', 'pb-44', 'md:pb-32');
        });

        // 歌词页: 移除底部 Padding (利用底部空间)
        if (playerDetail) {
            playerDetail.classList.remove('pb-24');
            playerDetail.classList.add('pb-0');
        }

        // 桌面端: 移除 md:pt-0, 添加 md:pt-24 (避免遮挡顶部 NOW PLAYING)
        // 调整内容容器以填满全屏
        if (container) {
            container.classList.remove('md:pt-0');
            container.classList.add('md:pt-24');
            container.classList.add('translate-y-12', 'opacity-80', 'scale-95');
            // 稍后移除微调，保持丝滑
            setTimeout(() => {
                container.classList.remove('translate-y-12', 'opacity-80', 'scale-95');
            }, 600);
        }
    }

    // [New] 触发可视化模块更新布局 (Padding 处理)
    if (window.musicVisualizer) {
        window.musicVisualizer.applySettings();
    }

    // 重新校准歌词位置 (动画结束后执行)
    setTimeout(() => {
        scrollToActiveLine(true);
    }, 300);
}

// 导出函数
window.togglePlayerPanel = togglePlayerPanel;
window.updateSetting = updateSetting;

// 精简播放栏控制（长按播放键触发）
function setCompactPlaybar(compact, showToastMsg = false) {
    const infoEl = document.getElementById('player-song-info');
    const collapseBtn = document.getElementById('btn-collapse-panel');
    if (!infoEl) return;

    if (compact) {
        infoEl.style.display = 'none';
        if (collapseBtn) collapseBtn.style.display = 'none';
        if (showToastMsg) showToast('info', '已开启精简播放控制栏', 1500);
    } else {
        infoEl.style.display = '';
        if (collapseBtn) collapseBtn.style.display = '';
        if (showToastMsg) showToast('info', '已恢复完整播放栏控制', 1500);
    }

    // 重新计算并应用底栏自适应布局高度 (解决手机端 Footer 高度重叠)
    if (window.musicVisualizer && window.musicVisualizer.applySettings) {
        setTimeout(() => window.musicVisualizer.applySettings(), 50);
    }
}
window.setCompactPlaybar = setCompactPlaybar;

// Initialize Sound Effects on first play/click
function initAudioEngine() {
    if (window.soundEffects && !window._audioEngineInited) {
        window.soundEffects.init();
        window._audioEngineInited = true;

        // Ensure Visualizer captures correct source
        if (window.musicVisualizer && window.musicVisualizer.init) {
            window.musicVisualizer.init();
        }

        // 如果侧边栏 VU 表已开启，启动渲染
        if (settings.showSidebarVU && window.VUMeterController) {
            window.VUMeterController.start();
        }

        // iOS: 在用户手势上下文中立即启动 anchor audio，建立后台音频会话
        if (window.iOSBackgroundAudio) {
            window.iOSBackgroundAudio.ensureAnchorPlaying();
        }
    }
}

// Intercept play for audio engine init
const originalTogglePlay = window.togglePlay;
window.togglePlay = function () {
    initAudioEngine();
    if (originalTogglePlay) originalTogglePlay();
};

document.addEventListener('click', initAudioEngine, {once: true});

// [搜索建议已提取到 js/search.js]

// [Token 管理已提取到 js/token-manager.js]

// [DLNA投屏已提取到 js/dlna-cast.js]

// [专辑补全功能已提取到 js/album-complete.js]

// [本地库管理已提取到 js/local-library.js]
