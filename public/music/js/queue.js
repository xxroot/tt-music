// ========== Queue - 播放队列管理 ==========
// 负责播放队列的渲染、排序、增删操作。
// 依赖全局: currentPlaylist, currentIndex, audio, playSong, savePlaybackState, sendDlnaCommand
// ==================================================

window.QueueManager = (function() {

/** 队列是否已渲染 */
let isQueueRendered = false;

/** [ML-06 优化] 虚拟滚动 scroll 事件节流 */
let _queueScrollTimer = null;

/**
 * 切换播放队列抽屉显示/隐藏
 */
function toggleQueueDrawer() {
    const drawer = document.getElementById('queue-drawer');
    if (!drawer) return;

    const isHidden = drawer.classList.contains('translate-x-full');
    if (isHidden) {
        renderQueue();
        drawer.classList.remove('translate-x-full');

        // 自动定位当前歌曲
        setTimeout(() => {
            scrollToCurrentSongInQueue(false);
        }, 350); // 等待抽屉打开动画完成

        // 移动端: 如果侧边栏打开则关闭
        if (window.innerWidth <= 1024) {
            const sidebar = document.getElementById('main-sidebar');
            if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
                toggleSidebar();
            }
        }
    } else {
        drawer.classList.add('translate-x-full');
    }
}

/**
 * 定位播放队列中当前播放的歌曲
 *
 * @param {boolean} flash - 是否显示闪烁提醒效果
 */
function scrollToCurrentSongInQueue(flash = true) {
    const listContainer = document.getElementById('queue-list');
    if (!listContainer) return;

    // 根据 renderQueue 中的 active 状态类名进行查找
    const activeItem = listContainer.querySelector('.border-emerald-500');
    if (activeItem) {
        activeItem.scrollIntoView({behavior: 'smooth', block: 'center'});

        if (flash) {
            // 闪烁高亮提醒
            activeItem.classList.add('ring-2', 'ring-emerald-500', 'ring-inset', 'ring-opacity-50');
            setTimeout(() => {
                activeItem.classList.remove('ring-2', 'ring-emerald-500', 'ring-inset', 'ring-opacity-50');
            }, 1000);
        }
    } else if (flash) {
        showInfo('当前播放歌曲不在队列中或尚未渲染');
    }
}

/**
 * 渲染播放队列
 * 根据歌曲数量自动选择正常渲染或虚拟滚动
 */
function renderQueue() {
    const listContainer = document.getElementById('queue-list');
    const countEl = document.getElementById('queue-count');
    if (!listContainer) return;

    if (!window.currentPlaylist || window.currentPlaylist.length === 0) {
        listContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 opacity-30 select-none">
                <i class="fas fa-music text-4xl mb-4"></i>
                <p class="text-xs font-bold uppercase tracking-widest">队列为空</p>
            </div>
        `;
        if (countEl) countEl.innerText = '0 SONGS';
        return;
    }

    if (countEl) countEl.innerText = `${window.currentPlaylist.length} SONGS`;

    // [优化] 超过 200 首时使用虚拟滚动,避免一次性渲染大量 DOM 节点
    const QUEUE_ITEM_HEIGHT = 70; // 每行大约高度 (px)
    const VIRTUAL_BUFFER = 10; // 上下缓冲行数
    const VIRTUAL_THRESHOLD = 200; // 超过此数量启用虚拟渲染

    if (window.currentPlaylist.length > VIRTUAL_THRESHOLD) {
        renderQueueVirtual(listContainer, QUEUE_ITEM_HEIGHT, VIRTUAL_BUFFER);
        return;
    }

    // 正常渲染(歌曲数量少时)
    listContainer.innerHTML = window.currentPlaylist.map((song, index) => {
        const isActive = index === window.currentIndex;
        return `
            <div class="group flex items-center gap-3 p-3 rounded-xl transition-all hover:t-bg-item-hover cursor-pointer relative ${isActive ? 't-bg-item-hover border-l-4 border-emerald-500 pl-2' : ''}"
                 onclick="playSongFromQueue(${index})">
                
                <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative">
                    <img src="${getImgUrl(song)}" 
                         onerror="this.src='/music/assets/logo.png'" 
                         loading="lazy" fetchpriority="low"
                         class="w-full h-full object-cover">
                    ${isActive ? '<div class="absolute inset-0 bg-emerald-500/20 flex items-center justify-center"><div class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></div></div>' : ''}
                </div>
                
                <div class="flex-1 min-w-0">
                    ${createMarqueeHtml(song.name, 'text-sm font-bold ' + (isActive ? 'text-emerald-500' : 't-text-main'))}
                    <div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">
                        ${getSourceTag(song.source)}
                        ${getQualityTags(song)}
                        ${createMarqueeHtml(song.singer, 'text-[10px] t-text-muted flex-1')}
                    </div>
                </div>

                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="event.stopPropagation(); removeFromQueue(${index})" class="p-2 text-gray-400 hover:text-red-500 transition-colors">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                    <div class="p-2 text-gray-400 cursor-grab active:cursor-grabbing queue-drag-handle">
                        <i class="fas fa-grip-lines text-xs"></i>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // 初始化/更新 Sortable (支持移动端触摸)
    initQueueSortable(listContainer);

    // 更新提示: 队列超过 1 首歌时显示拖拽提示
    const tip = document.getElementById('queue-tip');
    if (tip) {
        if (window.currentPlaylist.length > 1) tip.classList.remove('hidden');
        else tip.classList.add('hidden');
    }

    // 应用滚动文本检查
    applyMarqueeChecks();
}

/**
 * [优化] 虚拟滚动渲染播放列表
 * 只渲染可见区域的歌曲项,避免上万首时 DOM 节点过多导致卡顿
 *
 * @param {HTMLElement} container - 列表容器
 * @param {number} itemHeight - 每行高度 (px)
 * @param {number} buffer - 上下缓冲行数
 */
function renderQueueVirtual(container, itemHeight, buffer) {
    const totalHeight = window.currentPlaylist.length * itemHeight;
    const containerHeight = container.clientHeight || 500;
    const scrollTop = container.scrollTop || 0;

    // 计算可见范围
    const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
    const endIdx = Math.min(
        window.currentPlaylist.length,
        Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer
    );

    // 创建占位容器
    const wrapper = document.createElement('div');
    wrapper.style.height = `${totalHeight}px`;
    wrapper.style.position = 'relative';

    // 渲染可见项
    const visibleHtml = window.currentPlaylist.slice(startIdx, endIdx).map((song, sliceIdx) => {
        const index = startIdx + sliceIdx;
        const isActive = index === window.currentIndex;
        const topOffset = index * itemHeight;

        return `
            <div class="group flex items-center gap-3 p-3 rounded-xl transition-all hover:t-bg-item-hover cursor-pointer relative absolute w-full ${isActive ? 't-bg-item-hover border-l-4 border-emerald-500 pl-2' : ''}"
                 style="top: ${topOffset}px;"
                 onclick="playSongFromQueue(${index})">
                
                <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative">
                    <img src="${getImgUrl(song)}" 
                         onerror="this.src='/music/assets/logo.png'" 
                         loading="lazy" fetchpriority="low"
                         class="w-full h-full object-cover">
                    ${isActive ? '<div class="absolute inset-0 bg-emerald-500/20 flex items-center justify-center"><div class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></div></div>' : ''}
                </div>
                
                <div class="flex-1 min-w-0">
                    ${createMarqueeHtml(song.name, 'text-sm font-bold ' + (isActive ? 'text-emerald-500' : 't-text-main'))}
                    <div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">
                        ${getSourceTag(song.source)}
                        ${getQualityTags(song)}
                        ${createMarqueeHtml(song.singer, 'text-[10px] t-text-muted flex-1')}
                    </div>
                </div>

                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="event.stopPropagation(); removeFromQueue(${index})" class="p-2 text-gray-400 hover:text-red-500 transition-colors">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    wrapper.innerHTML = visibleHtml;
    container.innerHTML = '';
    container.appendChild(wrapper);

    // 滚动时重新渲染
    container.onscroll = () => {
        renderQueueVirtual(container, itemHeight, buffer);
    };

    applyMarqueeChecks();
}

/**
 * 初始化队列拖拽排序
 *
 * @param {HTMLElement} container - 列表容器
 */
function initQueueSortable(container) {
    if (typeof Sortable === 'undefined' || !container) return;

    try {
        const oldSortable = Sortable.get(container);
        if (oldSortable) oldSortable.destroy();
    } catch (e) {
    }

    Sortable.create(container, {
        animation: 200,
        handle: '.queue-drag-handle',
        ghostClass: 'sortable-ghost-solid',
        chosenClass: 'sortable-chosen-item',
        dragClass: 'sortable-drag-item',
        forceFallback: true,
        fallbackOnBody: true,
        delay: 100,
        delayOnTouchOnly: true,
        touchStartThreshold: 3,
        onStart: () => {
            document.body.classList.add('select-none');
        },
        onEnd: (evt) => {
            document.body.classList.remove('select-none');
            const oldIndex = evt.oldIndex;
            const newIndex = evt.newIndex;
            if (oldIndex === newIndex) return;

            // 重排 currentPlaylist
            const movedItem = window.currentPlaylist.splice(oldIndex, 1)[0];
            window.currentPlaylist.splice(newIndex, 0, movedItem);

            // 更新 currentIndex
            if (window.currentIndex === oldIndex) {
                window.currentIndex = newIndex;
            } else if (oldIndex < window.currentIndex && newIndex >= window.currentIndex) {
                window.currentIndex--;
            } else if (oldIndex > window.currentIndex && newIndex <= window.currentIndex) {
                window.currentIndex++;
            }

            renderQueue();
            savePlaybackState();
            showInfo('播放顺序已更新');
        }
    });
}

function initQueueVirtualScroll() {
    const listContainer = document.getElementById('queue-list');
    if (!listContainer) return;
    listContainer.addEventListener('scroll', () => {
        if (_queueScrollTimer) return;
        _queueScrollTimer = requestAnimationFrame(() => {
            _queueScrollTimer = null;
            // 只在虚拟模式下重新渲染
            if (window.currentPlaylist.length > 200) {
                renderQueueVirtual(listContainer, 70, 10);
            }
        });
    }, {passive: true});
}

function playSongFromQueue(index) {
    if (!window.currentPlaylist[index]) return;
    playSong(window.currentPlaylist[index], index);
}

function removeFromQueue(index) {
    if (!window.currentPlaylist || index < 0 || index >= window.currentPlaylist.length) return;

    const removedId = window.currentPlaylist[index].id;
    window.currentPlaylist.splice(index, 1);

    // If we removed the currently playing song's index, we need to adjust currentIndex
    if (index === window.currentIndex) {
        // [Optional] Auto-play next or just stop? Here we just adjust index for next song
        // Typically people expect it to stay at same index but if it was last, wrap around
        if (window.currentPlaylist.length === 0) {
            window.currentIndex = -1;
            try {
                const audio = document.getElementById('audio-player');
                audio.pause();
            } catch (e) {
            }
        } else if (window.currentIndex >= window.currentPlaylist.length) {
            window.currentIndex = 0; // Wrap to start
        }
        // [Think] Should we auto-play next? Usually delete means "remove but keep playing current"
        // But if user clicks delete on current, maybe skip to next.
        // For now, let's keep playing but adjust index.
    } else if (index < window.currentIndex) {
        window.currentIndex--;
    }

    renderQueue();
    savePlaybackState(); // Save state after removal
    // 同步歌单移除到后端 DMC（不中断播放）
    if (window._castDeviceType === 'upnp') {
        sendDlnaCommand('removeFromPlaylist', {indices: [index]});
    }
    showSuccess('已从队列移除');
}

async function clearQueue() {
    if (!window.currentPlaylist || window.currentPlaylist.length === 0) return;
    if (await showSelect('清空队列', '确定要清空当前播放队列吗？', {danger: true})) {
        window.currentPlaylist = [];
        window.currentIndex = -1;
        try {
            const audio = document.getElementById('audio-player');
            audio.pause();
        } catch (e) {
        }
        renderQueue();
        savePlaybackState(); // Save empty state
        // 同步清空歌单到后端 DMC
        if (window._castDeviceType === 'upnp') {
            sendDlnaCommand('clearPlaylist', {});
        }
        showInfo('队列已清空');
    }
}

return {
    toggleQueueDrawer,
    scrollToCurrentSongInQueue,
    renderQueue,
    initQueueSortable,
    initQueueVirtualScroll,
    playSongFromQueue,
    removeFromQueue,
    clearQueue
};
})();

// ============================================================================
// 向后兼容的独立导出 (Backward Compatible Individual Exports)
// ============================================================================

window.toggleQueueDrawer = window.QueueManager.toggleQueueDrawer;
window.scrollToCurrentSongInQueue = window.QueueManager.scrollToCurrentSongInQueue;
window.renderQueue = window.QueueManager.renderQueue;
window.initQueueSortable = window.QueueManager.initQueueSortable;
window.playSongFromQueue = window.QueueManager.playSongFromQueue;
window.removeFromQueue = window.QueueManager.removeFromQueue;
window.clearQueue = window.QueueManager.clearQueue;
window.initQueueVirtualScroll = window.QueueManager.initQueueVirtualScroll;
