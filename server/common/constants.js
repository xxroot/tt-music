"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRAY_AUTO_ID = exports.QUALITYS = exports.DOWNLOAD_STATUS = exports.DEFAULT_SETTING = exports.DATA_KEYS = exports.LIST_IDS = exports.APP_EVENT_NAMES = exports.STORE_NAMES = exports.SPLIT_CHAR = exports.URL_SCHEME_RXP = void 0;
exports.URL_SCHEME_RXP = /^lxmusic:\/\//;
exports.SPLIT_CHAR = {
    DISLIKE_NAME: '@',
    DISLIKE_NAME_ALIAS: '#',
};
exports.STORE_NAMES = {
    APP_SETTINGS: 'config_v2',
    DATA: 'data',
    SYNC: 'sync',
    HOTKEY: 'hot_key',
    USER_API: 'user_api',
    LRC_RAW: 'lyrics',
    LRC_EDITED: 'lyrics_edited',
    THEME: 'theme',
    SOUND_EFFECT: 'sound_effect',
};
exports.APP_EVENT_NAMES = {
    winMainName: 'win_main',
    winLyricName: 'win_lyric',
    trayName: 'tray',
};
exports.LIST_IDS = {
    DEFAULT: 'default',
    LOVE: 'love',
    TEMP: 'temp',
    DOWNLOAD: 'download',
    PLAY_LATER: null,
};
exports.DATA_KEYS = {
    viewPrevState: 'viewPrevState',
    playInfo: 'playInfo',
    searchHistoryList: 'searchHistoryList',
    listScrollPosition: 'listScrollPosition',
    listPrevSelectId: 'listPrevSelectId',
    listUpdateInfo: 'listUpdateInfo',
    ignoreVersion: 'ignoreVersion',
    leaderboardSetting: 'leaderboardSetting',
    songListSetting: 'songListSetting',
    searchSetting: 'searchSetting',
    lastStartInfo: 'lastStartInfo',
};
exports.DEFAULT_SETTING = {
    leaderboard: {
        source: 'kw',
        boardId: 'kw__16',
    },
    songList: {
        source: 'kw',
        sortId: 'new',
        tagId: '',
    },
    search: {
        temp_source: 'kw',
        source: 'all',
        type: 'music',
    },
    viewPrevState: {
        url: '/search',
        query: {},
    },
};
exports.DOWNLOAD_STATUS = {
    RUN: 'run',
    WAITING: 'waiting',
    PAUSE: 'pause',
    ERROR: 'error',
    COMPLETED: 'completed',
};
exports.QUALITYS = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'];
exports.TRAY_AUTO_ID = -1;
