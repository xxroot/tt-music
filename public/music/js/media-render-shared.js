// ========== Media Render Shared - 专辑风格通用渲染组件 ==========
// 供本地专辑库 (album-lib.js) 与 DLNA 服务 (dlna-server.js) 复用，
// 保证两处"专辑网格卡片"与"专辑明细歌曲行"视觉样式完全一致。
// 依赖全局: escapeHtml (utils.js)。仅在渲染期调用，加载期不执行。
// ================================================================

/**
 * 音质标签映射: 返回 { label, colorClass }
 * FLAC→绿色, Hi-Res/非常见格式→金黄色, 其它→蓝色
 * @param {string} quality - 音质原始值 (如 'flac', 'flac24bit', '320k')
 * @returns {{label: string, colorClass: string}} label 为空表示不显示标签
 */
function getQualityTagInfo(quality) {
    const qualityMap = {
        '128k': '128k',
        '192k': '192k',
        '320k': '320k',
        'flac': 'FLAC',
        'ape': 'APE',
        'wav': 'WAV',
        'ogg': 'OGG',
        'm4a': 'M4A',
        'flac24bit': 'Hi-Res',
        'dsf': 'DSF',
        'dff': 'DFF',
        'aiff': 'AIFF',
        'aif': 'AIFF',
        'dts': 'DTS',
        'wv': 'WV',
        'wma': 'WMA',
    };
    const qualityLower = (quality || '').toLowerCase();
    const label = quality ? (qualityMap[qualityLower] || qualityLower.toUpperCase()) : '';

    const hiResFormats = ['flac24bit', 'dsf', 'dff', 'aiff', 'aif', 'dts', 'wv', 'wma'];
    let colorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 transition-colors';
    if (qualityLower === 'flac24bit' || hiResFormats.includes(qualityLower)) {
        colorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 transition-colors';
    } else if (qualityLower === 'flac') {
        colorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 transition-colors';
    }
    return { label, colorClass };
}

/**
 * 通用专辑风格网格卡片 HTML (与本地专辑库 renderAlbumLibList 卡片结构一致)
 * @param {Object} o
 * @param {string} o.coverUrl      - 封面 URL (空/加载失败时回退 logo 占位)
 * @param {string} o.title         - 卡片标题
 * @param {string} [o.subtitle]    - 副标题 (歌手等)，空则不渲染
 * @param {string[]} [o.statsItems] - 统计信息 HTML 片段数组
 * @param {string} o.onclick       - 卡片整体点击事件
 * @param {string} [o.overlayIcon] - hover 遮罩圆形按钮图标 (默认 fa-play)
 * @param {string} [o.onOverlayClick] - 遮罩按钮点击事件 (默认同 onclick)
 * @returns {string} 卡片 HTML
 */
function buildAlbumGridCardHtml(o) {
    const coverUrl = o.coverUrl || '';
    const title = o.title || '';
    const overlayIcon = o.overlayIcon || 'fa-play';
    const onOverlayClick = o.onOverlayClick || o.onclick;
    const statsHtml = (o.statsItems && o.statsItems.length)
        ? `<div class="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400 font-medium">${o.statsItems.join('')}</div>`
        : '';
    const subtitleHtml = o.subtitle
        ? `<p class="text-xs t-text-muted mt-1.5 truncate">${escapeHtml(o.subtitle)}</p>`
        : '';

    return `
        <div class="group cursor-pointer" onclick="${o.onclick}">
            <div class="relative aspect-square overflow-hidden rounded-2xl shadow-md transition-all group-hover:shadow-xl group-hover:-translate-y-1">
                <img src="${coverUrl}" alt="" loading="lazy"
                     class="w-full h-full object-cover dynamic-logo is-placeholder"
                     onload="this.classList.remove('is-placeholder')"
                     onerror="this.src='/music/assets/logo.png'; this.classList.add('is-placeholder');">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onclick="event.stopPropagation(); ${onOverlayClick}">
                    <div class="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-300">
                        <i class="fas ${overlayIcon} ml-1"></i>
                    </div>
                </div>
            </div>
            <div class="mt-3">
                <h3 class="text-sm font-bold t-text-main line-clamp-2 leading-snug group-hover:text-emerald-500 transition-colors" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                ${subtitleHtml}
                ${statsHtml}
            </div>
        </div>
    `;
}

/**
 * 通用专辑明细歌曲行 HTML (grid-cols-12 布局，与 renderAlbumDetailList 行结构一致)
 * @param {Object} o
 * @param {number} o.displayIndex    - 显示序号 (1-based)
 * @param {string} o.title           - 歌曲名
 * @param {string} [o.coverUrl]      - 封面缩略图 URL (空则显示占位图标)
 * @param {string} [o.qualityLabel]  - 音质标签文本 (空则不显示)
 * @param {string} [o.qualityColorClass] - 音质标签颜色 class
 * @param {string} [o.metaStr]       - 元信息字符串 (sampleRate/bitDepth 等)
 * @param {string} [o.sourceTagHtml] - 来源标签 HTML (空则不显示)
 * @param {string} [o.nameExtraHtml] - 歌名下附加行 HTML (如 DMS 的 "艺术家 · 专辑")
 * @param {string} [o.singerHtml]    - 歌手列 HTML (空则不渲染歌手列，歌名列自动扩展)
 * @param {string} [o.durationStr]   - 时长字符串
 * @param {string} [o.sizeStr]       - 文件大小字符串 (空则不显示)
 * @param {boolean} [o.isActive]     - 是否当前播放歌曲
 * @param {boolean} [o.isPlaying]    - 是否正在播放 (显示均衡器动画)
 * @param {string} o.onclick         - 行点击事件
 * @param {string} [o.tooltipStr]    - 歌名 hover 提示文本 (文件路径)
 * @param {string} [o.actionsHtml]   - 右侧操作按钮 HTML (编辑/删除 或 投屏)
 * @returns {string} 歌曲行 HTML
 */
function buildSongRowHtml(o) {
    const isActive = !!o.isActive;
    const isPlaying = !!o.isPlaying;
    const activeTextClass = isActive ? 'text-emerald-600 dark:text-emerald-400' : '';
    const hasSinger = !!o.singerHtml;
    // 有歌手列: 1+5+2+1+3=12; 无歌手列: 1+7+1+3=12
    const nameColClass = hasSinger ? 'col-span-5 md:col-span-5' : 'col-span-7 md:col-span-7';

    // 序号 / 播放状态列
    let indexCell;
    if (isActive) {
        indexCell = isPlaying
            ? '<div class="flex items-end justify-center gap-[2px] h-3.5"><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0s;height:40%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.15s;height:70%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.3s;height:50%"></span></div>'
            : '<i class="fas fa-pause text-[10px] text-emerald-500"></i>';
    } else {
        indexCell = `<span class="text-xs t-text-muted font-mono">${o.displayIndex}</span>`;
    }

    // 封面缩略图
    const coverCell = o.coverUrl
        ? `<img src="${o.coverUrl}" alt="" loading="lazy" class="w-10 h-10 rounded object-cover transition-transform duration-200 group-hover/songname:scale-105 group-hover/songname:shadow-md" onerror="this.style.display='none'">`
        : `<div class="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-transform duration-200 group-hover/songname:scale-105"><i class="fas fa-music text-[11px] t-text-muted"></i></div>`;

    // 歌名下信息行: 来源标签 + 音质标签 + 元信息
    const qualityTag = o.qualityLabel
        ? `<span class="text-[9px] px-1.5 py-0.5 rounded ${o.qualityColorClass || ''} font-bold flex-shrink-0">${o.qualityLabel}</span>`
        : '';
    const metaTag = o.metaStr
        ? `<span class="text-[9px] t-text-muted truncate">${o.metaStr}</span>`
        : '';
    const infoLine = (o.sourceTagHtml || qualityTag || metaTag)
        ? `<div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">${o.sourceTagHtml || ''}${qualityTag}${metaTag}</div>`
        : '';
    // 歌名下附加行 (DMS: 艺术家 · 专辑)
    const extraLine = o.nameExtraHtml
        ? `<div class="text-[10px] t-text-muted truncate mt-0.5">${o.nameExtraHtml}</div>`
        : '';

    // hover 路径提示
    const tooltip = o.tooltipStr
        ? `<div class="absolute left-0 top-full mt-1 z-50 hidden group-hover/songname:block px-2 py-1 rounded text-[11px] font-mono text-white bg-gray-800 dark:bg-gray-700 shadow-lg whitespace-nowrap max-w-[400px] truncate pointer-events-none">${escapeHtml(o.tooltipStr)}</div>`
        : '';

    // 歌手列
    const singerCell = hasSinger ? o.singerHtml : '';

    // 时长 / 大小列
    const sizeLine = o.sizeStr ? `<span class="text-[9px] t-text-muted">${o.sizeStr}</span>` : '';

    return `
        <div class="grid grid-cols-12 gap-2 md:gap-4 px-3 md:px-4 py-3 rounded-xl items-center transition-all duration-200 hover:t-bg-track group hover:shadow-sm hover:scale-[1.005] ${isActive ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 't-bg-item-hover'}"
            onclick="${o.onclick}">
            <div class="col-span-1 text-center flex items-center justify-center gap-1">
                ${indexCell}
            </div>
            <div class="${nameColClass} flex items-center gap-2 min-w-0 relative group/songname cursor-pointer">
                <div class="relative w-10 h-10 flex-shrink-0">
                    ${coverCell}
                    <div class="absolute inset-0 bg-black/20 rounded hidden group-hover/songname:flex items-center justify-center transition-all">
                        <i class="fas fa-play text-white text-[10px]"></i>
                    </div>
                </div>
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="truncate text-sm ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 't-text-main'} font-medium">${escapeHtml(o.title || 'Unknown')}</span>
                    ${infoLine}
                    ${extraLine}
                </div>
                ${tooltip}
            </div>
            ${singerCell}
            <div class="col-span-2 md:col-span-1 text-center flex flex-col items-center">
                <span class="text-xs ${activeTextClass || 't-text-muted'} font-mono tabular-nums">${o.durationStr || '--:--'}</span>
                ${sizeLine}
            </div>
            <div class="col-span-4 md:col-span-3 text-right flex items-center justify-end gap-1">
                ${o.actionsHtml || ''}
            </div>
        </div>
    `;
}

// ========== Window exports ==========
window.getQualityTagInfo = getQualityTagInfo;
window.buildAlbumGridCardHtml = buildAlbumGridCardHtml;
window.buildSongRowHtml = buildSongRowHtml;
