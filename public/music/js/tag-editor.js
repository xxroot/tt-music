// ========== Tag Editor - TAG 编辑器 ==========
// 负责音乐文件标签的读取、编辑、保存，以及封面上传功能。
// 依赖全局函数: buildCoverUrl, formatDuration, getUserAuthHeaders, showToast
// ==================================================

let _tagEditorState = null; // { relativePath, source, songIndex, context }

async function openTagEditor(index, context) {
    let song = null;
    if (context === 'musiclib') {
        const pageIdx = index;
        const globalIdx = (window._musicLibPage - 1) * window._musicLibPageSize + pageIdx;
        song = window._musicLibFiltered[globalIdx];
    } else if (context === 'album') {
        song = window._albumLibCurrentAlbum && window._albumLibCurrentAlbum.songs[index];
    } else if (context === 'folderlib') {
        song = window._folderSongsList[index];
    }
    if (!song || !song.relativePath) {
        console.log('无法获取歌曲信息', song, index, context)
        showToast('error', '无法获取歌曲信息');
        return;
    }

    _tagEditorState = {
        relativePath: song.relativePath,
        source: song.source,
        songIndex: index,
        context: context,
    };

    // Reset form
    document.getElementById('tag-edit-title').value = song.name || '';
    document.getElementById('tag-edit-artist').value = song.singer || '';
    document.getElementById('tag-edit-album').value = song.album || '';
    document.getElementById('tag-edit-album-artist').value = song.albumArtist || '';
    document.getElementById('tag-edit-composer').value = song.composer || '';
    document.getElementById('tag-edit-genre').value = song.genre || '';
    document.getElementById('tag-edit-year').value = song.year || '';
    document.getElementById('tag-edit-track-number').value = song.trackNumber || '';
    document.getElementById('tag-edit-disc-number').value = song.discNumber || '';
    document.getElementById('tag-edit-disc-total').value = song.discTotal || '';
    document.getElementById('tag-edit-audio-quality').value = song.audioQuality || '';
    document.getElementById('tag-edit-rename').checked = false;
    document.getElementById('tag-edit-warn').classList.add('hidden');

    // Cover
    const coverEl = document.getElementById('tag-edit-cover');
    const coverUrl = buildCoverUrl(song.relativePath, song.source);
    coverEl.src = coverUrl || '';
    coverEl.onerror = function () {
        this.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23e5e7eb" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%239ca3af" font-size="12">No Cover</text></svg>';
    };

    // Read-only info
    document.getElementById('tag-edit-ext').textContent = song.relativePath ? song.relativePath.split('.').pop().toUpperCase() : '-';
    document.getElementById('tag-edit-duration').textContent = song.duration ? formatDuration(song.duration) : '-';
    document.getElementById('tag-edit-sample-rate').textContent = song.sampleRate ? (song.sampleRate / 1000).toFixed(1) + 'kHz' : '-';
    document.getElementById('tag-edit-bit-depth').textContent = song.bitDepth ? song.bitDepth + 'bit' : '-';

    // Open modal with animation
    const modal = document.getElementById('tag-editor-modal');
    const content = document.getElementById('tag-editor-modal-content');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    // Async load TAG from file
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`/api/music/tag/read?relativePath=${encodeURIComponent(song.relativePath)}&source=${encodeURIComponent(song.source || '')}`, {headers});
        const result = await res.json();
        if (result.success && result.data) {
            const d = result.data;
            document.getElementById('tag-edit-title').value = d.title || song.name || '';
            document.getElementById('tag-edit-artist').value = d.artist || song.singer || '';
            document.getElementById('tag-edit-album').value = d.album || song.album || '';
            document.getElementById('tag-edit-album-artist').value = d.albumArtist || song.albumArtist || '';
            document.getElementById('tag-edit-composer').value = d.composer || song.composer || '';
            document.getElementById('tag-edit-genre').value = d.genre || song.genre || '';
            document.getElementById('tag-edit-year').value = d.year || song.year || '';
            document.getElementById('tag-edit-track-number').value = d.trackNumber || song.trackNumber || '';
            document.getElementById('tag-edit-disc-number').value = d.discNumber || song.discNumber || '';
            document.getElementById('tag-edit-disc-total').value = d.discTotal || song.discTotal || '';
            document.getElementById('tag-edit-audio-quality').value = d.audioQuality || song.audioQuality || '';

            // Update readonly info from file TAG
            if (d.duration) document.getElementById('tag-edit-duration').textContent = formatDuration(d.duration);
            if (d.sampleRate) document.getElementById('tag-edit-sample-rate').textContent = (d.sampleRate / 1000).toFixed(1) + 'kHz';
            if (d.bitDepth) document.getElementById('tag-edit-bit-depth').textContent = d.bitDepth + 'bit';

            if (!d.writable) {
                const warnEl = document.getElementById('tag-edit-warn');
                warnEl.textContent = '当前文件格式不支持标签写入，修改仅更新数据库记录。';
                warnEl.classList.remove('hidden');
                document.getElementById('tag-edit-save-btn').textContent = '保存（仅数据库）';
            } else {
                document.getElementById('tag-edit-save-btn').textContent = '保存';
            }

            // Update cover if file has embedded cover
            if (d.hasCover && song.relativePath) {
                coverEl.src = buildCoverUrl(song.relativePath, song.source);
            }
        }
    } catch (err) {
        console.warn('[TagEditor] Failed to read tags from file:', err);
    }
}

function closeTagEditorModal() {
    const modal = document.getElementById('tag-editor-modal');
    const content = document.getElementById('tag-editor-modal-content');
    content.classList.add('scale-95', 'opacity-0');
    content.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        _tagEditorState = null;
    }, 300);
}

async function handleTagCoverUpload(event) {
    if (!_tagEditorState) return;
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        showToast('error', '封面图片不能超过 5MB');
        return;
    }

    // Local preview
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('tag-edit-cover').src = e.target.result;
    };
    reader.readAsDataURL(file);

    // Upload to server
    try {
        const formData = new FormData();
        formData.append('relativePath', _tagEditorState.relativePath);
        formData.append('cover', file);

        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        delete headers['Content-Type']; // Let browser set multipart boundary

        const res = await fetch('/api/music/tag/cover', {
            method: 'POST',
            headers,
            body: formData,
        });
        const result = await res.json();
        if (result.success) {
            showToast('success', '封面已更新');
        } else {
            showToast('error', '封面上传失败: ' + (result.message || '未知错误'));
        }
    } catch (err) {
        console.error('[TagEditor] Cover upload failed:', err);
        showToast('error', '封面上传失败: ' + err.message);
    }
    // Reset file input so same file can be selected again
    event.target.value = '';
}

async function saveTagEdits() {
    if (!_tagEditorState) return;

    const saveBtn = document.getElementById('tag-edit-save-btn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '保存中...';
    saveBtn.disabled = true;

    const tags = {
        title: document.getElementById('tag-edit-title').value.trim(),
        artist: document.getElementById('tag-edit-artist').value.trim(),
        album: document.getElementById('tag-edit-album').value.trim(),
        albumArtist: document.getElementById('tag-edit-album-artist').value.trim(),
        composer: document.getElementById('tag-edit-composer').value.trim(),
        genre: document.getElementById('tag-edit-genre').value.trim(),
        year: document.getElementById('tag-edit-year').value ? parseInt(document.getElementById('tag-edit-year').value) : null,
        trackNumber: document.getElementById('tag-edit-track-number').value ? parseInt(document.getElementById('tag-edit-track-number').value) : null,
        discNumber: document.getElementById('tag-edit-disc-number').value ? parseInt(document.getElementById('tag-edit-disc-number').value) : null,
        discTotal: document.getElementById('tag-edit-disc-total').value ? parseInt(document.getElementById('tag-edit-disc-total').value) : null,
        audioQuality: document.getElementById('tag-edit-audio-quality').value.trim(),
    };

    const renameFile = document.getElementById('tag-edit-rename').checked;

    try {
        const headers = {'Content-Type': 'application/json'};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch('/api/music/tag/write', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                relativePath: _tagEditorState.relativePath,
                source: _tagEditorState.source,
                tags,
                renameFile,
            }),
        });
        const result = await res.json();
        if (result.success) {
            showToast('success', '保存成功');
            closeTagEditorModal();
            // Refresh the current view
            if (_tagEditorState.context === 'musiclib') {
                await loadMusicLib();
            } else if (_tagEditorState.context === 'album') {
                await refreshAlbumDetail();
            } else if (_tagEditorState.context === 'folderlib') {
                await loadFolderSongs();
            }
        } else {
            showToast('error', '保存失败: ' + (result.message || '未知错误'));
        }
    } catch (err) {
        console.error('[TagEditor] Save failed:', err);
        showToast('error', '保存失败: ' + err.message);
    } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

// ========== Window Exports ==========
window.openTagEditor = openTagEditor;
window.closeTagEditorModal = closeTagEditorModal;
window.handleTagCoverUpload = handleTagCoverUpload;
window.saveTagEdits = saveTagEdits;
