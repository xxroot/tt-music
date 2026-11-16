/**
 * Pagination Factory - 分页工厂函数
 * 消除音乐库/专辑库/歌手库三处重复的分页代码
 *
 * @module PaginationFactory
 */

// ============================================================================
// 分页工厂 (Pagination Factory)
// ============================================================================

window.PaginationFactory = (function() {

/**
 * 创建分页控制器，返回一组分页操作函数
 * @param {object} config - 配置对象
 * @param {function} config.getPage - 获取当前页码 () => number
 * @param {function} config.setPage - 设置当前页码 (page) => void
 * @param {function} config.getPageSize - 获取每页条数 () => number
 * @param {function} config.setPageSize - 设置每页条数 (size) => void
 * @param {function} config.getTotal - 获取总条数 () => number
 * @param {function} config.getTotalPages - 获取总页数 () => number (服务端返回，0表示需本地计算)
 * @param {function} config.loadFn - 加载数据函数 () => void|Promise
 * @param {string} config.prefix - DOM 元素 ID 前缀 (如 'musiclib')
 * @param {string} config.itemLabel - 条目单位标签 (如 '首', '个专辑', '位歌手')
 * @param {number} [config.defaultPageSize=30] - 默认每页条数 (changePageSize 的 fallback)
 * @param {string|null} [config.scrollContainerId] - 滚动容器 ID (翻页时自动滚到顶部，null则不滚动)
 * @param {string|null} [config.pageInfoId] - 页面信息元素 ID (null则不更新)
 * @returns {{ updatePagination: function, prevPage: function, nextPage: function, goToPage: function, changePageSize: function }}
 */
function createLibPaginator(config) {
    const {
        getPage, setPage, getPageSize, setPageSize,
        getTotal, getTotalPages, loadFn,
        prefix, itemLabel,
        defaultPageSize = 30,
        scrollContainerId = null,
        pageInfoId = null
    } = config;

    /**
     * 更新分页 UI
     */
    function updatePagination() {
        const pagination = window.createPagination({
            page: getPage(),
            pageSize: getPageSize(),
            totalItems: getTotal()
        });

        // 使用服务端返回的总页数修正（仅当 getTotalPages > 0 时）
        const serverTotalPages = getTotalPages();
        if (serverTotalPages > 0) {
            pagination.totalPages = serverTotalPages;
        }

        window.updateLibPaginationUI({
            paginationElId: `${prefix}-pagination`,
            prevBtnId: `${prefix}-prev-page`,
            nextBtnId: `${prefix}-next-page`,
            pageInputId: `${prefix}-page-input`,
            totalPagesElId: `${prefix}-total-pages`,
            pageInfoId: pageInfoId,
            pagination,
            totalItems: getTotal(),
            itemLabel
        });
    }

    /**
     * 获取有效的总页数
     */
    function _getEffectiveTotalPages() {
        const serverTP = getTotalPages();
        if (serverTP > 0) return serverTP;
        return Math.max(1, Math.ceil(getTotal() / getPageSize()));
    }

    /**
     * 翻页后滚动到顶部
     */
    function _scrollToTop() {
        if (scrollContainerId) {
            document.getElementById(scrollContainerId)?.scrollTo({top: 0, behavior: 'smooth'});
        }
    }

    /**
     * 上一页
     */
    function prevPage() {
        if (getPage() > 1) {
            setPage(getPage() - 1);
            loadFn();
            _scrollToTop();
        }
    }

    /**
     * 下一页
     */
    function nextPage() {
        const totalPages = _getEffectiveTotalPages();
        if (getPage() < totalPages) {
            setPage(getPage() + 1);
            loadFn();
            _scrollToTop();
        }
    }

    /**
     * 跳转到指定页
     * @param {number} page - 目标页码
     */
    function goToPage(page) {
        const totalPages = _getEffectiveTotalPages();
        const target = Math.max(1, Math.min(Math.floor(page) || 1, totalPages));
        if (target !== getPage()) {
            setPage(target);
            loadFn();
            _scrollToTop();
        }
    }

    /**
     * 修改每页条数
     * @param {number|string} size - 新的每页条数
     */
    function changePageSize(size) {
        const newSize = parseInt(size) || defaultPageSize;
        if (newSize !== getPageSize()) {
            setPageSize(newSize);
            setPage(1);
            loadFn();
        }
    }

    return {updatePagination, prevPage, nextPage, goToPage, changePageSize};
}

return { createLibPaginator };
})();

// ============================================================================
// 向后兼容的独立导出 (Backward Compatible Individual Exports)
// ============================================================================

window.createLibPaginator = window.PaginationFactory.createLibPaginator;
