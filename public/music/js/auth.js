/**
 * Auth - 认证管理模块
 * 管理用户认证状态、Token 和认证初始化
 *
 * @module Auth
 */

// ============================================================================
// 认证状态 (Authentication State)
// ============================================================================

let authEnabled = false;
let authToken = sessionStorage.getItem('lx_player_auth');
let userToken = localStorage.getItem('lx_user_token');

// ============================================================================
// 认证工具函数 (Authentication Utilities)
// ============================================================================

/**
 * 生成用户 API 请求所需的认证 Headers。
 * 有 Token 时携带 x-user-token；无 Token 时不携带认证头，以公开身份 (_open) 访问。
 * 注意：用户名+密码明文认证 (x-user-password) 已在服务端废弃，不可再回退发送，
 * 否则“已存用户名但 Token 失效”的半登录状态下所有需认证接口将 401 失败。
 */
function getUserAuthHeaders() {
    const username = window.currentListData?.username || localStorage.getItem('lx_sync_user') || '';
    if (userToken) {
        return {'x-user-name': username, 'x-user-token': userToken};
    }
    return {};
}

// ============================================================================
// 认证初始化 (Authentication Initialization)
// ============================================================================

// 页面加载时：检查认证配置并初始化登录状态
(async () => {
    try {
        const response = await fetch('/api/music/config');
        const config = await response.json();
        window.lx_config = config; // 获取公共配置供权限模块使用
        authEnabled = config['player.enableAuth'] === true;

        // 获取到公共配置后，立即刷新一次 UI 状态 (管理员按钮/设置项禁用等)
        if (typeof window.syncSettingsUI === 'function') window.syncSettingsUI();
        else if (typeof window.updateAdminUI === 'function') window.updateAdminUI();

        // 有 Token 时验证其有效性
        if (userToken) {
            try {
                const vRes = await fetch('/api/user/auth/verify', {
                    headers: {'x-user-token': userToken}
                });
                const vData = await vRes.json();
                if (!vData.valid) {
                    localStorage.removeItem('lx_user_token');
                    userToken = null;
                }
            } catch (e) {
                console.warn('[Auth] Token 验证失败:', e);
            }
        }

        // 更新顶部登录状态指示器
        updateLoginStatus();

        // 公开受限用户自动尝试从服务器拉取配置
        if (config['user.enablePublicRestriction']) {
            if (typeof window.fetchSettingsFromServer === 'function') {
                await window.fetchSettingsFromServer();
            }
        }

        // 客户端模式自动连接远程同步 (仅在已登录到本地账户时触发)
        if (userToken && window.settings?.enableClientModeSync && window.settings?.remoteSyncUrl && window.settings?.remoteSyncCode) {
            console.info('[Sync] Client mode enabled, auto-connecting to remote server...');
            setTimeout(() => {
                if (typeof window.handleRemoteOverwriteConnect === 'function') {
                    window.handleRemoteOverwriteConnect(true);
                }
            }, 500);
        }

    } catch (error) {
        console.error('[Auth] 初始化检查失败:', error);
    }
})();

// ============================================================================
// 登出 (Logout)
// ============================================================================

// 登出：调用服务端清除 Session，跳转到登录页
async function handleLogout() {
    try {
        await fetch('/api/music/auth/logout', {method: 'POST'});
    } catch (e) {
        console.error('[Auth] 登出请求失败:', e);
    }
    window.location.replace('/music/login');
}

// ============================================================================
// 管理员认证 (Admin Authentication)
// ============================================================================

/**
 * 管理员权限验证通用处理逻辑
 * 如果检测到 403 错误，弹出密码输入框并保存密码后重试
 */
async function handleAdminAuth(message) {
    const pass = await showInput('管理员身份验证', message, {
        placeholder: '请输入后台管理密码',
        inputType: 'password'
    });
    if (pass) {
        localStorage.setItem('lx_admin_password', pass);
        updateAdminUI(); // 更新 UI 状态
        return true;
    }
    return false;
}

// 管理员登录处理
async function handleAdminLogin() {
    const authorized = await handleAdminAuth('请输入管理员密码进行登录验证');
    if (authorized) {
        showSuccess('管理员已登录');
        window.syncSettingsUI(); // 刷新设置界面状态
    }
}

// 管理员退出登录处理
async function handleAdminLogout() {
    if (!(await showSelect('管理员登出', '确定要退出管理员身份吗？'))) return;
    localStorage.removeItem('lx_admin_password');
    updateAdminUI();
    window.syncSettingsUI();
    showSuccess('管理员已登出');
}

// 更新管理员相关 UI 元素
function updateAdminUI() {
    const isAdmin = !!localStorage.getItem('lx_admin_password');
    const isPublic = !window.currentListData?.username || window.currentListData?.username === 'default';

    // 自定义源部分的标签和按钮
    const adminTag = document.getElementById('settings-admin-tag');
    const loginBtn = document.getElementById('btn-admin-login');
    const logoutBtn = document.getElementById('btn-admin-logout');
    const scopeTag = document.getElementById('settings-source-scope-tag');

    if (adminTag) adminTag.classList.toggle('hidden', !isAdmin);
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !isAdmin);
    if (loginBtn) {
        loginBtn.classList.toggle('hidden', isAdmin || !window.lx_config?.['user.enablePublicRestriction'] || !isPublic);
    }
    if (scopeTag) {
        scopeTag.classList.toggle('hidden', !isPublic);
    }

    // 处于登录/同步状态时，将相关连接按钮变灰防止重复操作
    const isLocalLoggedIn = !!window.userToken && !isPublic;
    const isRemoteConnected = (window.SyncManager && window.SyncManager.mode === 'remote' && window.SyncManager.client?.isConnected) ||
        (window.currentRemoteOverwriteClient && window.currentRemoteOverwriteClient.isConnected);

    const disableMainRemote = isRemoteConnected || isLocalLoggedIn;
    ['sync-remote-url', 'sync-remote-code'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disableMainRemote;
            if (disableMainRemote) {
                el.classList.add('opacity-40', 'cursor-not-allowed', 'grayscale');
                el.parentElement?.classList.add('pointer-events-none');
            } else {
                el.classList.remove('opacity-40', 'cursor-not-allowed', 'grayscale');
                el.parentElement?.classList.remove('pointer-events-none');
            }
        }
    });

    // 弹窗内的远程同步输入框及客户端模式勾选框：仅在远程已连或开启了客户端模式时才禁用
    // (勾选客户端模式后锁定输入，防止在自动同步流程中改动配置)
    const disableModalRemote = isRemoteConnected || window.settings?.enableClientModeSync;
    const modalInputIds = ['remote-overwrite-url', 'remote-overwrite-code', 'setting-client-mode-sync'];
    modalInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disableModalRemote;
            if (disableModalRemote) {
                el.classList.add('opacity-40', 'cursor-not-allowed', 'grayscale');
                // 注意：勾选框的父级不要加 pointer-events-none，否则无法取消
                if (id !== 'setting-client-mode-sync') el.parentElement?.classList.add('pointer-events-none');
            } else {
                el.classList.remove('opacity-40', 'cursor-not-allowed', 'grayscale');
                if (id !== 'setting-client-mode-sync') el.parentElement?.classList.remove('pointer-events-none');
            }
        }
    });


    const modeBtnIds = ['btn-mode-local', 'btn-mode-remote'];
    modeBtnIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (isLocalLoggedIn || isRemoteConnected) {
                el.style.opacity = '0.5';
                el.style.pointerEvents = 'none';
                el.classList.add('grayscale');
            } else {
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
                el.classList.remove('grayscale');
            }
        }
    });

    // 处理操作按钮的禁用状态 (分为主界面按钮和弹窗按钮)
    const mainActionButtons = [
        document.querySelector('#sync-remote-step1 button'),
        document.querySelector('#sync-remote-step2 button')
    ];
    mainActionButtons.forEach(btn => {
        if (btn) {
            btn.disabled = disableMainRemote;
            if (disableMainRemote) btn.classList.add('opacity-30', 'pointer-events-none', 'grayscale');
            else btn.classList.remove('opacity-30', 'pointer-events-none', 'grayscale');
        }
    });

    const modalActionButtons = [
        document.querySelector('#remote-overwrite-step1 button'),
        document.querySelector('button[onclick^="handleRemoteOverwriteConnect"]')
    ];
    modalActionButtons.forEach(btn => {
        if (btn) {
            btn.disabled = disableModalRemote;
            if (disableModalRemote) btn.classList.add('opacity-30', 'pointer-events-none', 'grayscale');
            else btn.classList.remove('opacity-30', 'pointer-events-none', 'grayscale');
        }
    });
}

// ============================================================================
// 登录弹窗与状态管理 (Login Dialog & Status Management)
// ============================================================================

/**
 * 弹出用户登录对话框（用户名 + 密码）。
 * 可在页面任意位置调用（header、收藏引导等）。
 */
function showLoginDialog() {
    // 关闭已打开的下拉菜单
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in';
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50 dark:bg-emerald-900/20">
                    <h3 class="text-sm font-bold t-text-main flex items-center gap-2">
                        <i class="fas fa-sign-in-alt text-emerald-500"></i> 用户登录
                    </h3>
                    <button id="login-modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold t-text-muted mb-1">用户名</label>
                            <input type="text" id="login-dialog-user"
                                class="w-full px-4 py-2.5 t-bg-main border t-border-main rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                                placeholder="请输入用户名" autocomplete="username">
                        </div>
                        <div>
                            <label class="block text-xs font-bold t-text-muted mb-1">密码</label>
                            <input type="password" id="login-dialog-pass"
                                class="w-full px-4 py-2.5 t-bg-main border t-border-main rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                                placeholder="请输入密码" autocomplete="current-password">
                        </div>
                        <!-- 错误提示 -->
                        <div id="login-dialog-error" class="hidden text-red-500 text-xs text-center bg-red-50 dark:bg-red-900/20 py-2 px-4 rounded-lg">
                            <i class="fas fa-exclamation-circle mr-1"></i>
                            <span></span>
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="login-dialog-ok" class="flex-1 py-2.5 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-lg transition-all active:scale-95">
                        登录并同步
                    </button>
                    <button id="login-dialog-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        取消
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const userInput = modal.querySelector('#login-dialog-user');
        const passInput = modal.querySelector('#login-dialog-pass');
        const errorDiv = modal.querySelector('#login-dialog-error');
        const okBtn = modal.querySelector('#login-dialog-ok');

        // 自动填入上次使用的用户名
        const lastUser = localStorage.getItem('lx_sync_user');
        if (lastUser) userInput.value = lastUser;
        userInput.focus();
        if (lastUser) passInput.focus();

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) content.classList.add('scale-95', 'opacity-0');
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };

        const showError = (msg) => {
            errorDiv.querySelector('span').textContent = msg;
            errorDiv.classList.remove('hidden');
        };

        const doLogin = async () => {
            const user = userInput.value.trim();
            const pass = passInput.value;
            if (!user || !pass) {
                showError('请输入用户名和密码');
                return;
            }

            okBtn.disabled = true;
            okBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 登录中...';
            errorDiv.classList.add('hidden');

            try {
                const success = await handleDialogLogin(user, pass);
                if (success) {
                    close(true);
                } else {
                    showError('登录失败：用户名或密码错误');
                    okBtn.disabled = false;
                    okBtn.innerHTML = '登录并同步';
                }
            } catch (e) {
                showError('登录出错：' + e.message);
                okBtn.disabled = false;
                okBtn.innerHTML = '登录并同步';
            }
        };

        okBtn.onclick = doLogin;
        modal.querySelector('#login-dialog-cancel').onclick = () => close(false);
        modal.querySelector('#login-modal-close-x').onclick = () => close(false);
        modal.querySelector('div:first-child').onclick = () => close(false);

        passInput.onkeydown = (e) => {
            if (e.key === 'Enter') doLogin();
            if (e.key === 'Escape') close(false);
        };
        userInput.onkeydown = (e) => {
            if (e.key === 'Enter') passInput.focus();
            if (e.key === 'Escape') close(false);
        };
    });
}

/**
 * 执行用户登录核心逻辑（不依赖 DOM 表单元素）。
 * 可在登录弹窗、自动登录等场景调用。
 * @param {string} user 用户名
 * @param {string} pass 密码
 * @returns {Promise<boolean>} 是否登录成功
 */
async function handleDialogLogin(user, pass) {
    const syncManager = window.SyncManager;
    if (!syncManager) {
        console.error('[Auth] SyncManager 未初始化');
        return false;
    }

    syncManager.initLocal(user, pass);
    const success = await syncManager.client.login();

    if (!success) return false;

    // 获取 Token（如果尚未有）
    if (!userToken) {
        try {
            const tokenRes = await fetch('/api/user/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: user, password: pass})
            });
            if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                if (tokenData.token) {
                    userToken = tokenData.token;
                    localStorage.setItem('lx_user_token', userToken);
                }
            }
        } catch (e) {
            console.warn('[Auth] Token 获取失败:', e);
        }
    }

    // 显示并加载 Token 管理面板
    const tokenSection = document.getElementById('token-management-section');
    if (tokenSection) {
        tokenSection.classList.remove('hidden');
        if (typeof window.loadTokenConfig === 'function') window.loadTokenConfig();
    }

    // 同步列表数据
    try {
        const listData = await syncManager.sync();
        window.currentListData = listData;
        if (window.currentListData) window.currentListData.username = user;
        if (typeof window.renderMyLists === 'function') window.renderMyLists(listData);
        localStorage.setItem('lx_list_data', JSON.stringify(listData));
    } catch (e) {
        console.warn('[Auth] 列表同步失败:', e);
    }

    // 保存凭证
    localStorage.setItem('lx_sync_mode', 'local');
    localStorage.setItem('lx_sync_user', user);
    localStorage.setItem('lx_sync_pass', pass);

    // 更新同步状态文字
    if (typeof window.updateSyncStatus === 'function') {
        window.updateSyncStatus(`<i class="fas fa-check-circle text-emerald-500"></i> 已同步 (用户: ${user})`);
    }

    // 更新顶部登录状态
    updateLoginStatus();

    // 刷新设置 UI
    if (typeof window.syncSettingsUI === 'function') window.syncSettingsUI();
    else if (typeof window.updateAdminUI === 'function') window.updateAdminUI();

    // 拉取服务端设置
    if (window.settings?.saveAccountSettingsToFile && typeof window.fetchSettingsFromServer === 'function') {
        window.fetchSettingsFromServer();
    }

    // 客户端模式：登录后自动触发远程同步
    if (window.settings?.enableClientModeSync && window.settings?.remoteSyncUrl && window.settings?.remoteSyncCode) {
        console.info('[Sync] Client mode auto-triggering remote sync after local login...');
        setTimeout(() => {
            if (typeof window.handleRemoteOverwriteConnect === 'function') {
                window.handleRemoteOverwriteConnect(true);
            }
        }, 1000);
    }

    if (typeof window.showSuccess === 'function') window.showSuccess(`已登录：${user}`);

    // 如果当前正在显示“我的收藏”页面，登录成功后刷新视图
    const favView = document.getElementById('view-favorites');
    if (favView && !favView.classList.contains('hidden') && typeof window.handleFavoritesClick === 'function') {
        window.handleFavoritesClick();
    }

    return true;
}

/**
 * 更新顶部登录状态指示器。
 * 根据当前 userToken 和 localStorage 中的用户名刷新 UI。
 */
function updateLoginStatus() {
    const loginTrigger = document.getElementById('login-trigger');
    const userMenuTrigger = document.getElementById('user-menu-trigger');
    const dropdown = document.getElementById('user-dropdown');

    const isLoggedIn = !!userToken;
    const username = localStorage.getItem('lx_sync_user') || '';

    if (isLoggedIn && username) {
        // 已登录：仅显示已登录图标（点击展开登出菜单），隐藏登录按钮
        if (loginTrigger) loginTrigger.classList.add('hidden');
        if (userMenuTrigger) {
            userMenuTrigger.classList.remove('hidden');
            userMenuTrigger.classList.add('flex');
            userMenuTrigger.title = `已登录: ${username}`;
        }
    } else {
        // 未登录：仅显示登录图标，隐藏已登录菜单
        if (loginTrigger) loginTrigger.classList.remove('hidden');
        if (userMenuTrigger) {
            userMenuTrigger.classList.add('hidden');
            userMenuTrigger.classList.remove('flex');
        }
        if (dropdown) dropdown.classList.add('hidden');
    }
}

/**
 * 切换用户下拉菜单的显示/隐藏。
 */
function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('hidden');

    // 点击页面其他位置关闭菜单
    if (!dropdown.classList.contains('hidden')) {
        const closeHandler = (e) => {
            const statusEl = document.getElementById('login-status');
            if (statusEl && !statusEl.contains(e.target)) {
                dropdown.classList.add('hidden');
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
}

/**
 * 用户退出登录：清除凭证、重置 UI。
 */
async function handleUserLogout() {
    // 关闭下拉菜单
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    if (typeof window.showSelect === 'function') {
        if (!(await window.showSelect('退出登录', '确定要退出当前用户登录吗？'))) return;
    }

    // 清除 Token 和凭证
    userToken = null;
    localStorage.removeItem('lx_user_token');
    localStorage.removeItem('lx_sync_user');
    localStorage.removeItem('lx_sync_pass');
    localStorage.removeItem('lx_sync_mode');
    localStorage.removeItem('lx_list_data');

    // 清除列表数据并刷新侧边栏
    window.currentListData = null;
    if (typeof window.renderMyLists === 'function') {
        window.renderMyLists({defaultList: [], loveList: [], userList: []});
    }

    // 更新同步状态
    if (typeof window.updateSyncStatus === 'function') {
        window.updateSyncStatus('<i class="fas fa-circle text-[8px] text-gray-300"></i> 状态: 未连接', false);
    }

    // 隐藏 Token 管理面板
    const tokenSection = document.getElementById('token-management-section');
    if (tokenSection) tokenSection.classList.add('hidden');

    // 更新顶部登录状态
    updateLoginStatus();

    // 刷新设置 UI
    if (typeof window.syncSettingsUI === 'function') window.syncSettingsUI();
    else if (typeof window.updateAdminUI === 'function') window.updateAdminUI();

    if (typeof window.showSuccess === 'function') window.showSuccess('已退出登录');
}

// ============================================================================
// 暴露到全局 (Expose to Global Scope)
// ============================================================================

window.getUserAuthHeaders = getUserAuthHeaders;
window.handleLogout = handleLogout;
window.authEnabled = authEnabled;
Object.defineProperty(window, 'userToken', { get() { return userToken; }, set(v) { userToken = v; }, configurable: true });
window.handleAdminAuth = handleAdminAuth;
window.handleAdminLogin = handleAdminLogin;
window.handleAdminLogout = handleAdminLogout;
window.updateAdminUI = updateAdminUI;
window.showLoginDialog = showLoginDialog;
window.handleDialogLogin = handleDialogLogin;
window.updateLoginStatus = updateLoginStatus;
window.toggleUserMenu = toggleUserMenu;
window.handleUserLogout = handleUserLogout;
