// ========================================
// Toast / Dialog UI 组件
// (由 app.js 提取，纯 UI 无业务依赖)
// ========================================

/**
 * 弹出输入对话框 (showInput)
 * @param {string} title 标题
 * @param {string} message 提示信息
 * @param {object} options 配置 (placeholder, defaultValue, confirmText, cancelText)
 * @returns {Promise<string | null>}
 */
function showInput(title, message, options = {}) {
    const {
        placeholder = '请输入内容...',
        defaultValue = '',
        confirmText = '确定',
        cancelText = '取消',
        confirmColor = 'bg-emerald-500',
        inputType = 'text'
    } = options;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="flex items-start gap-4 mb-4">
                        <div class="w-10 h-10 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
                            <i class="fas fa-edit text-lg"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-sm t-text-muted leading-relaxed mb-4">${message}</p>
                            <input type="${inputType}" id="modal-input" 
                                class="w-full px-4 py-2.5 t-bg-main border t-border-main rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                                placeholder="${placeholder}" value="${defaultValue}">
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="confirm-ok" class="flex-1 py-2.5 text-sm font-bold text-white ${confirmColor} hover:opacity-90 rounded-xl shadow-lg transition-all active:scale-95">
                        ${confirmText}
                    </button>
                    <button id="confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        ${cancelText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const input = modal.querySelector('#modal-input');
        input.focus();
        if (defaultValue) input.select();

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

        modal.querySelector('#confirm-ok').onclick = () => close(input.value.trim() || null);
        modal.querySelector('#confirm-cancel').onclick = () => close(null);
        modal.querySelector('#modal-close-x').onclick = () => close(null);
        modal.querySelector('div:first-child').onclick = () => close(null);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') close(input.value.trim() || null);
            if (e.key === 'Escape') close(null);
        };
    });
}


//确认弹窗
function showSelect(title, message, options = {}) {
    const {
        confirmText = '确定',
        cancelText = '取消',
        confirmColor = 'bg-emerald-500',
        danger = false
    } = options;

    const btnColor = danger ? 'bg-red-500 hover:bg-red-600 shadow-red-100' : `${confirmColor} hover:opacity-90 shadow-emerald-100`;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="flex items-start gap-4">
                        <div class="w-10 h-10 rounded-full ${danger ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'} flex items-center justify-center shrink-0">
                            <i class="fas ${danger ? 'fa-exclamation-triangle' : 'fa-question-circle'} text-lg"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-sm t-text-muted leading-relaxed">${message}</p>
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="confirm-ok" class="flex-1 py-2.5 text-sm font-bold text-white ${btnColor} rounded-xl shadow-lg transition-all active:scale-95">
                        ${confirmText}
                    </button>
                    <button id="confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        ${cancelText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

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

        modal.querySelector('#confirm-ok').onclick = () => close(true);
        modal.querySelector('#confirm-cancel').onclick = () => close(false);
        modal.querySelector('#modal-close-x').onclick = () => close(false);
        modal.querySelector('div:first-child').onclick = () => close(false);
    });
}

/**
 * 通用多选选择列表
 */
function showOptions(title, message, options = []) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in";

        const optionsHtml = options.map(opt => `
            <button class="w-full text-left px-4 py-3.5 t-text-main hover:bg-emerald-500 hover:text-white transition-all rounded-xl font-bold text-sm flex items-center justify-between group" data-value="${opt}">
                <span>${opt}</span>
                <i class="fas fa-chevron-right text-[10px] opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all"></i>
            </button>
        `).join('');

        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="opt-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <div class="p-3">
                    <p class="px-3 py-2 text-xs t-text-muted mb-2 font-medium">${message}</p>
                    <div class="max-h-[60vh] overflow-y-auto custom-scrollbar space-y-1">
                        ${optionsHtml}
                    </div>
                </div>
            </div>
        `;

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

        modal.querySelectorAll('button[data-value]').forEach(btn => {
            btn.onclick = () => close(btn.getAttribute('data-value'));
        });

        modal.querySelector('#opt-close-x').onclick = () => close(null);
        modal.querySelector('div:first-child').onclick = () => close(null);

        document.body.appendChild(modal);
    });
}

// 通用 Toast 显示函数 (支持宽屏、滚动文字、点击重置倒计时、动态堆叠)
function showToast(type, message, duration = 3000) {
    const config = {
        success: {bg: 'bg-emerald-500', icon: 'fa-check-circle'},
        info: {bg: 'bg-blue-500', icon: 'fa-info-circle'},
        error: {bg: 'bg-red-500', icon: 'fa-exclamation-circle'}
    };
    const conf = config[type] || config.info;

    const toast = document.createElement('div');
    // 添加 toast-item 类用于后续高度计算
    toast.className = `toast-item fixed right-4 ${conf.bg} text-white px-4 py-3 rounded-lg shadow-lg z-[1000] animate-slide-in flex items-center gap-3 w-80 md:w-96 max-w-[90vw] cursor-pointer transition-all duration-300`;

    // 使用通用跑马灯逻辑，自动检测文字是否超出容器宽度
    // 注意: createMarqueeHtml / applyMarqueeChecks 定义在 app.js 中，运行时通过 window 访问
    const contentHtml = window.createMarqueeHtml(message, 'flex-1 font-medium');

    toast.innerHTML = `
        <i class="fas ${conf.icon} text-xl shrink-0"></i>
        ${contentHtml}
    `;

    // [Strategy] Newest at bottom: 96px. Push old ones UP.
    const bottomBase = 96;
    const gap = 12;

    toast.style.visibility = 'hidden';
    document.body.appendChild(toast);

    // 触发动态滚动检测
    window.applyMarqueeChecks();

    const toastHeight = toast.offsetHeight || 60;
    const shiftAmt = toastHeight + gap;

    document.querySelectorAll('.toast-item').forEach(el => {
        if (el === toast) return;
        const oldB = parseFloat(el.style.bottom || bottomBase);
        const newB = oldB + shiftAmt;
        el.style.bottom = `${newB}px`;
        el.dataset.offset = newB;
    });

    toast.style.bottom = `${bottomBase}px`;
    toast.dataset.offset = bottomBase;
    toast.style.visibility = 'visible';

    let hideTimer = null;

    const startTimer = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-4');
            setTimeout(() => {
                const h = toast.offsetHeight + gap;
                toast.remove();
                document.querySelectorAll('.toast-item').forEach(el => {
                    const elB = parseFloat(el.style.bottom || 0);
                    if (elB > parseFloat(toast.dataset.offset)) {
                        const newB = elB - h;
                        el.style.bottom = `${newB}px`;
                        el.dataset.offset = newB;
                    }
                });
            }, 300);
        }, duration);
    };

    startTimer();

    // 点击事件: 重新计时 (用户请求: 点击了那个信息就重新计时隐藏)
    toast.addEventListener('click', () => {
        // 视觉反馈
        toast.classList.add('scale-[1.02]', 'brightness-110');
        setTimeout(() => toast.classList.remove('scale-[1.02]', 'brightness-110'), 150);

        // 重置计时器
        startTimer();
    });

    // 鼠标悬停暂停计时 (优化体验)
    toast.addEventListener('mouseenter', () => {
        if (hideTimer) clearTimeout(hideTimer);
    });

    toast.addEventListener('mouseleave', () => {
        startTimer();
    });
}

// 封装旧 API
function showSuccess(message) {
    showToast('success', message, 2000);
}

function showInfo(message) {
    showToast('info', message, 2000);
}

function showError(message) {
    showToast('error', message, 2000);
}

// 清除所有当前显示的 Toast
function dismissAllToasts() {
    const toasts = document.querySelectorAll('.toast-item');
    toasts.forEach(toast => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    });
}

// ========== Window 导出 ==========
window.showInput = showInput;
window.showSelect = showSelect;
window.showOptions = showOptions;
window.showToast = showToast;
window.showSuccess = showSuccess;
window.showInfo = showInfo;
window.showError = showError;
window.dismissAllToasts = dismissAllToasts;
