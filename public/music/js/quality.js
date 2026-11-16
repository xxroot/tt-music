/**
 * 音质管理模块
 * 负责音质选择、智能降级和音质信息获取
 */

// 音质优先级定义（从高到低）
const QUALITY_PRIORITY = ['flac24bit', 'flac', '320k', '128k'];

// 下载专用音质优先级（从高到低，允许降级到有损）
const DOWNLOAD_QUALITY_PRIORITY = ['flac24bit', 'flac', '320k', '128k'];

// 音质显示名称
const QUALITY_NAMES = {
    'flac24bit': 'Hi-Res',
    'flac': '无损',
    '320k': '高品质',
    '128k': '标准'
};

// 音质颜色（用于 UI 显示）: FLAC及以下→蓝色, FLAC以上(Hi-Res)→金黄色
const QUALITY_COLORS = {
    'flac24bit': 'bg-amber-100 text-amber-700 border-amber-200',
    'flac': 'bg-blue-100 text-blue-700 border-blue-200',
    '320k': 'bg-blue-100 text-blue-700 border-blue-200',
    '128k': 'bg-blue-100 text-blue-700 border-blue-200'
};

/**
 * 获取歌曲的最佳可用音质
 * @param {Object} songInfo - 歌曲信息对象
 * @param {string} userPreference - 用户偏好音质（默认 '320k'）
 * @returns {string} 实际可用的最佳音质
 */
function getBestQuality(songInfo, userPreference = 'flac') {
    if (!songInfo) return '128k';

    const types = songInfo.types || songInfo._types ||
        songInfo.qualitys || songInfo._qualitys ||
        (songInfo.meta && (songInfo.meta.qualitys || songInfo.meta._qualitys || songInfo.meta.types || songInfo.meta._types)) ||
        (songInfo.quality ? [songInfo.quality] : {});

    // 规范化 types 结构
    // musicSdk 返回的格式可能是数组或对象
    let availableQualities = [];

    if (Array.isArray(types)) {
        // 数组格式：[{ type: '320k', size: '...' }, ...]
        availableQualities = types.map(t => t.type || t);
    } else {
        // 对象格式：{ '320k': true, 'flac': false, ... }
        availableQualities = Object.keys(types).filter(k => types[k]);
    }

    // 如果没有可用音质信息，返回默认值
    if (availableQualities.length === 0) {
        console.warn('[Quality] 歌曲无音质信息，使用默认 flac');
        return 'flac';
    }

    // 从用户偏好开始，向下降级查找
    const startIndex = QUALITY_PRIORITY.indexOf(userPreference);
    if (startIndex === -1) {
        console.warn(`[Quality] 无效的音质偏好: ${userPreference}`);
        return availableQualities[0] || '128k';
    }

    for (let i = startIndex; i < QUALITY_PRIORITY.length; i++) {
        const quality = QUALITY_PRIORITY[i];
        if (availableQualities.includes(quality)) {
            console.log(`[Quality] 选择音质: ${quality} (偏好: ${userPreference})`);
            return quality;
        }
    }

    // 如果所有标准音质都不可用，返回第一个可用的
    console.warn('[Quality] 无匹配音质，使用第一个可用:', availableQualities[0]);
    return availableQualities[0] || '128k';
}

/**
 * 获取下一级音质（用于降级重试）
 * @param {string} currentQuality - 当前音质
 * @returns {string|null} 下一级音质，如果已是最低则返回 null
 */
function getNextLowerQuality(currentQuality, songInfo = null) {
    const index = QUALITY_PRIORITY.indexOf(currentQuality);
    if (index === -1 || index === QUALITY_PRIORITY.length - 1) {
        return null;
    }
    // 如果传入了 songInfo，只在歌曲实际支持的音质中查找下一级
    const available = songInfo ? getAvailableQualities(songInfo) : null;
    for (let i = index + 1; i < QUALITY_PRIORITY.length; i++) {
        const q = QUALITY_PRIORITY[i];
        if (!available || available.includes(q)) {
            return q;
        }
    }
    return null;
}

/**
 * 获取所有可用音质列表
 * @param {Object} songInfo - 歌曲信息
 * @returns {Array<string>} 可用音质数组
 */
function getAvailableQualities(songInfo) {
    if (!songInfo) return ['128k'];

    const types = songInfo.types || songInfo._types ||
        songInfo.qualitys || songInfo._qualitys ||
        (songInfo.meta && (songInfo.meta.qualitys || songInfo.meta._qualitys || songInfo.meta.types || songInfo.meta._types)) ||
        {};

    if (Array.isArray(types)) {
        return types.map(t => t.type || t);
    } else {
        return Object.keys(types).filter(k => types[k]);
    }
}

/**
 * 获取音质的显示名称
 * @param {string} quality - 音质标识
 * @returns {string} 显示名称
 */
function getQualityDisplayName(quality) {
    return QUALITY_NAMES[quality] || quality.toUpperCase();
}

/**
 * 获取音质的颜色类
 * @param {string} quality - 音质标识
 * @returns {string} Tailwind CSS 类名
 */
function getQualityColor(quality) {
    return QUALITY_COLORS[quality] || QUALITY_COLORS['128k'];
}

/**
 * 检查歌曲是否支持指定音质
 * @param {Object} songInfo - 歌曲信息
 * @param {string} quality - 要检查的音质
 * @returns {boolean} 是否支持
 */
function isQualityAvailable(songInfo, quality) {
    const available = getAvailableQualities(songInfo);
    return available.includes(quality);
}

/**
 * 获取下载用的最佳音质（优先高音质，允许向下降级到有损）
 * @param {Object} songInfo - 歌曲信息对象
 * @param {string} userPreference - 用户偏好音质（默认 'flac24bit'）
 * @returns {string|null} 实际可用的音质，一首可用音质都没有时返回 null
 */
function getBestDownloadQuality(songInfo, userPreference = 'flac24bit') {
    if (!songInfo) return null;

    const availableQualities = getAvailableQualities(songInfo);

    // 如果没有可用音质信息，返回 null
    if (availableQualities.length === 0) {
        console.warn('[Quality] 歌曲无音质信息，跳过下载');
        return null;
    }

    // 从用户偏好音质开始，按 QUALITY_PRIORITY 向下降级查找可用音质
    const startIndex = QUALITY_PRIORITY.indexOf(userPreference);
    const start = startIndex === -1 ? 0 : startIndex;

    for (let i = start; i < QUALITY_PRIORITY.length; i++) {
        const quality = QUALITY_PRIORITY[i];
        if (availableQualities.includes(quality)) {
            console.log(`[Quality] 下载选择音质: ${quality} (偏好: ${userPreference})`);
            return quality;
        }
    }

    // 标准音质都没命中，返回第一个可用的
    console.warn('[Quality] 无匹配标准音质，使用第一个可用:', availableQualities[0]);
    return availableQualities[0] || null;
}

/**
 * 检查音质是否为无损及以上
 * @param {string} quality - 音质标识
 * @returns {boolean} 是否为无损及以上音质
 */
function isLosslessQuality(quality) {
    if (!quality) return false;
    return quality === 'flac24bit' || quality === 'flac' || quality === 'ape' || quality === 'wav';
}

// 导出到全局
window.QualityManager = {
    QUALITY_PRIORITY,
    DOWNLOAD_QUALITY_PRIORITY,
    QUALITY_NAMES,
    QUALITY_COLORS,
    getBestQuality,
    getBestDownloadQuality,
    isLosslessQuality,
    getNextLowerQuality,
    getAvailableQualities,
    getQualityDisplayName,
    getQualityColor,
    isQualityAvailable
};

console.log('[Quality] 音质管理模块已加载');
