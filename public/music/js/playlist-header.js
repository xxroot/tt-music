/**
 * PlaylistHeader — 歌单头部信息共享渲染模块
 * 在线歌单详情页和收藏歌单视图共用同一套渲染逻辑
 * 依赖全局: setImg, createMarqueeHtml, applyMarqueeChecks
 */
window.PlaylistHeader = (function () {

    /** 格式化播放量 */
    function formatPlayCount(count) {
        if (!count) return '0';
        if (count > 100000000) return (count / 100000000).toFixed(1) + '亿';
        if (count > 10000) return (count / 10000).toFixed(1) + '万';
        return count;
    }

    /**
     * 生成头部 HTML 模板
     * @param {string} prefix - 元素 ID 前缀 (如 'sl-detail' 或 'search-pl')
     * @param {object} options - { showCollapseToggle, showRefreshBtn, showJumpBtn }
     */
    function generateHeaderHTML(prefix, options) {
        const opts = options || {};
        const collapseBtn = opts.showCollapseToggle
            ? `<button data-action="collapse" class="absolute top-2 right-2 p-1.5 t-text-muted hover:t-bg-track rounded-lg transition-colors" title="折叠/展开">
                 <i class="fas fa-chevron-up ${prefix}-collapse-icon transition-transform duration-300"></i>
               </button>` : '';

        const actionBtns = [];
        if (opts.showRefreshBtn) {
            actionBtns.push(`<button data-action="refresh" class="p-2 t-bg-panel border t-border-main rounded-xl hover:text-emerald-500 transition-colors shadow-sm" title="更新歌单">
                <i class="fas fa-sync-alt"></i>
            </button>`);
        }
        if (opts.showJumpBtn) {
            actionBtns.push(`<button data-action="jump" class="p-2 t-bg-panel border t-border-main rounded-xl hover:text-emerald-500 transition-colors shadow-sm" title="打开原始歌单">
                <i class="fas fa-external-link-alt"></i>
            </button>`);
        }
        const actionBtnsHtml = actionBtns.length
            ? `<div class="flex items-center gap-2 flex-shrink-0">${actionBtns.join('')}</div>`
            : '';

        return `
            <div class="relative p-4 md:p-6 flex gap-4 md:gap-6 overflow-hidden transition-all duration-300 ease-in-out max-h-[1000px] ${prefix}-header-inner">
                ${collapseBtn}
                <img id="${prefix}-cover" loading="lazy" fetchpriority="low"
                     class="w-24 h-24 md:w-48 md:h-48 rounded-2xl shadow-xl flex-shrink-0 object-cover dynamic-logo is-placeholder"
                     src="/music/assets/logo.png">
                <div class="flex flex-col justify-center gap-1 md:gap-3 flex-1 min-w-0">
                    <h2 id="${prefix}-name"
                        class="text-lg md:text-3xl font-extrabold t-text-main line-clamp-2">
                    </h2>
                    <div class="flex items-center gap-2 flex-wrap">
                        <div id="${prefix}-author"
                             class="text-xs md:text-base font-medium text-emerald-600"></div>
                        <div id="${prefix}-stats"
                             class="flex items-center gap-3 text-xs t-text-muted ml-2">
                        </div>
                    </div>
                    <div class="relative mt-1">
                        <p id="${prefix}-desc"
                           class="text-xs md:text-sm t-text-muted line-clamp-3 md:line-clamp-4 leading-relaxed max-w-4xl cursor-pointer hover:t-text-main transition-colors">
                        </p>
                        <button id="${prefix}-desc-btn"
                                class="text-xs text-emerald-500 hover:text-emerald-600 mt-1 hidden font-medium">
                            展开全部
                            <i class="fas fa-chevron-down text-[10px] ml-0.5"></i>
                        </button>
                    </div>
                    ${actionBtnsHtml ? `<div class="mt-2">${actionBtnsHtml}</div>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * 渲染头部到容器
     * @param {string} containerId - 容器元素 ID
     * @param {object} info - { name, img, desc, author, total, play_count, time }
     * @param {object} options - { prefix, showCollapseToggle, showRefreshBtn, showJumpBtn, onRefresh, onJump, total }
     */
    function render(containerId, info, options) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const opts = options || {};
        const prefix = opts.prefix || 'pl';

        // 生成 HTML
        container.innerHTML = generateHeaderHTML(prefix, opts);

        // 填充歌单名
        const nameEl = document.getElementById(`${prefix}-name`);
        if (nameEl) {
            nameEl.innerHTML = window.createMarqueeHtml
                ? window.createMarqueeHtml(info.name || '未命名歌单')
                : (info.name || '未命名歌单');
        }

        // 填充封面
        const coverSrc = info.img || info.pic || info.cover || '/music/assets/logo.png';
        if (window.setImg) {
            window.setImg(`${prefix}-cover`, coverSrc);
        } else {
            const coverEl = document.getElementById(`${prefix}-cover`);
            if (coverEl) coverEl.src = coverSrc;
        }

        // 填充作者
        const authorEl = document.getElementById(`${prefix}-author`);
        if (authorEl) {
            const authorText = info.author || '';
            authorEl.innerHTML = window.createMarqueeHtml
                ? window.createMarqueeHtml(authorText, 'text-emerald-500 font-medium')
                : authorText;
        }

        // 填充统计信息
        const statsHtml = [];
        const totalSongs = opts.total != null ? opts.total : (info.total || 0);
        statsHtml.push(`<span><i class="fas fa-music text-[10px] mr-1"></i>${totalSongs} 首歌曲</span>`);
        if (info.play_count || info.playCount) {
            statsHtml.push(`<span><i class="fas fa-headphones text-[10px] mr-1"></i>${formatPlayCount(info.play_count || info.playCount)}</span>`);
        }
        if (info.time) {
            statsHtml.push(`<span><i class="far fa-calendar text-[10px] mr-1"></i>${info.time}</span>`);
        }
        const statsEl = document.getElementById(`${prefix}-stats`);
        if (statsEl) {
            statsEl.innerHTML = statsHtml.join('');
        }

        // 填充描述
        const descEl = document.getElementById(`${prefix}-desc`);
        const descBtn = document.getElementById(`${prefix}-desc-btn`);
        if (descEl) {
            descEl.innerText = info.desc || '暂无介绍';
            descEl.classList.add('line-clamp-3', 'md:line-clamp-4');
            descEl.dataset.expanded = 'false';
        }
        if (descBtn) {
            descBtn.innerHTML = '展开全部 <i class="fas fa-chevron-down text-[10px] ml-0.5"></i>';
            descBtn.classList.add('hidden');
            requestAnimationFrame(() => {
                if (descEl && descBtn && descEl.scrollHeight > descEl.clientHeight) {
                    descBtn.classList.remove('hidden');
                }
            });
        }

        // 绑定事件（事件委托）
        container.querySelectorAll('[data-action]').forEach(btn => {
            const action = btn.dataset.action;
            if (action === 'collapse' && opts.showCollapseToggle) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleCollapse(prefix);
                });
            } else if (action === 'refresh' && typeof opts.onRefresh === 'function') {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    opts.onRefresh();
                });
            } else if (action === 'jump' && typeof opts.onJump === 'function') {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    opts.onJump();
                });
            }
        });

        // 描述点击展开/收起
        if (descEl) {
            descEl.addEventListener('click', () => toggleDesc(prefix));
        }
        if (descBtn) {
            descBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDesc(prefix);
            });
        }

        // 触发跑马灯检测
        if (typeof window.applyMarqueeChecks === 'function') {
            window.applyMarqueeChecks();
        }
    }

    /** 显示头部容器 */
    function show(containerId) {
        const container = document.getElementById(containerId);
        if (container) container.classList.remove('hidden');
    }

    /** 隐藏头部容器 */
    function hide(containerId) {
        const container = document.getElementById(containerId);
        if (container) container.classList.add('hidden');
    }

    /**
     * 折叠/展开头部
     * @param {string} prefix - 元素 ID 前缀
     * @param {string} [externalIconId] - 外部折叠图标元素 ID（如顶部栏的图标）
     */
    function toggleCollapse(prefix, externalIconId) {
        const header = document.querySelector(`.${prefix}-header-inner`);
        if (!header) return;
        const container = header.parentElement;
        const internalIcon = header.querySelector(`.${prefix}-collapse-icon`);
        const externalIcon = externalIconId ? document.getElementById(externalIconId) : null;
        const isCollapsed = header.classList.contains('is-collapsed');
        if (isCollapsed) {
            header.classList.remove('is-collapsed', 'max-h-0', 'opacity-0', 'py-0');
            header.classList.add('max-h-[1000px]', 'p-4', 'md:p-6');
            if (container) container.classList.add('border-b');
            if (internalIcon) internalIcon.style.transform = 'rotate(0deg)';
            if (externalIcon) externalIcon.style.transform = 'rotate(0deg)';
        } else {
            header.classList.remove('max-h-[1000px]', 'p-4', 'md:p-6');
            header.classList.add('is-collapsed', 'max-h-0', 'opacity-0', 'py-0');
            if (container) container.classList.remove('border-b');
            if (internalIcon) internalIcon.style.transform = 'rotate(180deg)';
            if (externalIcon) externalIcon.style.transform = 'rotate(180deg)';
        }
    }

    /** 展开/收起描述 */
    function toggleDesc(prefix) {
        const descEl = document.getElementById(`${prefix}-desc`);
        const descBtn = document.getElementById(`${prefix}-desc-btn`);
        if (!descEl || !descBtn) return;
        const isExpanded = descEl.dataset.expanded === 'true';
        if (isExpanded) {
            descEl.classList.add('line-clamp-3', 'md:line-clamp-4');
            descEl.dataset.expanded = 'false';
            descBtn.innerHTML = '展开全部 <i class="fas fa-chevron-down text-[10px] ml-0.5"></i>';
        } else {
            descEl.classList.remove('line-clamp-3', 'md:line-clamp-4');
            descEl.dataset.expanded = 'true';
            descBtn.innerHTML = '收起 <i class="fas fa-chevron-up text-[10px] ml-0.5"></i>';
        }
    }

    return { render, show, hide, toggleCollapse, toggleDesc };
})();
