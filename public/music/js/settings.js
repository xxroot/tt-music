/**
 * Settings - 设置管理模块
 * 管理应用设置的默认值、加载、同步和歌词数据状态
 *
 * @module Settings
 */

// ============================================================================
// 默认设置 (Default Settings)
// ============================================================================

const DEFAULT_SETTINGS = {
    itemsPerPage: 20,
    preferredQuality: 'flac24bit',
    enablePublicSources: true,
    enableProxyPlayback: false,
    enableProxyDownload: false,
    enableAutoProxy: true,
    enableCustomProxy: false,
    customProxyUrl: '',
    downloadConcurrency: 6,
    hotSearchLimit: 20,
    lyricFontSize: 1.25,
    lyricFontFamily: '',
    switchPlaylistOnSearchPlay: true,
    switchPlaylistOnSongListPlay: true,
    autoResume: true,
    showSidebarSongInfo: true,
    enableCrossfade: true,
    keepScreenAwake: true,
    enableKeyboardShortcuts: true,
    showLyricTranslation: true,
    showLyricRoma: false,
    swapLyricTransRoma: false,
    autoCompactPlaybar: true,
    enableAutoSwitchSource: true,
    enableAutoSkipOnError: true,
    enablePreloader: true,
    enableSmtcLyric: true,
    // VU 表 (Volume Unit Meter)
    showSidebarVU: false,
    sidebarVUStyle: 'classic-gold',
    showFullscreenVU: true,
    showFooterVisualizer: false,
    footerVisualizerStyle: 'bars',
    showDetailVisualizer: false,
    detailVisualizerStyle: 'pulse',
    visualizerOpacity: 0.5,
    visualizerGlobalStyle: 'blocks',
    visualizerColorMode: 'theme',
    visualizerCustomColor: '#10b981',
    enableServerCache: true,
    enableServerLyricCache: true,
    enableLyricCache: true,
    enableSongUrlCache: true,
    enableLyricGlow: true,
    enablePersistentToken: false,
    playerBackground: 'blur',
    playMode: 'order', // 播放模式: list/single/random/order，默认顺序播放
    saveAccountSettingsToFile: true,
    autoUpdateNetworkList: false,
    preferServerCache: true,
    remoteSyncUrl: '',
    remoteSyncCode: '',
    enableClientModeSync: false,
    lastRemoteSyncMode: 'merge_remote_local',
};

// ============================================================================
// 设置加载与同步 (Settings Load & Sync)
// ============================================================================

let settings = {...DEFAULT_SETTINGS};
try {
    const saved = localStorage.getItem('lx_settings');
    if (saved) {
        settings = {...settings, ...JSON.parse(saved)};
    }
} catch (e) {
    console.error('[Settings] 加载设置失败:', e);
}

// ============================================================================
// 歌词数据状态 (Lyrics Data State)
// ============================================================================

let currentRawLrc = '';
let currentRawTlrc = '';
let currentRawRlrc = '';
let currentRawKlrc = '';
let lastLyricSongId = null;

// ============================================================================
// 暴露到全局 (Expose to Global Scope)
// ============================================================================

window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
// let 变量使用 defineProperty 保持实时同步
Object.defineProperty(window, 'settings', { get() { return settings; }, set(v) { settings = v; }, configurable: true });
Object.defineProperty(window, 'currentRawLrc', { get() { return currentRawLrc; }, set(v) { currentRawLrc = v; }, configurable: true });
Object.defineProperty(window, 'currentRawTlrc', { get() { return currentRawTlrc; }, set(v) { currentRawTlrc = v; }, configurable: true });
Object.defineProperty(window, 'currentRawRlrc', { get() { return currentRawRlrc; }, set(v) { currentRawRlrc = v; }, configurable: true });
Object.defineProperty(window, 'currentRawKlrc', { get() { return currentRawKlrc; }, set(v) { currentRawKlrc = v; }, configurable: true });
Object.defineProperty(window, 'lastLyricSongId', { get() { return lastLyricSongId; }, set(v) { lastLyricSongId = v; }, configurable: true });
