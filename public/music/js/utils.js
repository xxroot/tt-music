/**
 * Utils - 通用工具函数
 * 从 app.js 提取的公共工具函数，供所有模块使用
 *
 * @module Utils
 */

// ============================================================================
// 通用分页与列表管理工具 (Pagination & List Management Utilities)
// ============================================================================

window.Utils = (function() {

function createPagination(state) {
    const {page, pageSize, totalItems} = state;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    return {startIdx, endIdx, totalPages, currentPage, hasPrev: currentPage > 1, hasNext: currentPage < totalPages};
}

function updateLibPaginationUI(config) {
    const {
        paginationElId,
        prevBtnId,
        nextBtnId,
        pageInputId,
        totalPagesElId,
        pageInfoId,
        pagination,
        totalItems,
        itemLabel
    } = config;
    const paginationEl = document.getElementById(paginationElId);
    if (!paginationEl) return;
    if (totalItems === 0) {
        paginationEl.classList.add('hidden');
        return;
    }
    paginationEl.classList.remove('hidden');
    const prevBtn = document.getElementById(prevBtnId);
    const nextBtn = document.getElementById(nextBtnId);
    const pageInput = document.getElementById(pageInputId);
    const totalPagesEl = document.getElementById(totalPagesElId);
    if (prevBtn) prevBtn.disabled = !pagination.hasPrev;
    if (nextBtn) nextBtn.disabled = !pagination.hasNext;
    if (pageInput) {
        pageInput.value = pagination.currentPage;
        pageInput.max = pagination.totalPages;
    }
    if (totalPagesEl) totalPagesEl.textContent = pagination.totalPages;
    if (pageInfoId) {
        const pageInfo = document.getElementById(pageInfoId);
        if (pageInfo) pageInfo.textContent = `共 ${totalItems} ${itemLabel}`;
    }
}

function navigatePage(state, renderFn, scrollContainerId, delta) {
    const {page, pageSize, filteredList} = state;
    const totalPages = Math.ceil(filteredList.length / pageSize);
    const newPage = page + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        state.page = newPage;
        renderFn();
        if (scrollContainerId) document.getElementById(scrollContainerId)?.scrollTo({top: 0, behavior: 'smooth'});
        return newPage;
    }
    return page;
}

function goToPage(state, renderFn, scrollContainerId, targetPage) {
    const {pageSize, filteredList} = state;
    const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
    const page = Math.max(1, Math.min(Math.floor(targetPage) || 1, totalPages));
    state.page = page;
    renderFn();
    if (scrollContainerId) document.getElementById(scrollContainerId)?.scrollTo({top: 0, behavior: 'smooth'});
    return page;
}

function changePageSize(state, renderFn, newSize, defaultSize = PAGINATION.DEFAULT_PAGE_SIZE) {
    const size = parseInt(newSize) || defaultSize;
    if (size !== state.pageSize) {
        state.pageSize = size;
        state.page = 1;
        renderFn();
    }
}

function filterList(sourceList, searchInputId, matchFn) {
    const searchInput = document.getElementById(searchInputId);
    const query = (searchInput?.value || '').toLowerCase().trim();
    if (!query) return [...sourceList];
    return sourceList.filter(item => matchFn(item, query));
}

function sortList(list, sortSelectId, sortFns, defaultSortBy = 'name') {
    const sortSelect = document.getElementById(sortSelectId);
    const sortBy = sortSelect?.value || defaultSortBy;
    const sortFn = sortFns[sortBy] || sortFns[defaultSortBy];
    if (sortFn) list.sort(sortFn);
    return list;
}

// ============================================================================
// 通用格式化工具 (Formatting Utilities)
// ============================================================================

/** 从可能是逗号分隔的 img 字段中提取第一个有效 URL (v_album_info.img 可能聚合多张封面) */
function extractFirstImg(img) {
    if (!img) return '';
    if (!img.includes(',')) return img;
    return img.split(',').find(s => s.trim()) || img;
}

/** 构建封面 URL (本地库歌曲需要附带 source + relativePath 参数) */
function buildCoverUrl(relativePath, source) {
    if (!relativePath) return '';
    let url = `/api/music/cache/cover?filename=${encodeURIComponent(relativePath)}`;
    if (source && String(source) === 'local') {
        url += `&source=${encodeURIComponent(source)}&relativePath=${encodeURIComponent(relativePath)}`;
    }
    return url;
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 转义 JS 字符串（用于 onclick 等内联 JS 中的单引号字符串值）
function escapeJs(text) {
    if (!text) return '';
    return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 判断指定歌曲是否为当前正在播放的歌曲（统一入口，所有列表共用）
 *  基于 song 对象自身属性判断，避免依赖各列表附加的辅助字段（_serverCachePath 等脏数据）
 *  解决跨列表播放时"正在播放"指示不一致的问题 */
function isCurrentPlayingSong(song) {
    const cur = window.currentPlayingSong;
    if (!cur || !song) return false;
    // 1. 本地歌曲：用 relativePath 唯一标识（避免空字符串匹配陷阱）
    if (cur.relativePath && song.relativePath && cur.relativePath === song.relativePath) return true;
    // 2. 业务标识：id + source 组合
    if (cur.id && song.id && cur.source && song.source &&
        cur.id === song.id && cur.source === song.source) return true;
    return false;
}

return {
    createPagination,
    updateLibPaginationUI,
    navigatePage,
    goToPage,
    changePageSize,
    filterList,
    sortList,
    extractFirstImg,
    buildCoverUrl,
    formatFileSize,
    escapeHtml,
    escapeJs,
    formatDuration,
    isCurrentPlayingSong
};
})();

// ============================================================================
// 向后兼容的独立导出 (Backward Compatible Individual Exports)
// ============================================================================

window.createPagination = window.Utils.createPagination;
window.updateLibPaginationUI = window.Utils.updateLibPaginationUI;
window.navigatePage = window.Utils.navigatePage;
window.goToPage = window.Utils.goToPage;
window.changePageSize = window.Utils.changePageSize;
window.filterList = window.Utils.filterList;
window.sortList = window.Utils.sortList;
window.extractFirstImg = window.Utils.extractFirstImg;
window.buildCoverUrl = window.Utils.buildCoverUrl;
window.formatFileSize = window.Utils.formatFileSize;
window.escapeHtml = window.Utils.escapeHtml;
window.escapeJs = window.Utils.escapeJs;
window.formatDuration = window.Utils.formatDuration;
window.isCurrentPlayingSong = window.Utils.isCurrentPlayingSong;
