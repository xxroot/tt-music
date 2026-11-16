/**
 * Custom Source Management (自定义源管理)
 * 
 * 负责自定义音源的上传、导入、切换、删除、排序及模态框控制等前端逻辑。
 * 从 app.js 中提取，减少主文件体积。
 * 
 * 依赖:
 *   - window.settings (settings.js)
 *   - window.currentListData (app.js)
 *   - window.handleAdminAuth, window.createMarqueeHtml, window.applyMarqueeChecks (app.js)
 *   - showError, showSuccess, showInfo, showSelect, showInput (app.js, var/function 声明)
 *   - updateSetting (app.js, function 声明)
 *   - Sortable (CDN 全局变量)
 */

let customSourceMode = 'file'; // 'file' or 'url'

// 切换上传方式
function switchCustomSourceMode(mode) {
    customSourceMode = mode;

    // 更新按钮样式
    document.getElementById('btn-source-file').className = mode === 'file'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 t-text-muted rounded-lg hover:bg-gray-200';

    document.getElementById('btn-source-url').className = mode === 'url'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 t-text-muted rounded-lg hover:bg-gray-200';

    // 切换显示
    document.getElementById('custom-source-file').classList.toggle('hidden', mode !== 'file');
    document.getElementById('custom-source-url').classList.toggle('hidden', mode !== 'url');
}

// 处理本地文件上传
async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // 验证文件类型
    if (!file.name.endsWith('.js')) {
        showError('请选择 .js 文件');
        return;
    }

    // 更新文件名显示
    // document.getElementById('file-name-display').textContent = file.name;

    try {
        // 读取文件内容
        const content = await file.text();

        // 先验证脚本
        showInfo('正在验证脚本...');
        const adminPass = localStorage.getItem('lx_admin_password');
        const headers = {'Content-Type': 'application/json'};
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        let validationRes = await fetch('/api/custom-source/validate', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                script: content,
                username: window.currentListData?.username || 'default'
            })
        });

        if (validationRes.status === 403) {
            const errData = await validationRes.json();
            showError(errData.error || '权限限制：请先登录管理员。');
            const authorized = await window.handleAdminAuth('上传自定义源需要管理员权限');
            if (authorized) return handleFileUpload(input);
            input.value = '';
            return;
        }

        const validation = await validationRes.json();

        if (!validation.valid && !validation.requireUnsafe) {
            showError(`脚本无效: ${validation.error}`);
            input.value = '';
            // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';
            return;
        }

        // 验证通过，上传
        showInfo(`验证通过，正在上传 "${validation.metadata.name || file.name}"...`);
        let result = await uploadCustomSource(file.name, content, 'file');

        // 如果需要不安全模式确认
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', {
                danger: true,
                confirmText: '允许并上传'
            });
            if (confirmed) {
                result = await uploadCustomSource(file.name, content, 'file', true);
            } else {
                showInfo('已取消上传');
                input.value = '';
                return;
            }
        }

        showSuccess(`已上传: ${validation.metadata.name || file.name} ${validation.metadata.version ? (/^v/i.test(validation.metadata.version) ? validation.metadata.version : 'v' + validation.metadata.version) : ''}`);

        // 重置输入
        input.value = '';
        // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 上传失败:', error);
        showError(`上传失败: ${error.message}`);
    }
}

// 处理远程链接导入
async function handleUrlImport() {
    const input = await showInput("导入远程音源", "请输入自定义源脚本的 URL 地址:", {
        placeholder: "https://example.com/script.js",
        confirmText: "开始导入"
    });

    if (input === null) return; // 用户取消

    const url = input.trim();
    if (!url) {
        showError('请输入链接地址');
        return;
    }

    try {
        showInfo('正在获取并验证远程脚本...');

        const username = window.currentListData?.username || 'default';
        const headers = {'Content-Type': 'application/json'};
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        // 从服务器代理下载
        const response = await fetch(`/api/custom-source/import`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                url,
                filename: url.split('/').pop().split('?')[0] || '',
                username: username
            })
        });

        if (response.status === 403) {
            const data = await response.json();
            showError(data.error || '权限限制：请先登录管理员。');
            const authorized = await window.handleAdminAuth('导入自定义源需要管理员权限');
            if (authorized) return handleUrlImport();
            return;
        }

        let result = await response.json();

        if (!response.ok || (result.success === false && !result.requireUnsafe)) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }

        // 如果需要不安全模式确认
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', {
                danger: true,
                confirmText: '允许并导入'
            });
            if (confirmed) {
                const retryHeaders = {'Content-Type': 'application/json'};
                if (adminPass) retryHeaders['x-frontend-auth'] = adminPass;
                const retryResp = await fetch(`/api/custom-source/import`, {
                    method: 'POST',
                    headers: retryHeaders,
                    body: JSON.stringify({
                        url,
                        filename,
                        username: username,
                        allowUnsafeVM: true
                    })
                });
                if (retryResp.status === 403) {
                    showError('管理员验证校验失败');
                    return;
                }
                result = await retryResp.json();
            } else {
                showInfo('已取消导入');
                return;
            }
        }

        showSuccess(`已导入: ${result.filename}`);

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 导入失败:', error);
        showError(`导入失败: ${error.message}`);
    }
}

// 上传自定义源到服务器
async function uploadCustomSource(filename, content, type, allowUnsafeVM = false) {
    const headers = {'Content-Type': 'application/json'};
    const adminPass = localStorage.getItem('lx_admin_password');
    if (adminPass) headers['x-frontend-auth'] = adminPass;

    const response = await fetch('/api/custom-source/upload', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            filename,
            content,
            type,
            username: window.currentListData?.username || 'default', // 使用当前登录用户
            allowUnsafeVM
        })
    });

    if (response.status === 403) {
        const result = await response.json();
        showError(result.error || '权限不足：请先登录管理员。');
        const authorized = await window.handleAdminAuth('上传自定义源需要管理员权限');
        if (authorized) return uploadCustomSource(filename, content, type, allowUnsafeVM);
        return;
    }

    if (!response.ok) {
        const errorText = await response.text();
        let errMsg = errorText;
        try {
            const errJson = JSON.parse(errorText);
            if (errJson.error) errMsg = errJson.error;
        } catch (e) {
        }
        throw new Error(errMsg || `HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.success === false && !result.requireUnsafe) {
        throw new Error(result.error || '上传失败');
    }
    return result;
}

// 加载自定义源列表 (随时可以调用以刷新界面)
async function loadCustomSources() {
    await renderCustomSources();
}

// ========== 自定义源管理逻辑 ==========

async function fetchCustomSources() {
    try {
        const username = window.currentListData?.username || 'default';
        const res = await fetch(`/api/custom-source/list?username=${username}`);
        if (!res.ok) throw new Error('Failed to fetch sources');
        return await res.json();
    } catch (err) {
        console.error('Fetch sources failed:', err);
        return [];
    }
}


function updateSourceScopeUI() {
    const username = window.currentListData?.username || 'default';
    const isPublic = username === 'default';
    const showPublic = window.settings.enablePublicSources !== false; // Default true

    const settingsTag = document.getElementById('settings-source-scope-tag');
    const modalTag = document.getElementById('modal-source-scope-info');

    // Tag Content Logic
    let tagHtml = '';
    if (isPublic) {
        tagHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-500 whitespace-nowrap inline-block">公开</span>`;
    } else {
        // User logged in
        let userTag = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-600 whitespace-nowrap inline-block">${username}</span>`;
        if (showPublic) {
            userTag += `<span class="ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-500 whitespace-nowrap inline-block">公开</span>`
        }
        tagHtml = userTag;
    }

    if (settingsTag) settingsTag.innerHTML = tagHtml;

    if (modalTag) {
        modalTag.innerHTML = isPublic
            ? `<div class="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 w-fit mb-2"><i class="fas fa-globe"></i> 上传到: 公开</div>`
            : `<div class="flex items-center gap-2 text-xs text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-100 w-fit mb-2"><i class="fas fa-user-circle"></i> 上传到: ${username}</div>`;
    }
}

function togglePublicSourcesSetting() {
    updateSetting('enablePublicSources', !window.settings.enablePublicSources);
}

// 更新无可用音源提示条显隐 (存在已启用源则隐藏, 否则显示)
// 同时控制设置页内提示条与首页顶部提示条
function updateSourceGuideHint(list) {
    const hasEnabledSource = Array.isArray(list) && list.some(item => item.enabled);
    const hint = document.getElementById('source-guide-hint');
    if (hint) hint.classList.toggle('hidden', hasEnabledSource);
    const banner = document.getElementById('no-source-banner');
    if (banner) banner.classList.toggle('hidden', hasEnabledSource);
}

async function renderCustomSources() {
    let list = await fetchCustomSources();

    // Filter based on setting
    if (window.settings.enablePublicSources === false) {
        // Filter out sources where owner is 'open'.
        // Note: fetchCustomSources returns API objects. We need to check structure.
        // The API returns array of { id, name, version, ..., owner: 'open' || 'username' }
        list = list.filter(item => item.owner !== 'open');
    }

    updateSourceScopeUI();

    // 同步无可用音源提示条显隐
    updateSourceGuideHint(list);

    // 渲染目标容器 ID 列表：模态框内 & 设置界面内
    const targetIds = ['custom-sources-list', 'settings-custom-sources-list'];

    targetIds.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 空状态
        if (list.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center p-6 t-text-muted">
                    <i class="fas fa-box-open text-3xl mb-3 opacity-30"></i>
                    <p class="text-sm">暂无自定义源</p>
                    ${containerId === 'custom-sources-list' ?
                `<button onclick="document.getElementById('script-file').click()" class="mt-3 text-emerald-600 hover:text-emerald-700 text-sm font-medium">即刻上传</button>`
                : ''}
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        list.forEach((source, index) => {
            const div = document.createElement('div');
            // 设置界面使用稍紧凑的样式，模态框使用标准样式 (这里为了统一先用一样的，微调边距)
            div.className = `t-bg-panel p-4 rounded-xl border t-border-main shadow-sm hover:shadow-md transition-all mb-3 relative group flex items-start source-item`;
            div.dataset.id = source.id;
            div.dataset.enabled = source.enabled;
            div.dataset.index = index;

            // 格式化支持的源
            let supportedBadges = '';
            if (source.supportedSources && source.supportedSources.length > 0) {
                const sourceMap = {
                    'kg': {name: '酷狗', color: 't-badge-blue'},
                    'kw': {name: '酷我', color: 't-badge-yellow'},
                    'tx': {name: 'QQ', color: 't-badge-green'},
                    'wy': {name: '网易', color: 't-badge-red'},
                    'mg': {name: '咪咕', color: 't-badge-pink'}
                };

                supportedBadges = `<div class="flex flex-wrap gap-1.5 mt-2">
                ${source.supportedSources.map(s => {
                    const info = sourceMap[s] || {name: s, color: 't-badge-gray'};
                    return `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors border border-transparent ${info.color}">${info.name}</span>`;
                }).join('')}
            </div>`;
            } else {
                supportedBadges = `<div class="mt-2 text-[10px] t-text-muted italic">未知支持源</div>`;
            }

            const size = source.size && !isNaN(source.size) ? (source.size / 1024).toFixed(1) + ' KB' : '未知大小';
            let date = '未知日期';
            try {
                if (source.uploadTime) date = new Date(source.uploadTime).toLocaleDateString();
            } catch (e) {
            }

            /* Status Badge Logic */
            let statusBadge = '';
            let errorMsg = '';

            if (source.enabled) {
                if (source.status === 'success') {
                    statusBadge = `<span class="text-[10px] bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30 px-1.5 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1 transition-colors"><i class="fas fa-check-circle"></i>正常</span>`;
                } else if (source.status === 'failed') {
                    statusBadge = `<span class="text-[10px] bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30 px-1.5 py-0.5 rounded-full border border-red-100 flex items-center gap-1 cursor-help transition-colors" title="${source.error || '加载失败'}"><i class="fas fa-times-circle"></i>失败</span>`;
                    errorMsg = `<div class="text-[10px] text-red-500 dark:text-red-400 mt-1 flex items-start gap-1 p-1.5 bg-red-50 dark:bg-red-900/20 rounded transition-colors"><i class="fas fa-info-circle mt-0.5 flex-shrink-0"></i><span class="break-all">${source.error || '未知错误'}</span></div>`;
                } else {
                    // If enabled but no status (yet), assume initializing or loaded before status tracking
                    statusBadge = `<span class="text-[10px] bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30 px-1.5 py-0.5 rounded-full border border-blue-100 flex items-center gap-1 transition-colors"><i class="fas fa-circle-notch fa-spin"></i>加载...</span>`;
                }
            }

            div.innerHTML = `
            <div class="flex items-center self-stretch cursor-grab custom-source-handle t-text-muted hover:text-emerald-500 pr-4 -ml-2 transition-all active:scale-110 touch-none" title="拖拽排序">
                <i class="fas fa-grip-vertical text-lg"></i>
            </div>
            <div class="flex justify-between items-start flex-1 min-w-0">
                <div class="flex-1 pr-4 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <i class="fas fa-file-code text-emerald-500 flex-shrink-0"></i>
                        ${window.createMarqueeHtml(source.name, "font-bold t-text-main text-sm")}
                    </div>
                    ${errorMsg}
                    <div class="flex flex-wrap items-center text-[10px] t-text-muted gap-x-3 gap-y-1 mt-1.5">
                        <span class="flex items-center"><i class="fas fa-user mr-1 opacity-70"></i>${source.author || '未知'}</span>
                        <span class="flex items-center"><i class="far fa-hdd mr-1 opacity-70"></i>${size}</span>
                        <span class="t-bg-main t-text-muted px-1.5 py-0.5 rounded-lg shrink-0 transition-colors font-mono pointer-events-none border t-border-main">${source.version ? (/^v/i.test(source.version) ? source.version : 'v' + source.version) : '未知'}</span>
                        ${statusBadge}
                    </div>
                    ${supportedBadges}
                </div>
                
                <div class="flex flex-col items-end gap-2 shrink-0">
                    <button onclick="toggleSource('${source.id}', ${source.enabled})" 
                            class="px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap w-20 flex justify-center items-center ${source.enabled
                ? (source.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/30' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/30')
                : 't-bg-track t-text-muted hover:t-bg-item-hover'}">
                        ${source.enabled ? '已启用' : '已禁用'}
                    </button>
                    
                    <div class="flex items-center gap-1">
                        ${source.enabled && source.status === 'failed' ? `
                        <button onclick="reloadSource('${source.id}')" 
                                class="p-1.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-lg transition-colors"
                                title="尝试重新加载">
                            <i class="fas fa-sync-alt text-sm"></i>
                        </button>` : ''}
                        
                        <button onclick="deleteSource('${source.id}')" 
                                class="p-1.5 t-text-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                                title="删除">
                            <i class="fas fa-trash-alt text-sm"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
            container.appendChild(div);
        });

        // Add Sortable (Optimized for Mobile)
        if (typeof Sortable !== 'undefined') {
            // Destroy existing instance to avoid duplicates
            try {
                const oldSortable = Sortable.get(container);
                if (oldSortable) oldSortable.destroy();
            } catch (e) {
            }

            Sortable.create(container, {
                animation: 200,
                handle: '.custom-source-handle',
                ghostClass: 'sortable-ghost-solid',
                chosenClass: 'sortable-chosen-item',
                dragClass: 'sortable-drag-item',

                // 核心配置
                forceFallback: true,
                fallbackOnBody: false,
                fallbackTolerance: 0,

                // 响应优化
                delay: 200,
                delayOnTouchOnly: true,
                touchStartThreshold: 5,

                // 排序逻辑
                swapThreshold: 0.5,
                invertSwap: true,
                direction: 'vertical',

                onStart: function () {
                    document.body.classList.add('select-none');
                },
                onEnd: async function (evt) {
                    document.body.classList.remove('select-none');
                    const items = Array.from(container.querySelectorAll('.source-item'));

                    // Parse current state from DOM after drag
                    const draggedItem = evt.item;
                    const draggedId = draggedItem.dataset.id;
                    const isEnabled = draggedItem.dataset.enabled === 'true';

                    // Separate into enabled and disabled to enforce grouping
                    let enabledIds = [];
                    let disabledIds = [];

                    items.forEach(el => {
                        const id = el.dataset.id;
                        const stateEnabled = el.dataset.enabled === 'true';

                        // Enforce logic: an item keeps its enabled/disabled state,
                        // we just figure out its relative order within its group.
                        if (stateEnabled) {
                            enabledIds.push(id);
                        } else {
                            disabledIds.push(id);
                        }
                    });

                    // Check if a swap occurred across boundaries causing a weird state?
                    // Actually, the UI just re-arranged the divs. By separating them into enabledIds and disabledIds,
                    // we automatically force enabled to be before disabled.
                    // If an enabled source was dragged to the disabled section, it will naturally be at the end of the enabledIds array (because it was placed after other enabled items).
                    // Same vice versa.

                    const finalOrderIds = [...enabledIds, ...disabledIds];

                    try {
                        const username = window.currentListData?.username || 'default';
                        const headers = {'Content-Type': 'application/json'};
                        const adminPass = localStorage.getItem('lx_admin_password');
                        if (adminPass) headers['x-frontend-auth'] = adminPass;

                        const response = await fetch('/api/custom-source/reorder', {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({username, sourceIds: finalOrderIds})
                        });

                        if (response.status === 403) {
                            const result = await response.json();
                            showError(result.error || '权限限制：保存排序需要管理员权限。');
                            const authorized = await window.handleAdminAuth('保存排序需要管理员身份');
                            if (authorized) {
                                // 管理员验证成功后会自动刷新 UI 状态
                                renderCustomSources();
                            }
                            return;
                        }

                        if (!response.ok) throw new Error('Reorder failed');

                        // Re-render to show the forcefully corrected order (enabled on top)
                        renderCustomSources();
                    } catch (error) {
                        console.error('Reorder error:', error);
                        showError('保存排序失败，请检查网络或管理员权限状态');
                        renderCustomSources(); // Revert UI
                    }
                }
            });
        }
    });

    // Apply dynamic marquee checks after rendering source list
    if (typeof window.applyMarqueeChecks === 'function') {
        window.applyMarqueeChecks();
    }
}

// 重新加载源 (强制重新启用)
async function reloadSource(sourceId) {
    try {
        const username = window.currentListData?.username || 'default';
        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, sourceId, enabled: true}) // Force enable triggers reload
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showInfo('正在重新加载...');
        // Wait a bit for server to process
        setTimeout(() => {
            renderCustomSources();
        }, 1000);

    } catch (error) {
        console.error('Reload failed:', error);
        showError(`重载请求失败: ${error.message}`);
    }
}

// 切换状态
async function toggleSource(sourceId, currentEnabled, allowUnsafeVM = false) {
    try {
        const username = window.currentListData?.username || 'default';
        const headers = {'Content-Type': 'application/json'};
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({username, sourceId, enabled: !currentEnabled, allowUnsafeVM}) // Send new state
        });

        if (response.status === 403) {
            const data = await response.json();
            showError(data.error || '权限限制：需要管理员身份。');
            const authorized = await window.handleAdminAuth('修改自定义源状态需要管理员权限');
            if (authorized) return await toggleSource(sourceId, currentEnabled, allowUnsafeVM);
            return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();

        // 处理 REQUIRE_UNSAFE_VM
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', {
                danger: true,
                confirmText: '依然启用'
            });
            if (confirmed) {
                return await toggleSource(sourceId, currentEnabled, true);
            } else {
                return;
            }
        }

        // 刷新列表
        await renderCustomSources();
        showSuccess(currentEnabled ? '已禁用' : '已启用');
    } catch (error) {
        console.error('[CustomSource] 切换状态失败:', error);
        showError(`操作失败: ${error.message}`);
    }
}

// 删除源
async function deleteSource(sourceId) {
    if (!(await showSelect('删除自定义源', '确定要删除这个自定义源吗？', {danger: true}))) return;

    try {
        const username = window.currentListData?.username || 'default';
        const headers = {'Content-Type': 'application/json'};
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const response = await fetch('/api/custom-source/delete', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({username, sourceId})
        });

        if (response.status === 403) {
            const data = await response.json();
            showError(data.error || '权限限制：需要管理员身份。');
            const authorized = await window.handleAdminAuth('删除自定义源需要管理员权限');
            if (authorized) return await deleteSource(sourceId);
            return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showSuccess('已删除');
        await renderCustomSources();
    } catch (error) {
        console.error('[CustomSource] 删除失败:', error);
        showError(`删除失败: ${error.message}`);
    }
}

// 模态框控制
function openCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');
    if (modal) modal.classList.remove('hidden');

    // 渲染列表
    renderCustomSources();

    setTimeout(() => {
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
}

function closeCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
    }, 300);
}

// ========================================
// 导出函数到 window (供 HTML onclick 等外部调用)
// ========================================
window.openCustomSourceModal = openCustomSourceModal;
window.closeCustomSourceModal = closeCustomSourceModal;
window.switchCustomSourceMode = switchCustomSourceMode;
window.handleFileUpload = handleFileUpload;
window.handleUrlImport = handleUrlImport;
window.toggleSource = toggleSource;
window.deleteSource = deleteSource;
window.reloadSource = reloadSource;
window.togglePublicSourcesSetting = togglePublicSourcesSetting;
// Alias (兼容旧版)
window.toggleCustomSource = toggleSource;
window.deleteCustomSource = deleteSource;
window.importFromUrl = handleUrlImport;
