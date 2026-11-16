// ========================================
// 评论系统 (Comments Module)
// (由 app.js 提取)
// ========================================

let currentCommentType = 'hot'; // 'hot' or 'new'
let currentCommentPage = 1;
let isCommentLoading = false;

// 评论数据缓存
let lastCommentSongId = null;
let commentCache = {
    hot: {pages: {}, total: 0, maxPage: 1},
    new: {pages: {}, total: 0, maxPage: 1}
};

function clearCommentCache() {
    commentCache.hot = {pages: {}, total: 0, maxPage: 1};
    commentCache.new = {pages: {}, total: 0, maxPage: 1};
    const hotCount = document.getElementById('hot-comment-count');
    const newCount = document.getElementById('new-comment-count');
    if (hotCount) hotCount.innerText = '';
    if (newCount) newCount.innerText = '';
}

// 解决变量名不一致问题
function getActiveSongInfo() {
    // currentPlayingSong 定义在 app.js 中，通过 window 访问
    if (typeof window.currentPlayingSong !== 'undefined' && window.currentPlayingSong) return window.currentPlayingSong;
    return null;
}


function toggleCommentModal() {
    const modal = document.getElementById('comment-modal');
    const content = document.getElementById('comment-modal-content');
    if (!modal || !content) return;

    const isHidden = modal.classList.contains('hidden');

    if (isHidden) {
        // 打开
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // 触发动画
        requestAnimationFrame(() => {
            content.classList.remove('translate-y-10', 'opacity-0');
            content.classList.add('translate-y-0', 'opacity-100');
        });

        // 加载评论
        const song = getActiveSongInfo();
        if (song) {
            const songId = song.songmid || song.hash || song.id;
            if (lastCommentSongId !== songId) {
                lastCommentSongId = songId;
                clearCommentCache();
                refreshComments();
            } else {
                fetchComments();
            }
        } else {
            console.warn('[Comment] No song playing, showing empty state');
            document.getElementById('comment-list').innerHTML = '<div class="text-center py-10 t-text-muted font-bold">请先播放歌曲</div>';
            document.getElementById('comment-loader').classList.add('hidden');
        }
    } else {
        // 关闭
        content.classList.remove('translate-y-0', 'opacity-100');
        content.classList.add('translate-y-10', 'opacity-0');

        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
}

async function switchCommentType(type) {
    if (currentCommentType === type) return;
    currentCommentType = type;

    // UI Feedback
    const hotBtn = document.getElementById('tab-hot-comments');
    const newBtn = document.getElementById('tab-new-comments');

    if (type === 'hot') {
        hotBtn.classList.add('text-emerald-600');
        hotBtn.classList.remove('t-text-muted');
        hotBtn.querySelector('div').classList.remove('scale-x-0');

        newBtn.classList.remove('text-emerald-600');
        newBtn.classList.add('t-text-muted');
        newBtn.querySelector('div').classList.add('scale-x-0');
    } else {
        newBtn.classList.add('text-emerald-600');
        newBtn.classList.remove('t-text-muted');
        newBtn.querySelector('div').classList.remove('scale-x-0');

        hotBtn.classList.remove('text-emerald-600');
        hotBtn.classList.add('t-text-muted');
        hotBtn.querySelector('div').classList.add('scale-x-0');
    }

    refreshComments(false);
}

async function refreshComments(force = true) {
    if (force) {
        clearCommentCache();
    }
    currentCommentPage = 1;
    await fetchComments();
}

async function changeCommentPage(delta) {
    const newPage = currentCommentPage + delta;
    if (newPage < 1 || isCommentLoading) return;

    currentCommentPage = newPage;
    await fetchComments();

    // 滚动到顶部
    const container = document.getElementById('comment-list-container');
    if (container) container.scrollTo({top: 0, behavior: 'smooth'});
}

async function fetchComments() {
    const song = getActiveSongInfo();
    if (!song || isCommentLoading) {
        return;
    }

    const loader = document.getElementById('comment-loader');
    const list = document.getElementById('comment-list');
    const pageIndicator = document.getElementById('comment-page-indicator');

    // 1. 检查当前类型和页码是否有缓存
    const cache = commentCache[currentCommentType];
    const cachedPage = cache.pages[currentCommentPage];

    if (cachedPage) {
        if (list) list.innerHTML = ''; // 确保清空上一页内容
        renderComments(cachedPage);
        updateCommentCountLabels(cache.total);
        updatePaginationUI(cache.total, cache.maxPage);
        if (loader) loader.classList.add('hidden');
        isCommentLoading = false;
        return;
    }

    // 2. Cache miss: 显示加载状态
    isCommentLoading = true;
    if (loader) loader.classList.remove('hidden');
    if (list) list.innerHTML = '';
    if (pageIndicator) pageIndicator.innerText = `PAGE -- / --`;

    // 更新标题和来源
    document.getElementById('comment-title').innerText = `${song.name} - 评论`;
    document.getElementById('comment-source-info').innerText = `Source: ${song.source.toUpperCase()}`;


    try {
        const response = await fetch('/api/music/comment', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                songInfo: song,
                type: currentCommentType,
                page: currentCommentPage,
                limit: 20
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Comment] API Error:', response.status, errorText);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        // 存入缓存
        commentCache[currentCommentType].pages[currentCommentPage] = data.comments;
        commentCache[currentCommentType].total = data.total;
        commentCache[currentCommentType].maxPage = data.maxPage || Math.ceil((data.total || 0) / 20) || 1;

        renderComments(data.comments);
        updateCommentCountLabels(data.total);
        updatePaginationUI(data.total, data.maxPage);

    } catch (e) {
        console.error('Fetch comments failed:', e);
        if (list) list.innerHTML = `<div class="text-center py-10 text-red-400 font-bold">加载失败: ${e.message}</div>`;
    } finally {
        if (loader) loader.classList.add('hidden');
        isCommentLoading = false;
    }
}

function updatePaginationUI(total, maxPage) {
    const totalPages = maxPage || Math.ceil((total || 0) / 20) || 1;
    const pageIndicator = document.getElementById('comment-page-indicator');
    if (pageIndicator) pageIndicator.innerText = `PAGE ${currentCommentPage} / ${totalPages}`;

    const prevBtn = document.getElementById('btn-comment-prev');
    const nextBtn = document.getElementById('btn-comment-next');
    if (prevBtn) prevBtn.disabled = currentCommentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentCommentPage >= totalPages;

    // 兼容旧版统计逻辑 (如果有)
    const oldInfo = document.getElementById('comment-pagination-info');
    if (oldInfo) oldInfo.innerText = `Page ${currentCommentPage}`;
}

function updateCommentCountLabels(total) {
    if (total === undefined) return;
    const countLabel = currentCommentType === 'hot' ? 'hot-comment-count' : 'new-comment-count';
    const el = document.getElementById(countLabel);
    if (el) el.innerText = total > 1000 ? (total / 1000).toFixed(1) + 'k' : total;
}

function renderComments(comments) {
    const list = document.getElementById('comment-list');
    if (!list) return;

    if (!comments || comments.length === 0) {
        if (currentCommentPage === 1) {
            list.innerHTML = '<div class="text-center py-20 text-gray-300 font-bold uppercase tracking-widest">暂无评论</div>';
        }
        return;
    }

    const html = comments.map(c => createCommentItemHTML(c)).join('');
    if (currentCommentPage === 1) {
        list.innerHTML = html;
    } else {
        list.insertAdjacentHTML('beforeend', html);
    }
}

function createCommentItemHTML(comment, isReply = false) {
    const timeStr = comment.timeStr || (comment.time ? new Date(comment.time).toLocaleString() : '');
    const location = comment.location ? ` • ${comment.location}` : '';

    // 头像处理
    const defaultAvatar = '/music/assets/logo.png';
    const avatar = comment.avatar || defaultAvatar;
    const isDefault = avatar.includes('logo.png') || !comment.avatar;
    const avatarClass = `w-8 h-8 md:w-10 md:h-10 rounded-full shadow-sm hover:scale-110 transition-transform t-bg-main flex-shrink-0 object-cover ${isDefault ? 'dynamic-logo is-placeholder p-1.5' : ''}`;

    let replyHtml = '';
    if (comment.reply && comment.reply.length > 0) {
        replyHtml = `
            <div class="mt-4 ml-2 pl-4 border-l-2 t-border-main space-y-4">
                ${comment.reply.map(r => createCommentItemHTML(r, true)).join('')}
            </div>
        `;
    }

    return `
        <div class="group flex gap-3 md:gap-4 transition-all animate-fade-in-up">
            <img src="${avatar}" 
                 loading="lazy" fetchpriority="low"
                 class="${avatarClass}" 
                 onerror="if(!this.dataset.tried){this.dataset.tried=1;this.src='/music/assets/logo.png';this.classList.add('dynamic-logo','is-placeholder','p-1.5','bg-emerald-50');this.style.filter='var(--logo-filter, none)';}">
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs md:text-sm font-black t-text-main truncate">${comment.userName}</span>
                    <div class="flex items-center gap-1.5 text-[10px] t-text-muted font-bold">
                        <i class="far fa-thumbs-up"></i>
                        <span>${comment.likedCount || 0}</span>
                    </div>
                </div>
                <p class="text-xs md:text-sm t-text-muted leading-relaxed break-words whitespace-pre-wrap">${comment.text}</p>
                ${comment.images && comment.images.length > 0 ? `
                    <div class="mt-2 flex flex-wrap gap-2">
                        ${comment.images.map(img => `
                            <img src="${img}" 
                                 loading="lazy" fetchpriority="low"
                                 class="max-w-[200px] max-h-[300px] rounded-lg shadow-sm cursor-pointer hover:opacity-90 transition-opacity" 
                                 onclick="window.open('${img}', '_blank')"
                                 onerror="this.style.display='none'">
                        `).join('')}
                    </div>
                ` : ''}
                <div class="mt-2 flex items-center gap-3 text-[10px] t-text-muted font-bold uppercase tracking-tight">
                    <span>${timeStr}${location}</span>
                </div>
                ${replyHtml}
            </div>
        </div>
    `;
}

// ========== Window 导出 ==========
window.toggleCommentModal = toggleCommentModal;
window.switchCommentType = switchCommentType;
window.refreshComments = refreshComments;
window.fetchComments = fetchComments;
window.changeCommentPage = changeCommentPage;
window.clearCommentCache = clearCommentCache;
