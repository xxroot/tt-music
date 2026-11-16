// ========== DLNA Cast - DLNA/UPNP 投屏控制 ==========
// 负责 WebSocket 投屏连接、DMC 命令发送、状态同步、设备扫描。
// 依赖全局: currentPlaylist, currentIndex, currentPlayingSong, updatePlayButton, getUserAuthHeaders
// ==================================================

// ========================================
// UPNP/DLNA Cast Control & Server Local Player
// ========================================

// ============================================================================
// DLNA DMC 投屏控制模块状态 (DLNA/UPNP Casting Control State)
// ============================================================================
// 职责：通过 WebSocket 控制后端 DMC，实现 UPNP/DLNA 设备投屏
// 核心功能：
// - WebSocket 连接管理 (initDlnaWs, scheduleDlnaWsReconnect)
// - DMC 命令发送 (sendDlnaCommand)
// - DMC 状态同步 (onDlnaMessage → state/playState/progress/songChange)
// - 歌单同步 (syncPlaylistToDmc, buildDlnaPlaylist)
// ============================================================================
const DlnaDmcState = {
    ws: null,                        // DLNA WebSocket 连接
    wsReconnectTimer: null,          // WS 重连定时器
    wsReconnectDelay: TIMEOUT.WS_RECONNECT_BASE,          // WS 重连延迟（指数退避）
    isReceivingState: false,         // 防止 DMC→WEB→DMC 死循环的标志
    devices: [],                     // 缓存的 UPNP 设备列表
    activeDeviceId: null,            // 当前连接的 UPNP 设备 ID（由 DMC 状态同步）
    activeDeviceName: '',            // 设备显示名称
    lastPosition: 0,                 // 最后已知播放位置（秒）
    lastDuration: 0,                 // 最后已知总时长（秒）
    lastPlayState: 'IDLE',           // 最后已知播放状态
    playlistFingerprint: '',         // 歌单指纹：记录已同步到 DMC 的歌单标识
    playlistJustSynced: false        // 歌单刚同步标志：阻止 _upnpPlaySongHook 发重复 play 命令
};

// ============================================================================
// 服务器本地播放模块状态 (Server Local Player State)
// ============================================================================
// 职责：控制服务器端的音频播放器（ffplay），实现服务器音频输出
// 核心功能：
// - 设备扫描 (scanAllCastDevices → /api/local/devices)
// - 设备选择 (selectLocalDevice → /api/local/play)
// - 播放控制 (/api/local/stop)
// 注意：本地播放复用 DLNA WebSocket 进行状态同步
// ============================================================================
const LocalPlayerState = {
    devices: [],                     // 缓存的服务器音频设备列表
    playerInfo: null,                // 服务器音频播放器信息
    activeDeviceId: null             // 当前选择的服务器音频设备 ID
};

// ============================================================================
// 投屏模式标识（共用）
// ============================================================================
let _castDeviceType = null;          // 'upnp' 或 'local' 或 'airplay'，标识当前投屏模式

// ============================================================================
// AirPlay DMC 投屏控制模块状态 (AirPlay Casting Control State)
// ============================================================================
// 职责：通过 WebSocket 控制后端 AirPlay DMC，实现 AirPlay 设备投屏
// ============================================================================
const AirPlayState = {
    ws: null,                        // AirPlay WebSocket 连接
    wsReconnectTimer: null,          // WS 重连定时器
    wsReconnectDelay: TIMEOUT.WS_RECONNECT_BASE,
    devices: [],                     // 缓存的 AirPlay 设备列表
    activeDeviceId: null,            // 当前连接的 AirPlay 设备 ID
    activeDeviceName: '',            // 设备显示名称
    isReceivingState: false,         // 防止状态回推死循环
    lastPosition: 0,
    lastDuration: 0,
    lastPlayState: 'IDLE',
    playlistFingerprint: '',
    playlistJustSynced: false
};

// ============================================================================
// 向后兼容别名（保持现有函数逻辑不变）
// ============================================================================
let _dlnaWs = null;                  // → DlnaDmcState.ws
let _dlnaWsReconnectTimer = null;    // → DlnaDmcState.wsReconnectTimer
let _dlnaWsReconnectDelay = TIMEOUT.WS_RECONNECT_BASE;    // → DlnaDmcState.wsReconnectDelay
let _isReceivingDmcState = false;    // → DlnaDmcState.isReceivingState
let _upnpDevices = [];               // → DlnaDmcState.devices
let _localDevices = [];              // → LocalPlayerState.devices
let _localPlayerInfo = null;         // → LocalPlayerState.playerInfo
let _upnpActiveDeviceId = null;      // → DlnaDmcState.activeDeviceId 或 LocalPlayerState.activeDeviceId
let _upnpActiveDeviceName = '';      // → DlnaDmcState.activeDeviceName 或 LocalPlayerState.activeDeviceName
let _dlnaLastPosition = 0;           // → DlnaDmcState.lastPosition
let _dlnaLastDuration = 0;           // → DlnaDmcState.lastDuration
let _dlnaLastPlayState = 'IDLE';     // → DlnaDmcState.lastPlayState
let _dlnaPlaylistFingerprint = '';   // → DlnaDmcState.playlistFingerprint
let _dlnaPlaylistJustSynced = false; // → DlnaDmcState.playlistJustSynced
let _scanRetryCount = 0;             // 投屏设备扫描自动重试计数

/**
 * 同步全局变量到状态对象（保持向后兼容）
 * 在关键状态变更点调用此函数，确保 DlnaDmcState 和 LocalPlayerState 保持最新
 */
function syncCastStateToObjects() {
    // DLNA DMC 状态同步
    DlnaDmcState.ws = _dlnaWs;
    DlnaDmcState.wsReconnectTimer = _dlnaWsReconnectTimer;
    DlnaDmcState.wsReconnectDelay = _dlnaWsReconnectDelay;
    DlnaDmcState.isReceivingState = _isReceivingDmcState;
    DlnaDmcState.devices = _upnpDevices;
    DlnaDmcState.lastPosition = _dlnaLastPosition;
    DlnaDmcState.lastDuration = _dlnaLastDuration;
    DlnaDmcState.lastPlayState = _dlnaLastPlayState;
    DlnaDmcState.playlistFingerprint = _dlnaPlaylistFingerprint;
    DlnaDmcState.playlistJustSynced = _dlnaPlaylistJustSynced;

    // LocalPlayer 状态同步
    LocalPlayerState.devices = _localDevices;
    LocalPlayerState.playerInfo = _localPlayerInfo;

    // 投屏模式标识：根据 _castDeviceType 同步 activeDeviceId/Name
    if (_castDeviceType === 'upnp') {
        DlnaDmcState.activeDeviceId = _upnpActiveDeviceId;
        DlnaDmcState.activeDeviceName = _upnpActiveDeviceName;
        LocalPlayerState.activeDeviceId = null;
    } else if (_castDeviceType === 'local') {
        LocalPlayerState.activeDeviceId = _upnpActiveDeviceId;
        LocalPlayerState.activeDeviceName = _upnpActiveDeviceName;
        DlnaDmcState.activeDeviceId = null;
        DlnaDmcState.activeDeviceName = '';
    } else {
        DlnaDmcState.activeDeviceId = null;
        DlnaDmcState.activeDeviceName = '';
        LocalPlayerState.activeDeviceId = null;
    }
}

/**
 * 同步状态对象到全局变量（保持向后兼容）
 * 在状态对象更新后调用此函数，确保全局变量保持最新
 */
function syncCastStateFromObjects() {
    _dlnaWs = DlnaDmcState.ws;
    _dlnaWsReconnectTimer = DlnaDmcState.wsReconnectTimer;
    _dlnaWsReconnectDelay = DlnaDmcState.wsReconnectDelay;
    _isReceivingDmcState = DlnaDmcState.isReceivingState;
    _upnpDevices = DlnaDmcState.devices;
    _dlnaLastPosition = DlnaDmcState.lastPosition;
    _dlnaLastDuration = DlnaDmcState.lastDuration;
    _dlnaLastPlayState = DlnaDmcState.lastPlayState;
    _dlnaPlaylistFingerprint = DlnaDmcState.playlistFingerprint;
    _dlnaPlaylistJustSynced = DlnaDmcState.playlistJustSynced;

    _localDevices = LocalPlayerState.devices;
    _localPlayerInfo = LocalPlayerState.playerInfo;

    // 根据投屏模式恢复 activeDeviceId/Name
    if (_castDeviceType === 'upnp') {
        _upnpActiveDeviceId = DlnaDmcState.activeDeviceId;
        _upnpActiveDeviceName = DlnaDmcState.activeDeviceName;
    } else if (_castDeviceType === 'local') {
        _upnpActiveDeviceId = LocalPlayerState.activeDeviceId;
        _upnpActiveDeviceName = LocalPlayerState.activeDeviceName;
    } else {
        _upnpActiveDeviceId = null;
        _upnpActiveDeviceName = '';
    }
}

/** 初始化 DLNA DMC WebSocket 连接 */
function initDlnaWs() {
    // [DLNA DMC 模块] WebSocket 连接管理
    if (_dlnaWs && (_dlnaWs.readyState === WebSocket.OPEN || _dlnaWs.readyState === WebSocket.CONNECTING)) {
        return; // 已连接或正在连接
    }

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProtocol + '//' + location.host + '/ws/dlna';

    try {
        _dlnaWs = new WebSocket(wsUrl);
        // 同步到状态对象
        DlnaDmcState.ws = _dlnaWs;
    } catch (err) {
        console.warn('[DLNA-WS] 创建连接失败:', err);
        scheduleDlnaWsReconnect();
        return;
    }

    _dlnaWs.onopen = () => {
        _dlnaWsReconnectDelay = TIMEOUT.WS_RECONNECT_BASE; // 重置退避
        DlnaDmcState.wsReconnectDelay = TIMEOUT.WS_RECONNECT_BASE;
        // [优化] 不再主动请求状态，服务端会在连接后 500ms 自动推送完整状态
        // 避免重复请求导致服务端 getFullState() 被调用两次
    };

    _dlnaWs.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            onDlnaMessage(msg);
        } catch (err) {
            console.warn('[DLNA-WS] 消息解析失败:', err);
        }
    };

    _dlnaWs.onclose = () => {
        _dlnaWs = null;
        DlnaDmcState.ws = null;
        scheduleDlnaWsReconnect();
    };

    _dlnaWs.onerror = (err) => {
        console.warn('[DLNA-WS] 连接错误');
    };
}

/** 投屏时静音/恢复本地音频
 * @param {boolean} muted - true: 静音（投屏中）, false: 恢复（断开投屏）
 */
function setCastMute(muted) {
    // [DLNA DMC 模块] 投屏时静音本地音频，避免双重播放
    if (window.audio) {
        window.audio.muted = muted;
    }
}

/** WS 重连（指数退避，最大30s） */
function scheduleDlnaWsReconnect() {
    // [DLNA DMC 模块] WebSocket 重连逻辑
    if (_dlnaWsReconnectTimer) return;
    _dlnaWsReconnectTimer = setTimeout(() => {
        _dlnaWsReconnectTimer = null;
        DlnaDmcState.wsReconnectTimer = null;
        _dlnaWsReconnectDelay = Math.min(_dlnaWsReconnectDelay * 2, TIMEOUT.WS_RECONNECT_MAX);
        DlnaDmcState.wsReconnectDelay = _dlnaWsReconnectDelay;
        initDlnaWs();
    }, _dlnaWsReconnectDelay);
}

/** 发送 DLNA 控制命令 */
function sendDlnaCommand(type, payload) {
    // [DLNA DMC 模块] 发送命令到后端 DMC
    if (!_dlnaWs || _dlnaWs.readyState !== WebSocket.OPEN) {
        console.warn('[DLNA-WS] 未连接，无法发送命令:', type);
        return;
    }
    _dlnaWs.send(JSON.stringify({type, payload}));
}

/** 处理 DMC 推送的消息 */
function onDlnaMessage(msg) {
    // [DLNA DMC 模块] 处理后端 DMC 推送的状态消息
    const {type, payload} = msg;

    switch (type) {
        case 'state':
            // DMC 完整状态推送（初始同步 + 需求17：DMC→WEB）
            // [LOG CLEANED] console.log('[DLNA-WS] Received state message:', {
            //     playState: payload.playState,
            //     connected: payload.connected,
            //     deviceId: payload.deviceId,
            //     deviceName: payload.deviceName,
            //     currentSong: payload.currentSong?.name || 'none',
            //     playlistLen: payload.playlist?.length || 0,
            //     playlistIndex: payload.playlistIndex,
            //     position: payload.position,
            //     duration: payload.duration,
            //     playMode: payload.playMode
            // });
            _isReceivingDmcState = true;
            DlnaDmcState.isReceivingState = true;
            try {
                // 1. 同步连接状态
                if (payload.connected && payload.deviceId) {
                    _upnpActiveDeviceId = payload.deviceId;
                    _upnpActiveDeviceName = payload.deviceName || '';
                    _castDeviceType = 'upnp';
                    updateUpnpCastButton();
                    updateUpnpCurrentDeviceUI();
                    setCastMute(true);
                } else if (!payload.connected) {
                    _upnpActiveDeviceId = null;
                    _upnpActiveDeviceName = '';
                    _castDeviceType = null;
                    updateUpnpCastButton();
                    updateUpnpCurrentDeviceUI();
                    setCastMute(false);
                }

                // 2. 同步歌单（DMC→WEB，不回推避免死循环）
                if (payload.playlist && payload.playlist.length > 0) {
                    if (typeof window.currentPlaylist !== 'undefined') {
                        window.currentPlaylist = payload.playlist;
                        window.currentIndex = payload.playlistIndex >= 0 ? payload.playlistIndex : 0;
                        if (typeof renderQueueList === 'function') renderQueueList();
                    }
                }

                // 3. 同步当前播放信息
                if (payload.currentSong) {
                    updateDlnaPlayingInfo(payload);
                }

                // 4. 同步播放模式（DMC→前端反向映射，只更新UI不回推DMC）
                if (payload.playMode && typeof window.playMode !== 'undefined') {
                    const feModeMap = {
                        listLoop: 'list',
                        list: 'order',
                        singleLoop: 'single',
                        single: 'order',
                        random: 'random'
                    };
                    const mappedMode = feModeMap[payload.playMode] || payload.playMode;
                    if (mappedMode !== window.playMode) {
                        window.playMode = mappedMode;
                        updatePlayModeUI();
                        try {
                            localStorage.setItem('lx_play_mode', window.playMode);
                        } catch (e) {
                        }
                    }
                }

                // 4.5 同步音量（初始连接时同步一次，后续由 volume 增量消息更新）
                if (payload.volume !== undefined && payload.volume >= 0 && typeof currentVolume !== 'undefined') {
                    const newVolume = Math.max(0, Math.min(1, payload.volume / 100));
                    currentVolume = newVolume;
                    window.audio.volume = currentVolume;
                    isMuted = (currentVolume === 0);
                    updateVolumeUI();
                }

                // 5. [新增] 同步进度信息（初始状态包含 position/duration）
                if (payload.position !== undefined) _dlnaLastPosition = payload.position;
                if (payload.duration !== undefined) _dlnaLastDuration = payload.duration;
                // 如果有进度数据，立即更新进度条UI
                if (payload.duration > 0 && typeof formatTime === 'function') {
                    const timeCurrentEl = document.getElementById('time-current');
                    const timeTotalEl = document.getElementById('time-total');
                    const progressBarEl = document.getElementById('progress-bar');
                    if (timeCurrentEl) timeCurrentEl.innerText = formatTime(payload.position);
                    if (timeTotalEl) timeTotalEl.innerText = formatTime(payload.duration);
                    if (progressBarEl && typeof isDragging !== 'undefined' && !isDragging) {
                        const pct = (payload.position / payload.duration) * 100;
                        progressBarEl.style.width = pct + '%';
                    }
                    // 同步歌词
                    if (lyricPlayer) {
                        lyricPlayer.play(payload.position * 1000);
                        if (typeof isUserScrolling !== 'undefined') isUserScrolling = false;
                    }
                }
            } finally {
                _isReceivingDmcState = false;
            }
            break;

        case 'playState':
            // 播放状态变化
            _dlnaLastPlayState = payload.playState;
            if (payload.playState === 'PLAYING') {
                updatePlayButton(true);
                const statusEl = document.getElementById('player-status');
                if (statusEl) statusEl.innerText = 'UPNP投屏中 - ' + (_upnpActiveDeviceName || '');
            } else if (payload.playState === 'PAUSED') {
                updatePlayButton(false);
                const statusEl = document.getElementById('player-status');
                if (statusEl) statusEl.innerText = 'UPNP暂停中 - ' + (_upnpActiveDeviceName || '');
                if (lyricPlayer) lyricPlayer.pause();
            } else if (payload.playState === 'IDLE' || payload.playState === 'RESOLVING') {
                updatePlayButton(false);
            }
            // 更新进度
            if (payload.position !== undefined) _dlnaLastPosition = payload.position;
            if (payload.duration !== undefined) _dlnaLastDuration = payload.duration;
            break;

        case 'progress':
            // 进度更新
            if (payload.duration > 0 && typeof formatTime === 'function') {
                const timeCurrentEl = document.getElementById('time-current');
                const timeTotalEl = document.getElementById('time-total');
                const progressBarEl = document.getElementById('progress-bar');
                if (timeCurrentEl) timeCurrentEl.innerText = formatTime(payload.position);
                if (timeTotalEl) timeTotalEl.innerText = formatTime(payload.duration);
                if (progressBarEl && typeof isDragging !== 'undefined' && !isDragging) {
                    const pct = (payload.position / payload.duration) * 100;
                    progressBarEl.style.width = pct + '%';
                }
                // 同步歌词
                if (lyricPlayer) {
                    lyricPlayer.play(payload.position * 1000);
                    if (typeof isUserScrolling !== 'undefined') isUserScrolling = false;
                }
            }
            _dlnaLastPosition = payload.position;
            _dlnaLastDuration = payload.duration;
            break;

        case 'songChange':
            // 歌曲切换
            if (payload.song) {
                window.currentPlayingSong = payload.song;
                if (typeof window.currentIndex !== 'undefined' && payload.index !== undefined) {
                    window.currentIndex = payload.index;
                }
                updateDlnaPlayingInfo({currentSong: payload.song, position: 0, duration: 0, playState: 'PLAYING'});
            }
            break;

        case 'playMode':
            // DMC 推送的播放模式变化 → 只更新前端 UI，不回推 DMC（防死循环）
            if (payload.playMode && typeof window.playMode !== 'undefined') {
                const feModeMap = {
                    listLoop: 'list',
                    list: 'order',
                    singleLoop: 'single',
                    single: 'order',
                    random: 'random'
                };
                const mappedMode = feModeMap[payload.playMode] || payload.playMode;
                if (mappedMode !== window.playMode) {
                    window.playMode = mappedMode;
                    updatePlayModeUI();
                    try {
                        localStorage.setItem('lx_play_mode', window.playMode);
                    } catch (e) {
                    }
                }
            }
            break;

        case 'volume':
            // DMC 推送的音量变化 → 只更新前端 UI，不回推 DMC（防死循环）
            if (payload.volume !== undefined && payload.volume >= 0 && typeof currentVolume !== 'undefined') {
                const newVolume = Math.max(0, Math.min(1, payload.volume / 100));
                // 值比较去重：自己发出的变更经 DMC 回传后值相同（0.005 容差），自然跳过
                if (Math.abs(newVolume - currentVolume) > 0.005) {
                    currentVolume = newVolume;
                    window.audio.volume = currentVolume;
                    isMuted = (currentVolume === 0);
                    updateVolumeUI();
                    try {
                        localStorage.setItem('lx_volume', currentVolume.toString());
                    } catch (e) {
                    }
                }
            }
            break;

        case 'playlist':
            // 歌单更新
            _isReceivingDmcState = true;
            try {
                if (payload.songs && typeof window.currentPlaylist !== 'undefined') {
                    window.currentPlaylist = payload.songs;
                    window.currentIndex = payload.index >= 0 ? payload.index : 0;
                    // 同步更新指纹，防止后续操作误判歌单变化
                    _dlnaPlaylistFingerprint = computePlaylistFingerprint(window.currentPlaylist);
                    if (typeof renderQueueList === 'function') renderQueueList();
                }
            } finally {
                _isReceivingDmcState = false;
            }
            break;

        case 'connected':
            // DMR 已连接
            _upnpActiveDeviceId = payload.deviceId;
            _upnpActiveDeviceName = payload.deviceName || '';
            _castDeviceType = 'upnp';
            updateUpnpCastButton();
            updateUpnpCurrentDeviceUI();
            renderUpnpDeviceList();
            break;

        case 'disconnected':
            // DMR 已断开
            _upnpActiveDeviceId = null;
            _upnpActiveDeviceName = '';
            _castDeviceType = null;
            _dlnaPlaylistFingerprint = '';  // 重置指纹，下次连接时强制同步
            updateUpnpCastButton();
            updateUpnpCurrentDeviceUI();
            renderUpnpDeviceList();
            setCastMute(false);
            // 断开投屏后本地 Web 播放器立即暂停，不自动恢复
            if (window.audio && !window.audio.paused) {
                try { window.audio.pause(); } catch (e) { /* ignore */ }
            }
            updatePlayButton(false);
            const statusElD = document.getElementById('player-status');
            if (statusElD) statusElD.innerText = '';
            break;

        case 'resolving':
            // URL 解析中
            const statusElR = document.getElementById('player-status');
            if (statusElR) statusElR.innerText = '解析中... ' + (payload.songName || '');
            break;

        case 'error':
            // 错误通知
            if (payload.message) {
                console.warn('[DLNA] DMC error:', payload.message);
                showError(payload.message);
            }
            break;
    }
}

// 歌单指纹：记录已同步到 DMC 的歌单标识，只有指纹变化时才发送 setPlaylist

/** 计算歌单指纹：基于歌曲ID有序拼接（长度+ID序列），用于判断歌单是否真正变化 */
function computePlaylistFingerprint(songs) {
    if (!songs || songs.length === 0) return '';
    return songs.length + ':' + songs.map(s => s.id || '').join(',');
}

/** 更新 DLNA 播放信息到 UI */
function updateDlnaPlayingInfo(payload) {
    const song = payload.currentSong;
    if (!song) return;

    // 更新播放栏歌曲信息
    if (typeof updatePlayerInfo === 'function') {
        updatePlayerInfo(song);
    }
    // 更新媒体会话
    if (typeof updateMediaSessionMetadata === 'function') {
        updateMediaSessionMetadata(song);
    }
    // 更新播放按钮
    if (payload.playState === 'PLAYING') {
        updatePlayButton(true);
    } else if (payload.playState === 'PAUSED') {
        updatePlayButton(false);
    }
    // 重置时间显示（切歌时 duration=0，在 GENA 事件到达前显示 00:00）
    if (payload.duration !== undefined && typeof formatTime === 'function') {
        _dlnaLastDuration = payload.duration;
        _dlnaLastPosition = payload.position || 0;
        const timeCurrentEl = document.getElementById('time-current');
        const timeTotalEl = document.getElementById('time-total');
        const progressBarEl = document.getElementById('progress-bar');
        if (timeCurrentEl) timeCurrentEl.innerText = formatTime(_dlnaLastPosition);
        if (timeTotalEl) timeTotalEl.innerText = formatTime(_dlnaLastDuration);
        if (progressBarEl) progressBarEl.style.width = '0%';
    }
    // 静音本地音频
    setCastMute(true);
}

/** 构建轻量歌单（DmcSongRef）用于发送给 DMC */
function buildDlnaPlaylist(songs) {
    // [DLNA DMC 模块] 构建轻量歌单对象用于发送给后端 DMC
    if (!songs || !Array.isArray(songs)) return [];

    // 音质优先级：flac24bit > flac > 320k > 128k
    const QUALITY_PRIORITY = ['flac24bit', 'flac', '320k', '128k'];

    return songs.map(s => {
        // 判断是否在线歌曲
        const isMusicLibSong = s._isMusicLibSong || !!s.relativePath || !!s._serverCachePath;

        // 获取 quality：优先使用已有的 quality
        let quality = s.quality || '';

        // 如果是在线歌曲且 quality 为空，从 types 中按优先级提取最高音质
        if (!isMusicLibSong && !quality && s.types && Array.isArray(s.types)) {
            // 从 types 中按优先级找到最高的可用音质
            for (const q of QUALITY_PRIORITY) {
                if (s.types.some(t => t.type === q)) {
                    quality = q;
                    break;
                }
            }
        }

        // 构建 interval: 优先用已有字符串，否则从 duration(数字/秒) 转换
        let interval = s.interval || '';
        if (!interval && s.duration && typeof s.duration === 'number' && s.duration > 0) {
            const mins = Math.floor(s.duration / 60);
            const secs = Math.floor(s.duration % 60);
            interval = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }

        return {
            id: s.id || '',
            name: s.name || '',
            singer: s.singer || '',
            albumName: s.albumName || (s.album && s.album.name) || '',
            albumId: s.albumId || (s.album && s.album.id) || '',
            source: s.source || '',
            songmid: s.songmid || s.songId || '',
            interval: interval,
            quality: quality,
            img: s.img || null,
            relativePath: s.relativePath || s._serverCachePath || null,
            _isMusicLibSong: isMusicLibSong,
            _isFromAlbumLib: s._isFromAlbumLib || false,
            directUrl: s.directUrl || null,
        };
    });
}

/** 歌单向 DMC 同步（指纹驱动，防死循环）
 *
 * 核心逻辑：只有歌单指纹变化时才发送 setPlaylist，否则不发送。
 * - 指纹变化（新歌单）→ 发 setPlaylist，DMC 停旧→播新，_upnpPlaySongHook 跳过
 * - 指纹未变（同一歌单内切歌）→ 不发 setPlaylist，由 _upnpPlaySongHook 发 play 命令
 */
function syncPlaylistToDmc(songs, startIndex, playImmediately) {
    // [DLNA DMC 模块] 歌单向 DMC 同步（指纹驱动，防死循环）
    // 防止死循环：接收 DMC 状态时不回推
    if (_isReceivingDmcState) return;
    // 非 DLNA 模式下不同步
    if (!_upnpActiveDeviceId || _castDeviceType !== 'upnp') return;

    const newFingerprint = computePlaylistFingerprint(songs);
    const playlistChanged = newFingerprint !== _dlnaPlaylistFingerprint;

    if (!playlistChanged) {
        // 歌单没变（同一歌单内操作），不需要重新同步歌单,那么设置播放歌曲
        sendDlnaCommand('playIndex', {
            index: startIndex || 0,
        });
        return;
    }

    // 歌单变化 → 发送新歌单到 DMC
    // [LOG CLEANED] console.log(`[DLNA] syncPlaylistToDmc: Playlist CHANGED, sending setPlaylist to DMC (old fingerprint: ${_dlnaPlaylistFingerprint.substring(0, 30)}... → new: ${newFingerprint.substring(0, 30)}...)`);
    _dlnaPlaylistFingerprint = newFingerprint;
    DlnaDmcState.playlistFingerprint = newFingerprint;

    // playImmediately=true 时 DMC 会自动播放，设置标志防止 _upnpPlaySongHook 重复发 play 命令
    if (playImmediately !== false) {
        _dlnaPlaylistJustSynced = true;
        DlnaDmcState.playlistJustSynced = true;
    }

    sendDlnaCommand('setPlaylist', {
        songs: buildDlnaPlaylist(songs),
        startIndex: startIndex || 0,
        playImmediately: playImmediately !== false,
    });
    // [LOG CLEANED] console.log('[DLNA] syncPlaylistToDmc: setPlaylist command sent to DMC via WebSocket');
}

/** 歌单同步到 AirPlay DMC（指纹驱动，防死循环）
 *
 * 与 syncPlaylistToDmc 逻辑类似，但通过 AirPlay WS 发送
 */
function syncPlaylistToAirPlay(songs, startIndex, playImmediately) {
    if (AirPlayState.isReceivingState) return;
    if (!AirPlayState.activeDeviceId || _castDeviceType !== 'airplay') return;

    const newFingerprint = computePlaylistFingerprint(songs);
    const playlistChanged = newFingerprint !== AirPlayState.playlistFingerprint;

    if (!playlistChanged) {
        sendAirPlayCommand('playIndex', { index: startIndex || 0 });
        return;
    }

    AirPlayState.playlistFingerprint = newFingerprint;

    if (playImmediately !== false) {
        AirPlayState.playlistJustSynced = true;
    }

    sendAirPlayCommand('setPlaylist', {
        songs: buildDlnaPlaylist(songs),
        startIndex: startIndex || 0,
        playImmediately: playImmediately !== false,
    });
}

/** Toggle the UPNP device panel */
function toggleUpnpPanel() {
    const panel = document.getElementById('upnp-panel');
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    if (isHidden) {
        panel.classList.remove('hidden');
        panel.classList.add('flex');
        requestAnimationFrame(() => {
            const content = panel.querySelector('.t-bg-panel');
            if (content) {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }
        });
        updateUpnpCurrentDeviceUI();
    } else {
        closeUpnpPanel();
    }
}

/** Close the UPNP device panel */
function closeUpnpPanel() {
    const panel = document.getElementById('upnp-panel');
    if (!panel) return;
    const content = panel.querySelector('.t-bg-panel');
    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
        panel.classList.add('hidden');
        panel.classList.remove('flex');
    }, 200);
}

/** Scan for all cast devices (UPNP & Server Audio) on the network */
async function scanAllCastDevices() {
    // [设备扫描] 同时扫描 UPNP 设备和服务器本地音频设备
    const btn = document.getElementById('upnp-scan-btn');
    const upnpListEl = document.getElementById('upnp-device-list');
    const localListEl = document.getElementById('local-device-list');
    if (!btn) return;

    // Show scanning state
    btn.disabled = true;
    const scanLabel = _scanRetryCount > 0 ? '重新扫描中...' : '扫描中...';
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>' + scanLabel + '</span>';
    if (upnpListEl) upnpListEl.innerHTML = '<div class="text-center py-4 t-text-muted"><i class="fas fa-spinner fa-spin text-lg mb-2"></i><p class="text-xs">搜索中...</p></div>';
    if (localListEl) localListEl.innerHTML = '<div class="text-center py-4 t-text-muted"><i class="fas fa-spinner fa-spin text-lg mb-2"></i><p class="text-xs">扫描中...</p></div>';
    const airplayListEl = document.getElementById('airplay-device-list');
    if (airplayListEl) airplayListEl.innerHTML = '<div class="text-center py-4 t-text-muted"><i class="fas fa-spinner fa-spin text-lg mb-2"></i><p class="text-xs">扫描中...</p></div>';

    const headers = {'Content-Type': 'application/json'};
    Object.assign(headers, getUserAuthHeaders());

    // Scan UPNP, Server Audio, and AirPlay devices in parallel
    const [upnpResult, localResult, airplayResult] = await Promise.allSettled([
        fetch('/api/upnp/scan', {method: 'POST', headers}).then(r => r.json()),  // [DLNA DMC] UPNP 设备扫描
        fetch('/api/local/devices', {headers}).then(r => r.json()),               // [LocalPlayer] 服务器音频设备扫描
        fetch('/api/airplay/scan', {method: 'POST', headers}).then(r => r.json()), // [AirPlay] AirPlay 设备扫描
    ]);

    // Process UPNP results
    if (upnpResult.status === 'fulfilled' && upnpResult.value.success && upnpResult.value.devices) {
        _upnpDevices = upnpResult.value.devices;
        DlnaDmcState.devices = _upnpDevices;
    } else {
        _upnpDevices = [];
        DlnaDmcState.devices = [];
        const errMsg = upnpResult.status === 'fulfilled' ? (upnpResult.value.message || '未知错误') : '网络错误';
        if (upnpListEl) upnpListEl.innerHTML = '<div class="text-center py-4 t-text-muted"><i class="fas fa-exclamation-circle text-lg mb-2 text-red-400"></i><p class="text-xs">' + escapeHtml(errMsg) + '</p></div>';
    }

    // Process Server Audio results
    if (localResult.status === 'fulfilled' && localResult.value.success && localResult.value.devices) {
        _localDevices = localResult.value.devices;
        _localPlayerInfo = localResult.value.playerInfo || null;
        LocalPlayerState.devices = _localDevices;
        LocalPlayerState.playerInfo = _localPlayerInfo;
    } else {
        _localDevices = [];
        _localPlayerInfo = null;
        LocalPlayerState.devices = [];
        LocalPlayerState.playerInfo = null;
        const errMsg = localResult.status === 'fulfilled' ? (localResult.value.message || '未知错误') : '网络错误';
        if (localListEl) localListEl.innerHTML = '<div class="text-center py-4 t-text-muted"><i class="fas fa-exclamation-circle text-lg mb-2 text-red-400"></i><p class="text-xs">' + escapeHtml(errMsg) + '</p></div>';
    }

    // Process AirPlay results
    if (airplayResult.status === 'fulfilled' && airplayResult.value.success && airplayResult.value.devices) {
        AirPlayState.devices = airplayResult.value.devices;
    } else {
        AirPlayState.devices = [];
        const errMsg = airplayResult.status === 'fulfilled' ? (airplayResult.value.message || '未知错误') : '网络错误';
        if (airplayListEl) airplayListEl.innerHTML = '<div class="text-center py-4 t-text-muted"><i class="fas fa-exclamation-circle text-lg mb-2 text-red-400"></i><p class="text-xs">' + escapeHtml(errMsg) + '</p></div>';
    }

    // Render all lists
    renderUpnpDeviceList();
    renderLocalDeviceList();
    renderAirPlayDeviceList();

    // Auto-retry if no UPNP devices found (DLNA 设备为空时自动重试一次)
    const hasUpnpDevices = _upnpDevices.length > 0;
    if (!hasUpnpDevices && _scanRetryCount < TIMEOUT.SCAN_RETRY_MAX) {
        _scanRetryCount++;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>重新扫描中...</span>';
        setTimeout(() => scanAllCastDevices(), 500);
        return;
    }

    _scanRetryCount = 0;
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-search"></i> <span>扫描设备</span>';
}

/** Keep old function name as alias */
async function scanUpnpDevices() {
    return scanAllCastDevices();
}

/** Render the UPNP device list */
function renderUpnpDeviceList() {
    // [DLNA DMC 模块] 渲染 UPNP 设备列表 UI
    const listEl = document.getElementById('upnp-device-list');
    if (!listEl) return;

    if (_upnpDevices.length === 0) {
        listEl.innerHTML = '<div class="text-center py-4 t-text-muted"><p class="text-xs">未发现UPNP设备</p></div>';
        return;
    }

    listEl.innerHTML = _upnpDevices.map(device => {
        const isActive = device.id === _upnpActiveDeviceId && _castDeviceType === 'upnp';
        return `
            <button onclick="selectUpnpDevice('${device.id.replace(/'/g, "\\'")}')" 
                class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 ${isActive ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700' : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10'}">
                <div class="w-10 h-10 rounded-lg ${isActive ? 'bg-emerald-100 dark:bg-emerald-800/40' : 'bg-gray-100 dark:bg-gray-700'} flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-${isActive ? 'volume-up text-emerald-500' : 'tv text-gray-400 dark:text-gray-500'}"></i>
                </div>
                <div class="flex-1 text-left min-w-0">
                    <div class="text-sm font-medium ${isActive ? 'text-emerald-700 dark:text-emerald-400' : 't-text-main'} truncate">${escapeHtml(device.name)}</div>
                    <div class="text-xs t-text-muted truncate">${escapeHtml(device.model || device.manufacturer || 'UPNP设备')}</div>
                </div>
                ${isActive ? '<span class="text-[10px] px-2 py-0.5 bg-emerald-500 text-white rounded-full font-bold">已连接</span>' : ''}
            </button>
        `;
    }).join('');
}

/** Render the server audio device list */
function renderLocalDeviceList() {
    // [LocalPlayer 模块] 渲染服务器音频设备列表 UI
    const listEl = document.getElementById('local-device-list');
    if (!listEl) return;

    // Check if server player is available
    if (!_localPlayerInfo || !_localPlayerInfo.available) {
        listEl.innerHTML = '<div class="text-center py-4 t-text-muted"><i class="fas fa-exclamation-triangle text-lg mb-2 text-amber-400"></i><p class="text-xs">服务器未安装音频播放器</p><p class="text-[10px] t-text-muted mt-1">请安装 ffplay (FFmpeg) 以支持服务器端播放</p></div>';
        return;
    }

    if (_localDevices.length === 0) {
        listEl.innerHTML = '<div class="text-center py-4 t-text-muted"><p class="text-xs">未发现服务器音频设备</p></div>';
        return;
    }

    // Device type icon map
    const iconMap = {
        'speaker': 'fa-volume-up',
        'dac': 'fa-usb',
        'hdmi': 'fa-plug',
        'headphone': 'fa-headphones',
        'bluetooth': 'fa-bluetooth-b',
        'other': 'fa-music',
    };
    const colorMap = {
        'speaker': 'text-gray-400',
        'dac': 'text-purple-400',
        'hdmi': 'text-blue-400',
        'headphone': 'text-pink-400',
        'bluetooth': 'text-blue-500',
        'other': 'text-gray-400',
    };

    listEl.innerHTML = _localDevices.map(device => {
        const isActive = device.id === _upnpActiveDeviceId && _castDeviceType === 'local';
        const icon = iconMap[device.type] || iconMap.other;
        const iconColor = colorMap[device.type] || colorMap.other;
        const typeLabel = {
            speaker: '扬声器',
            dac: 'USB DAC',
            hdmi: 'HDMI',
            headphone: '耳机',
            bluetooth: '蓝牙',
            other: '音频设备'
        }[device.type] || '音频设备';
        return `
            <button onclick="selectLocalDevice('${device.id.replace(/'/g, "\\'")}')"
                class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 ${isActive ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700' : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10'}">
                <div class="w-10 h-10 rounded-lg ${isActive ? 'bg-emerald-100 dark:bg-emerald-800/40' : 'bg-gray-100 dark:bg-gray-700'} flex items-center justify-center flex-shrink-0">
                    <i class="fas ${icon} ${isActive ? 'text-emerald-500' : iconColor}"></i>
                </div>
                <div class="flex-1 text-left min-w-0">
                    <div class="text-sm font-medium ${isActive ? 'text-emerald-700 dark:text-emerald-400' : 't-text-main'} truncate">${escapeHtml(device.name)}</div>
                    <div class="text-xs t-text-muted truncate">${typeLabel}${device.isDefault ? ' (默认)' : ''}</div>
                </div>
                ${isActive ? '<span class="text-[10px] px-2 py-0.5 bg-emerald-500 text-white rounded-full font-bold">已选择</span>' : ''}
            </button>
        `;
    }).join('');
}

/** Select a server audio device and start playing */
async function selectLocalDevice(deviceId) {
    // [LocalPlayer 模块] 选择服务器音频设备并开始播放
    const device = _localDevices.find(d => d.id === deviceId);
    if (!device) return;

    // If selecting the same device, toggle disconnect
    if (_upnpActiveDeviceId === deviceId && _castDeviceType === 'local') {
        disconnectUpnpDevice();
        return;
    }

    // If currently connected to another device type, disconnect first
    if (_upnpActiveDeviceId && _castDeviceType !== 'local') {
        await disconnectUpnpDevice();
    }

    // Connect to this server audio device
    _upnpActiveDeviceId = deviceId;
    _upnpActiveDeviceName = device.name;
    _castDeviceType = 'local';
    syncCastStateToObjects();  // 同步到状态对象
    onUpnpConnected();
    showSuccess('已选择服务器音频设备: ' + device.name);

    // If audio is currently playing, play it on the server and pause local playback
    const song = getCurrentPlayingSong();
    const isAudioPlaying = window.audio && !window.audio.paused;
    if (isAudioPlaying && song) {
        let mediaUrl = '';
        if (song._serverCachePath) {
            mediaUrl = '/api/music/cache/file/' + encodeURIComponent(song._serverCachePath);
        } else if (song.relativePath) {
            mediaUrl = '/api/music/cache/file/' + encodeURIComponent(song.relativePath);
        } else if (window.audio.src) {
            mediaUrl = window.audio.src;
        }
        if (mediaUrl) {
            try {
                const headers = {'Content-Type': 'application/json'};
                Object.assign(headers, getUserAuthHeaders());
                await fetch('/api/local/play', {
                    method: 'POST', headers,
                    body: JSON.stringify({deviceId: deviceId, mediaUrl: mediaUrl, title: song.name || 'Music'})
                });
            } catch (err) {
                console.warn('[LocalPlayer] Play failed:', err);
            }
        }
        if (window.audio && !window.audio.paused) {
            try {
                window.audio.pause();
            } catch (e) { /* ignore */
            }
        }
        setCastMute(true);
        const statusEl = document.getElementById('player-status');
        if (statusEl) statusEl.innerText = '服务器投屏中 - ' + device.name;
        updatePlayButton(true);
    }
}

/** Select a UPNP device and start casting current song */
async function selectUpnpDevice(deviceId) {
    // [DLNA DMC 模块] 选择 UPNP 设备并开始投屏
    const device = _upnpDevices.find(d => d.id === deviceId);
    if (!device) return;

    // 如果点击的是已连接的同一设备，断开连接
    if (_upnpActiveDeviceId === deviceId && _castDeviceType === 'upnp') {
        disconnectUpnpDevice();
        return;
    }

    // 防重复连接：如果正在连接同一设备，忽略
    if (_upnpActiveDeviceId === deviceId) {
        // [LOG CLEANED] console.log('[DLNA] Already connected to device:', deviceId);
        return;
    }

    // 如果当前连接了其他设备类型，先断开
    if (_upnpActiveDeviceId && _castDeviceType !== 'upnp') {
        await disconnectUpnpDevice();
    }

    // 通过 WS 发送连接命令给后端 DMC
    sendDlnaCommand('connect', {deviceId: deviceId});

    // 先设置本地状态（WS 推送会确认）
    _upnpActiveDeviceName = device.name;
    _castDeviceType = 'upnp';
    syncCastStateToObjects();  // 同步到状态对象

    // 如果有正在播放的歌曲，推送到 DMC
    const song = getCurrentPlayingSong();
    const isAudioPlaying = window.audio && !window.audio.paused;
    if (isAudioPlaying && song) {
        // 静音本地音频
        if (window.audio && !window.audio.paused) {
            try {
                window.audio.pause();
            } catch (e) { /* ignore */
            }
        }
        setCastMute(true);
        // 推送歌单和当前歌曲到 DMC
        // 前端操作：连接UPNP/DLNA设备
        syncPlaylistToDmc(window.currentPlaylist, window.currentIndex, true);
    }

    showSuccess('已连接到 ' + device.name);
}

/** Get current playing song info */
function getCurrentPlayingSong() {
    // Try to get from currentPlaylist using the global currentIndex
    if (typeof window.currentPlaylist !== 'undefined' && window.currentPlaylist && window.currentPlaylist.length > 0 && typeof window.currentIndex !== 'undefined' && window.currentIndex >= 0) {
        return window.currentPlaylist[window.currentIndex];
    }
    return null;
}

/** Called when cast device is connected */
function onUpnpConnected() {
    // [共用] 投屏设备连接成功后的 UI 更新
    updateUpnpCurrentDeviceUI();
    renderUpnpDeviceList();
    renderLocalDeviceList();
    updateUpnpCastButton();
}

/** Disconnect from cast device (UPNP, Server Audio, or AirPlay)
 * 断开投屏后本地 Web 播放器保持暂停状态，不自动恢复播放
 */
async function disconnectUpnpDevice() {
    if (_upnpActiveDeviceId || AirPlayState.activeDeviceId) {
        if (_castDeviceType === 'upnp') {
            // [DLNA DMC] 通过 WS 断开 DMR
            sendDlnaCommand('disconnect', {});
        } else if (_castDeviceType === 'local') {
            // [LocalPlayer] 停止服务器本地播放
            try {
                const headers = {'Content-Type': 'application/json'};
                Object.assign(headers, getUserAuthHeaders());
                await fetch('/api/local/stop', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({deviceId: _upnpActiveDeviceId})
                });
            } catch (e) { /* ignore */
            }
        } else if (_castDeviceType === 'airplay') {
            // [AirPlay] 断开 AirPlay 设备
            sendAirPlayCommand('disconnect', {});
            AirPlayState.activeDeviceId = null;
            AirPlayState.activeDeviceName = '';
            AirPlayState.playlistFingerprint = '';
        }
    }

    _upnpActiveDeviceId = null;
    _upnpActiveDeviceName = '';
    _castDeviceType = null;
    syncCastStateToObjects();  // 同步到状态对象
    updateUpnpCurrentDeviceUI();
    renderUpnpDeviceList();
    renderAirPlayDeviceList();
    updateUpnpCastButton();
    setCastMute(false);
    // 断开投屏后不自动恢复本地播放，保持暂停状态
    if (window.audio && !window.audio.paused) {
        try { window.audio.pause(); } catch (e) { /* ignore */ }
    }
    updatePlayButton(false);
    setPlayerStatus('');
}

/** Update the current device UI in the panel */
function updateUpnpCurrentDeviceUI() {
    const el = document.getElementById('upnp-current-device');
    const nameEl = document.getElementById('upnp-current-device-name');
    if (!el || !nameEl) return;

    // 检查 UPNP/Local/AirPlay 任意一种投屏连接
    const castActive = _upnpActiveDeviceId || (AirPlayState.activeDeviceId && _castDeviceType === 'airplay');
    const castName = _castDeviceType === 'airplay' ? AirPlayState.activeDeviceName : _upnpActiveDeviceName;

    if (castActive) {
        el.classList.remove('hidden');
        nameEl.textContent = castName;
    } else {
        el.classList.add('hidden');
    }
}

/** Update the cast button appearance */
function updateUpnpCastButton() {
    const btn = document.getElementById('btn-upnp-cast');
    const mobileBtn = document.getElementById('btn-upnp-cast-mobile');
    const typeLabel = _castDeviceType === 'local' ? '服务器' : (_castDeviceType === 'airplay' ? 'AirPlay' : 'UPNP');

    // 检查任意投屏连接
    const castActive = _upnpActiveDeviceId || (AirPlayState.activeDeviceId && _castDeviceType === 'airplay');
    const castName = _castDeviceType === 'airplay' ? AirPlayState.activeDeviceName : _upnpActiveDeviceName;

    if (castActive) {
        // Desktop button
        if (btn) {
            btn.classList.remove('text-gray-500', 'hover:text-emerald-600', 'border-gray-300');
            btn.classList.add('text-emerald-500', 'hover:text-emerald-600', 'border-emerald-300');
            btn.title = typeLabel + '投屏中: ' + castName;
        }
        // Mobile button
        if (mobileBtn) {
            mobileBtn.classList.remove('t-text-muted');
            mobileBtn.classList.add('text-emerald-500');
            mobileBtn.title = typeLabel + '投屏中: ' + castName;
        }
    } else {
        // Desktop button
        if (btn) {
            btn.classList.add('text-gray-500', 'hover:text-emerald-600', 'border-gray-300');
            btn.classList.remove('text-emerald-500', 'hover:text-emerald-600', 'border-emerald-300');
            btn.title = '投屏到设备';
        }
        // Mobile button
        if (mobileBtn) {
            mobileBtn.classList.add('t-text-muted');
            mobileBtn.classList.remove('text-emerald-500');
            mobileBtn.title = '投屏到设备';
        }
    }
}

// ===== 旧 DLNA 轮询/状态机逻辑已移至后端 DMC（dlnaDmc.ts），以下为 WS 集成 hook =====

/** playSong hook：投屏时通过 WS 发送播放命令给 DMC
 *
 * 三种场景：
 * 1. 新歌单（指纹刚变）→ syncPlaylistToDmc 已发 setPlaylist，DMC 自动播放，此处跳过
 * 2. 同一歌单内切歌（指纹未变）→ 发 play 命令让 DMC 播指定歌曲
 * 3. AirPlay 投屏 → 通过 AirPlay WS 发送 play 命令
 */
function _upnpPlaySongHook(song, audioSrc) {
    // AirPlay 投屏模式
    if (AirPlayState.activeDeviceId && song && _castDeviceType === 'airplay') {
        if (AirPlayState.playlistJustSynced) {
            AirPlayState.playlistJustSynced = false;
            return true;
        }
        sendAirPlayCommand('play', {
            song: buildDlnaPlaylist([song])[0],
            index: typeof window.currentIndex !== 'undefined' ? window.currentIndex : -1,
        });
        return true;
    }
    // DLNA/UPNP 投屏模式
    if (_upnpActiveDeviceId && song && _castDeviceType === 'upnp') {
        // 场景1：刚通过 syncPlaylistToDmc 发了新歌单，DMC setPlaylist(playImmediately=true) 已触发播放
        if (_dlnaPlaylistJustSynced) {
            _dlnaPlaylistJustSynced = false;
            // [LOG CLEANED] console.log(`[DLNA] _upnpPlaySongHook: skipped (new playlist sync already triggered play), song=${song.name}`);
            return true;
        }
        // 场景2：同一歌单内切歌，发 play 命令
        // [LOG CLEANED] console.log(`[DLNA] _upnpPlaySongHook: play song in current playlist, song=${song.name}, index=${typeof window.currentIndex !== 'undefined' ? window.currentIndex : -1}`);
        sendDlnaCommand('play', {
            song: buildDlnaPlaylist([song])[0],
            index: typeof window.currentIndex !== 'undefined' ? window.currentIndex : -1,
        });
        // 投屏时不在本地播放音频
        return true;
    }
    return false;
}

/** 投屏切换播放/暂停 — 通过 WS 控制 DMC */
async function upnpTogglePlayPause() {
    if (!_upnpActiveDeviceId && !AirPlayState.activeDeviceId) return;
    if (_castDeviceType === 'local') {
        // 本地播放设备仍用 HTTP API
        try {
            const headers = {'Content-Type': 'application/json'};
            Object.assign(headers, getUserAuthHeaders());
            const statusRes = await fetch('/api/local/status', {headers});
            const statusResult = await statusRes.json();
            if (statusResult.success) {
                if (statusResult.state === 'PLAYING') {
                    await fetch('/api/local/pause', {method: 'POST', headers});
                    updatePlayButton(false);
                    if (lyricPlayer) lyricPlayer.pause();
                } else {
                    await fetch('/api/local/resume', {method: 'POST', headers});
                    updatePlayButton(true);
                }
            }
        } catch (err) {
            console.error('[Cast] Toggle play failed:', err);
        }
        return;
    }
    if (_castDeviceType === 'airplay') {
        // AirPlay 设备：通过 AirPlay WS 控制
        const isPlaying = AirPlayState.lastPlayState === 'PLAYING' || AirPlayState.lastPlayState === 'TRANSITIONING';
        if (isPlaying) {
            sendAirPlayCommand('pause', {});
            updatePlayButton(false);
            if (lyricPlayer) lyricPlayer.pause();
        } else {
            sendAirPlayCommand('resume', {});
            updatePlayButton(true);
        }
        return;
    }
    // UPNP 设备：通过 WS 控制 DMC
    // 根据当前播放状态决定暂停还是恢复（无论 currentPlayingSong 是否为 null，都基于实际播放状态判断）
    const isPlaying = _dlnaLastPlayState === 'PLAYING' || _dlnaLastPlayState === 'TRANSITIONING';
    if (isPlaying) {
        sendDlnaCommand('pause', {});
        updatePlayButton(false);
        if (lyricPlayer) lyricPlayer.pause();
    } else {
        sendDlnaCommand('resume', {});
        updatePlayButton(true);
    }
}

/** 投屏进度跳转 — 通过 WS 控制 DMC */
async function upnpSeekTo(positionSeconds) {
    if ((!_upnpActiveDeviceId && !AirPlayState.activeDeviceId) || !Number.isFinite(positionSeconds) || positionSeconds < 0) return;
    if (_castDeviceType === 'local') {
        try {
            const headers = {'Content-Type': 'application/json'};
            Object.assign(headers, getUserAuthHeaders());
            await fetch('/api/local/seek', {
                method: 'POST',
                headers,
                body: JSON.stringify({position: positionSeconds})
            });
        } catch (err) { /* ignore */
        }
        return;
    }
    if (_castDeviceType === 'airplay') {
        sendAirPlayCommand('seek', { position: positionSeconds });
        return;
    }
    sendDlnaCommand('seek', {position: positionSeconds});
}

/** 投屏设置音量 — 通过 WS 控制 DMC */
function upnpSetVolume(level) {
    if (!_upnpActiveDeviceId && !AirPlayState.activeDeviceId) return;
    if (_castDeviceType === 'local') {
        try {
            const headers = {'Content-Type': 'application/json'};
            Object.assign(headers, getUserAuthHeaders());
            fetch('/api/local/volume', {method: 'POST', headers, body: JSON.stringify({volume: level})}).catch(() => {
            });
        } catch (e) { /* ignore */
        }
        return;
    }
    if (_castDeviceType === 'airplay') {
        sendAirPlayCommand('volume', { volume: level });
        return;
    }
    sendDlnaCommand('volume', {volume: level});
}

/** 初始化 DLNA WS 并恢复连接状态 */
async function restoreUpnpConnection() {
    // 初始化 WS 连接，WS 连接成功后 DMC 会自动推送完整状态
    initDlnaWs();
    // 同时初始化 AirPlay WS
    initAirPlayWs();
}

// ===== Window exports =====
// State objects (const, no reassignment issue)
window.DlnaDmcState = DlnaDmcState;
window.LocalPlayerState = LocalPlayerState;
window.AirPlayState = AirPlayState;

// let variables need Object.defineProperty for live sync
Object.defineProperty(window, '_castDeviceType', { get() { return _castDeviceType; }, set(v) { _castDeviceType = v; }, configurable: true });
Object.defineProperty(window, '_dlnaWs', { get() { return _dlnaWs; }, set(v) { _dlnaWs = v; }, configurable: true });
Object.defineProperty(window, '_upnpDevices', { get() { return _upnpDevices; }, set(v) { _upnpDevices = v; }, configurable: true });
Object.defineProperty(window, '_upnpActiveDeviceId', { get() { return _upnpActiveDeviceId; }, set(v) { _upnpActiveDeviceId = v; }, configurable: true });
Object.defineProperty(window, '_upnpActiveDeviceName', { get() { return _upnpActiveDeviceName; }, set(v) { _upnpActiveDeviceName = v; }, configurable: true });
Object.defineProperty(window, '_dlnaLastPosition', { get() { return _dlnaLastPosition; }, set(v) { _dlnaLastPosition = v; }, configurable: true });
Object.defineProperty(window, '_dlnaLastDuration', { get() { return _dlnaLastDuration; }, set(v) { _dlnaLastDuration = v; }, configurable: true });
Object.defineProperty(window, '_dlnaLastPlayState', { get() { return _dlnaLastPlayState; }, set(v) { _dlnaLastPlayState = v; }, configurable: true });
Object.defineProperty(window, '_dlnaPlaylistFingerprint', { get() { return _dlnaPlaylistFingerprint; }, set(v) { _dlnaPlaylistFingerprint = v; }, configurable: true });
Object.defineProperty(window, '_dlnaPlaylistJustSynced', { get() { return _dlnaPlaylistJustSynced; }, set(v) { _dlnaPlaylistJustSynced = v; }, configurable: true });
Object.defineProperty(window, '_localDevices', { get() { return _localDevices; }, set(v) { _localDevices = v; }, configurable: true });
Object.defineProperty(window, '_localPlayerInfo', { get() { return _localPlayerInfo; }, set(v) { _localPlayerInfo = v; }, configurable: true });
Object.defineProperty(window, '_isReceivingDmcState', { get() { return _isReceivingDmcState; }, set(v) { _isReceivingDmcState = v; }, configurable: true });
Object.defineProperty(window, '_dlnaWsReconnectTimer', { get() { return _dlnaWsReconnectTimer; }, set(v) { _dlnaWsReconnectTimer = v; }, configurable: true });
Object.defineProperty(window, '_dlnaWsReconnectDelay', { get() { return _dlnaWsReconnectDelay; }, set(v) { _dlnaWsReconnectDelay = v; }, configurable: true });

// Functions
window.initDlnaWs = initDlnaWs;
window.sendDlnaCommand = sendDlnaCommand;
window.onDlnaMessage = onDlnaMessage;
window.syncPlaylistToDmc = syncPlaylistToDmc;
window.syncPlaylistToAirPlay = syncPlaylistToAirPlay;
window.buildDlnaPlaylist = buildDlnaPlaylist;
// Additional functions exposed for external access
window.setCastMute = setCastMute;
window.getCurrentPlayingSong = getCurrentPlayingSong;
window.toggleUpnpPanel = toggleUpnpPanel;
window.closeUpnpPanel = closeUpnpPanel;
window.scanAllCastDevices = scanAllCastDevices;
window.scanUpnpDevices = scanUpnpDevices;
window.renderUpnpDeviceList = renderUpnpDeviceList;
window.renderLocalDeviceList = renderLocalDeviceList;
window.selectLocalDevice = selectLocalDevice;
window.onUpnpConnected = onUpnpConnected;
window.disconnectUpnpDevice = disconnectUpnpDevice;
window.updateUpnpCurrentDeviceUI = updateUpnpCurrentDeviceUI;
window.updateUpnpCastButton = updateUpnpCastButton;
window.computePlaylistFingerprint = computePlaylistFingerprint;
window.updateDlnaPlayingInfo = updateDlnaPlayingInfo;
window._upnpPlaySongHook = _upnpPlaySongHook;
window.upnpTogglePlayPause = upnpTogglePlayPause;
window.upnpSeekTo = upnpSeekTo;
window.upnpSetVolume = upnpSetVolume;
window.restoreUpnpConnection = restoreUpnpConnection;
window.selectUpnpDevice = selectUpnpDevice;

// ============================================================================
// AirPlay DMC 投屏控制模块 (AirPlay Casting Control Module)
// ============================================================================

/** AirPlay WebSocket 连接管理 */
function initAirPlayWs() {
    if (AirPlayState.ws && (AirPlayState.ws.readyState === WebSocket.OPEN || AirPlayState.ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProtocol + '//' + location.host + '/ws/airplay';

    try {
        AirPlayState.ws = new WebSocket(wsUrl);
    } catch (err) {
        console.warn('[AirPlay-WS] 创建连接失败:', err);
        scheduleAirPlayWsReconnect();
        return;
    }

    AirPlayState.ws.onopen = () => {
        AirPlayState.wsReconnectDelay = TIMEOUT.WS_RECONNECT_BASE;
    };

    AirPlayState.ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            onAirPlayMessage(msg);
        } catch (err) {
            console.warn('[AirPlay-WS] 消息解析失败:', err);
        }
    };

    AirPlayState.ws.onclose = () => {
        AirPlayState.ws = null;
        scheduleAirPlayWsReconnect();
    };

    AirPlayState.ws.onerror = () => {
        console.warn('[AirPlay-WS] 连接错误');
    };
}

/** AirPlay WS 重连（指数退避） */
function scheduleAirPlayWsReconnect() {
    if (AirPlayState.wsReconnectTimer) return;
    AirPlayState.wsReconnectTimer = setTimeout(() => {
        AirPlayState.wsReconnectTimer = null;
        AirPlayState.wsReconnectDelay = Math.min(AirPlayState.wsReconnectDelay * 2, TIMEOUT.WS_RECONNECT_MAX);
        initAirPlayWs();
    }, AirPlayState.wsReconnectDelay);
}

/** 发送 AirPlay 控制命令 */
function sendAirPlayCommand(type, payload) {
    if (!AirPlayState.ws || AirPlayState.ws.readyState !== WebSocket.OPEN) {
        console.warn('[AirPlay-WS] 未连接，无法发送命令:', type);
        return;
    }
    AirPlayState.ws.send(JSON.stringify({ type, payload }));
}

/** 处理 AirPlay DMC 推送的消息 */
function onAirPlayMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
        case 'state':
            AirPlayState.isReceivingState = true;
            try {
                if (payload.connected && payload.deviceId) {
                    AirPlayState.activeDeviceId = payload.deviceId;
                    AirPlayState.activeDeviceName = payload.deviceName || '';
                    _castDeviceType = 'airplay';
                    updateUpnpCastButton();
                    updateUpnpCurrentDeviceUI();
                    setCastMute(true);
                } else if (!payload.connected) {
                    AirPlayState.activeDeviceId = null;
                    AirPlayState.activeDeviceName = '';
                    if (_castDeviceType === 'airplay') _castDeviceType = null;
                    updateUpnpCastButton();
                    updateUpnpCurrentDeviceUI();
                    setCastMute(false);
                }

                if (payload.playlist && payload.playlist.length > 0) {
                    if (typeof window.currentPlaylist !== 'undefined') {
                        window.currentPlaylist = payload.playlist;
                        window.currentIndex = payload.playlistIndex >= 0 ? payload.playlistIndex : 0;
                        if (typeof renderQueueList === 'function') renderQueueList();
                    }
                }

                if (payload.currentSong) {
                    updateDlnaPlayingInfo(payload);
                }

                if (payload.playMode && typeof window.playMode !== 'undefined') {
                    // AirPlay 设备模式 → 前端模式（与 UPNP 反向映射保持一致）
                    const feModeMap = { listLoop: 'list', list: 'order', singleLoop: 'single', single: 'order', random: 'random' };
                    const mappedMode = feModeMap[payload.playMode];
                    if (mappedMode && mappedMode !== window.playMode) {
                        window.playMode = mappedMode;
                        updatePlayModeUI();
                        try {
                            localStorage.setItem('lx_play_mode', mappedMode);
                        } catch (e) {
                        }
                    }
                }
            } finally {
                AirPlayState.isReceivingState = false;
            }
            break;

        case 'playState':
            AirPlayState.lastPlayState = payload.playState;
            AirPlayState.lastPosition = payload.position || 0;
            AirPlayState.lastDuration = payload.duration || 0;
            if (payload.playState === 'PLAYING') {
                updatePlayButton(true);
                setPlayerStatus('AirPlay投屏中 - ' + (AirPlayState.activeDeviceName || ''), true);
            } else if (payload.playState === 'PAUSED') {
                updatePlayButton(false);
                setPlayerStatus('AirPlay暂停中 - ' + (AirPlayState.activeDeviceName || ''), false);
                if (lyricPlayer) lyricPlayer.pause();
            } else if (payload.playState === 'IDLE' || payload.playState === 'RESOLVING') {
                updatePlayButton(false);
            }
            break;

        case 'progress':
            AirPlayState.lastPosition = payload.position || 0;
            AirPlayState.lastDuration = payload.duration || 0;
            if (payload.duration > 0 && typeof formatTime === 'function') {
                const timeCurrentEl = document.getElementById('time-current');
                const timeTotalEl = document.getElementById('time-total');
                const progressBarEl = document.getElementById('progress-bar');
                if (timeCurrentEl) timeCurrentEl.innerText = formatTime(payload.position);
                if (timeTotalEl) timeTotalEl.innerText = formatTime(payload.duration);
                if (progressBarEl && typeof isDragging !== 'undefined' && !isDragging) {
                    progressBarEl.style.width = (payload.position / payload.duration * 100) + '%';
                }
                // 同步歌词
                if (lyricPlayer) {
                    lyricPlayer.play(payload.position * 1000);
                    if (typeof isUserScrolling !== 'undefined') isUserScrolling = false;
                }
            }
            break;

        case 'volume':
            if (typeof window.updateDlnaVolume === 'function') {
                window.updateDlnaVolume(payload);
            }
            break;

        case 'songChange':
            if (payload.song) {
                // 优先使用本地歌单中完整元数据的歌曲（推送的是轻量对象，缺少 sampleRate/bitDepth 等），
                // 确保 updatePlayerInfo/updateAudioInfoTags 能渲染完整的音频参数标签
                let song = payload.song;
                const idx = payload.index;
                if (typeof idx === 'number' && idx >= 0
                    && window.currentPlaylist && window.currentPlaylist[idx]
                    && window.currentPlaylist[idx].id === payload.song.id) {
                    song = window.currentPlaylist[idx];
                }
                window.currentPlayingSong = song;
                if (typeof window.currentIndex !== 'undefined' && typeof idx === 'number') {
                    window.currentIndex = idx;
                }
                // 复用 DLNA 的播放信息更新逻辑（更新播放栏/媒体会话/播放按钮，并静音本地音频）
                // 注意：必须传入 song，此前误用无参 updatePlayerInfo() 会抛 TypeError 导致播放栏不更新
                updateDlnaPlayingInfo({currentSong: song, position: 0, duration: 0, playState: 'PLAYING'});
                // [Fix] 设置 AirPlay 投屏状态文本（updateDlnaPlayingInfo 不更新状态文本）
                setPlayerStatus('AirPlay投屏中 - ' + (AirPlayState.activeDeviceName || ''), true);
                // 刷新所有可见列表的"正在播放"指示（队列/专辑详情/音乐库等）
                if (typeof refreshVisiblePlayingIndicators === 'function') refreshVisiblePlayingIndicators();
            }
            break;

        case 'playlist':
            if (payload.songs && typeof window.currentPlaylist !== 'undefined') {
                window.currentPlaylist = payload.songs;
                window.currentIndex = payload.index >= 0 ? payload.index : 0;
                if (typeof renderQueueList === 'function') renderQueueList();
            }
            break;

        case 'error':
            console.warn('[AirPlay-WS] 错误:', payload.message);
            break;

        case 'connected':
            AirPlayState.activeDeviceId = payload.deviceId;
            AirPlayState.activeDeviceName = payload.deviceName || '';
            _castDeviceType = 'airplay';
            updateUpnpCastButton();
            updateUpnpCurrentDeviceUI();
            setCastMute(true);
            break;

        case 'disconnected':
            AirPlayState.activeDeviceId = null;
            AirPlayState.activeDeviceName = '';
            if (_castDeviceType === 'airplay') _castDeviceType = null;
            updateUpnpCastButton();
            updateUpnpCurrentDeviceUI();
            setCastMute(false);
            // 断开投屏后本地 Web 播放器立即暂停，不自动恢复
            if (window.audio && !window.audio.paused) {
                try { window.audio.pause(); } catch (e) { /* ignore */ }
            }
            updatePlayButton(false);
            setPlayerStatus('');
            break;
    }

    renderAirPlayDeviceList();
}

/** 渲染 AirPlay 设备列表 UI */
function renderAirPlayDeviceList() {
    const listEl = document.getElementById('airplay-device-list');
    if (!listEl) return;

    const devices = AirPlayState.devices || [];
    if (devices.length === 0) {
        listEl.innerHTML = '<div class="text-center py-4 t-text-muted"><p class="text-xs">未发现AirPlay设备</p></div>';
        return;
    }

    listEl.innerHTML = devices.map(device => {
        const isActive = device.id === AirPlayState.activeDeviceId && _castDeviceType === 'airplay';
        return `
            <button onclick="selectAirPlayDevice('${device.id.replace(/'/g, "\\'")}')" 
                class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 ${isActive ? 'bg-blue-50 border-blue-300 dark:bg-blue-900/20 dark:border-blue-700' : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'}">
                <div class="w-10 h-10 rounded-lg ${isActive ? 'bg-blue-100 dark:bg-blue-800/40' : 'bg-gray-100 dark:bg-gray-700'} flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-${isActive ? 'volume-up text-blue-500' : 'airplay text-gray-400 dark:text-gray-500'}"></i>
                </div>
                <div class="flex-1 text-left min-w-0">
                    <div class="text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-400' : 't-text-main'} truncate">${escapeHtml(device.name)}</div>
                    <div class="text-xs t-text-muted truncate">${escapeHtml(device.model || 'AirPlay设备')}</div>
                </div>
                ${isActive ? '<span class="text-[10px] px-2 py-0.5 bg-blue-500 text-white rounded-full font-bold">已连接</span>' : ''}
            </button>
        `;
    }).join('');
}

/** 选择 AirPlay 设备 */
async function selectAirPlayDevice(deviceId) {
    const device = AirPlayState.devices.find(d => d.id === deviceId);
    if (!device) return;

    // 若已是当前设备，断开连接
    if (AirPlayState.activeDeviceId === deviceId && _castDeviceType === 'airplay') {
        disconnectAirPlayDevice();
        return;
    }

    // 断开其他投屏连接
    if (_upnpActiveDeviceId && _castDeviceType !== 'airplay') {
        await disconnectUpnpDevice();
    }

    // 确保 AirPlay WS 已连接
    initAirPlayWs();

    // 发送连接命令
    sendAirPlayCommand('connect', { deviceId });

    // 设置本地状态
    AirPlayState.activeDeviceName = device.name;
    _castDeviceType = 'airplay';
    syncCastStateToObjects();

    // 如果有正在播放的歌曲，推送到 AirPlay
    const song = getCurrentPlayingSong();
    const isAudioPlaying = window.audio && !window.audio.paused;
    if (isAudioPlaying && song) {
        // 静音本地音频
        if (window.audio && !window.audio.paused) {
            try {
                window.audio.pause();
            } catch (e) { /* ignore */
            }
        }
        setCastMute(true);
        // 推送歌单和当前歌曲到 AirPlay DMC
        syncPlaylistToAirPlay(window.currentPlaylist, window.currentIndex, true);
    }

    showSuccess('已连接到 ' + device.name);
}

/** 断开 AirPlay 设备 */
function disconnectAirPlayDevice() {
    sendAirPlayCommand('disconnect', {});
    AirPlayState.activeDeviceId = null;
    AirPlayState.activeDeviceName = '';
    if (_castDeviceType === 'airplay') _castDeviceType = null;
    updateUpnpCastButton();
    updateUpnpCurrentDeviceUI();
    setCastMute(false);
    // 断开投屏后本地 Web 播放器立即暂停，不自动恢复
    if (window.audio && !window.audio.paused) {
        try { window.audio.pause(); } catch (e) { /* ignore */ }
    }
    updatePlayButton(false);
    setPlayerStatus('');
    renderAirPlayDeviceList();
}

// 导出 AirPlay 函数到 window
window.initAirPlayWs = initAirPlayWs;
window.sendAirPlayCommand = sendAirPlayCommand;
window.onAirPlayMessage = onAirPlayMessage;
window.renderAirPlayDeviceList = renderAirPlayDeviceList;
window.selectAirPlayDevice = selectAirPlayDevice;
window.disconnectAirPlayDevice = disconnectAirPlayDevice;
