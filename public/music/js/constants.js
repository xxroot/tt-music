/**
 * Constants - 全局常量定义
 * 从 app.js 提取的公共常量，供所有模块使用
 *
 * @module Constants
 */

// ============================================================================
// 常量定义 (Constants)
// ============================================================================

window.Constants = (function() {

const PAGINATION = {
    DEFAULT_PAGE_SIZE: 30,
    MIN_PAGE_SIZE: 10,
    MAX_PAGE_SIZE: 100,
    PAGE_SIZE_OPTIONS: [10, 20, 30, 50, 100]
};

const TIMEOUT = {
    URL_RESOLVE: 5000,
    NETWORK_PROBE: 2000,
    AUTO_SKIP_NORMAL: 3000,
    AUTO_SKIP_UNSUPPORTED: 2000,
    WS_RECONNECT_BASE: 1000,
    WS_RECONNECT_MAX: 30000,
    SCAN_RETRY_MAX: 1          // 投屏设备扫描最大自动重试次数
};

const ANIMATION = {
    SCROLL_DELAY: 300,
    RESIZE_DEBOUNCE: 300,
    TOAST_AUTO_HIDE: 150,
    TOAST_REMOVE: 300,
    MODAL_HIDE: 300,
    LYRIC_SCROLL: 100,
    POSITION_UPDATE_FAST: 200,
    POSITION_UPDATE_NORMAL: 500,
    POSITION_UPDATE_SLOW: 1200
};

const API = {
    BASE_PATH: '/api/music',
    WS_DLNA_PATH: '/ws/dlna'
};

const PLAYBACK = {
    NEXT_SONG_DELAY: 500,
    CACHE_LIST_REFRESH: 1500,
    DMC_STATE_SYNC: 500
};

const API_BASE = API.BASE_PATH;

return { PAGINATION, TIMEOUT, ANIMATION, API, PLAYBACK, API_BASE };
})();

// ============================================================================
// 向后兼容的独立导出 (Backward Compatible Individual Exports)
// ============================================================================

window.PAGINATION = window.Constants.PAGINATION;
window.TIMEOUT = window.Constants.TIMEOUT;
window.ANIMATION = window.Constants.ANIMATION;
window.API = window.Constants.API;
window.PLAYBACK = window.Constants.PLAYBACK;
window.API_BASE = window.Constants.API_BASE;
