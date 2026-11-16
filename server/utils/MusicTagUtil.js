"use strict";
/**
 * MusicTag 工具模块 (Music Tag Utility Module)
 * 统一封装所有 music-tag-native (MusicTagger/MetaPicture) 操作
 * 包括：标签读取、封面提取、标签写入、DB 记录映射等
 *
 * 所有其他模块应通过此模块访问 MusicTagger，避免直接 require('music-tag-native')
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeLyrics = exports.readLyrics = exports.withTaggerSave = exports.withTagger = exports.hasEmbeddedCover = exports.tagsToDbRecord = exports.writeAllTags = exports.writeAndReadBackTags = exports.writeBasicTags = exports.extractCover = exports.readExtendedTags = exports.readBasicTags = void 0;
// @ts-ignore - music-tag-native 无类型定义
const { MusicTagger, MetaPicture } = require('music-tag-native');
// ==================== 内部辅助函数 ====================
/**
 * 打开 tagger → 执行回调 → 释放资源 (统一生命周期管理)
 * MusicTagger 构造函数不接受参数，必须用 loadPath() 加载文件
 */
const openTagger = (filePath, callback) => {
    let tagger = null;
    try {
        tagger = new MusicTagger();
        tagger.loadPath(filePath);
        return callback(tagger);
    }
    finally {
        try {
            tagger?.dispose();
        }
        catch { /* ignore */ }
    }
};
/** 创建 MetaPicture 实例的工厂函数 */
const createMetaPicture = (mime, data, type = 'Cover') => new MetaPicture(mime, data instanceof Uint8Array ? data : new Uint8Array(data), type);
/** 从已打开的 tagger 实例提取基础标签 */
const extractBasicTags = (tagger) => ({
    title: tagger.title || undefined,
    artist: tagger.artist || undefined,
    album: tagger.album || undefined,
    year: tagger.year || undefined,
    genre: tagger.genre || undefined,
    duration: tagger.duration ? Math.round(tagger.duration / 1000) : undefined,
    sampleRate: tagger.sampleRate || undefined,
    bitDepth: tagger.bitDepth || undefined,
    channels: tagger.channels || undefined,
    bitRate: tagger.bitRate || undefined,
    discNumber: tagger.discNumber || undefined,
    discTotal: tagger.discTotal || undefined,
    audioQuality: tagger.audioQuality || undefined,
});
/** 从已打开的 tagger 实例提取扩展标签 (基础 + 3 个额外字段) */
const extractExtendedTags = (tagger) => ({
    ...extractBasicTags(tagger),
    trackNumber: tagger.trackNumber || undefined,
    albumArtist: tagger.albumArtist || undefined,
    composer: tagger.composer || undefined,
});
/** 将 WriteTagsOptions 应用到 tagger 实例 (写入标签 + 嵌入封面) */
const applyWriteOptions = (tagger, tags) => {
    if (tags.title)
        tagger.title = tags.title;
    if (tags.artist)
        tagger.artist = tags.artist;
    if (tags.album)
        tagger.album = tags.album;
    if (tags.cover) {
        try {
            tagger.pictures = [createMetaPicture(tags.cover.mime || 'image/jpeg', tags.cover.data)];
        }
        catch { /* ignore cover error */ }
    }
};
/** 将 FullWriteTagsOptions 应用到 tagger 实例 (TAG编辑器全量写入) */
const applyFullWriteOptions = (tagger, tags) => {
    if (tags.title !== undefined)
        tagger.title = tags.title;
    if (tags.artist !== undefined)
        tagger.artist = tags.artist;
    if (tags.album !== undefined)
        tagger.album = tags.album;
    if (tags.year !== undefined) {
        try {
            tagger.year = typeof tags.year === 'string' ? parseInt(tags.year) || 0 : tags.year;
        }
        catch { }
    }
    if (tags.genre !== undefined)
        tagger.genre = tags.genre;
    if (tags.trackNumber !== undefined) {
        try {
            tagger.trackNumber = parseInt(String(tags.trackNumber)) || 0;
        }
        catch { }
    }
    if (tags.discNumber !== undefined) {
        try {
            tagger.discNumber = parseInt(String(tags.discNumber)) || 0;
        }
        catch { }
    }
    if (tags.discTotal !== undefined) {
        try {
            tagger.discTotal = parseInt(String(tags.discTotal)) || 0;
        }
        catch { }
    }
    if (tags.audioQuality !== undefined) {
        try {
            tagger.audioQuality = tags.audioQuality;
        }
        catch { }
    }
    if (tags.albumArtist !== undefined)
        tagger.albumArtist = tags.albumArtist;
    if (tags.composer !== undefined)
        tagger.composer = tags.composer;
    if (tags.cover) {
        try {
            tagger.pictures = [createMetaPicture(tags.cover.mime || 'image/jpeg', tags.cover.data)];
        }
        catch { /* ignore cover error */ }
    }
};
// ==================== 公开 API ====================
/**
 * 读取音频文件的基础元数据标签
 * 包含: title, artist, album, year, genre, duration(秒), sampleRate, bitDepth, channels, bitRate
 * @param filePath 音频文件绝对路径
 * @returns 提取到的标签，失败时返回空对象
 */
const readBasicTags = (filePath) => {
    try {
        return openTagger(filePath, extractBasicTags);
    }
    catch {
        return {};
    }
};
exports.readBasicTags = readBasicTags;
/**
 * 读取音频文件的扩展元数据标签 (含 trackNumber, albumArtist, composer)
 * @param filePath 音频文件绝对路径
 * @returns 提取到的标签，失败时返回空对象
 */
const readExtendedTags = (filePath) => {
    try {
        return openTagger(filePath, extractExtendedTags);
    }
    catch {
        return {};
    }
};
exports.readExtendedTags = readExtendedTags;
/**
 * 从音频文件中提取内嵌封面图片
 * @param filePath 音频文件绝对路径
 * @returns 封面数据或 null
 */
const extractCover = (filePath) => {
    try {
        return openTagger(filePath, (tagger) => {
            const pics = tagger.pictures;
            if (pics && pics.length > 0) {
                return { data: Buffer.from(pics[0].data), mime: pics[0].mimeType || 'image/jpeg' };
            }
            return null;
        });
    }
    catch {
        return null;
    }
};
exports.extractCover = extractCover;
/**
 * 写入基础标签到音频文件 (title, artist, album, 可选封面)
 * @param filePath 音频文件绝对路径
 * @param tags 要写入的标签
 * @returns 是否成功
 */
const writeBasicTags = (filePath, tags) => {
    try {
        openTagger(filePath, (tagger) => {
            applyWriteOptions(tagger, tags);
            tagger.save();
        });
        return true;
    }
    catch {
        return false;
    }
};
exports.writeBasicTags = writeBasicTags;
/**
 * 写入标签并返回写入后的扩展标签 (用于下载后写标签+读回完整标签)
 * @param filePath 音频文件绝对路径
 * @param tags 要写入的标签
 * @returns 写入后读回的扩展标签，失败返回 null
 */
const writeAndReadBackTags = (filePath, tags) => {
    try {
        return openTagger(filePath, (tagger) => {
            applyWriteOptions(tagger, tags);
            tagger.save();
            return extractExtendedTags(tagger);
        });
    }
    catch {
        return null;
    }
};
exports.writeAndReadBackTags = writeAndReadBackTags;
/**
 * 写入全量标签到音频文件 (TAG编辑器专用)
 * 支持: title, artist, album, year, genre, trackNumber, discNumber, discTotal, audioQuality, albumArtist, composer, cover
 * @param filePath 音频文件绝对路径
 * @param tags 要写入的标签
 * @returns 是否成功
 */
const writeAllTags = (filePath, tags) => {
    try {
        openTagger(filePath, (tagger) => {
            applyFullWriteOptions(tagger, tags);
            tagger.save();
        });
        return true;
    }
    catch {
        return false;
    }
};
exports.writeAllTags = writeAllTags;
/**
 * 将扩展标签转换为 DB 友好格式 (snake_case)
 * 可直接用于 updateMusicLibMeta() 的参数
 * @param tags 扩展标签
 * @returns DB 格式的记录 (仅含非 undefined 字段)
 */
const tagsToDbRecord = (tags) => {
    const record = {};
    if (tags.genre)
        record.genre = tags.genre;
    if (tags.year)
        record.year = typeof tags.year === 'string' ? Number(tags.year) || undefined : tags.year;
    if (tags.trackNumber)
        record.track_number = typeof tags.trackNumber === 'string' ? Number(tags.trackNumber) || undefined : tags.trackNumber;
    if (tags.discNumber)
        record.disc_number = typeof tags.discNumber === 'string' ? Number(tags.discNumber) || undefined : tags.discNumber;
    if (tags.discTotal)
        record.disc_total = typeof tags.discTotal === 'string' ? Number(tags.discTotal) || undefined : tags.discTotal;
    if (tags.audioQuality)
        record.audio_quality = tags.audioQuality;
    if (tags.albumArtist)
        record.album_artist = tags.albumArtist;
    if (tags.composer)
        record.composer = tags.composer;
    if (tags.sampleRate)
        record.sample_rate = tags.sampleRate;
    if (tags.bitDepth)
        record.bit_depth = tags.bitDepth;
    if (tags.channels)
        record.channels = tags.channels;
    if (tags.bitRate)
        record.bit_rate = tags.bitRate;
    if (tags.duration)
        record.duration = tags.duration;
    return record;
};
exports.tagsToDbRecord = tagsToDbRecord;
/**
 * 检查音频文件是否已有内嵌封面
 * @param filePath 音频文件绝对路径
 * @returns 是否有封面
 */
const hasEmbeddedCover = (filePath) => {
    try {
        return openTagger(filePath, (tagger) => {
            const pics = tagger.pictures;
            return !!(pics && pics.length > 0);
        });
    }
    catch {
        return false;
    }
};
exports.hasEmbeddedCover = hasEmbeddedCover;
/**
 * 低级 tagger 访问封装 (用于复杂操作，如 acoustidTagWriter 的条件写入)
 * 自动管理 open → callback → dispose 生命周期 (不自动保存)
 * @param filePath 音频文件绝对路径
 * @param callback 回调函数，接收 tagger 实例和 MetaPicture 工厂
 * @returns 回调的返回值
 */
const withTagger = (filePath, callback) => {
    return openTagger(filePath, (tagger) => callback(tagger, createMetaPicture));
};
exports.withTagger = withTagger;
/**
 * 低级 tagger 访问封装 (写入后保存)
 * 自动管理 open → callback → save → dispose 生命周期
 * @param filePath 音频文件绝对路径
 * @param callback 回调函数，接收 tagger 实例和 MetaPicture 工厂
 */
const withTaggerSave = (filePath, callback) => {
    return openTagger(filePath, (tagger) => {
        const result = callback(tagger, createMetaPicture);
        tagger.save();
        return result;
    });
};
exports.withTaggerSave = withTaggerSave;
/**
 * 从音频文件中读取内嵌歌词 (LYRICS Vorbis comment / USLT frame)
 * @param filePath 音频文件绝对路径
 * @returns 歌词字符串，无歌词或读取失败时返回 null
 */
const readLyrics = (filePath) => {
    try {
        return openTagger(filePath, (tagger) => {
            const lyrics = tagger.lyrics;
            return lyrics && lyrics.trim() ? lyrics : null;
        });
    }
    catch {
        return null;
    }
};
exports.readLyrics = readLyrics;
/**
 * 写入歌词到音频文件 TAG (LYRICS Vorbis comment / USLT frame)
 * @param filePath 音频文件绝对路径
 * @param lyrics 歌词文本内容
 * @returns 是否写入成功
 */
const writeLyrics = (filePath, lyrics) => {
    try {
        openTagger(filePath, (tagger) => {
            tagger.lyrics = lyrics;
            tagger.save();
        });
        return true;
    }
    catch (err) {
        console.error(`[MusicTagUtil] Failed to write lyrics to ${filePath}:`, err.message || err);
        return false;
    }
};
exports.writeLyrics = writeLyrics;
