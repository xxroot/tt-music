"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAcoustidTags = void 0;
/**
 * Acoustid 标签写入模块 (Acoustid Tag Writer Module)
 * 使用 music-tag-native (MusicTagger) 将 Acoustid 元数据写入音频文件标签
 * 含封面嵌入 tag + 同目录保存 Cover 文件
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const acoustidLookup_1 = require("./acoustidLookup");
const acoustidFingerprint_1 = require("./acoustidFingerprint");
const MusicTagUtil = __importStar(require("../../utils/MusicTagUtil"));
/**
 * 写入 Acoustid 元数据到音频文件标签
 * @param filePath 音频文件绝对路径
 * @param metadata Acoustid 查询到的元数据
 * @param coverUrl 封面 URL (可为 null)
 * @param overwriteExisting 是否覆盖已有标签字段
 * @param acoustidId Acoustid ID (可为 null)
 * @returns 写入结果
 */
const writeAcoustidTags = async (filePath, metadata, coverUrl, overwriteExisting = false, acoustidId = null) => {
    const result = {
        written: false,
        skipped: false,
        fieldsWritten: [],
        coverApplied: false,
        coverSaved: false,
        coverSkipped: false
    };
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    // DFF 格式不支持标签写入
    if (!acoustidFingerprint_1.WRITABLE_TAG_EXTS.includes(ext)) {
        console.log(`[Acoustid] Tag writing not supported for ${ext}, skipping`);
        result.skipped = true;
        return result;
    }
    // 检查文件是否存在
    if (!node_fs_1.default.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    let coverData = null;
    // 下载封面图片
    if (coverUrl) {
        coverData = await (0, acoustidLookup_1.downloadCoverImage)(coverUrl);
    }
    try {
        MusicTagUtil.withTaggerSave(filePath, (tagger, createMetaPicture) => {
            const fieldsWritten = [];
            // 写入元数据字段 (overwriteExisting=false 时跳过已有值的字段)
            const writeField = (fieldName, value, taggerProp) => {
                if (!value)
                    return;
                if (!overwriteExisting && tagger[taggerProp])
                    return;
                tagger[taggerProp] = value;
                fieldsWritten.push(fieldName);
            };
            // 写入整数字段 (lofty-rs 要求 u32 类型)
            const writeIntField = (fieldName, value, taggerProp) => {
                if (value == null)
                    return;
                const intVal = typeof value === 'number' ? value : parseInt(String(value), 10);
                if (isNaN(intVal) || intVal <= 0)
                    return;
                if (!overwriteExisting && tagger[taggerProp])
                    return;
                try {
                    ;
                    tagger[taggerProp] = intVal;
                    fieldsWritten.push(fieldName);
                }
                catch {
                    // 某些格式可能不支持该字段, 忽略错误
                }
            };
            // ── 基本信息 ──
            writeField('title', metadata.title, 'title');
            writeField('artist', metadata.artist, 'artist');
            writeField('album', metadata.album, 'album');
            writeField('albumArtist', metadata.albumArtist, 'albumArtist');
            // genre (仅来自 MusicBrainz tags，非 primary-type)
            writeField('genre', metadata.genre, 'genre');
            // releaseType: 发行类型 (Album/Single/EP)
            writeField('releaseType', metadata.releaseType, 'grouping');
            // date: 完整日期 (如 "2023-01-15")
            writeField('date', metadata.date, 'date');
            // year: 从 date 中提取年份部分 (如 "2023-01-15" → 2023)
            if (metadata.date) {
                const yearStr = metadata.date.match(/^(\d{4})/)?.[1] || null;
                writeIntField('year', yearStr, 'year');
            }
            writeIntField('trackNumber', metadata.trackNumber, 'trackNumber');
            writeIntField('discNumber', metadata.discNumber, 'discNumber');
            // ── 厂牌/国家 ──
            writeField('label', metadata.label, 'publisher');
            // country 写入 comment 字段 (音频标签无专用 country 字段)
            if (metadata.country) {
                const countryComment = `Country: ${metadata.country}`;
                writeField('country', countryComment, 'comment');
            }
            // ── 排序名 ──
            writeField('artistSortName', metadata.artistSortName, 'artistSortName');
            writeField('albumArtistSortName', metadata.albumArtistSortName, 'albumArtistSortName');
            // ── MusicBrainz IDs ──
            writeField('recordingMbid', metadata.recordingMbid, 'musicBrainzTrackId');
            writeField('releaseMbid', metadata.releaseMbid, 'musicBrainzAlbumId');
            writeField('releaseGroupMbid', metadata.releaseGroupMbid, 'musicBrainzReleaseGroupId');
            // ── Acoustid ID ──
            writeField('acoustidId', acoustidId, 'acoustidId');
            // ── 封面 URL 写入 comment ──
            if (coverUrl) {
                const existingComment = tagger.comment || '';
                const coverComment = `Cover: ${coverUrl}`;
                const newComment = existingComment
                    ? `${existingComment}\n${coverComment}`
                    : coverComment;
                // 如果 country 已写入 comment，追加而非覆盖
                if (!overwriteExisting && existingComment && existingComment.includes('Country:')) {
                    ;
                    tagger.comment = `${existingComment}\n${coverComment}`;
                    fieldsWritten.push('coverUrl');
                }
                else if (!overwriteExisting && existingComment) {
                    // comment 已有其他内容且不覆盖，跳过
                }
                else {
                    ;
                    tagger.comment = newComment;
                    fieldsWritten.push('coverUrl');
                }
            }
            // 嵌入封面到 tag
            if (coverData) {
                try {
                    const pic = createMetaPicture(coverData.mime, coverData.data, 'Cover');
                    tagger.pictures = [pic];
                    result.coverApplied = true;
                    fieldsWritten.push('cover');
                    console.log(`[Acoustid] Cover embedded in tag: ${coverData.mime}, ${coverData.data.length} bytes`);
                }
                catch (picErr) {
                    console.error(`[Acoustid] Cover embedding failed: ${picErr.message}`);
                }
            }
            // withTaggerSave 自动调用 tagger.save()
            result.written = true;
            result.fieldsWritten = fieldsWritten;
            console.log(`[Acoustid] Tags written to: ${node_path_1.default.basename(filePath)} (${fieldsWritten.join(', ')})`);
        });
    }
    catch (err) {
        console.error(`[Acoustid] Tag writing failed: ${err.message}`);
        throw err;
    }
    // 保存封面到同目录 (Cover.jpg / Cover.png)
    if (coverData) {
        try {
            const dir = node_path_1.default.dirname(filePath);
            const coverExt = coverData.mime.includes('png') ? '.png' : '.jpg';
            const coverFileName = `Cover${coverExt}`;
            const coverFilePath = node_path_1.default.join(dir, coverFileName);
            // 检查是否已有 Cover 文件
            const existingCover = findExistingCover(dir);
            if (existingCover) {
                console.log(`[Acoustid] Cover file already exists, skipping: ${existingCover}`);
                result.coverSkipped = true;
            }
            else {
                node_fs_1.default.writeFileSync(coverFilePath, coverData.data);
                result.coverSaved = true;
                console.log(`[Acoustid] Cover saved: ${coverFilePath} (${coverData.data.length} bytes)`);
            }
        }
        catch (err) {
            console.error(`[Acoustid] Cover file save failed: ${err.message}`);
        }
    }
    return result;
};
exports.writeAcoustidTags = writeAcoustidTags;
/**
 * 检查目录中是否已有 Cover 文件
 * @param dir 目录路径
 * @returns 已有的 Cover 文件名, 无则返回 null
 */
const findExistingCover = (dir) => {
    const coverFileNames = ['Cover.jpg', 'Cover.png', 'cover.jpg', 'cover.png', 'Folder.jpg', 'folder.jpg'];
    try {
        const files = node_fs_1.default.readdirSync(dir);
        for (const file of files) {
            if (coverFileNames.includes(file)) {
                return file;
            }
        }
    }
    catch {
        // 目录读取失败, 忽略
    }
    return null;
};
