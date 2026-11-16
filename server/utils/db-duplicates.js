"use strict";
/**
 * 重复记录处理模块 (Duplicate Records Handler)
 * 处理下载记录中的重复项检测和清理
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteDuplicateRecords = exports.getDuplicateRecords = void 0;
const fs_1 = __importDefault(require("fs"));
const db_core_1 = require("./db-core");
const db_songs_1 = require("./db-songs");
/**
 * 获取基于 album + singer + song_name 的重复记录
 * 返回格式: { album, singer, song_name, records: [{ song_id, file_path, source, singer_id, singer }] }
 * 仅返回有重复的组
 */
const getDuplicateRecords = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        // Get all finished records with the identifying fields
        const result = db.exec(`
            SELECT song_id, file_path, song_name, singer, album, source, singer_id
            FROM download_records 
            WHERE status = 'finished' 
            ORDER BY song_name, singer, album
        `);
        if (result.length === 0 || result[0].values.length === 0)
            return [];
        // Group by album + singer + song_name
        const groups = new Map();
        for (const row of result[0].values) {
            const songId = row[0];
            const filePath = row[1];
            const songName = row[2];
            const singer = row[3];
            const album = row[4];
            const source = row[5];
            const singerId = row[6];
            const key = `${album}|||${singer}|||${songName}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push({
                song_id: songId,
                file_path: filePath || '',
                source: source || '',
                singer_id: singerId || '',
                singer: singer || ''
            });
        }
        // Filter to only groups with duplicates
        const duplicates = [];
        for (const [key, records] of groups.entries()) {
            if (records.length > 1) {
                const [album, singer, songName] = key.split('|||');
                duplicates.push({
                    album,
                    singer,
                    song_name: songName,
                    records
                });
            }
        }
        return duplicates;
    }
    catch (err) {
        console.error('[DB] Failed to get duplicate records:', err.message);
        return [];
    }
};
exports.getDuplicateRecords = getDuplicateRecords;
/**
 * 删除重复记录，保留标准 source_songId 格式 (如 wy_123, kg_456, tx_789)
 * 返回删除的记录数量
 */
const deleteDuplicateRecords = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const duplicates = (0, exports.getDuplicateRecords)();
        let deletedCount = 0;
        // Helper function to check if song_id matches standard format: prefix_number
        const isStandardFormat = (songId) => {
            const match = songId.match(/^([a-z]+)_(\d+)$/i);
            return match !== null;
        };
        for (const group of duplicates) {
            // Step 1: 先删除这组中 file_path 文件不存在的记录
            const recordsWithMissingFiles = [];
            for (const record of group.records) {
                if (!record.file_path || !fs_1.default.existsSync(record.file_path)) {
                    db.run(`DELETE FROM download_records WHERE song_id = ?`, [record.song_id]);
                    deletedCount++;
                    recordsWithMissingFiles.push(record.song_id);
                    console.log(`[Deduplicate] Deleted (file missing): ${record.song_id}`);
                    // 清理孤立的歌手信息
                    (0, db_songs_1.cleanupOrphanedSingerInfo)(record.singer);
                }
            }
            // 从 group.records 中移除已删除的记录
            const remainingRecords = group.records.filter(r => !recordsWithMissingFiles.includes(r.song_id));
            // 如果这组只剩 0 或 1 条记录，跳过后续处理
            if (remainingRecords.length <= 1)
                continue;
            // Step 2: 在剩余记录中找标准格式的保留
            const standardRecords = remainingRecords.filter(r => isStandardFormat(r.song_id));
            // 优先保留标准格式记录，若无则保留第一条
            const recordToKeep = standardRecords.length > 0 ? standardRecords[0] : remainingRecords[0];
            // Step 3: 删除其余重复记录（同时删除文件）
            for (const record of remainingRecords) {
                if (record.song_id !== recordToKeep.song_id) {
                    // 先删除文件
                    if (record.file_path && fs_1.default.existsSync(record.file_path)) {
                        try {
                            fs_1.default.unlinkSync(record.file_path);
                            console.log(`[Deduplicate] Deleted file: ${record.file_path}`);
                        }
                        catch (fileErr) {
                            console.warn(`[Deduplicate] Failed to delete file ${record.file_path}: ${fileErr.message}`);
                        }
                    }
                    // 再删除DB记录
                    db.run(`DELETE FROM download_records WHERE song_id = ?`, [record.song_id]);
                    deletedCount++;
                    console.log(`[Deduplicate] Deleted (duplicate): ${record.song_id} (kept: ${recordToKeep.song_id})`);
                    // 清理孤立的歌手信息
                    (0, db_songs_1.cleanupOrphanedSingerInfo)(record.singer);
                }
            }
        }
        if (deletedCount > 0) {
            (0, db_core_1.saveDatabase)();
            console.log(`[DB] Deleted ${deletedCount} duplicate record(s), kept standard source_songId format versions`);
        }
        return deletedCount;
    }
    catch (err) {
        console.error('[DB] Failed to delete duplicate records:', err.message);
        return 0;
    }
};
exports.deleteDuplicateRecords = deleteDuplicateRecords;
