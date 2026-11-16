/**
 * Folder Library - 文件夹浏览模块
 * 提供本地库目录树浏览 + 叶子目录歌曲列表功能
 *
 * 依赖: utils.js, pagination-factory.js, favorites-lists.js
 * @module FolderLib
 */

// ============================================================================
// 状态变量 (State Variables)
// ============================================================================

// 树形数据: 每个节点 { name, path, relPath, hasSubDirs, children:[]|null }
let _folderTree = null;
let _folderTreeLoaded = false;
let _folderSelectedPath = null;      // 当前选中目录绝对路径
let _folderSelectedRelPath = null;    // 当前选中目录相对路径
let _folderSelectedName = '';         // 当前选中目录名

// 歌曲列表状态
let _folderSongsList = [];
let _folderSongsPage = 1;
let _folderSongsPageSize = 30;
let _folderSongsTotal = 0;
let _folderSongsTotalPages = 0;
let _folderSongsTotalInDb = 0;
let _folderSongsTotalNotInDb = 0;
let _folderSongsOrder = 'desc';
let _folderSongsSearch = '';
let _folderSongsSearchDebounce = null;

// 目录信息条状态
let _folderCover = '';           // 目录封面 relativePath (后端检测)
let _folderTotalDuration = 0;    // 已入库歌曲总时长(秒)

// 展开状态 (持久化展开的绝对路径集合)
let _folderExpandedPaths = new Set();

// ============================================================================
// 树形数据加载 (Tree Loading)
// ============================================================================

/** 加载文件夹树 (首次加载或刷新) */
async function loadFolderTree(forceReload = false) {
    if (_folderTreeLoaded && !forceReload) return;

    const treeEl = document.getElementById('folderlib-tree');
    if (!treeEl) return;

    treeEl.innerHTML = '<div class="flex flex-col items-center justify-center py-10 t-text-muted"><i class="fas fa-folder-tree text-3xl mb-3 opacity-20"></i><p class="text-xs animate-pulse">加载中...</p></div>';

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch('/api/music/local/browse', { headers });
        const result = await res.json();

        if (result.code !== 0) {
            treeEl.innerHTML = `<div class="flex flex-col items-center justify-center py-10 t-text-muted">
                <i class="fas fa-exclamation-circle text-2xl mb-3 opacity-40"></i>
                <p class="text-xs">${escapeHtml(result.msg || '加载失败')}</p>
            </div>`;
            return;
        }

        const { roots } = result.data;

        // 过滤文件系统根，只显示设置->本地库中添加的目录 (文件夹视图不展示 "/")
        const libRoots = (roots || []).filter(r => !r.isFsRoot);

        if (!libRoots || libRoots.length === 0) {
            treeEl.innerHTML = `<div class="flex flex-col items-center justify-center py-10 t-text-muted">
                <i class="fas fa-folder-open text-3xl mb-3 opacity-20"></i>
                <p class="text-xs font-medium">暂无浏览目录</p>
                <p class="text-[10px] mt-1 opacity-70">请先在设置中添加本地库</p>
            </div>`;
            _folderTreeLoaded = true;
            return;
        }

        // 构建树形数据: 顶层为各已添加的本地库，进入库后懒加载子目录
        _folderTree = {
            name: '文件系统',
            path: '',
            relPath: '',
            hasSubDirs: true,
            children: libRoots.map((r, idx) => {
                const rootNode = {
                    name: r.name,
                    path: r.path,
                    relPath: r.name,
                    hasSubDirs: true,
                    children: null,  // 懒加载
                };
                // 单库场景: 预加载该库的子目录并展开 (保持旧版体验；directories 是文件系统根的内容，不可直接复用)
                if (idx === 0 && libRoots.length === 1) {
                    fetchFolderChildren(rootNode).then(children => {
                        rootNode.children = children;
                        renderFolderTree();
                    });
                    _folderExpandedPaths.add(r.path);
                }
                return rootNode;
            })
        };

        _folderTreeLoaded = true;
        renderFolderTree();
    } catch (err) {
        console.error('[FolderLib] Failed to load tree:', err);
        treeEl.innerHTML = `<div class="flex flex-col items-center justify-center py-10 t-text-muted">
            <i class="fas fa-exclamation-circle text-2xl mb-3 opacity-40"></i>
            <p class="text-xs">加载失败: ${escapeHtml(err.message)}</p>
        </div>`;
    }
}

/** 刷新文件夹库 (强制重新加载) */
function refreshFolderLib() {
    _folderTreeLoaded = false;
    _folderExpandedPaths.clear();
    _folderSelectedPath = null;
    _folderSelectedRelPath = null;
    _folderSelectedName = '';
    _folderSongsList = [];
    _folderCover = '';
    _folderTotalDuration = 0;
    loadFolderTree(true);
    // 清空右侧
    const listEl = document.getElementById('folderlib-list');
    if (listEl) {
        listEl.innerHTML = '<div class="flex flex-col items-center justify-center py-20 t-text-muted"><i class="fas fa-hand-pointer text-5xl mb-4 opacity-20"></i><p class="text-sm font-medium">请选择左侧文件夹查看歌曲</p></div>';
    }
    const paginationEl = document.getElementById('folderlib-pagination');
    if (paginationEl) paginationEl.classList.add('hidden');
    // 隐藏目录信息条
    const headerEl = document.getElementById('folderlib-detail-header');
    if (headerEl) headerEl.classList.add('hidden');
    updateFolderToolbar();
}

window.refreshFolderLib = refreshFolderLib;

// ============================================================================
// 目录信息条渲染 (Folder Detail Header)
// ============================================================================

/** 渲染目录信息条 (封面 + 目录名 + 统计信息) */
function renderFolderDetailHeader() {
    const headerEl = document.getElementById('folderlib-detail-header');
    if (!headerEl) return;

    // 未选中目录时隐藏
    if (!_folderSelectedPath) {
        headerEl.classList.add('hidden');
        return;
    }
    headerEl.classList.remove('hidden');

    // 渲染封面
    const coverImg = document.getElementById('folderlib-detail-cover');
    const coverPlaceholder = document.getElementById('folderlib-detail-cover-placeholder');
    let coverUrl = '';

    if (_folderCover) {
        // 后端检测到的目录封面文件
        coverUrl = buildCoverUrl(_folderCover, 'local');
    } else if (_folderSongsList.length > 0) {
        // 降级: 取第一首有 img 的歌曲封面
        const songWithCover = _folderSongsList.find(s => s.img && s.img.startsWith('http'));
        if (songWithCover) {
            coverUrl = songWithCover.img;
        } else {
            const songWithRelPath = _folderSongsList.find(s => s.relativePath);
            if (songWithRelPath) {
                coverUrl = buildCoverUrl(songWithRelPath.relativePath, songWithRelPath.source || 'local');
            }
        }
    }

    if (coverUrl && coverImg && coverPlaceholder) {
        coverImg.src = coverUrl;
        coverImg.classList.remove('hidden');
        coverPlaceholder.classList.add('hidden');
    } else if (coverImg && coverPlaceholder) {
        coverImg.classList.add('hidden');
        coverImg.removeAttribute('src');
        coverPlaceholder.classList.remove('hidden');
    }

    // 渲染目录名
    const nameEl = document.getElementById('folderlib-detail-name');
    if (nameEl) nameEl.textContent = _folderSelectedName || _folderSelectedRelPath || '未知目录';

    // 渲染统计信息
    const statsEl = document.getElementById('folderlib-detail-stats');
    if (statsEl) {
        const items = [];
        items.push(`<span><i class="fas fa-music text-[10px] mr-1"></i>${_folderSongsTotal} 首</span>`);
        if (_folderSongsTotalInDb !== undefined && _folderSongsTotal > 0) {
            items.push(`<span><i class="fas fa-database text-[10px] mr-1"></i>${_folderSongsTotalInDb} 已入库</span>`);
            // 全部入库徽标: 已入库数 == 总数
            if (_folderSongsTotalInDb === _folderSongsTotal) {
                items.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-bold border border-emerald-200 dark:border-emerald-500/30"><i class="fas fa-check-circle text-[9px]"></i>全部入库</span>`);
            }
        }
        if (_folderTotalDuration > 0) {
            items.push(`<span><i class="fas fa-clock text-[10px] mr-1"></i>${formatDuration(_folderTotalDuration)}</span>`);
        }
        statsEl.innerHTML = items.join('');
    }
}

// ============================================================================
// 树形渲染 (Tree Rendering)
// ============================================================================

/** 渲染整个文件夹树 */
function renderFolderTree() {
    const treeEl = document.getElementById('folderlib-tree');
    if (!treeEl || !_folderTree) return;

    treeEl.innerHTML = _folderTree.children.map(node => renderTreeNode(node, 0)).join('');
}

/** 渲染单个树节点 (递归) */
function renderTreeNode(node, depth) {
    const isExpanded = _folderExpandedPaths.has(node.path);
    const isSelected = _folderSelectedPath === node.path;
    const indent = depth * 16; // 16px 缩进

    const selectedClass = isSelected
        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-2 border-emerald-500'
        : 'border-l-2 border-transparent';
    const hoverClass = 'hover:bg-gray-100 dark:hover:bg-gray-700/40';

    const arrowIcon = node.hasSubDirs
        ? `<i class="fas fa-chevron-right text-[9px] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''} text-gray-400 flex-shrink-0 w-3"></i>`
        : `<span class="w-3 flex-shrink-0"></span>`;

    const folderIcon = isExpanded
        ? '<i class="fas fa-folder-open text-amber-500 text-xs flex-shrink-0"></i>'
        : '<i class="fas fa-folder text-amber-500 text-xs flex-shrink-0"></i>';

    // 子节点 (仅展开时渲染)
    let childrenHtml = '';
    if (isExpanded && node.children && node.children.length > 0) {
        childrenHtml = `<div class="folder-tree-children">${node.children.map(child => renderTreeNode(child, depth + 1)).join('')}</div>`;
    } else if (isExpanded && node.children === null && node.hasSubDirs) {
        // 正在加载子节点
        childrenHtml = `<div class="folder-tree-children" style="padding-left:${indent + 16}px">
            <div class="flex items-center gap-2 py-1.5 px-2 t-text-muted">
                <i class="fas fa-spinner fa-spin text-[10px]"></i>
                <span class="text-[10px]">加载中...</span>
            </div>
        </div>`;
    }

    return `<div class="folder-tree-node">
        <div class="folder-tree-label flex items-center gap-1.5 py-1.5 px-2 rounded-lg cursor-pointer transition-all duration-150 ${selectedClass} ${hoverClass} group"
             style="padding-left:${indent + 8}px"
             data-path="${escapeHtml(node.path)}"
             data-rel="${escapeHtml(node.relPath)}"
             data-has-sub="${node.hasSubDirs}"
             onclick="handleFolderNodeClick(this, event)">
            ${arrowIcon}
            ${folderIcon}
            <span class="text-xs truncate flex-1 ${isSelected ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 't-text-main'}">${escapeHtml(node.name)}</span>
        </div>
        ${childrenHtml}
    </div>`;
}

/** 处理树节点点击 */
async function handleFolderNodeClick(el, event) {
    event.stopPropagation();
    const absPath = el.dataset.path;
    const relPath = el.dataset.rel;
    const hasSubDirs = el.dataset.hasSub === 'true';

    if (hasSubDirs) {
        // 有子目录: 展开/折叠
        await toggleFolderNode(absPath, relPath);
    }

    // 无论是否有子目录，都选中该目录并查询歌曲
    selectFolder(absPath, relPath, absPath.split('/').pop() || relPath.split('/').pop() || '');
}

window.handleFolderNodeClick = handleFolderNodeClick;

/** 懒加载某目录的子目录列表 (返回树节点数组) */
async function fetchFolderChildren(parentNode) {
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`/api/music/local/browse?path=${encodeURIComponent(parentNode.path)}`, { headers });
        const result = await res.json();
        if (result.code === 0 && result.data.directories) {
            return result.data.directories.map(d => ({
                name: d.name,
                path: d.path,
                relPath: parentNode.relPath ? `${parentNode.relPath}/${d.name}` : d.name,
                hasSubDirs: d.hasSubDirs,
                children: null,
            }));
        }
    } catch (err) {
        console.error('[FolderLib] Failed to load subdirs:', err);
    }
    return [];
}

/** 展开/折叠目录节点 (懒加载子目录) */
async function toggleFolderNode(absPath, relPath) {
    const isExpanded = _folderExpandedPaths.has(absPath);

    if (isExpanded) {
        // 折叠
        _folderExpandedPaths.delete(absPath);
        renderFolderTree();
        return;
    }

    // 展开: 总是重新拉取子目录 (服务端实时读取文件系统，避免本地库新增目录被缓存遮蔽)
    const node = findNodeByPath(_folderTree, absPath);
    _folderExpandedPaths.add(absPath);
    renderFolderTree(); // 先渲染 loading 状态

    if (node) {
        node.children = await fetchFolderChildren(node);
    }

    renderFolderTree();
}

/** 刷新文件夹树 (保留展开/选中状态，重新拉取已展开目录的子目录；树未加载时强制重载) */
async function refreshFolderTree() {
    if (!_folderTree || !_folderTreeLoaded) {
        loadFolderTree(true);
        return;
    }
    const expandedPaths = [..._folderExpandedPaths];
    await Promise.all(expandedPaths.map(async (absPath) => {
        const node = findNodeByPath(_folderTree, absPath);
        if (node) node.children = await fetchFolderChildren(node);
    }));
    renderFolderTree();
}

window.refreshFolderTree = refreshFolderTree;

/** 在树中按绝对路径查找节点 */
function findNodeByPath(tree, absPath) {
    if (!tree) return null;
    if (tree.path === absPath) return tree;
    if (tree.children) {
        for (const child of tree.children) {
            const found = findNodeByPath(child, absPath);
            if (found) return found;
        }
    }
    return null;
}

// ============================================================================
// 目录选中与歌曲加载 (Folder Selection & Song Loading)
// ============================================================================

/** 选中目录，加载右侧歌曲列表 */
function selectFolder(absPath, relPath, name) {
    _folderSelectedPath = absPath;
    _folderSelectedRelPath = relPath;
    _folderSelectedName = name;
    _folderSongsPage = 1;
    _folderSongsSearch = '';

    const searchInput = document.getElementById('folderlib-search-input');
    if (searchInput) searchInput.value = '';

    updateFolderToolbar();
    renderFolderTree(); // 重新渲染以高亮选中状态
    // 显示目录信息条 (封面在 loadFolderSongs 后更新)
    const headerEl = document.getElementById('folderlib-detail-header');
    if (headerEl) headerEl.classList.remove('hidden');
    renderFolderDetailHeader();
    loadFolderSongs();
}

/** 加载当前选中目录的歌曲 (分页)；未选中目录时改为刷新目录树 (新增目录场景) */
async function loadFolderSongs() {
    const listEl = document.getElementById('folderlib-list');
    if (!listEl) return;

    if (!_folderSelectedPath) {
        await refreshFolderTree();
        return;
    }

    listEl.innerHTML = '<div class="flex flex-col items-center justify-center py-20 t-text-muted"><i class="fas fa-spinner fa-spin text-3xl mb-4 opacity-30"></i><p class="text-xs animate-pulse">加载中...</p></div>';

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const sortSelect = document.getElementById('folderlib-sort-select');
        const sort = sortSelect ? sortSelect.value : 'mtime';

        const params = new URLSearchParams({
            path: _folderSelectedPath,
            page: _folderSongsPage,
            pageSize: _folderSongsPageSize,
            sort: sort,
            order: _folderSongsOrder,
        });
        if (_folderSongsSearch) {
            params.set('search', _folderSongsSearch);
        }

        const res = await fetch(`/api/music/local/folder-songs?${params}`, { headers });
        const result = await res.json();

        if (result.code !== 0) {
            listEl.innerHTML = `<div class="flex flex-col items-center justify-center py-20 t-text-muted">
                <i class="fas fa-exclamation-circle text-3xl mb-4 opacity-30"></i>
                <p class="text-sm">${escapeHtml(result.msg || '加载失败')}</p>
            </div>`;
            updateFolderPagination();
            return;
        }

        const { data, total, totalPages, totalInDb, totalNotInDb, folderCover, totalDuration } = result.data;
        _folderSongsList = data || [];
        _folderSongsTotal = total || 0;
        _folderSongsTotalPages = totalPages || 0;
        _folderSongsTotalInDb = totalInDb || 0;
        _folderSongsTotalNotInDb = totalNotInDb || 0;
        _folderCover = folderCover || '';
        _folderTotalDuration = totalDuration || 0;

        renderFolderSongList();
        renderFolderDetailHeader();
        updateFolderPagination();
        updateFolderToolbar();
    } catch (err) {
        console.error('[FolderLib] Failed to load songs:', err);
        listEl.innerHTML = `<div class="flex flex-col items-center justify-center py-20 t-text-muted">
            <i class="fas fa-exclamation-circle text-3xl mb-4 opacity-30"></i>
            <p class="text-sm">加载失败: ${escapeHtml(err.message)}</p>
        </div>`;
    }
}

window.loadFolderTree = loadFolderTree;
window.loadFolderSongs = loadFolderSongs;

// ============================================================================
// 歌曲列表渲染 (Song List Rendering)
// ============================================================================

/** 渲染右侧歌曲列表 (复用 music-lib.js grid-cols-12 样式) */
function renderFolderSongList() {
    const listEl = document.getElementById('folderlib-list');
    if (!listEl) return;

    if (!_folderSongsList.length) {
        listEl.innerHTML = `<div class="flex flex-col items-center justify-center py-20 t-text-muted">
            <i class="fas fa-folder-open text-5xl mb-4 opacity-20"></i>
            <p class="text-sm font-medium">该文件夹下没有音频文件</p>
            <p class="text-[10px] mt-1 opacity-70">点击"添加到库"扫描此目录</p>
        </div>`;
        return;
    }

    const startIdx = (_folderSongsPage - 1) * _folderSongsPageSize;

    listEl.innerHTML = _folderSongsList.map((song, i) => {
        const globalIdx = startIdx + i;
        const displayIdx = globalIdx + 1;

        // 音质标签
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

        const sizeStr = song.size ? formatFileSize(song.size) : '';
        const durationStr = song.duration ? formatDuration(song.duration) : '--:--';

        // 音频元信息
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
        const activeTextClass = isActive ? 'text-emerald-600 dark:text-emerald-400' : '';
        const pathStr = song.relativePath || '';

        return `
            <div class="grid grid-cols-12 gap-2 md:gap-4 px-3 md:px-4 py-3 rounded-xl items-center transition-all duration-200 hover:t-bg-track group hover:shadow-sm hover:scale-[1.005] ${isActive ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 't-bg-item-hover'}">
                <div class="col-span-1 text-center flex items-center justify-center gap-1">
                    ${isActive ? (isActuallyPlaying ? '<div class="flex items-end justify-center gap-[2px] h-3.5"><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0s;height:40%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.15s;height:70%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.3s;height:50%"></span></div>' : '<i class="fas fa-pause text-[10px] text-emerald-500"></i>') : `<span class="text-xs t-text-muted font-mono">${displayIdx}</span>`}
                </div>
                <div class="col-span-5 md:col-span-5 flex items-center gap-2 min-w-0 relative group/songname cursor-pointer" onclick="playFolderSong(${i})">
                    <div class="relative w-10 h-10 flex-shrink-0">
                        ${coverUrl ? `<img src="${coverUrl}" alt="" loading="lazy" class="w-10 h-10 rounded object-cover transition-transform duration-200 group-hover/songname:scale-105 group-hover/songname:shadow-md" onerror="this.style.display='none'">` : `<div class="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-transform duration-200 group-hover/songname:scale-105"><i class="fas fa-music text-[11px] t-text-muted"></i></div>`}
                        <div class="absolute inset-0 bg-black/20 rounded hidden group-hover/songname:flex items-center justify-center transition-all">
                            <i class="fas fa-play text-white text-[10px]"></i>
                        </div>
                    </div>
                    <div class="flex flex-col min-w-0 flex-1">
                        <span class="truncate text-sm ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 't-text-main'} font-medium">${escapeHtml(song.name || 'Unknown')}</span>
                        <div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">
                            ${song.source ? getSourceTag(song.source) : ''}
                            ${qualityLabel ? `<span class="text-[9px] px-1.5 py-0.5 rounded ${qualityColorClass} font-bold flex-shrink-0">${qualityLabel}</span>` : ''}
                            ${song.inDb === false ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-500 dark:bg-orange-900/20 dark:text-orange-400 border border-orange-200 dark:border-orange-500/30 font-bold flex-shrink-0">未入库</span>` : ''}
                            ${audioMetaStr ? `<span class="text-[9px] t-text-muted truncate">${audioMetaStr}</span>` : ''}
                        </div>
                    </div>
                    ${pathStr ? `<div class="absolute left-0 top-full mt-1 z-50 hidden group-hover/songname:block px-2 py-1 rounded text-[11px] font-mono text-white bg-gray-800 dark:bg-gray-700 shadow-lg whitespace-nowrap max-w-[400px] truncate pointer-events-none">${escapeHtml(pathStr)}</div>` : ''}
                </div>
                <div class="hidden md:block md:col-span-2 truncate text-sm ${activeTextClass || 't-text-muted'} cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors" data-truncate-tooltip>${escapeHtml(song.singer || 'Unknown')}</div>
                <div class="hidden md:block md:col-span-2 truncate text-sm ${activeTextClass || 't-text-muted'} cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors" data-truncate-tooltip>${escapeHtml(song.album || '')}</div>
                <div class="col-span-2 md:col-span-1 text-center flex flex-col items-center">
                    <span class="text-xs ${activeTextClass || 't-text-muted'} font-mono tabular-nums">${durationStr}</span>
                    ${sizeStr ? `<span class="text-[9px] t-text-muted">${sizeStr}</span>` : ''}
                </div>
                <div class="col-span-4 md:col-span-1 text-right flex items-center justify-end gap-1">
                    <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-400 hover:text-blue-500 transition-all" title="编辑" onclick="event.stopPropagation(); openTagEditor(${i}, 'folderlib')">
                        <i class="fas fa-pen text-[10px]"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (typeof window._initTruncateTooltips === 'function') {
        window._initTruncateTooltips();
    }
}

// ============================================================================
// 播放控制 (Playback Control)
// ============================================================================

/** 播放文件夹中的单曲 */
function playFolderSong(pageIndex) {
    if (pageIndex < 0 || pageIndex >= _folderSongsList.length) return;
    const cachedSong = _folderSongsList[pageIndex];

    const song = Object.assign({}, cachedSong, {
        id: cachedSong.id || `folder_${pageIndex}`,
        _folderLibIndex: (_folderSongsPage - 1) * _folderSongsPageSize + pageIndex,
        _serverCachePath: cachedSong.relativePath,
        _isFolderLibSong: true,
    });

    // 设置播放列表为当前目录的歌曲
    currentPlaylist = _folderSongsList.map((s, idx) => {
        s._serverCachePath = s.relativePath;
        s._isFolderLibSong = true;
        return s;
    });

    if (playMode === 'random') resetShuffleState(pageIndex);

    currentPlayingScope = 'local_list';
    _currentAlbumIndex = -1;

    syncPlaylistToDmc(currentPlaylist, pageIndex, true);

    if (!_upnpActiveDeviceId || _castDeviceType !== 'upnp') {
        playSong(song, pageIndex, null, false, false, true);
    }
}

/** 播放当前目录全部歌曲 */
async function playAllFolder() {
    if (!_folderSongsTotal || !_folderSelectedPath) {
        if (typeof showInfo === 'function') showInfo('该目录下没有歌曲');
        return;
    }

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        // 获取该目录下全部歌曲
        const params = new URLSearchParams({
            path: _folderSelectedPath,
            page: 1,
            pageSize: 99999,
            sort: document.getElementById('folderlib-sort-select')?.value || 'mtime',
            order: _folderSongsOrder,
        });

        const res = await fetch(`/api/music/local/folder-songs?${params}`, { headers });
        const result = await res.json();

        if (result.code !== 0 || !result.data.data || !result.data.data.length) {
            if (typeof showInfo === 'function') showInfo('该目录下没有歌曲');
            return;
        }

        const allSongs = result.data.data;
        currentPlaylist = allSongs.map((s, i) => {
            s._serverCachePath = s.relativePath;
            s._isFolderLibSong = true;
            return s;
        });

        if (playMode === 'random') resetShuffleState(0);
        currentPlayingScope = 'local_list';
        _currentAlbumIndex = -1;

        syncPlaylistToDmc(currentPlaylist, 0, true);

        const firstSong = Object.assign({}, allSongs[0], {
            id: allSongs[0].id || 'folder_0',
            _folderLibIndex: 0,
            _serverCachePath: allSongs[0].relativePath,
            _isFolderLibSong: true,
        });

        if (!_upnpActiveDeviceId || _castDeviceType !== 'upnp') {
            playSong(firstSong, 0, null, false, false, true);
        }
    } catch (err) {
        console.error('[FolderLib] Play all failed:', err);
        if (typeof showError === 'function') showError('播放失败: ' + err.message);
    }
}

window.playFolderSong = playFolderSong;
window.playAllFolder = playAllFolder;

// ============================================================================
// 扫描当前目录 (Scan Current Folder)
// ============================================================================

/** 扫描当前选中的文件夹，将未入库的歌曲添加到本地库 */
async function scanCurrentFolder() {
    if (!_folderSelectedPath) {
        if (typeof showInfo === 'function') showInfo('请先选择一个文件夹');
        return;
    }

    // 弹出确认对话框
    const folderName = _folderSelectedName || _folderSelectedRelPath || '';
    const confirmed = await showSelect(
        '确认添加到库',
        `确定要扫描并添加目录「${folderName}」下的歌曲到本地库吗？`,
        { confirmText: '添加到库', confirmColor: 'bg-blue-500' }
    );
    if (!confirmed) return;

    try {
        const headers = {};
        Object.assign(headers, {'Content-Type': 'application/json'}, getUserAuthHeaders());

        const res = await fetch('/api/music/local/scan-folder', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ path: _folderSelectedPath })
        });
        const json = await res.json();

        if (json.code === 0 && json.data?.scanId) {
            if (typeof showSuccess === 'function') showSuccess('目录扫描已启动');
        } else {
            if (typeof showError === 'function') showError(json.msg || '启动扫描失败');
        }
    } catch (err) {
        console.error('[FolderLib] Scan folder failed:', err);
        if (typeof showError === 'function') showError('启动扫描失败: ' + err.message);
    }
}

window.scanCurrentFolder = scanCurrentFolder;

// ============================================================================
// 收藏功能 (Favorite / Collect)
// ============================================================================

/** 收藏当前目录为歌单 (已收藏时切换为取消收藏) */
async function favoriteFolder() {
    if (!_folderSelectedPath || !_folderSelectedName) {
        if (typeof showInfo === 'function') showInfo('请先选择一个文件夹');
        return;
    }

    if (!window.currentListData) {
        if (typeof showError === 'function') showError('请先登录后使用收藏功能');
        return;
    }

    // 已收藏 → 取消收藏 (删除对应歌单)
    const existingIdx = window.currentListData.userList.findIndex(
        l => l.name === _folderSelectedName && l.source === 'webplayer'
    );
    if (existingIdx >= 0) {
        const confirmed = await showSelect(
            '取消收藏',
            `确定要取消收藏歌单「${_folderSelectedName}」吗？`,
            { confirmText: '取消收藏', danger: true }
        );
        if (!confirmed) return;
        try {
            window.currentListData.userList.splice(existingIdx, 1);
            if (typeof window.pushDataChange === 'function') await window.pushDataChange();
            if (typeof window.renderMyLists === 'function') window.renderMyLists(window.currentListData);
            updateFavoriteBtnState();
            if (typeof showSuccess === 'function') showSuccess(`已取消收藏「${_folderSelectedName}」`);
        } catch (err) {
            console.error('[FolderLib] Unfavorite folder failed:', err);
            if (typeof showError === 'function') showError('取消收藏失败: ' + err.message);
        }
        return;
    }

    // 未收藏 → 创建歌单
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        // 获取该目录下全部歌曲
        const params = new URLSearchParams({
            path: _folderSelectedPath,
            page: 1,
            pageSize: 99999,
            sort: 'mtime',
            order: 'desc',
        });

        const res = await fetch(`/api/music/local/folder-songs?${params}`, { headers });
        const result = await res.json();

        if (result.code !== 0 || !result.data.data || !result.data.data.length) {
            if (typeof showInfo === 'function') showInfo('该目录下没有歌曲可以收藏');
            return;
        }

        const allSongs = result.data.data;

        // 创建歌单
        const newList = {
            id: 'webplayer_' + Date.now(),
            name: _folderSelectedName,
            source: 'webplayer',
            info: {
                name: _folderSelectedName,
                img: null,
                desc: '本地文件夹收藏',
                author: '',
                total: allSongs.length,
                time: new Date().toLocaleDateString('zh-CN')
            },
            list: allSongs.map(s => {
                if (typeof window.formatSongForStorage === 'function') {
                    return window.formatSongForStorage(s);
                }
                return s;
            })
        };

        window.currentListData.userList.push(newList);

        if (typeof window.pushDataChange === 'function') {
            await window.pushDataChange();
        }
        if (typeof window.renderMyLists === 'function') {
            window.renderMyLists(window.currentListData);
        }

        updateFavoriteBtnState();

        if (typeof showSuccess === 'function') {
            showSuccess(`已创建歌单「${_folderSelectedName}」，共 ${allSongs.length} 首`);
        }
    } catch (err) {
        console.error('[FolderLib] Favorite folder failed:', err);
        if (typeof showError === 'function') showError('收藏失败: ' + err.message);
    }
}

window.favoriteFolder = favoriteFolder;

// ============================================================================
// 搜索与排序 (Search & Sort)
// ============================================================================

/** 目录内搜索 (防抖) */
function folderFilterSongs() {
    if (_folderSongsSearchDebounce) clearTimeout(_folderSongsSearchDebounce);
    _folderSongsSearchDebounce = setTimeout(() => {
        const searchInput = document.getElementById('folderlib-search-input');
        _folderSongsSearch = searchInput ? searchInput.value.trim() : '';
        _folderSongsPage = 1;
        loadFolderSongs();
    }, 400);
}

/** 排序字段切换 */
function sortFolderSongs() {
    _folderSongsPage = 1;
    loadFolderSongs();
}

/** 排序方向切换 */
function toggleFolderSortOrder() {
    _folderSongsOrder = _folderSongsOrder === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('folderlib-sort-order-btn');
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = _folderSongsOrder === 'desc'
                ? 'fas fa-sort-amount-down text-sm'
                : 'fas fa-sort-amount-up text-sm';
        }
    }
    _folderSongsPage = 1;
    loadFolderSongs();
}

window.folderFilterSongs = folderFilterSongs;
window.sortFolderSongs = sortFolderSongs;
window.toggleFolderSortOrder = toggleFolderSortOrder;

// ============================================================================
// 工具栏状态 (Toolbar State)
// ============================================================================

/** 检查当前目录是否已收藏为歌单 (按 name + source='webplayer' 匹配) */
function isCurrentFolderFavorited() {
    if (!_folderSelectedName || !window.currentListData?.userList) return false;
    return window.currentListData.userList.some(
        l => l.name === _folderSelectedName && l.source === 'webplayer'
    );
}

/** 根据收藏状态更新收藏按钮视觉 (参考 radio.js updateFavoriteBtn) */
function updateFavoriteBtnState() {
    const btn = document.getElementById('folderlib-fav-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    const isFav = isCurrentFolderFavorited();
    if (isFav) {
        // 已收藏: 实心 bookmark + 翠绿色
        if (icon) icon.className = 'fas fa-bookmark text-sm text-emerald-500';
        btn.title = '取消收藏';
    } else {
        // 未收藏: 线性 bookmark + 默认灰
        if (icon) icon.className = 'far fa-bookmark text-sm';
        btn.title = '收藏为歌单';
    }
}

/** 更新收藏/播放全部/扫描按钮的可用状态 */
function updateFolderToolbar() {
    const favBtn = document.getElementById('folderlib-fav-btn');
    const playAllBtn = document.getElementById('folderlib-playall-btn');
    const scanBtn = document.getElementById('folderlib-scan-btn');

    const hasFolder = !!_folderSelectedPath;
    const hasSongs = _folderSongsTotal > 0;
    // 全部入库: 总数>0 且 已入库数 === 总数
    const allInDb = hasSongs && _folderSongsTotalInDb === _folderSongsTotal;

    if (favBtn) favBtn.disabled = !hasFolder || !hasSongs;
    if (playAllBtn) playAllBtn.disabled = !hasSongs;
    // 全部入库时扫描按钮变灰不可用
    if (scanBtn) scanBtn.disabled = !hasFolder || allInDb;

    // 同步收藏按钮亮灭状态
    updateFavoriteBtnState();
}

// ============================================================================
// 分页 (Pagination)
// ============================================================================

const _folderLibPaginator = createLibPaginator({
    getPage: () => _folderSongsPage,
    setPage: (p) => { _folderSongsPage = p; },
    getPageSize: () => _folderSongsPageSize,
    setPageSize: (s) => { _folderSongsPageSize = s; },
    getTotal: () => _folderSongsTotal,
    getTotalPages: () => _folderSongsTotalPages,
    loadFn: loadFolderSongs,
    prefix: 'folderlib',
    itemLabel: '首',
    defaultPageSize: 30,
    scrollContainerId: 'folderlib-list',
    pageInfoId: 'folderlib-page-info'
});

const updateFolderPagination = _folderLibPaginator.updatePagination;
const folderLibPrevPage = _folderLibPaginator.prevPage;
const folderLibNextPage = _folderLibPaginator.nextPage;
const folderLibGoToPage = _folderLibPaginator.goToPage;
const folderLibChangePageSize = _folderLibPaginator.changePageSize;

window.folderLibPrevPage = folderLibPrevPage;
window.folderLibNextPage = folderLibNextPage;
window.folderLibGoToPage = folderLibGoToPage;
window.folderLibChangePageSize = folderLibChangePageSize;

// ============================================================================
// 全局状态暴露 (供 tag-editor.js 等模块访问)
// ============================================================================

Object.defineProperty(window, '_folderSongsList', {
    get() { return _folderSongsList; },
    set(v) { _folderSongsList = v; },
    configurable: true
});

Object.defineProperty(window, '_folderSongsPage', {
    get() { return _folderSongsPage; },
    set(v) { _folderSongsPage = v; },
    configurable: true
});

Object.defineProperty(window, '_folderSongsPageSize', {
    get() { return _folderSongsPageSize; },
    set(v) { _folderSongsPageSize = v; },
    configurable: true
});

Object.defineProperty(window, '_folderSelectedPath', {
    get() { return _folderSelectedPath; },
    configurable: true
});
