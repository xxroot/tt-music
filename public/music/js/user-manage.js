// ============================================================================
// 用户管理模块 (User Management)
// 设置 -> 用户管理 TAB：需验证管理员密码后才可访问用户列表
// 复用现有管理员认证状态 (localStorage['lx_admin_password'])
// ============================================================================

// 当前已加载的用户列表
let userManageList = [];

// 获取管理员认证请求 Headers
function getUserManageHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const adminPass = localStorage.getItem('lx_admin_password');
    if (adminPass) headers['x-frontend-auth'] = adminPass;
    return headers;
}

// 显示验证错误提示
function showUserManageError(msg) {
    const errorEl = document.getElementById('user-manage-auth-error');
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
}

// 隐藏验证错误提示
function hideUserManageError() {
    const errorEl = document.getElementById('user-manage-auth-error');
    if (errorEl) errorEl.classList.add('hidden');
}

// 切换到"密码验证"视图
function showUserManageAuth() {
    document.getElementById('user-manage-auth-area')?.classList.remove('hidden');
    document.getElementById('user-manage-content-area')?.classList.add('hidden');
    hideUserManageError();
}

// 切换到"用户管理内容"视图并加载列表
function showUserManageContent() {
    document.getElementById('user-manage-auth-area')?.classList.add('hidden');
    document.getElementById('user-manage-content-area')?.classList.remove('hidden');
    loadUserManageUsers();
}

// 初始化用户管理 TAB（每次切换到该 TAB 时调用）
function initUserManage() {
    if (localStorage.getItem('lx_admin_password')) {
        // 已有管理员密码（已登录或已验证），直接展示内容
        showUserManageContent();
    } else {
        // 未验证，显示密码验证区
        showUserManageAuth();
    }
}

// 验证管理员密码 (POST /api/login)
async function verifyUserManagePassword() {
    const input = document.getElementById('user-manage-password-input');
    const password = input ? input.value : '';
    hideUserManageError();
    if (!password) {
        showUserManageError('请输入管理员密码');
        return;
    }
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            // 验证通过：写入管理员状态，与播放器管理员登录机制一致
            localStorage.setItem('lx_admin_password', password);
            if (typeof window.updateAdminUI === 'function') window.updateAdminUI();
            showSuccess('验证成功，正在加载用户列表');
            if (input) input.value = '';
            showUserManageContent();
        } else {
            showUserManageError('密码错误，请重试');
        }
    } catch (err) {
        console.error('[UserManage] 管理员密码验证失败:', err);
        showUserManageError('验证失败，请重试');
    }
}

// 管理员认证失效处理：清除本地状态并回到验证区
function handleUserManageAuthFail() {
    localStorage.removeItem('lx_admin_password');
    if (typeof window.updateAdminUI === 'function') window.updateAdminUI();
    showUserManageAuth();
    showError('管理员密码无效，请重新验证');
}

// 加载用户列表 (GET /api/users)
async function loadUserManageUsers() {
    const container = document.getElementById('user-manage-list');
    if (!container) return;
    container.innerHTML = `
        <div class="text-center text-xs t-text-muted py-8">
            <i class="fas fa-spinner fa-spin mr-2"></i>加载中...
        </div>`;
    try {
        const response = await fetch('/api/users', { headers: getUserManageHeaders() });
        if (response.status === 401) {
            handleUserManageAuthFail();
            return;
        }
        if (!response.ok) throw new Error('加载失败');
        const users = await response.json();
        userManageList = Array.isArray(users) ? users : [];
        renderUserManageList();
    } catch (err) {
        console.error('[UserManage] 加载用户列表失败:', err);
        container.innerHTML = `
            <div class="text-center text-xs text-red-500 py-8">
                <i class="fas fa-exclamation-circle mr-1"></i>加载失败: ${escapeHtml(err.message)}
            </div>`;
    }
}

// 手动刷新用户列表
function reloadUserManageUsers() {
    loadUserManageUsers();
}

// 渲染用户列表
function renderUserManageList() {
    const container = document.getElementById('user-manage-list');
    if (!container) return;
    if (!userManageList.length) {
        container.innerHTML = `
            <div class="text-center text-xs t-text-muted py-8">
                <i class="fas fa-users mr-1"></i>暂无用户，点击上方"添加用户"创建
            </div>`;
        return;
    }
    container.innerHTML = userManageList.map((user, index) => {
        const name = user.name || '';
        const initial = (name.charAt(0) || '?').toUpperCase();
        const safeName = escapeHtml(name);
        return `
            <div class="flex items-center justify-between p-3 t-bg-main rounded-xl border t-border-main transition-all hover:t-bg-track">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center text-sm font-bold flex-shrink-0">
                        ${escapeHtml(initial)}
                    </div>
                    <div class="min-w-0">
                        <div class="text-sm font-bold t-text-main truncate">${safeName}</div>
                        <div id="um-password-${index}" class="text-[10px] t-text-muted">${user.password ? '密码: ******' : '未设置密码'}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <button onclick="editUserManagePassword(${index})" title="修改密码"
                            class="w-8 h-8 rounded-lg t-text-muted hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all flex items-center justify-center">
                        <i class="fas fa-key text-xs"></i>
                    </button>
                    <button onclick="deleteUserManageUser(${index})" title="删除用户"
                            class="w-8 h-8 rounded-lg t-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all flex items-center justify-center">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                    <button onclick="viewUserManagePassword(${index})" title="查看密码"
                            class="w-8 h-8 rounded-lg t-text-muted hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all flex items-center justify-center">
                        <i class="fas fa-eye text-xs"></i>
                    </button>
                </div>
            </div>`;
    }).join('');
}

// 添加用户对话框：用户名和密码在同一窗口输入
function showAddUserManageDialog() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">添加用户</h3>
                    <button id="modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="flex items-start gap-4">
                        <div class="w-10 h-10 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
                            <i class="fas fa-user-plus text-lg"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-sm t-text-muted leading-relaxed mb-4">请输入新用户信息</p>
                            <div class="space-y-3">
                                <div>
                                    <label class="text-xs font-medium t-text-main block mb-1">用户名</label>
                                    <input type="text" id="um-add-name"
                                        class="w-full px-4 py-2.5 t-bg-main border t-border-main rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                                        placeholder="请输入用户名">
                                </div>
                                <div>
                                    <label class="text-xs font-medium t-text-main block mb-1">密码</label>
                                    <input type="password" id="um-add-password"
                                        class="w-full px-4 py-2.5 t-bg-main border t-border-main rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                                        placeholder="请输入密码">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="confirm-ok" class="flex-1 py-2.5 text-sm font-bold text-white bg-emerald-500 hover:opacity-90 rounded-xl shadow-lg transition-all active:scale-95">
                        添加
                    </button>
                    <button id="confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        取消
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const nameInput = modal.querySelector('#um-add-name');
        const passInput = modal.querySelector('#um-add-password');
        nameInput.focus();

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };

        modal.querySelector('#confirm-ok').onclick = () => close({
            name: nameInput.value.trim(),
            password: passInput.value
        });
        modal.querySelector('#confirm-cancel').onclick = () => close(null);
        modal.querySelector('#modal-close-x').onclick = () => close(null);
        modal.querySelector('div:first-child').onclick = () => close(null);

        // 用户名框回车跳转到密码框，密码框回车直接提交
        nameInput.onkeydown = (e) => {
            if (e.key === 'Enter') passInput.focus();
            if (e.key === 'Escape') close(null);
        };
        passInput.onkeydown = (e) => {
            if (e.key === 'Enter') close({ name: nameInput.value.trim(), password: passInput.value });
            if (e.key === 'Escape') close(null);
        };
    });
}

// 添加用户
async function addUserManageUser() {
    const result = await showAddUserManageDialog();
    if (!result) return;
    if (!result.name || !result.password) {
        showError('用户名和密码不能为空');
        return;
    }
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: getUserManageHeaders(),
            body: JSON.stringify({ name: result.name, password: result.password })
        });
        if (response.status === 401) {
            handleUserManageAuthFail();
            return;
        }
        if (!response.ok) throw new Error((await response.text()) || '添加失败');
        showSuccess('用户添加成功');
        loadUserManageUsers();
    } catch (err) {
        console.error('[UserManage] 添加用户失败:', err);
        showError('添加用户失败: ' + err.message);
    }
}

// 修改用户密码
async function editUserManagePassword(index) {
    const user = userManageList[index];
    if (!user) return;
    const name = user.name || '';
    const password = await showInput('修改密码', `为 "${escapeHtml(name)}" 设置新密码`, {
        placeholder: '请输入新密码',
        inputType: 'password'
    });
    if (!password) return;
    try {
        const response = await fetch('/api/users', {
            method: 'PUT',
            headers: getUserManageHeaders(),
            body: JSON.stringify({ name, password })
        });
        if (response.status === 401) {
            handleUserManageAuthFail();
            return;
        }
        if (!response.ok) throw new Error((await response.text()) || '修改失败');
        showSuccess('密码修改成功');
        loadUserManageUsers();
    } catch (err) {
        console.error('[UserManage] 修改密码失败:', err);
        showError('修改失败: ' + err.message);
    }
}

// 查看/隐藏用户密码（点击后直接在同一行密码文本处切换明文显示）
function viewUserManagePassword(index) {
    const user = userManageList[index];
    if (!user) return;
    const el = document.getElementById(`um-password-${index}`);
    if (!el) return;
    if (!user.password) {
        showInfo('该用户未设置密码');
        return;
    }
    // 已显示明文则恢复星号，否则显示明文（toggle 切换）
    const revealed = el.dataset.revealed === '1';
    el.textContent = revealed ? '密码: ******' : `密码: ${user.password}`;
    el.dataset.revealed = revealed ? '0' : '1';
}

// 删除用户
async function deleteUserManageUser(index) {
    const user = userManageList[index];
    if (!user) return;
    const name = user.name || '';
    const confirmed = await showSelect('删除用户', `确定要删除用户 "${escapeHtml(name)}" 吗？删除后用户数据文件夹将保留。`, {
        danger: true,
        confirmText: '确认删除'
    });
    if (!confirmed) return;
    try {
        const response = await fetch('/api/users', {
            method: 'DELETE',
            headers: getUserManageHeaders(),
            body: JSON.stringify({ name, deleteData: false })
        });
        if (response.status === 401) {
            handleUserManageAuthFail();
            return;
        }
        if (!response.ok) throw new Error((await response.text()) || '删除失败');
        showSuccess('用户已删除');
        loadUserManageUsers();
    } catch (err) {
        console.error('[UserManage] 删除用户失败:', err);
        showError('删除用户失败: ' + err.message);
    }
}

// 锁定用户管理（清除本地管理员状态，重新要求密码验证）
function lockUserManage() {
    localStorage.removeItem('lx_admin_password');
    if (typeof window.updateAdminUI === 'function') window.updateAdminUI();
    showUserManageAuth();
    showSuccess('用户管理已锁定');
}
