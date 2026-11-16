"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeaturesList = exports.File = exports.TRANS_MODE = exports.SYNC_CLOSE_CODE = exports.SYNC_CODE = exports.LIST_IDS = exports.SPLIT_CHAR = exports.ENV_PARAMS = void 0;
exports.ENV_PARAMS = [
    'PORT',
    'BIND_IP',
    'CONFIG_PATH',
    'LOG_PATH',
    'DATA_PATH',
    'PROXY_HEADER',
    'MAX_SNAPSHOT_NUM',
    'LIST_ADD_MUSIC_LOCATION_TYPE',
    'FRONTEND_PASSWORD',
    'WEBDAV_URL',
    'WEBDAV_USERNAME',
    'WEBDAV_PASSWORD',
    'SYNC_INTERVAL',
    'USER_ENABLE_PATH',
    'USER_ENABLE_ROOT',
    'ENABLE_WEBPLAYER_AUTH',
    'WEBPLAYER_PASSWORD',
    'DISABLE_TELEMETRY',
    'ENABLE_PUBLIC_USER_RESTRICTION',
    'PROXY_ALL_ENABLED',
    'PROXY_ALL_ADDRESS',
    'ADMIN_PATH',
    'PLAYER_PATH',
    'SUBSONIC_ENABLE',
    'SUBSONIC_PATH',
    'DOWNLOAD_PATH',
    'CACHE_PATH',
    'LX_USER_',
];
exports.SPLIT_CHAR = {
    DISLIKE_NAME: '@',
    DISLIKE_NAME_ALIAS: '#',
};
exports.LIST_IDS = {
    DEFAULT: 'default',
    LOVE: 'love',
    TEMP: 'temp',
    DOWNLOAD: 'download',
    PLAY_LATER: null,
};
exports.SYNC_CODE = {
    helloMsg: 'Hello~::^-^::~v4~',
    idPrefix: 'OjppZDo6',
    authMsg: 'lx-music auth::',
    msgAuthFailed: 'Auth failed',
    msgBlockedIp: 'Blocked IP',
    msgConnect: 'lx-music connect',
    authFailed: 'Auth failed',
    missingAuthCode: 'Missing auth code',
    getServiceIdFailed: 'Get service id failed',
    connectServiceFailed: 'Connect service failed',
    connecting: 'Connecting...',
    unknownServiceAddress: 'Unknown service address',
};
exports.SYNC_CLOSE_CODE = {
    normal: 1000,
    failed: 4100,
};
exports.TRANS_MODE = {
    merge_local_remote: 'merge_remote_local',
    merge_remote_local: 'merge_local_remote',
    overwrite_local_remote: 'overwrite_remote_local',
    overwrite_remote_local: 'overwrite_local_remote',
    overwrite_local_remote_full: 'overwrite_remote_local_full',
    overwrite_remote_local_full: 'overwrite_local_remote_full',
    cancel: 'cancel',
};
exports.File = {
    serverInfoJSON: 'serverInfo.json',
    userDir: 'users',
    userDevicesJSON: 'devices.json',
    userSettingsJSON: 'settings.json',
    userSoundEffectsJSON: 'soundEffects.json',
    userTokensJSON: 'token.json',
    listDir: 'list',
    listSnapshotDir: 'snapshot',
    listSnapshotInfoJSON: 'snapshotInfo.json',
    dislikeDir: 'dislike',
    dislikeSnapshotDir: 'snapshot',
    dislikeSnapshotInfoJSON: 'snapshotInfo.json',
};
exports.FeaturesList = [
    'list',
    'dislike',
];
