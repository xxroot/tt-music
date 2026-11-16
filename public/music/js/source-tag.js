/**
 * 来源标签渲染 (Source tag badge)
 * 将 source 标识翻译为对应的彩色标签徽章
 * 本地 → 绿色"本地"，网易/QQ/酷狗/酷我/咪咕 → 各自品牌色
 */
function getSourceTag(source) {
    if (!source) return '';
    // 本地歌曲显示绿色「本地」标签
    if (String(source) === 'local') {
        return `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] font-bold border border-emerald-200 dark:border-emerald-500/30 t-badge-green mr-1">本地</span>`;
    }
    const colors = {
        kw: 't-badge-yellow border-yellow-200 dark:border-yellow-500/30',
        kg: 't-badge-blue border-blue-200 dark:border-blue-500/30',
        tx: 't-badge-green border-green-200 dark:border-emerald-500/30',
        wy: 't-badge-red border-red-200 dark:border-red-500/30',
        mg: 't-badge-pink border-pink-200 dark:border-pink-500/30'
    };
    const names = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕' };
    const color = colors[source] || 't-bg-main t-text-muted t-border-main';
    const name = names[source] || source.toUpperCase();
    return `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] font-bold border ${color} mr-1">${name}</span>`;
}

window.getSourceTag = getSourceTag;
