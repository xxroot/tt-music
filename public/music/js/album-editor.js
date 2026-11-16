// ==================== Album Editor - 专辑编辑器 ====================
// 专辑编辑器模块，提供专辑元数据编辑、图片管理等功能

/** 专辑编辑器状态 */
let _albumEditorState = null; // { albumName, sources: [{source, images}], currentSource, songCount }

/**
 * 打开专辑编辑器弹窗
 */
async function openAlbumEditor() {
    if (!window._albumLibCurrentAlbum || !window._albumLibCurrentAlbum.name) {
        showToast('error', '当前没有专辑信息');
        return;
    }

    const album = window._albumLibCurrentAlbum;
    _albumEditorState = {
        albumName: album.name,
        sources: [],
        currentSource: null,
        songCount: album.singCount || (album.songs ? album.songs.length : 0),
    };

    // 填充表单
    document.getElementById('album-edit-name').value = album.name || '';
    document.getElementById('album-edit-singer').value = album.singer || '';
    document.getElementById('album-edit-album-artist').value = album.albumArtist || '';
    document.getElementById('album-edit-genre').value = album.genre || '';
    document.getElementById('album-edit-year').value = album.year || '';
    document.getElementById('album-edit-disc-number').value = '';
    document.getElementById('album-edit-disc-total').value = '';
    document.getElementById('album-edit-composer').value = '';

    // 如果有歌曲数据，从中读取 disc_number/disc_total/composer
    const songs = album.songs || [];
    if (songs.length > 0) {
        const firstSong = songs[0];
        document.getElementById('album-edit-disc-number').value = firstSong.discNumber || '';
        document.getElementById('album-edit-disc-total').value = firstSong.discTotal || '';
        document.getElementById('album-edit-composer').value = firstSong.composer || '';
    }

    // 显示提示
    document.getElementById('album-edit-hint').textContent =
        `保存后将更新该专辑下所有 ${_albumEditorState.songCount} 首歌曲的元数据，并写入音频文件 TAG`;

    // 打开弹窗动画
    const modal = document.getElementById('album-editor-modal');
    const content = document.getElementById('album-editor-modal-content');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    // 异步加载图片
    await loadAlbumImages();
}

/**
 * 关闭专辑编辑器弹窗
 */
function closeAlbumEditor() {
    const modal = document.getElementById('album-editor-modal');
    const content = document.getElementById('album-editor-modal-content');
    content.classList.add('scale-95', 'opacity-0');
    content.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        _albumEditorState = null;
    }, 300);
}

/**
 * 加载专辑图片并按 source 分 Tab 显示
 */
async function loadAlbumImages() {
    if (!_albumEditorState) return;

    const gridEl = document.getElementById('album-image-grid');
    const tabsEl = document.getElementById('album-image-tabs');
    gridEl.innerHTML = '<div class="text-xs t-text-muted col-span-full text-center py-6">加载中...</div>';
    tabsEl.innerHTML = '';

    try {
        const headers = {...getUserAuthHeaders()};
        const res = await fetch(`/api/music/album/images?albumName=${encodeURIComponent(_albumEditorState.albumName)}`, {headers});
        const result = await res.json();

        if (!result.success || !result.sources || result.sources.length === 0) {
            gridEl.innerHTML = '<div class="text-xs t-text-muted col-span-full text-center py-6">暂无图片</div>';
            return;
        }

        _albumEditorState.sources = result.sources;
        _albumEditorState.currentSource = result.sources[0].source;

        // 渲染 Tab
        renderAlbumImageTabs();
        // 渲染当前 Tab 的图片
        renderAlbumImageGrid();
    } catch (err) {
        console.error('[AlbumEditor] Load images failed:', err);
        gridEl.innerHTML = '<div class="text-xs t-text-muted col-span-full text-center py-6">加载失败</div>';
    }
}

/**
 * 渲染图片 Tab 栏
 */
function renderAlbumImageTabs() {
    if (!_albumEditorState) return;
    const tabsEl = document.getElementById('album-image-tabs');
    tabsEl.innerHTML = '';

    for (const src of _albumEditorState.sources) {
        const label = src.source === 'local'
            ? '本地'
            : '下载';
        const active = src.source === _albumEditorState.currentSource;
        const btn = document.createElement('button');
        btn.className = active
            ? 'px-3 py-1 text-xs rounded-full bg-emerald-500 text-white'
            : 'px-3 py-1 text-xs rounded-full t-bg-main t-text-main hover:bg-emerald-100 dark:hover:bg-emerald-900/30';
        btn.textContent = label + ` (${src.images.length})`;
        btn.onclick = () => switchAlbumImageTab(src.source);
        tabsEl.appendChild(btn);
    }
}

/**
 * 切换图片 Tab
 */
function switchAlbumImageTab(source) {
    if (!_albumEditorState) return;
    _albumEditorState.currentSource = source;
    renderAlbumImageTabs();
    renderAlbumImageGrid();
}

/**
 * 渲染当前 Tab 的图片网格
 */
function renderAlbumImageGrid() {
    if (!_albumEditorState) return;
    const gridEl = document.getElementById('album-image-grid');
    const src = _albumEditorState.sources.find(s => s.source === _albumEditorState.currentSource);

    if (!src || src.images.length === 0) {
        gridEl.innerHTML = '<div class="text-xs t-text-muted col-span-full text-center py-6">暂无图片，请上传</div>';
        return;
    }

    gridEl.innerHTML = '';
    for (const img of src.images) {
        const imgUrl = `/api/music/album/image?albumName=${encodeURIComponent(_albumEditorState.albumName)}&fileName=${encodeURIComponent(img.name)}&source=${encodeURIComponent(src.source)}`;
        const div = document.createElement('div');
        div.className = 'relative group';
        div.innerHTML = `
            <img src="${imgUrl}" alt="${img.name}" class="w-full aspect-square object-cover rounded-lg cursor-pointer"
                 onerror="this.src='/music/assets/logo.png';">
            <div class="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button onclick="deleteAlbumImage('${img.name.replace(/'/g, "\\'")}')"
                        class="w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition">
                    <i class="fas fa-trash text-xs"></i>
                </button>
            </div>
            <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg p-1">
                <p class="text-white text-[10px] truncate text-center">${img.name}</p>
            </div>
        `;
        gridEl.appendChild(div);
    }
}

/**
 * 上传专辑图片到当前 Tab 的 source 目录
 */
async function handleAlbumImageUpload(event) {
    if (!_albumEditorState || !_albumEditorState.currentSource) return;
    const files = event.target.files;
    if (!files || files.length === 0) return;

    try {
        showToast('info', '正在上传...');
        const formData = new FormData();
        formData.append('albumName', _albumEditorState.albumName);
        formData.append('source', _albumEditorState.currentSource);
        for (const f of files) {
            formData.append('images', f);
        }

        const headers = {...getUserAuthHeaders()};
        // 不设置 Content-Type，让浏览器自动处理 multipart boundary
        delete headers['Content-Type'];
        const res = await fetch('/api/music/album/images/upload', {
            method: 'POST',
            headers,
            body: formData,
        });

        const result = await res.json();
        if (result.success) {
            showToast('success', `已上传 ${result.saved} 张图片`);
            await loadAlbumImages();
        } else {
            throw new Error(result.message || '上传失败');
        }
    } catch (err) {
        console.error('[AlbumEditor] Upload failed:', err);
        showToast('error', '上传失败: ' + (err.message || '未知错误'));
    }

    // 重置 input
    event.target.value = '';
}

/**
 * 删除专辑图片
 */
async function deleteAlbumImage(fileName) {
    if (!_albumEditorState || !_albumEditorState.currentSource) return;

    const confirmed = await showSelect('删除图片', `确定删除图片 "${fileName}" 吗？`);
    if (!confirmed) return;

    try {
        const headers = {
            'Content-Type': 'application/json',
            ...getUserAuthHeaders()
        };
        const res = await fetch('/api/music/album/images/delete', {
            method: 'DELETE',
            headers,
            body: JSON.stringify({
                albumName: _albumEditorState.albumName,
                fileName,
                source: _albumEditorState.currentSource,
            })
        });

        const result = await res.json();
        if (result.success) {
            showToast('success', '图片已删除');
            await loadAlbumImages();
        } else {
            throw new Error(result.message || '删除失败');
        }
    } catch (err) {
        console.error('[AlbumEditor] Delete failed:', err);
        showToast('error', '删除失败: ' + (err.message || '未知错误'));
    }
}

/**
 * 保存专辑元数据编辑
 */
async function saveAlbumEdits() {
    if (!_albumEditorState) return;

    const newAlbumName = document.getElementById('album-edit-name').value.trim();
    if (!newAlbumName) {
        showToast('error', '专辑名不能为空');
        return;
    }

    const singer = document.getElementById('album-edit-singer').value.trim();
    const year = document.getElementById('album-edit-year').value;
    const discNumber = document.getElementById('album-edit-disc-number').value;
    const discTotal = document.getElementById('album-edit-disc-total').value;
    const albumArtist = document.getElementById('album-edit-album-artist').value;
    const genre = document.getElementById('album-edit-genre').value;
    const composer = document.getElementById('album-edit-composer').value;

    const saveBtn = document.getElementById('album-edit-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    try {
        const headers = {
            'Content-Type': 'application/json',
            ...getUserAuthHeaders()
        };

        const res = await fetch('/api/music/album/metadata', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                oldAlbumName: _albumEditorState.albumName,
                newAlbumName: newAlbumName,
                singer: singer || '',
                year: year ? parseInt(year) : null,
                discNumber: discNumber ? parseInt(discNumber) : null,
                discTotal: discTotal ? parseInt(discTotal) : null,
                albumArtist: albumArtist || '',
                genre: genre || '',
                composer: composer || '',
            })
        });

        const result = await res.json();
        if (result.success) {
            showToast('success',
                `已更新 ${result.updatedCount} 条记录` +
                (result.albumRenamed ? '，专辑已重命名' : '') +
                `，TAG 写入 ${result.tagWriteCount} 首`);

            // 更新本地数据
            _albumEditorState.albumName = newAlbumName;
            window._albumLibCurrentAlbum.name = newAlbumName;
            window._albumLibCurrentAlbum.singer = singer;
            window._albumLibCurrentAlbum.albumArtist = albumArtist;
            window._albumLibCurrentAlbum.genre = genre;
            window._albumLibCurrentAlbum.year = year;

            // 更新 UI
            const nameEl = document.getElementById('albumlib-detail-name');
            const navTitleEl = document.getElementById('albumlib-detail-nav-title');
            const singerEl = document.getElementById('albumlib-detail-singer');
            if (nameEl) nameEl.textContent = newAlbumName;
            if (navTitleEl) navTitleEl.textContent = newAlbumName;
            if (singerEl) singerEl.textContent = singer;

            closeAlbumEditor();

            // 刷新专辑详情
            await refreshAlbumDetail();
        } else {
            throw new Error(result.message || '更新失败');
        }
    } catch (err) {
        console.error('[AlbumEditor] Save failed:', err);
        showToast('error', '保存失败: ' + (err.message || '未知错误'));
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
    }
}

// 注册全局函数
window.openAlbumEditor = openAlbumEditor;
window.closeAlbumEditor = closeAlbumEditor;
window.handleAlbumImageUpload = handleAlbumImageUpload;
window.deleteAlbumImage = deleteAlbumImage;
window.saveAlbumEdits = saveAlbumEdits;
window.switchAlbumImageTab = switchAlbumImageTab;
