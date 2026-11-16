// ============================================================================
// 收藏与列表 (Favorites & Lists)
// 从 app.js 提取 — 包含同步登录/登出、列表渲染/CRUD、Playlist Add Modal
// ============================================================================
// 依赖全局: renderResults, updatePlaylist, playSong, currentPlayingSong, settings

// ============================================================================
// Block 1: Favorites initialization + toggleFavorites
// ============================================================================

// Initialize Favorites as hidden (collapsed)
const favList = document.getElementById('favorites-children');
if (favList) {
    favList.style.height = '0px';
    // favList.classList.add('hidden'); // using height transition instead
}

function toggleFavorites() {
    const list = document.getElementById('favorites-children');
    const arrow = document.getElementById('favorites-arrow');

    // Toggle logic
    if (list.style.height === '0px' || list.style.height === '') {
        list.style.height = 'auto'; // Estimate or auto
        list.style.height = list.scrollHeight + 'px'; // Smooth transition
        arrow.style.transform = 'rotate(0deg)'; // Arrow down
    } else {
        list.style.height = '0px';
        arrow.style.transform = 'rotate(-90deg)'; // Arrow right
    }
}

// Initial rotate for collapsed state
const favArrow = document.getElementById('favorites-arrow');
if (favArrow) favArrow.style.transform = 'rotate(-90deg)';


// ============================================================================
// Block 2: Sync functionality
// ============================================================================

// Link SyncManager from user_sync.js
// Link SyncManager from user_sync.js
const syncManager = window.SyncManager;
let currentListData = null;
Object.defineProperty(window, 'currentListData', { get() { return currentListData; }, set(v) { currentListData = v; }, configurable: true });
let syncModeResolve = null;
Object.defineProperty(window, 'syncModeResolve', { get() { return syncModeResolve; }, set(v) { syncModeResolve = v; }, configurable: true });

function switchSyncMode(mode) {
    const btnLocal = document.getElementById('btn-mode-local');
    const btnRemote = document.getElementById('btn-mode-remote');
    const formRemote = document.getElementById('sync-form-remote');

    if (mode === 'local') {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 t-text-muted hover:bg-gray-200 transition-all";
        if (formRemote) formRemote.classList.add('hidden');
        // 本地登录通过弹窗进行
        showLoginDialog();
    } else {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 t-text-muted hover:bg-gray-200 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 ring-2 ring-blue-500 transition-all";
        if (formRemote) formRemote.classList.remove('hidden');
        // Reset Remote Flow
        handleRemoteBack();
    }
}

//同步设置
async function pushSettingsToServer(force = false) {
    if (!force && !settings.saveAccountSettingsToFile) return;
    // Only local sync mode supports this for now
    if (localStorage.getItem('lx_sync_mode') !== 'local' && !window.lx_config?.['user.enablePublicRestriction'] && !force) return;

    const user = localStorage.getItem('lx_sync_user');
    const isPublicMode = !user && window.lx_config?.['user.enablePublicRestriction'];
    if (!user && !isPublicMode && !force) return;

    try {
        const headers = {'Content-Type': 'application/json'};
        if (isPublicMode) {
            // 公开受限用户：不需账号认证，但需要管理员密码
            headers['x-user-name'] = 'default';
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        } else {
            // 已登录用户：使用 Token（或兼容旧密码）
            Object.assign(headers, getUserAuthHeaders());
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        }

        const res = await fetch('/api/user/settings', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(settings)
        });
        if (res.ok) {
        }

        // 同时同步音质配置
        if (window.soundEffects && typeof window.soundEffects.pushToServer === 'function') {
            window.soundEffects.pushToServer();
        }
    } catch (e) {
        console.error('[Settings] 同步到服务器失败:', e);
        if (force) throw e;
    }
}

async function manualSaveSettings(btn) {
    const originalText = btn.innerHTML;
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 正在处理...';

        // 1. Sync to localStorage
        localStorage.setItem('lx_settings', JSON.stringify(settings));

        // 2. Force push to server (settings.json)
        await pushSettingsToServer(true);

        btn.innerHTML = '<i class="fas fa-check mr-2"></i> 保存成功 (已同步到服务器)';
        btn.classList.add('bg-emerald-50', 'dark:bg-emerald-500/10', 'text-emerald-600', 'dark:text-emerald-400', 'border-emerald-200');
        btn.classList.remove('bg-blue-50', 'dark:bg-blue-500/10', 'text-blue-600', 'dark:text-blue-400', 'border-blue-100');

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('bg-emerald-50', 'dark:bg-emerald-500/10', 'text-emerald-600', 'dark:text-emerald-400', 'border-emerald-200');
            btn.classList.add('bg-blue-50', 'dark:bg-blue-500/10', 'text-blue-600', 'dark:text-blue-400', 'border-blue-100');
            btn.disabled = false;
        }, 2000);
        showSuccess('配置已成功保存并同步至服务器');
    } catch (e) {
        console.error('[Settings] 手动保存失败:', e);
        btn.innerHTML = '<i class="fas fa-times mr-2"></i> 保存失败';
        btn.classList.add('text-red-500', 'border-red-200');
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('text-red-500', 'border-red-200');
            btn.disabled = false;
        }, 2000);
        showError('同步失败，请检查网络或登录状态');
    }
}

async function fetchSettingsFromServer() {
    if (!settings.saveAccountSettingsToFile) return;

    const user = localStorage.getItem('lx_sync_user');
    const isPublicMode = !user && window.lx_config?.['user.enablePublicRestriction'];
    if (!user && !isPublicMode) return;

    try {
        const headers = {};
        if (isPublicMode) {
            headers['x-user-name'] = 'default';
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        } else {
            Object.assign(headers, getUserAuthHeaders());
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        }

        const res = await fetch('/api/user/settings', {
            headers: headers
        });

        if (res.ok) {
            const serverSettings = await res.json();
            // Merge settings
            settings = {...settings, ...serverSettings};
            // Save to local
            localStorage.setItem('lx_settings', JSON.stringify(settings));
            // Update UI
            if (typeof window.syncSettingsUI === 'function') window.syncSettingsUI();

            // 应用服务端播放模式（登录后立即生效，无需刷新页面）
            if (settings.playMode && ['list', 'single', 'random', 'order'].includes(settings.playMode) &&
                typeof window.playMode !== 'undefined' && settings.playMode !== window.playMode) {
                window.playMode = settings.playMode;
                try { localStorage.setItem('lx_play_mode', settings.playMode); } catch (e) {}
                if (typeof window.updatePlayModeUI === 'function') window.updatePlayModeUI();
            }

            if (typeof showSuccess === 'function') {
                showSuccess('已从服务器恢复设置');
            }

            // 同时加载音效设置
            if (window.soundEffects && typeof window.soundEffects.fetchFromServer === 'function') {
                window.soundEffects.fetchFromServer();
            }
        } else {
        }
    } catch (e) {
        console.error('[Settings] 从服务器加载设置失败:', e);
    }
}


function updateSyncStatus(html, showLogout = true) {
    const statusEl = document.getElementById('sync-status');
    const settingsOption = document.getElementById('sync-settings-file-option');
    if (!statusEl) return;

    let fullHtml = html;
    // Show logout button if requested AND we have active data or connection
    const hasActiveLogin = currentListData || (syncManager && syncManager.client && syncManager.client.isConnected);
    if (showLogout && hasActiveLogin) {
        fullHtml += ` <button onclick="handleSyncLogout()" class="ml-2 text-red-500 hover:text-red-600 text-[10px] md:text-xs font-bold px-2 py-0.5 rounded border border-red-200 hover:bg-red-300/10 transition-all inline-flex items-center gap-1" title="退出登录"><i class="fas fa-sign-out-alt"></i><span class="hidden sm:inline">退出登录</span></button>`;

        // Add "Sync from Remote" button if in LOCAL mode
        if (localStorage.getItem('lx_sync_mode') === 'local') {
            const username = localStorage.getItem('lx_sync_user') || '该用户';
            fullHtml += ` <button onclick="showRemoteOverwriteModal('${username}')" class="ml-2 text-emerald-500 hover:text-emerald-600 text-[10px] md:text-xs font-bold px-2 py-0.5 rounded border border-emerald-200 hover:bg-emerald-300/10 transition-all inline-flex items-center gap-1" title="连接远程服务器"><i class="fas fa-satellite-dish"></i><span class="hidden sm:inline">连接远程服务器</span></button>`;
        }
    }
    statusEl.innerHTML = fullHtml;
    // [新增] 状态变化后刷新登录界面禁用状态
    if (typeof updateAdminUI === 'function') updateAdminUI();
}

async function handleSyncLogout() {
    // [新增] 造访调用服务端注销 Token
    if (userToken) {
        try {
            await fetch('/api/user/logout', {
                method: 'POST',
                headers: {'x-user-token': userToken}
            });
        } catch (e) {
            console.warn('[Auth] Token 注销失败:', e);
        }
        localStorage.removeItem('lx_user_token');
        userToken = null;
    }

    if (syncManager && syncManager.client && typeof syncManager.client.close === 'function') {
        syncManager.client.close();
    }

    currentListData = null;
    localStorage.removeItem('lx_sync_mode');
    localStorage.removeItem('lx_sync_user');
    localStorage.removeItem('lx_sync_pass');
    localStorage.removeItem('lx_sync_url');
    localStorage.removeItem('lx_sync_code');
    localStorage.removeItem('lx_ws_auth');
    localStorage.removeItem('lx_list_data');

    // Clear forms (已删除的本地表单元素不再清理)
    const remoteUrl = document.getElementById('sync-remote-url');
    const remoteCode = document.getElementById('sync-remote-code');
    if (remoteUrl) remoteUrl.value = '';
    if (remoteCode) remoteCode.value = '';

    // Reset UI Status (no logout button here)
    updateSyncStatus('<i class="fas fa-circle text-[8px] text-gray-300"></i> 状态: 未连接', false);

    // Clear sidebar lists
    renderMyLists({defaultList: [], loveList: [], userList: []});

    if (typeof showSuccess === 'function') {
        showSuccess('已退出登录并清除同步数据');
    }
}

/**
 * 本地登录（已废弃，委托给 showLoginDialog）。
 * 保留函数名以兼容外部引用。
 */
async function handleLocalLogin() {
    return showLoginDialog();
}

function showSyncModeModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('sync-connect-form').classList.add('hidden');
    document.getElementById('sync-mode-selection').classList.remove('hidden');
}


function closeSyncModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Reset views
    document.getElementById('sync-connect-form').classList.remove('hidden');
    document.getElementById('sync-mode-selection').classList.add('hidden');

    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
}

function selectSyncMode(mode) {
    const fullOverwrite = document.getElementById('sync-full-overwrite').checked;
    if (fullOverwrite && mode.startsWith('overwrite')) {
        mode += '_full';
    }

    const translatedMode = mode;

    if (syncModeResolve) {
        syncModeResolve(translatedMode);
        syncModeResolve = null;
    }
    closeSyncModal();
}

function cancelSyncMode() {
    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
    closeSyncModal();
}

function handleRemoteStep1() {
    const url = document.getElementById('sync-remote-url').value.trim();
    if (!url) {
        showError('请输入链接地址');
        return;
    }
    // Basic validation
    if (!url.match(/^(ws|http)s?:\/\//)) {
        showError('链接格式错误，应以 http://, https://, ws:// 或 wss:// 开头');
        return;
    }

    document.getElementById('sync-remote-step1').classList.add('hidden');
    document.getElementById('sync-remote-step2').classList.remove('hidden');
}

function handleRemoteBack() {
    document.getElementById('sync-remote-step1').classList.remove('hidden');
    document.getElementById('sync-remote-step2').classList.add('hidden');
    document.getElementById('sync-remote-code').value = ''; // Optional clear
}

function handleRemoteConnect() {
    const url = document.getElementById('sync-remote-url').value;
    const code = document.getElementById('sync-remote-code').value;
    const statusEl = document.getElementById('sync-status');

    if (!code) {
        showError('请输入连接码');
        return;
    }

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-500"></i> 正在连接远程服务器...';

    try {
        let authInfo = null;
        if (localStorage.getItem('lx_sync_url') === url && localStorage.getItem('lx_sync_code') === code) {
            try {
                const savedStr = localStorage.getItem('lx_ws_auth');
                if (savedStr) authInfo = JSON.parse(savedStr);
            } catch (e) {
            }
        }

        syncManager.initRemote(url, code, {
            getData: async () => {
                // Try to load from cache first
                const cached = localStorage.getItem('lx_list_data');
                if (cached) {
                    try {
                        const data = JSON.parse(cached);
                        return data;
                    } catch (e) {
                        console.error('[Cache] 解析缓存失败:', e);
                    }
                }
                return currentListData || {defaultList: [], loveList: [], userList: []};
            },
            setData: async (data) => {
                // Save to cache
                localStorage.setItem('lx_list_data', JSON.stringify(data));
                // Update global
                const oldUsername = currentListData ? currentListData.username : null;
                currentListData = data;
                if (oldUsername) currentListData.username = oldUsername; // Preserve username

                // Render UI
                renderMyLists(data);
                updateSyncStatus('<i class="fas fa-check-circle text-blue-500"></i> 数据已同步');
            },
            getSyncMode: async () => {
                return new Promise((resolve) => {
                    syncModeResolve = resolve;
                    showSyncModeModal();
                });
            }
        }, authInfo);

        // Setup Callbacks
        syncManager.client.onLogin = async (success, msg) => {
            if (success) {
                updateSyncStatus('<i class="fas fa-check-circle text-green-500"></i> 已连接 (等待同步...)');
                // Remove manual sync() call. Let the server drive the sync via RPC.

                // Save connection info and authInfo to localStorage
                localStorage.setItem('lx_sync_mode', 'remote');
                localStorage.setItem('lx_sync_url', url);
                localStorage.setItem('lx_sync_code', code);

                // Save authInfo for reconnection
                if (syncManager.client.authInfo) {
                    localStorage.setItem('lx_ws_auth', JSON.stringify(syncManager.client.authInfo));
                }
            } else {
                statusEl.innerHTML = `<i class="fas fa-times-circle text-red-500"></i> 连接失败: ${msg || '未知错误'}`;
            }
        };

        syncManager.client.connect();

    } catch (e) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-red-500"></i> 错误: ${e.message}`;
    }
}

// ============================================================================
// Block 3: Remote Overwrite Modal
// ============================================================================

let currentRemoteOverwriteClient = null;
Object.defineProperty(window, 'currentRemoteOverwriteClient', { get() { return currentRemoteOverwriteClient; }, set(v) { currentRemoteOverwriteClient = v; }, configurable: true });

function switchRemoteModalStep(stepId) {
    const steps = ['remote-overwrite-step1', 'remote-overwrite-mode-selection', 'remote-overwrite-step2', 'remote-overwrite-result'];
    steps.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === stepId) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });
}

function showRemoteOverwriteModal(username) {
    const modal = document.getElementById('modal-remote-overwrite');
    const content = document.getElementById('modal-remote-overwrite-content');
    if (!modal) return;

    // Reset state and cleanup previous client if any
    if (currentRemoteOverwriteClient) {
        currentRemoteOverwriteClient.close();
        currentRemoteOverwriteClient = null;
    }

    switchRemoteModalStep('remote-overwrite-step1');
    document.getElementById('remote-overwrite-status').innerHTML = '';
    remoteSyncModeResolve = null;
    lastSelectedRemoteSyncMode = null;

    // Pre-fill from settings
    const urlInput = document.getElementById('remote-overwrite-url');
    const codeInput = document.getElementById('remote-overwrite-code');
    if (urlInput && settings.remoteSyncUrl) urlInput.value = settings.remoteSyncUrl;
    else if (urlInput) {
        const savedUrl = localStorage.getItem('lx_sync_url');
        if (savedUrl) urlInput.value = savedUrl;
    }
    if (codeInput && settings.remoteSyncCode) codeInput.value = settings.remoteSyncCode;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

function closeRemoteOverwriteModal(refresh = false) {
    const modal = document.getElementById('modal-remote-overwrite');
    const content = document.getElementById('modal-remote-overwrite-content');
    if (!modal) return;

    if (currentRemoteOverwriteClient) {
        currentRemoteOverwriteClient.close();
        currentRemoteOverwriteClient = null;
    }

    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

let remoteSyncModeResolve = null;
Object.defineProperty(window, 'remoteSyncModeResolve', { get() { return remoteSyncModeResolve; }, set(v) { remoteSyncModeResolve = v; }, configurable: true });
let lastSelectedRemoteSyncMode = null;
Object.defineProperty(window, 'lastSelectedRemoteSyncMode', { get() { return lastSelectedRemoteSyncMode; }, set(v) { lastSelectedRemoteSyncMode = v; }, configurable: true });

function selectRemoteOverwriteMode(mode) {
    if (remoteSyncModeResolve) {
        lastSelectedRemoteSyncMode = mode;
        // 保存上次选择的同步模式到设置中，以便客户端模式自动使用
        if (settings.lastRemoteSyncMode !== mode) {
            updateSetting('lastRemoteSyncMode', mode);
        }
        remoteSyncModeResolve(mode);
        remoteSyncModeResolve = null;
    }
}


async function handleRemoteOverwriteConnect(silent = false) {
    let url = settings.remoteSyncUrl || '';
    let code = settings.remoteSyncCode || '';

    // If not silent or inputs are accessible, try to get from DOM
    const urlInput = document.getElementById('remote-overwrite-url');
    const codeInput = document.getElementById('remote-overwrite-code');
    if (urlInput && urlInput.value.trim()) url = urlInput.value.trim();
    if (codeInput && codeInput.value.trim()) code = codeInput.value.trim();

    const statusEl = document.getElementById('remote-overwrite-status');

    if (!url || !code) {
        if (!silent && statusEl) statusEl.innerText = '请输入完整的连接信息';
        return;
    }

    if (!silent && statusEl) {
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-emerald-500"></i> 正在建立安全连接...';
    }

    if (currentRemoteOverwriteClient) currentRemoteOverwriteClient.close();
    currentRemoteOverwriteClient = new RemoteClient(url, code);
    const tempRemoteClient = currentRemoteOverwriteClient;

    tempRemoteClient.listHandlers = {
        getData: async () => {
            return currentListData || {defaultList: [], loveList: [], userList: []};
        },
        setData: async (data) => {
            try {
                // 1. Update UI and global memory (Preserve username)
                const oldUsername = currentListData ? currentListData.username : localStorage.getItem('lx_sync_user');
                currentListData = data;
                if (oldUsername) currentListData.username = oldUsername;

                localStorage.setItem('lx_list_data', JSON.stringify(data));
                renderMyLists(data);

                // 2. Push to local server (important!)
                if (syncManager && syncManager.mode === 'local') {
                    await syncManager.push(data);
                }
            } catch (err) {
                console.error('[RemoteOverwrite] 覆盖应用失败:', err);
            }
        },
        getSyncMode: async () => {
            // 如果开启了客户端模式且有上次选择的模式，则自动选择
            if (settings.enableClientModeSync && settings.lastRemoteSyncMode) {
                lastSelectedRemoteSyncMode = settings.lastRemoteSyncMode;
                return settings.lastRemoteSyncMode;
            }

            return new Promise((resolve) => {
                remoteSyncModeResolve = resolve;
                // If silent and no mode saved, we might have to show the modal anyway
                switchRemoteModalStep('remote-overwrite-mode-selection');
                if (silent) {
                    // Force show modal if it's hidden during silent sync but needs interaction
                    const modal = document.getElementById('modal-remote-overwrite');
                    if (modal && modal.classList.contains('hidden')) {
                        showRemoteOverwriteModal();
                    }
                }
            });
        }
    };

    tempRemoteClient.onLogin = (success, msg) => {
        if (success) {
            // Save address and code to settings and sync to server
            settings.remoteSyncUrl = url;
            settings.remoteSyncCode = code;
            localStorage.setItem('lx_settings', JSON.stringify(settings));
            if (settings.saveAccountSettingsToFile) {
                pushSettingsToServer();
            }
            if (!silent && statusEl) {
                statusEl.innerHTML = '<i class="fas fa-check-circle text-emerald-500"></i> 已连通，等待同步指令...';
            }
        } else {
            if (!silent && statusEl) {
                statusEl.classList.remove('t-text-muted');
                statusEl.classList.add('text-red-500');
                statusEl.innerText = '连接失败: ' + (msg || '未知错误');
            } else if (silent) {
                console.warn('[Sync] Silent connect failed:', msg);
            }
        }
    };

    tempRemoteClient.onSync = (status) => {
        if (status === 'finished') {
            if (!silent) {
                switchRemoteModalStep('remote-overwrite-result');
            } else {
                console.info('[Sync] Silent sync finished.');
                if (window.showInfo) showInfo('远程同步成功');
            }
            tempRemoteClient.close();
            currentRemoteOverwriteClient = null;

            // Updated result text logic below...
            const titleEl = document.getElementById('remote-overwrite-result-title');
            const textEl = document.getElementById('remote-overwrite-result-text');
            const username = localStorage.getItem('lx_sync_user') || '该用户';

            if (lastSelectedRemoteSyncMode === 'overwrite_local_remote_full') {
                if (titleEl) titleEl.innerText = '推送同步成功！';
                if (textEl) textEl.innerText = '当前本地账户歌单已成功覆盖至远程服务器。';
            } else if (lastSelectedRemoteSyncMode === 'merge_local_remote') {
                if (titleEl) titleEl.innerText = '合并同步成功！';
                if (textEl) textEl.innerText = '当前本地账户歌单已成功合并至远程服务器。';
            } else if (lastSelectedRemoteSyncMode === 'overwrite_remote_local_full') {
                if (titleEl) titleEl.innerText = '拉取覆盖成功！';
                if (textEl) textEl.innerText = '远程服务器歌单已成功覆盖至当前本地账户。';
            } else if (lastSelectedRemoteSyncMode === 'merge_remote_local') {
                if (titleEl) titleEl.innerText = '拉取合并成功！';
                if (textEl) textEl.innerText = '远程服务器歌单已成功合并至当前本地账户。';
            } else {
                if (titleEl) titleEl.innerText = '连接成功';
                if (textEl) textEl.innerText = '远程服务器已连接，当前数据内容与本地完全一致。';
            }

            // Update the status on the main settings page too
            updateSyncStatus(`<i class="fas fa-check-circle text-emerald-500"></i> 远程同步任务已完成 (${username})`);
        } else if (status === 'started' || status === 'syncing') {
            if (!silent) {
                switchRemoteModalStep('remote-overwrite-step2');
            }
        }
    };

    try {
        await tempRemoteClient.connect();
    } catch (err) {
        if (!silent && statusEl) statusEl.innerText = '初始化失败: ' + err.message;
        else console.error('[Sync] Silent connect failed:', err);
    }
}


// ============================================================================
// Block 4: List rendering & CRUD
// ============================================================================

function renderMyLists(data) {
    const container = document.getElementById('my-lists-container');
    container.innerHTML = '';

    if (!data) return;

    // Helper to create list item
    const createItem = (listObj, name, icon, count) => {
        const id = typeof listObj === 'string' ? listObj : listObj.id;
        const div = document.createElement('div');
        div.className = "px-4 py-2 text-xs t-text-muted hover:t-bg-main cursor-pointer flex items-center group transition-colors overflow-hidden";
        div.setAttribute('data-sidebar-list-id', id);
        div.onclick = () => handleListClick(id);

        // Use createMarqueeHtml for list name (hover-scroll: 默认省略号，悬停时滚动)
        const nameHtml = name.length > 8 ? createMarqueeHtml(name, 'flex-1 hover-scroll-marquee') : `<span class="flex-1 truncate">${name}</span>`;

        div.innerHTML = `
            <i class="fas ${icon} w-4 text-center text-xs mr-2 t-text-muted group-hover:text-emerald-500 transition-colors flex-shrink-0"></i>
            ${name.length > 8 ? `<div class="flex-1 overflow-hidden">${nameHtml}</div>` : nameHtml}
            <span class="text-xs text-gray-300 group-hover:t-text-muted mr-2 flex-shrink-0">${count}</span>
            ${id !== 'default' && id !== 'love' ? `<i class="fas fa-trash text-gray-300 hover:text-red-500 hidden group-hover:block flex-shrink-0" onclick="handleRemoveList('${id}', event)"></i>` : ''}
        `;
        return div;
    };

    // Default List
    if (data.defaultList) {
        container.appendChild(createItem('default', '播放记录', 'fa-list', data.defaultList.length));
    }
    // Love List
    if (data.loveList) {
        container.appendChild(createItem('love', '我的收藏', 'fa-heart', data.loveList.length));
    }
    // User Lists
    if (data.userList) {
        data.userList.forEach(l => {
            const listLen = l.list ? l.list.length : 0;
            container.appendChild(createItem(l, l.name, 'fa-music', listLen));
        });
    }

    // [Resume] 处理本地列表的自动恢复跳转
    if (window._pendingResumeListId) {
        const listId = window._pendingResumeListId;
        delete window._pendingResumeListId;
        // 调用 handleListClick 以加载真实的列表数据并应用高亮
        handleListClick(listId);
    }

    // 刷新 favorites-children 高度（已展开时自动撑开，修复收藏歌单后侧边栏不刷新问题）
    const favChildren = document.getElementById('favorites-children');
    if (favChildren && favChildren.style.height && favChildren.style.height !== '0px') {
        // 使用 requestAnimationFrame 确保 DOM 已完成渲染
        requestAnimationFrame(() => {
            favChildren.style.height = favChildren.scrollHeight + 'px';
        });
    }

    // 检测长名称并应用悬停滚动跑马灯 (Apply hover-scroll marquee for long list names)
    if (typeof applyMarqueeChecks === 'function') applyMarqueeChecks();
}

// 播放当前收藏列表全部歌曲 (Play all songs in current favorites list)
function playAllFavorites() {
    if (!window.viewingPlaylist || window.viewingPlaylist.length === 0) {
        showInfo('列表中没有歌曲');
        return;
    }
    updatePlaylist(window.viewingPlaylist, 0, currentSearchScope);
}
window.playAllFavorites = playAllFavorites;

// 更新收藏视图工具栏中的在线歌单操作按钮显隐 (Update online playlist ops buttons in favorites toolbar)
// 按钮位于 favorites-toolbar 的"播放全部"按钮前，仅在查看在线歌单时显示
function updateFavoritesToolbarOnlineBtns(show) {
    const refreshBtn = document.getElementById('favorites-toolbar-refresh');
    const jumpBtn = document.getElementById('favorites-toolbar-jump');
    if (refreshBtn) refreshBtn.classList.toggle('hidden', !show);
    if (jumpBtn) jumpBtn.classList.toggle('hidden', !show);
}

function handleListClick(listId, skipAutoUpdate = false) {
    window.exitListSecondaryModes();

    if (!currentListData) return;

    // Mobile: Close sidebar when a list is selected
    if (window.innerWidth < 1025) {
        const sidebar = document.getElementById('main-sidebar');
        // If sidebar is open (class removed), close it
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            window.toggleSidebar();
        }
    }

    // Set current viewing list ID for batch operations
    window.currentViewingListId = listId;
    currentSearchScope = 'local_list';

    let list = [];
    let title = '';

    if (listId === 'default') {
        list = currentListData.defaultList;
        title = '播放记录';
    } else if (listId === 'love') {
        list = currentListData.loveList;
        title = '我的收藏';
    } else {
        const uList = currentListData.userList.find(l => l.id === listId);
        if (uList) {
            list = uList.list;
            title = uList.name;
        }
    }

    // Switch to Search View (as List View)
    // Manually handle tab switch to avoid 'network' reset
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');

    // [New] 为歌单搜索视图重新初始化 ListSearch
    window.initGlobalListSearch();

    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
    }, 10);

    // UI Updates
    document.getElementById('page-title').innerText = title;
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = `在 ${title} 中搜索...`;

    // Set Scope
    currentSearchScope = 'local_list';
    document.getElementById('search-source').classList.add('hidden'); // Hide selector

    // Reset all tabs to muted, then highlight Favorites as the parent
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) {
        favTab.classList.add('active-tab');
        favTab.classList.remove('t-text-muted');
    }

    // Highlight Child List
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });
    const subItem = document.querySelector(`[data-sidebar-list-id="${listId}"]`);
    if (subItem) {
        subItem.classList.add('active-sub-item');
        subItem.classList.remove('t-text-muted');
    }

    // 计算当前是否为在线歌单 (Determine if current list is an online playlist)
    const targetList = (listId !== 'default' && listId !== 'love' && currentListData.userList)
        ? currentListData.userList.find(l => l.id === listId)
        : null;
    const isOnlineList = !!(targetList && targetList.sourceListId && targetList.source);

    // 渲染歌单头部信息（仅 userList 中的歌单）
    // 在线歌单操作按钮（更新/打开原始歌单）已移至 favorites-toolbar 的"播放全部"按钮前，此处不再重复渲染
    const playlistHeaderContainer = document.getElementById('search-playlist-header');
    if (playlistHeaderContainer && window.PlaylistHeader) {
        if (targetList && targetList.info) {
            window.PlaylistHeader.render('search-playlist-header', targetList.info, {
                prefix: 'search-pl',
                total: targetList.list ? targetList.list.length : 0
            });
            window.PlaylistHeader.show('search-playlist-header');
        } else {
            window.PlaylistHeader.hide('search-playlist-header');
        }
    }

    // 更新 favorites-toolbar 中的在线歌单操作按钮显隐（位于"播放全部"按钮前）
    updateFavoritesToolbarOnlineBtns(isOnlineList);

    // Render
    currentPage = 1; // Reset pagination
    renderResults(list);

    // [New] Auto Update Logic: If it's a network playlist (has sourceListId) and setting is ON, refresh background
    const uList = currentListData.userList ? currentListData.userList.find(l => l.id === listId) : null;
    if (!skipAutoUpdate && settings.autoUpdateNetworkList && uList && uList.sourceListId && uList.source) {
        handleRefreshList(listId, null, true); // true means silent/no-confirm
    }
}

function handleFavoritesClick() {
    // 如果侧边栏已收缩，先展开
    if (window._sidebarCollapsed) {
        window._sidebarCollapsed = false;
        localStorage.setItem('lx_sidebar_collapsed', 'false');
        window.applySidebarCollapse();
        setTimeout(() => {
            const children = document.getElementById('favorites-children');
            const arrow = document.getElementById('favorites-arrow');
            if (children) {
                children.style.height = children.scrollHeight + 'px';
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
        }, 320);
    }
    window.exitListSecondaryModes();
    toggleFavorites(); // Toggle folder dropdown in sidebar

    // 切换到 view-favorites 视图（方格卡片视图）
    document.querySelectorAll('[id^="view-"]').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
    });
    const favView = document.getElementById('view-favorites');
    if (favView) {
        favView.classList.remove('hidden');
        setTimeout(() => {
            favView.classList.remove('opacity-0');
            favView.classList.add('opacity-100');
        }, 10);
    }

    // Highlight Sidebar Header
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) {
        favTab.classList.add('active-tab');
        favTab.classList.remove('t-text-muted');
    }

    // Clear sub-item highlight（进入全部收藏视图时取消子项高亮）
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });

    // UI Updates
    document.getElementById('page-title').innerText = "我的收藏";

    // 未登录：显示引导页，隐藏方格容器
    if (!currentListData) {
        const gridContainer = document.getElementById('favorites-grid-container');
        const emptyGuide = document.getElementById('favorites-empty-guide');
        if (gridContainer) gridContainer.classList.add('hidden');
        if (emptyGuide) {
            emptyGuide.classList.remove('hidden');
            emptyGuide.classList.add('flex'); // flex for centering
        }
        return;
    }

    // 已登录：显示方格列表，隐藏引导页
    const gridContainer = document.getElementById('favorites-grid-container');
    const emptyGuide = document.getElementById('favorites-empty-guide');
    if (gridContainer) gridContainer.classList.remove('hidden');
    if (emptyGuide) {
        emptyGuide.classList.add('hidden');
        emptyGuide.classList.remove('flex');
    }

    // 构造歌单列表并渲染方格卡片（复用 home.js 的共享函数）
    const playlists = (typeof buildAllPlaylists === 'function') ? buildAllPlaylists() : [];
    if (typeof renderPlaylistGrid === 'function') {
        renderPlaylistGrid(playlists || [], 'favorites-grid');
    }
}

async function handleCreateList() {
    const name = await showInput("新建歌单", "请输入新歌单的名称：", {
        placeholder: "歌单名称"
    });

    if (name && currentListData) {
        const newList = {
            id: 'webplayer_' + Date.now(),
            name: name,
            source: 'webplayer',
            info: {
                name: name,
                img: null,
                desc: '',
                author: '',
                total: 0,
                time: new Date().toLocaleDateString('zh-CN')
            },
            list: []
        };
        currentListData.userList.push(newList);
        // Sync
        try {
            await pushDataChange();
            renderMyLists(currentListData);
            // Re-render the add modal grid if it is open (or just to keep it fresh)
            if (typeof renderPlaylistAddGrid === 'function') {
                renderPlaylistAddGrid();
            }
            showSuccess('歌单创建成功');
        } catch (e) {
            console.error('Create list failed:', e);
            showError('创建失败，请重试');
        }
    }
}

function formatSongToLxMusicStandard(item) {
    if (!item) return item;
    const s = JSON.parse(JSON.stringify(item));

    // 获取封面地址 (兼容各种 SDK 原始字段和 meta 字段)
    const picUrl = s.img || s.pic || s.picUrl ||
        (s.meta && (s.meta.picUrl || s.meta.img || s.meta.pic)) ||
        (s.album && (s.album.picUrl || s.album.img)) ||
        (s.al && s.al.picUrl) || null;

    // 如果已经包含合法的 meta 且有 songId，且 ID 符合规范，可能是已格式化的
    if (s.meta && s.meta.songId && s.id && (String(s.id).includes('_') || s.source === 'mg')) {
        // 确保 picUrl 存在
        if (!s.meta.picUrl && picUrl) s.meta.picUrl = picUrl;
        // 确保 interval 存在（从各种可能的字段中提取）
        if (!s.interval) {
            if (s.time) {
                s.interval = s.time;
            } else if (typeof s.duration === 'number' && s.duration > 0) {
                const mins = Math.floor(s.duration / 60);
                const secs = Math.floor(s.duration % 60);
                s.interval = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            } else {
                s.interval = '';
            }
        }
        // 将 meta 字段复制到顶层（兼容旧数据），picUrl 提升后更名为 img
        Object.assign(s, s.meta);
        if (s.picUrl) { s.img = s.picUrl; delete s.picUrl; }
        return s;
    }

    const source = s.source || '';
    const songmid = s.songmid || s.id || '';

    // 1. 提取核心元数据
    const albumName = s.albumName ||
        (s.album && s.album.name) ||
        (s.al && s.al.name) ||
        (s.meta && s.meta.albumName) || '';

    const albumId = s.albumId ||
        (s.album && s.album.id) ||
        (s.al && s.al.id) ||
        (s.meta && s.meta.albumId) || null;

    // 2. 构造干净的 meta 对象（只保留标准字段）
    let meta = {
        songId: String(songmid),
        albumName: albumName,
        picUrl: picUrl,
        qualitys: s.qualitys || s.types || (s.meta && (s.meta.qualitys || s.meta.types)) || [],
        _qualitys: s._qualitys || s._types || (s.meta && (s.meta._qualitys || s.meta.types)) || {}
    };

    if (albumId) meta.albumId = String(albumId);

    // 3. 构造标准 root 对象
    const rootItem = {
        name: s.name || '',
        singer: s.singer || '',
        source: source,
        interval: s.interval || s.time || '',
        meta: meta
    };

    // 4. 针对各平台源的特殊 ID 处理
    switch (source) {
        case 'tx':
            if (s.strMediaMid || (s.meta && s.meta.strMediaMid))
                meta.strMediaMid = s.strMediaMid || s.meta.strMediaMid;
            if (s.albumMid || (s.meta && s.meta.albumMid))
                meta.albumMid = s.albumMid || s.meta.albumMid;
            if (s.songId || (s.meta && s.meta.songId))
                meta.songId = String(s.songId || s.meta.songId);
            rootItem.id = `tx_${songmid}`;
            break;
        case 'wy':
            rootItem.id = `wy_${songmid}`;
            break;
        case 'kg':
            let hash = s.hash || (s.meta && s.meta.hash) || '';
            if (!hash && String(songmid).includes('_')) {
                hash = String(songmid).split('_')[1];
            } else if (!hash && String(songmid).length === 32) {
                hash = songmid;
            }

            let kgSongId = s.songId || (s.meta && s.meta.songId) || (String(songmid).includes('_') ? String(songmid).split('_')[0] : songmid);
            if (kgSongId === hash) kgSongId = '';

            meta.songId = String(kgSongId || '');
            meta.hash = hash;

            if (kgSongId && hash) {
                rootItem.id = `${kgSongId}_${hash}`;
            } else if (hash) {
                rootItem.id = hash;
            } else {
                rootItem.id = `kg_${kgSongId}`;
            }
            break;
        case 'mg':
            if (s.copyrightId || (s.meta && s.meta.copyrightId))
                meta.copyrightId = s.copyrightId || s.meta.copyrightId;
            if (s.lrcUrl || (s.meta && s.meta.lrcUrl))
                meta.lrcUrl = s.lrcUrl || s.meta.lrcUrl;
            rootItem.id = String(songmid);
            break;
        case 'kw':
            rootItem.id = `kw_${songmid}`;
            break;
        default:
            rootItem.id = songmid;
            break;
    }

    // 保留本地歌曲的关键字段
    if (source && String(source) === 'local') {
        if (s.relativePath) rootItem.relativePath = s.relativePath;
        if (s.duration) rootItem.duration = s.duration;
        if (s.size) rootItem.size = s.size;
        if (s.quality) rootItem.quality = s.quality;
        if (s.ext) rootItem.ext = s.ext;
        if (s.img) rootItem.img = s.img;
        if (s.sampleRate) rootItem.sampleRate = s.sampleRate;
        if (s.bitDepth) rootItem.bitDepth = s.bitDepth;
        if (s.bitRate) rootItem.bitRate = s.bitRate;
        if (s.album || s.albumName) rootItem.album = s.album || s.albumName;
    }

    // 将 meta 中的字段复制一份到顶层，方便读取端直接访问
    Object.assign(rootItem, meta);
    // picUrl 提升到顶层后更名为 img
    if (rootItem.picUrl) { rootItem.img = rootItem.picUrl; delete rootItem.picUrl; }

    return rootItem;
}

function collectCurrentSongList() {
    if (!currentListData || typeof window.SongListManager === 'undefined') return;
    const detail = window.SongListManager.getCurrentDetail();
    if (!detail || !detail.id || !detail.list || detail.list.length === 0) {
        if (window.showToast) window.showToast('error', '歌单数据不完整或为空');
        return;
    }

    // Check if already collected
    const existingIndex = currentListData.userList.findIndex(l => String(l.sourceListId) === String(detail.id) && l.source === detail.source);
    if (existingIndex >= 0) {
        if (window.showToast) window.showToast('info', '该歌单已在您的收藏中');
        return;
    }

    // Generate random 32 chars hex string for id consistency with other clients
    const randomHex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    const newId = `${detail.source}_${randomHex()}${randomHex()}${randomHex()}${randomHex()}`;

    // Make sure each song has the source attribute and correct id format
    const listWithSource = detail.list.map(s => {
        const item = formatSongToLxMusicStandard(s);
        if (!item.source) item.source = detail.source;
        return item;
    });

    const newList = {
        id: newId,
        name: detail.info.name || '未命名歌单',
        source: detail.source,
        sourceListId: String(detail.id),
        info: {
            name: detail.info.name || '未命名歌单',
            img: detail.info.img || detail.info.pic || detail.info.cover || null,
            desc: detail.info.desc || '',
            author: detail.info.author || '',
            total: detail.info.total || detail.list.length,
            play_count: detail.info.play_count || detail.info.playCount || null,
            time: detail.info.time || ''
        },
        locationUpdateTime: null,
        list: listWithSource
    };

    currentListData.userList.push(newList);

    // Sync
    pushDataChange().then(() => {
        renderMyLists(currentListData);
        // 更新收藏按钮状态（点亮爱心）
        const collectBtn = document.getElementById('sl-detail-collect');
        if (collectBtn) {
            const icon = collectBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('far');
                icon.classList.add('fas');
            }
            collectBtn.classList.add('text-red-500');
        }
        if (window.showToast) window.showToast('success', '歌单收藏成功！');
    }).catch(err => {
        console.error('收藏失败:', err);
        if (window.showToast) window.showToast('error', '收藏失败，请重试');
    });
}

async function toggleLove() {
    if (!currentListData || currentIndex < 0) return;
    const song = currentPlaylist[currentIndex];

    // Format song to standardized format (preserves local/downloaded fields)
    const formattedSong = formatSongForStorage(song);
    let targetId = formattedSong.id || song.id;

    const index = currentListData.loveList.findIndex(s => s.id === targetId || s.id === song.id);
    if (index >= 0) {
        currentListData.loveList.splice(index, 1);
    } else {
        currentListData.loveList.push(formattedSong);
    }

    // Update UI immediately
    updatePlayerInfo(song);

    // Sync
    await pushDataChange();
}

async function handleRefreshList(listId, event, silent = false) {
    if (event) event.stopPropagation();
    if (!currentListData) return;

    const list = currentListData.userList.find(l => l.id === listId);
    if (!list || !list.sourceListId || !list.source) {
        if (!silent && window.showToast) window.showToast('info', '该歌单不支持在线刷新');
        return;
    }

    if (!silent) {
        const confirmed = await showSelect('更新歌单', `是否更新当前歌单 "${list.name}"？\n(确认后将重新从服务器拉取歌单并覆盖当前内容)`, {
            confirmText: '确定更新',
            confirmColor: 'bg-emerald-500'
        });

        if (!confirmed) return;
    }

    if (window.showToast) window.showToast('info', '正在同步最新歌单内容...');

    try {
        const url = `${API_BASE}/songList/detail?source=${list.source}&id=${encodeURIComponent(list.sourceListId)}&page=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data || !data.list) throw new Error('数据拉取失败');

        // 格式化新歌曲列表
        const newList = data.list.map(s => {
            const item = formatSongToLxMusicStandard(s);
            if (!item.source) item.source = list.source;
            return item;
        });

        // 更新列表模型
        list.list = newList;
        if (data.info) {
            list.info = {
                name: data.info.name || list.name,
                img: data.info.img || data.info.pic || data.info.cover || null,
                desc: data.info.desc || '',
                author: data.info.author || '',
                total: data.info.total || newList.length,
                play_count: data.info.play_count || data.info.playCount || null,
                time: data.info.time || ''
            };
            if (data.info.name) list.name = data.info.name;
        }

        // 推送同步并重绘 UI
        await pushDataChange();
        renderMyLists(currentListData);

        // 如果当前正处于该列表视图，刷新结果列表显示
        if (window.currentViewingListId === listId) {
            handleListClick(listId, true); // Skip auto-update to avoid loop
        }

        if (window.showToast) window.showToast('success', '歌单内容已同步至最新状态');
    } catch (e) {
        console.error('[Refresh] Failed:', e);
        if (window.showToast) window.showToast('error', '歌单同步失败: ' + e.message);
    }
}

async function handleJumpToOriginalList(listId, event) {
    if (event) event.stopPropagation();
    if (!currentListData) return;

    const list = currentListData.userList.find(l => l.id === listId);
    if (!list || !list.sourceListId || !list.source) {
        if (window.showToast) window.showToast('info', '该歌单不支持跳转到原始页');
        return;
    }

    // 1. Switch Tab to songlist
    window.switchTab('songlist');

    // 2. Adjust SongListManager source select if available
    const sourceSelect = document.getElementById('songlist-source');
    if (sourceSelect) {
        sourceSelect.value = list.source;
    }

    // 3. Open Detail view via SongListManager
    if (window.SongListManager && window.SongListManager.openDetail) {
        window.SongListManager.openDetail(list.sourceListId, list.source);
    }
}

async function handleRemoveList(listId, event) {
    event.stopPropagation();
    if (!(await showSelect('删除歌单', '确定要删除此歌单吗？', {danger: true}))) return;

    if (currentListData) {
        const index = currentListData.userList.findIndex(l => l.id === listId);
        if (index >= 0) {
            currentListData.userList.splice(index, 1);
            try {
                await pushDataChange();
                renderMyLists(currentListData);
            } catch (e) {
                showError('删除同步失败');
            }
        }
    }
}


// ============================================================================
// DOMContentLoaded: Favorites/Sync auto-restore (split from app.js)
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Restore cached list data
    const cachedList = localStorage.getItem('lx_list_data');
    if (cachedList) {
        try {
            currentListData = JSON.parse(cachedList);
            const savedUser = localStorage.getItem('lx_sync_user');
            if (savedUser && currentListData) currentListData.username = savedUser; // Restore username from cache

            renderMyLists(currentListData);
        } catch (e) {
            console.error('[Cache] 恢复列表数据失败:', e);
        }
    }

    // 2. Auto-reconnect or auto-login
    const syncMode = localStorage.getItem('lx_sync_mode');

    if (syncMode === 'local') {
        // Local mode: auto-login (直接调用登录函数，无需表单元素)
        const user = localStorage.getItem('lx_sync_user');
        const pass = localStorage.getItem('lx_sync_pass');
        if (user && pass && !userToken) {
            handleDialogLogin(user, pass);
        }
    } else if (syncMode === 'remote') {
        // Remote mode: auto-reconnect
        const url = localStorage.getItem('lx_sync_url');
        const code = localStorage.getItem('lx_sync_code');
        const authStr = localStorage.getItem('lx_ws_auth');

        if (url && code) {
            document.getElementById('sync-remote-url').value = url;
            document.getElementById('sync-remote-code').value = code;

            // Check if we have saved authInfo
            if (authStr) {
                try {
                    const authInfo = JSON.parse(authStr);

                    // Pre-populate authInfo in client
                    syncManager.initRemote(url, code, {
                        getData: async () => {
                            const cached = localStorage.getItem('lx_list_data');
                            return cached ? JSON.parse(cached) : {defaultList: [], loveList: [], userList: []};
                        },
                        setData: async (data) => {
                            localStorage.setItem('lx_list_data', JSON.stringify(data));
                            const oldUsername = currentListData ? currentListData.username : null;
                            currentListData = data;
                            if (oldUsername) currentListData.username = oldUsername; // Preserve username

                            renderMyLists(data);
                            document.getElementById('sync-status').innerHTML = '<i class="fas fa-check-circle text-blue-500"></i> 数据已同步';
                        },
                        getSyncMode: async () => {
                            return new Promise((resolve) => {
                                syncModeResolve = resolve;
                                showSyncModeModal();
                            });
                        }
                    });

                    syncManager.client.authInfo = authInfo; // Reuse saved auth
                    syncManager.client.onLogin = (success) => {
                        if (success) {
                            updateSyncStatus('<i class="fas fa-check-circle text-green-500"></i> 已自动重连');
                        } else {
                            localStorage.removeItem('lx_ws_auth'); // Clear invalid auth
                        }
                    };
                    syncManager.client.connect();
                } catch (e) {
                    console.error('[Cache] 自动重连失败:', e);
                }
            } else {
            }
        }
    }
});


// ============================================================================
// Window exports (from original app.js L3566-L3611)
// ============================================================================

window.switchSyncMode = switchSyncMode;
window.handleLocalLogin = handleLocalLogin;
window.handleSyncLogout = handleSyncLogout;

// Helper to Push Changes to Remote
async function pushDataChange() {
    if (!currentListData) return;
    try {
        await window.SyncManager.push(currentListData);
    } catch (e) {
        console.error('Push Failed', e);
    }
}

async function refreshUserListData() {
    if (!window.SyncManager) return;
    try {
        const listData = await window.SyncManager.sync();
        window.currentListData = listData;
        if (typeof renderMyLists === 'function') {
            renderMyLists(listData);
        }

        // [New] If currently viewing a local list, refresh its contents in main view
        if (window.currentSearchScope === 'local_list' && window.currentViewingListId) {
            handleListClick(window.currentViewingListId, true); // true to skip background auto-update
        }

        // Save to cache
        localStorage.setItem('lx_list_data', JSON.stringify(listData));
    } catch (e) {
        console.error('[Sync] Failed to refresh list data:', e);
    }
}

window.refreshUserListData = refreshUserListData;
window.handleRemoteConnect = handleRemoteConnect;
window.handleCreateList = handleCreateList;
window.handleRefreshList = handleRefreshList;
window.handleRemoveList = handleRemoveList;
window.toggleFavorites = toggleFavorites;
window.handleFavoritesClick = handleFavoritesClick;
window.handleRemoteStep1 = handleRemoteStep1;
window.handleRemoteBack = handleRemoteBack;
window.handleListClick = handleListClick;
window.handleJumpToOriginalList = handleJumpToOriginalList;
window.toggleLove = toggleLove;
window.selectSyncMode = selectSyncMode;
window.cancelSyncMode = cancelSyncMode;
window.closeSyncModal = closeSyncModal;
window.showRemoteOverwriteModal = showRemoteOverwriteModal;
window.closeRemoteOverwriteModal = closeRemoteOverwriteModal;
window.selectRemoteOverwriteMode = selectRemoteOverwriteMode;
window.handleRemoteOverwriteConnect = handleRemoteOverwriteConnect;
window.pushDataChange = pushDataChange;
window.manualSaveSettings = manualSaveSettings;
window.fetchSettingsFromServer = fetchSettingsFromServer;
window.updateSyncStatus = updateSyncStatus;
window.showSyncModeModal = showSyncModeModal;
window.collectCurrentSongList = collectCurrentSongList;
window.formatSongToLxMusicStandard = formatSongToLxMusicStandard;
window.formatSongForStorage = formatSongForStorage;
window.cleanSongData = cleanSongData;
window.renderMyLists = renderMyLists;
window.renderPlaylistAddGrid = renderPlaylistAddGrid;


// ============================================================================
// Block 6: Playlist Add Modal
// ============================================================================

// Helper to render the grid (can be called from anywhere)
function renderPlaylistAddGrid() {
    const isBatch = !!window.batchCollectSongs;
    const songs = isBatch ? window.batchCollectSongs : [currentPlayingSong];
    const firstSong = songs[0];
    if (!firstSong) return;

    const listContainer = document.getElementById('playlist-add-list');
    if (!listContainer) return;

    // Single song mode: calculate inclusion status
    let targetId = null;
    if (!isBatch) {
        const cleanedSong = cleanSongData(firstSong);
        targetId = cleanedSong.id;
    }

    listContainer.innerHTML = '';

    // Helper to create grid item
    const createGridItem = (listId, listName, count, isIncluded) => {
        const btn = document.createElement('button');
        // Base styles
        let className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden ";

        // Active/Inactive styles (Highlight only in single-song mode)
        if (!isBatch && isIncluded) {
            className += "bg-emerald-500 text-white shadow-md scale-[1.02] ring-2 ring-emerald-200";
        } else {
            className += "bg-emerald-50 text-emerald-500 hover:bg-emerald-100 hover:shadow";
        }

        btn.className = className;
        btn.onclick = () => handleTogglePlaylist(listId, btn); // Use handler wrapper

        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${listName}</span>
            ${(!isBatch && isIncluded) ? '<i class="fas fa-check text-xs ml-1 opacity-80"></i>' : ''}
        `;
        return btn;
    };

    // 1. My Love
    const loveList = currentListData.loveList || [];
    const isLoved = !isBatch && targetId && loveList.some(s => s.id === targetId);
    listContainer.appendChild(createGridItem('love', '我的收藏', loveList.length, isLoved));

    // 2. User Lists
    if (currentListData.userList) {
        currentListData.userList.forEach(list => {
            const isIncluded = !isBatch && targetId && list.list.some(s => s.id === targetId);
            listContainer.appendChild(createGridItem(list.id, list.name, list.list.length, isIncluded));
        });
    }

    // 3. Create New List Dash Box
    const createNewBtn = document.createElement('button');
    createNewBtn.className = "h-14 rounded-lg text-xs font-bold border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 hover:text-emerald-500 hover:border-emerald-400 transition-all flex items-center justify-center gap-2 t-bg-main/20 hover:t-bg-main/50 shadow-sm";
    createNewBtn.innerHTML = `
        <i class="fas fa-plus"></i> 新建歌单
    `;
    createNewBtn.onclick = () => {
        handleCreateList();
    };
    listContainer.appendChild(createNewBtn);
}

async function openPlaylistAddModal(batchSongs = null) {
    if (!currentListData) {
        showError('请先登录后使用收藏功能');
        return;
    }

    // Set batch state if provided
    window.batchCollectSongs = Array.isArray(batchSongs) ? batchSongs : null;

    const isBatch = !!window.batchCollectSongs;
    const song = isBatch ? window.batchCollectSongs[0] : currentPlayingSong;

    if (!song) {
        showError(isBatch ? '无可收藏的歌曲' : '当前没有正在播放的歌曲');
        return;
    }

    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');
    const nameLabel = document.getElementById('playlist-add-song-name');

    if (!modal) return;

    // Set Info
    nameLabel.innerText = isBatch ? `已选择 ${window.batchCollectSongs.length} 首歌曲` : song.name;

    // Render List Items
    renderPlaylistAddGrid();

    // Show Modal
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closePlaylistAddModal() {
    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
        // Update Player Info to refresh heart icon state
        if (currentPlayingSong) {
            updatePlayerInfo(currentPlayingSong);
        }
    }, 300);
}

// 绑定模态框背景点击
const playlistAddModal = document.getElementById('playlist-add-modal');
if (playlistAddModal) {
    playlistAddModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            closePlaylistAddModal();
        }
    });
}


// Helper: Clean song data to match LX.Music.MusicInfoOnline interface
function cleanSongData(song) {
    if (!song) return null;

    // Ensure meta exists, defaulting to empty object if missing
    const sourceMeta = song.meta || {};

    // 1. Resolve Song ID (songId or songmid or id)
    // Different sources/APIs place the ID in different spots
    let songId = sourceMeta.songId || song.songId || song.songmid || song.id;

    // [Fix] 针对 QQ 音乐 (tx)，强制使用 songmid 作为主 ID，避免使用数字 ID
    if (song.source === 'tx' && song.songmid) {
        songId = song.songmid;
    }

    // 2. Resolve Album Name
    let albumName = sourceMeta.albumName || song.albumName || song.album?.name || '';

    // 3. Resolve Pic URL
    let picUrl = sourceMeta.picUrl || song.picUrl || song.img || song.album?.cover;

    // Common Meta
    const meta = {
        songId: songId,
        albumName: albumName,
        picUrl: picUrl,
        qualitys: sourceMeta.qualitys || song.qualitys || song.types,
        _qualitys: sourceMeta._qualitys || song._qualitys || song._types,
        albumId: sourceMeta.albumId || song.albumId
    };

    // Source Reference: src/types/music.d.ts
    // 补全特定源的字段
    if (song.source === 'kg') {
        meta.hash = sourceMeta.hash || song.hash;
    } else if (song.source === 'tx') {
        meta.strMediaMid = sourceMeta.strMediaMid || song.strMediaMid || song.mediaMid;
        meta.id = sourceMeta.id || song.songId || song.id; // tx often uses numerical ID here
        meta.albumMid = sourceMeta.albumMid || song.albumMid;
    } else if (song.source === 'mg') {
        meta.copyrightId = sourceMeta.copyrightId || song.copyrightId || songId; // fallback
        meta.lrcUrl = sourceMeta.lrcUrl || song.lrcUrl;
        meta.mrcUrl = sourceMeta.mrcUrl || song.mrcUrl;
        meta.trcUrl = sourceMeta.trcUrl || song.trcUrl;
    }

    // Common Base
    // 确保 ID 格式为 source_songId (如 kw_123456)
    // 如果 song.id 已经是 source_id 格式则保留，否则拼接
    const fullId = (song.source && songId && !String(songId).startsWith(song.source + '_'))
        ? `${song.source}_${songId}`
        : (song.id || `${song.source || 'temp'}_${songId}`);

    const cleanSong = {
        id: fullId, // Standardized ID
        name: song.name,
        singer: song.singer,
        source: song.source,
        interval: song.interval,
        meta: meta
    };

    // 将 meta 中的字段复制一份到顶层，方便读取端直接访问
    Object.assign(cleanSong, meta);
    // picUrl 提升到顶层后更名为 img
    if (cleanSong.picUrl) { cleanSong.img = cleanSong.picUrl; delete cleanSong.picUrl; }

    // Remove undefined keys
    const removeUndefined = (obj) => {
        Object.keys(obj).forEach(key => {
            if (obj[key] === undefined) delete obj[key];
            else if (typeof obj[key] === 'object' && obj[key] !== null) removeUndefined(obj[key]);
        });
        return obj;
    };

    return removeUndefined(cleanSong);
}

/**
 * 格式化歌曲数据用于存储到收藏/歌单/试听列表
 * 在线歌曲使用 formatSongToLxMusicStandard 标准格式；
 * 已下载/本地库歌曲额外保留 relativePath、_serverCachePath、音频信息等关键字段，
 * 确保从收藏列表播放时能正确命中本地缓存或走在线解析路径。
 * @param {Object} song - 原始歌曲对象
 * @returns {Object|null} 格式化后的歌曲对象
 */
function formatSongForStorage(song) {
    if (!song) return null;

    // 使用 formatSongToLxMusicStandard 获取基础标准格式（含正确的 ID 和 meta 结构）
    const formatted = formatSongToLxMusicStandard(song);
    if (!formatted) return null;

    // 已下载歌曲（在线来源，但有 relativePath 说明已下载到服务器）
    // 保留本地缓存相关字段，使 resolveSongUrl 能命中 server_cache 路径
    const isDownloadedOnlineSong = (
        song._isMusicLibSong || song.relativePath || song._serverCachePath
    ) && String(song.source || '') !== 'local';

    if (isDownloadedOnlineSong) {
        if (song.relativePath) formatted.relativePath = song.relativePath;
        if (song._serverCachePath) formatted._serverCachePath = song._serverCachePath;
        if (song._isMusicLibSong) formatted._isMusicLibSong = true;
        if (song.ext) formatted.ext = song.ext;
        if (song.quality) formatted.quality = song.quality;
        if (song.size) formatted.size = song.size;
        if (song.sampleRate) formatted.sampleRate = song.sampleRate;
        if (song.bitDepth) formatted.bitDepth = song.bitDepth;
        if (song.channels) formatted.channels = song.channels;
        if (song.bitRate) formatted.bitRate = song.bitRate;
        if (song.hasCover !== undefined) formatted.hasCover = song.hasCover;
        if (song.album) formatted.album = song.album;
    }

    // 本地库歌曲 (source === 'local') 已由 formatSongToLxMusicStandard 的 L11366-11377 逻辑处理，无需额外操作
    // 在线歌曲直接使用标准格式即可

    return formatted;
}


// Modified handler for Grid Buttons
async function handleTogglePlaylist(listId, btnElement) {
    if (!currentListData) return;

    const isBatch = !!window.batchCollectSongs;
    const songs = isBatch ? window.batchCollectSongs : [currentPlayingSong];
    if (songs.length === 0 || !songs[0]) return;

    // --- Batch Mode Logic ---
    if (isBatch) {
        btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        btnElement.disabled = true;

        // 1. Find target list in memory (Optimistic Update)
        let targetListArray = null;
        if (listId === 'love') targetListArray = currentListData.loveList;
        else targetListArray = currentListData.userList.find(l => l.id === listId)?.list;

        if (!targetListArray) {
            showError('未找到目标歌单');
            return;
        }

        // 2. Local State Modification
        const addedSongs = [];
        songs.forEach(s => {
            const cleaned = formatSongForStorage(s);
            if (!targetListArray.some(existing => existing.id === cleaned.id)) {
                targetListArray.unshift(cleaned);
                addedSongs.push(cleaned);
            }
        });

        if (addedSongs.length === 0) {
            showInfo('所选歌曲已在歌单中');
            closePlaylistAddModal();
            return;
        }

        // 3. Immediate UI Refresh
        renderMyLists(currentListData);
        if (window.currentSearchScope === 'local_list' && window.currentViewingListId) {
            handleListClick(window.currentViewingListId, true);
        }

        // 4. Close Modal Immediately
        closePlaylistAddModal();

        // 5. Background Backend Sync
        try {
            const isRemoteSync = window.SyncManager && window.SyncManager.mode === 'remote' && window.SyncManager.client && window.SyncManager.client.isConnected;

            if (isRemoteSync) {
                // 远程模式：推送更新
                await pushDataChange();
                showSuccess(`成功批量同步 ${addedSongs.length} 首歌曲`);
            } else {
                // 本地模式：调用 API 同步后端存储
                const res = await fetch('/api/music/user/list/add', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', ...getUserAuthHeaders()},
                    body: JSON.stringify({
                        listId: listId,
                        musicInfos: addedSongs
                    })
                });
                if (!res.ok) throw new Error(await res.text());
                showSuccess(`批量收藏 ${addedSongs.length} 首歌曲成功`);
            }

            // Cleanup selection
            if (typeof deselectAll === 'function') deselectAll();
            if (window.batchMode) {
                if (typeof toggleBatchMode === 'function') toggleBatchMode();
                if (typeof toggleLbBatchMode === 'function') toggleLbBatchMode();
            }

        } catch (e) {
            console.error('[BatchCollect] Sync failed, reverting or refreshing:', e);
            showError('同步失败: ' + e.message);
            // Full refresh as fallback to ensure consistency
            refreshUserListData();
        } finally {
            window.batchCollectSongs = null;
        }
        return;
    }

    // --- Single Song Mode Logic (Existing) ---
    const song = songs[0];
    console.log("当前要收藏的歌信息",song)
    let targetListArray;
    if (listId === 'love') {
        targetListArray = currentListData.loveList;
    } else {
        const uList = currentListData.userList.find(l => l.id === listId);
        if (uList) targetListArray = uList.list;
    }

    if (!targetListArray) return;

    const cleanedSong = formatSongForStorage(song); // 获取标准化的歌曲数据（保留已下载/本地库字段）
    const targetId = cleanedSong.id;

    // Check against the standardized ID to ensure correct matching
    const isCurrentlyIncluded = targetListArray.some(s => s.id === targetId);
    const willAdd = !isCurrentlyIncluded;

    // Optimistic UI Update
    updateGridItemVisuals(btnElement, willAdd);

    try {
        if (willAdd) {
            targetListArray.unshift(cleanedSong);
        } else {
            const idx = targetListArray.findIndex(s => s.id === targetId);
            if (idx >= 0) targetListArray.splice(idx, 1);
        }

        await pushDataChange();
        renderMyLists(currentListData);
        closePlaylistAddModal(); // 关闭模态框并刷新爱心按钮状态
    } catch (e) {
        showError('同步失败: ' + e.message);
        updateGridItemVisuals(btnElement, !willAdd); // Revert UI
    }
}

function updateGridItemVisuals(btn, isIncluded) {
    if (isIncluded) {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-red-500 text-white shadow-md scale-[1.02] ring-2 ring-red-200";
        // Update icon if needed, though innerHTML replacement is easiest
        const textSpan = btn.querySelector('span'); // Assuming first span is text
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${text}</span>
            <i class="fas fa-check text-xs ml-1 opacity-80"></i>
        `;
    } else {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-red-50 text-red-500 hover:bg-red-100 hover:shadow";
        const textSpan = btn.querySelector('span');
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `<span class="truncate max-w-[80%]">${text}</span>`;
    }
}

async function toggleSongInList(listId, isAdd) {
    // Deprecated in favor of handleTogglePlaylist
    console.warn("toggleSongInList is deprecated");
}

// Playlist Add Modal window exports
window.openPlaylistAddModal = openPlaylistAddModal;
window.closePlaylistAddModal = closePlaylistAddModal;
window.toggleSongInList = toggleSongInList;
window.handleTogglePlaylist = handleTogglePlaylist;
