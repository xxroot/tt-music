"use strict";
/**
 * 歌曲相关数据库操作 (Song-related Database Operations)
 * 处理 download_records 表的歌曲 CRUD 操作
 *
 * 重构说明:
 * - 提取通用行转换函数,消除 7 处重复代码
 * - 按功能分组: 查询 → 写入 → 删除 → 统计 → 维护
 * - 简化日志: 仅保留关键操作日志,去除冗余输出
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHomeStats = exports.getRecordsNeedingEnrichment = exports.batchUpsertDownloadRecords = exports.deleteDownloadRecordsBySongIds = exports.getSongIdsBySource = exports.getSongIdsByPathPrefix = exports.getFinishedCountByPathPrefix = exports.deleteDownloadRecordsByPathPrefix = exports.deleteDownloadRecordsBySource = exports.getFinishedCountBySource = exports.deleteDownloadRecordBySourceAndSongId = exports.deleteStaleRecords = exports.getStaleRecords = exports.clearAllDownloadRecords = exports.getDownloadStats = exports.replaceFileRecordWithSongId = exports.deleteDownloadRecordByFilePath = exports.deleteDownloadRecordByPath = exports.cleanupOrphanedSingerInfo = exports.updateSongFullTags = exports.updateSongNameInDB = exports.updateDurationByPath = exports.updateAlbumCoverBatch = exports.updateMusicLibMeta = exports.upsertDownloadRecord = exports.getFolderSongsPageFromDB = exports.getMusicLibPageFromDB = exports.getRandomSongsFromDB = exports.getMusicLibListFromDB = exports.getDownloadRecordByFileIdentity = exports.getDownloadRecordByName = exports.getDownloadRecordBySongId = exports.getDownloadRecordsByRelativePathPrefix = exports.getDownloadRecordByRelativePath = exports.getDownloadRecordByPath = exports.getAllDownloadRecords = exports.getDownloadRecords = exports.getDownloadRecord = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_core_1 = require("./db-core");
// ==================== 通用工具函数 ====================
/**
 * 将 SQL 查询结果行转换为 DownloadRecord 对象
 */
const rowToRecord = (row, columns) => {
    const record = {};
    columns.forEach((col, idx) => {
        record[col] = row[idx];
    });
    return record;
};
/**
 * 执行查询并返回单条记录
 */
const querySingle = (sql, params = []) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return null;
    try {
        const result = db.exec(sql, params);
        if (result.length > 0 && result[0].values.length > 0) {
            return rowToRecord(result[0].values[0], result[0].columns);
        }
    }
    catch (err) {
        console.error('[DB] Query failed:', err.message);
    }
    return null;
};
/**
 * 执行查询并返回多条记录
 */
const queryMultiple = (sql, params = []) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(sql, params);
        if (result.length > 0 && result[0].values.length > 0) {
            const columns = result[0].columns;
            return result[0].values.map((row) => rowToRecord(row, columns));
        }
    }
    catch (err) {
        console.error('[DB] Query failed:', err.message);
    }
    return [];
};
// ==================== 查询操作 (Query Operations) ====================
/**
 * 按 source + song_id 查询单条下载记录
 */
const getDownloadRecord = (source, songId) => {
    return querySingle(`SELECT *
         FROM download_records
         WHERE source = ?
           AND song_id = ?`, [source, songId]);
};
exports.getDownloadRecord = getDownloadRecord;
/**
 * 批量查询下载记录 (返回 Map)
 * @param source 音源标识 (wy/tx/kg/kw/mg)
 * @param songIds 歌曲ID数组 (不含source前缀的纯ID)
 * @returns Map<songId, DownloadRecord> - key为纯songId,不含source前缀
 */
const getDownloadRecords = (source, songIds) => {
    const map = new Map();
    if (songIds.length === 0)
        return map;
    try {
        const placeholders = songIds.map(() => '?').join(',');
        const records = queryMultiple(`SELECT *
             FROM download_records
             WHERE source = ?
               AND song_id IN (${placeholders})`, [source, ...songIds]);
        records.forEach(record => map.set(record.song_id, record));
    }
    catch (err) {
        console.error('[DB] Batch query failed:', err.message);
    }
    return map;
};
exports.getDownloadRecords = getDownloadRecords;
/**
 * 查询所有下载记录
 */
const getAllDownloadRecords = () => {
    return queryMultiple(`SELECT *
                          FROM download_records
                          ORDER BY downloaded_at DESC`);
};
exports.getAllDownloadRecords = getAllDownloadRecords;
/**
 * 按绝对路径查询下载记录
 */
const getDownloadRecordByPath = (filePath) => {
    return querySingle(`SELECT *
         FROM download_records
         WHERE file_path = ?`, [filePath]);
};
exports.getDownloadRecordByPath = getDownloadRecordByPath;
/**
 * 按 relative_path 查询下载记录
 */
const getDownloadRecordByRelativePath = (relativePath) => {
    return querySingle(`SELECT *
         FROM download_records
         WHERE relative_path = ?`, [relativePath]);
};
exports.getDownloadRecordByRelativePath = getDownloadRecordByRelativePath;
/**
 * 按 relative_path 前缀查询下载记录（LIKE 查询，用于多扩展名候选匹配）
 * 例：传入 'album/name(singer)' 可匹配 'album/name(singer).flac' / '.mp3' 等
 */
const getDownloadRecordsByRelativePathPrefix = (prefix) => {
    return queryMultiple(`SELECT *
         FROM download_records
         WHERE relative_path LIKE ?
           AND status = 'finished'`, [prefix + '%']);
};
exports.getDownloadRecordsByRelativePathPrefix = getDownloadRecordsByRelativePathPrefix;
/**
 * 按 source + song_id 查询下载记录 (用于 DMC resolveSongUrl)
 */
const getDownloadRecordBySongId = (source, songId) => {
    return querySingle(`SELECT *
         FROM download_records
         WHERE source = ?
           AND song_id = ?
           AND status = 'finished'`, [source, songId]);
};
exports.getDownloadRecordBySongId = getDownloadRecordBySongId;
/**
 * 按歌曲名+歌手+专辑查询下载记录
 */
const getDownloadRecordByName = (name, singer, album) => {
    return querySingle(`SELECT *
         FROM download_records
         WHERE song_name = ?
           AND singer = ?
           AND album = ?
           AND status = 'finished'`, [name, singer, album]);
};
exports.getDownloadRecordByName = getDownloadRecordByName;
/**
 * 按文件标识查询 (file_ 前缀记录)
 */
const getDownloadRecordByFileIdentity = (singer, album, songName) => {
    const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
    const fileSongId = `file_${sanitize(singer)}_${sanitize(album)}_${sanitize(songName)}`;
    return querySingle(`SELECT *
         FROM download_records
         WHERE song_id = ?`, [fileSongId]);
};
exports.getDownloadRecordByFileIdentity = getDownloadRecordByFileIdentity;
/**
 * 获取音乐库列表 (前端兼容格式)
 */
const getMusicLibListFromDB = (source) => {
    try {
        let whereClause = "WHERE status = 'finished'";
        const params = [];
        if (source) {
            if (source === 'download') {
                // 下载歌曲: 排除本地库来源
                whereClause += " AND source != 'local'";
            }
            else {
                whereClause += ' AND source = ?';
                params.push(source);
            }
        }
        const records = queryMultiple(`
            SELECT song_id,
                   song_name,
                   singer,
                   album,
                   source,
                   quality,
                   file_path,
                   file_size,
                   duration,
                   relative_path,
                   ext,
                   has_cover,
                   has_lyric,
                   mtime,
                   downloaded_at,
                   genre, year, track_number, album_artist, composer, sample_rate, bit_depth, channels, bit_rate, singer_ids, singer_id, img, album_id
            FROM download_records
            ${whereClause}
            ORDER BY COALESCE(mtime, downloaded_at) DESC
            LIMIT 200
        `, params);
        return records.map(record => (0, db_core_1.mapRecordToFrontendFormat)(record));
    }
    catch (err) {
        console.error('[DB] Failed to get music lib list:', err.message);
        return [];
    }
};
exports.getMusicLibListFromDB = getMusicLibListFromDB;
/**
 * 随机获取音乐库歌曲 (Randomly select songs from music library)
 * 供首页"随心听"使用，ORDER BY RANDOM() 全库随机抽取
 * @param limit 返回数量上限
 */
const getRandomSongsFromDB = (limit) => {
    if (!limit || limit <= 0)
        return [];
    try {
        const records = queryMultiple(`
            SELECT song_id,
                   song_name,
                   singer,
                   album,
                   source,
                   quality,
                   file_path,
                   file_size,
                   duration,
                   relative_path,
                   ext,
                   has_cover,
                   has_lyric,
                   mtime,
                   downloaded_at,
                   genre, year, track_number, album_artist, composer, sample_rate, bit_depth, channels, bit_rate, singer_ids, singer_id, img, album_id
            FROM download_records
            WHERE status = 'finished'
            ORDER BY RANDOM()
            LIMIT ?
        `, [limit]);
        return records.map(record => (0, db_core_1.mapRecordToFrontendFormat)(record));
    }
    catch (err) {
        console.error('[DB] Failed to get random songs:', err.message);
        return [];
    }
};
exports.getRandomSongsFromDB = getRandomSongsFromDB;
/**
 * 获取音乐库分页列表 (服务端分页)
 * @param options.page 页码 (从1开始)
 * @param options.pageSize 每页数量
 * @param options.sort 排序字段 (mtime/name/singer/album/size/duration)
 * @param options.order 排序方向 (desc/asc)
 * @param options.search 搜索关键词 (匹配歌名/歌手/专辑)
 */
const getMusicLibPageFromDB = (options) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { data: [], total: 0, page: 1, pageSize: 30, totalPages: 0 };
    const { page = 1, pageSize = 30, sort = 'mtime', order = 'desc', search = '', source = '' } = options;
    try {
        // 构建 WHERE 子句
        let whereClause = "WHERE status = 'finished'";
        const params = [];
        if (source) {
            if (source === 'download') {
                // 下载歌曲: 排除本地库来源
                whereClause += " AND source != 'local'";
            }
            else {
                whereClause += ' AND source = ?';
                params.push(source);
            }
        }
        if (search) {
            whereClause += ` AND (song_name LIKE ? OR singer LIKE ? OR album LIKE ?)`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }
        // 获取总数
        const countResult = db.exec(`SELECT COUNT(*) as total FROM download_records ${whereClause}`, params);
        const total = countResult.length > 0 && countResult[0].values.length > 0
            ? countResult[0].values[0][0]
            : 0;
        // 构建 ORDER BY 子句
        const sortMap = {
            'name': 'song_name',
            'singer': 'singer',
            'album': 'album',
            'mtime': 'COALESCE(mtime, downloaded_at)',
            'size': 'file_size',
            'duration': 'duration'
        };
        const sortColumn = sortMap[sort] || sortMap['mtime'];
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        // 计算偏移量
        const offset = (page - 1) * pageSize;
        // 获取分页结果
        const records = queryMultiple(`
            SELECT song_id,
                   song_name,
                   singer,
                   album,
                   source,
                   quality,
                   file_path,
                   file_size,
                   duration,
                   relative_path,
                   ext,
                   has_cover,
                   has_lyric,
                   mtime,
                   downloaded_at,
                   genre, year, track_number, album_artist, composer, sample_rate, bit_depth, channels, bit_rate, singer_ids, singer_id, img, album_id
            FROM download_records
            ${whereClause}
            ORDER BY ${sortColumn} ${sortOrder}, rowid ASC
            LIMIT ? OFFSET ?
        `, [...params, pageSize, offset]);
        return {
            data: records.map(record => (0, db_core_1.mapRecordToFrontendFormat)(record)),
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize)
        };
    }
    catch (err) {
        console.error('[DB] Failed to get paginated music lib list:', err.message);
        return { data: [], total: 0, page: 1, pageSize: 30, totalPages: 0 };
    }
};
exports.getMusicLibPageFromDB = getMusicLibPageFromDB;
/**
 * 查询指定本地库目录下的歌曲 (分页)
 * @param options.folderPath 相对于库根目录的路径 (如 "摇滚/Beyond")
 * @param options.page 页码 (从1开始)
 * @param options.pageSize 每页数量
 * @param options.sort 排序字段 (mtime/name/singer/album/size/duration)
 * @param options.order 排序方向 (desc/asc)
 * @param options.search 搜索关键词 (匹配歌名/歌手/专辑)
 */
const getFolderSongsPageFromDB = (options) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { data: [], total: 0, page: 1, pageSize: 30, totalPages: 0 };
    const { folderPath, page = 1, pageSize = 30, sort = 'mtime', order = 'desc', search = '' } = options;
    try {
        // LIKE 转义: 将 % 和 _ 字符转义，避免注入
        const escapedFolder = folderPath.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const likePattern = `${escapedFolder}/%`;
        // 构建 WHERE 子句
        let whereClause = "WHERE status = 'finished' AND source = 'local' AND relative_path LIKE ? ESCAPE '\\'";
        const params = [likePattern];
        if (search) {
            whereClause += ` AND (song_name LIKE ? OR singer LIKE ? OR album LIKE ?)`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }
        // 获取总数
        const countResult = db.exec(`SELECT COUNT(*) as total FROM download_records ${whereClause}`, params);
        const total = countResult.length > 0 && countResult[0].values.length > 0
            ? countResult[0].values[0][0]
            : 0;
        // 构建 ORDER BY 子句
        const sortMap = {
            'name': 'song_name',
            'singer': 'singer',
            'album': 'album',
            'mtime': 'COALESCE(mtime, downloaded_at)',
            'size': 'file_size',
            'duration': 'duration'
        };
        const sortColumn = sortMap[sort] || sortMap['mtime'];
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        // 计算偏移量
        const offset = (page - 1) * pageSize;
        // 获取分页结果
        const records = queryMultiple(`
            SELECT song_id,
                   song_name,
                   singer,
                   album,
                   source,
                   quality,
                   file_path,
                   file_size,
                   duration,
                   relative_path,
                   ext,
                   has_cover,
                   has_lyric,
                   mtime,
                   downloaded_at,
                   genre, year, track_number, album_artist, composer, sample_rate, bit_depth, channels, bit_rate, singer_ids, singer_id, img, album_id
            FROM download_records
            ${whereClause}
            ORDER BY ${sortColumn} ${sortOrder}, rowid ASC
            LIMIT ? OFFSET ?
        `, [...params, pageSize, offset]);
        return {
            data: records.map(record => (0, db_core_1.mapRecordToFrontendFormat)(record)),
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize)
        };
    }
    catch (err) {
        console.error('[DB] Failed to get folder songs:', err.message);
        return { data: [], total: 0, page: 1, pageSize: 30, totalPages: 0 };
    }
};
exports.getFolderSongsPageFromDB = getFolderSongsPageFromDB;
// ==================== 写入操作 (Write Operations) ====================
/**
 * 新增或更新下载记录 (UPSERT)
 */
const upsertDownloadRecord = (record) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return;
    try {
        const exists = db.exec(`SELECT id
             FROM download_records
             WHERE source = ?
               AND song_id = ?`, [record.source, record.song_id]);
        const values = [
            record.song_name,
            record.singer || '',
            record.album || '',
            record.quality || '',
            record.file_path || '',
            record.file_size || 0,
            record.duration || null,
            record.status,
            record.error_msg || '',
            record.relative_path || '',
            record.ext || '',
            record.has_cover ? 1 : 0,
            record.has_lyric ? 1 : 0,
            record.mtime || '',
            record.genre || '',
            record.year || null,
            record.track_number || null,
            record.album_artist || '',
            record.composer || '',
            record.sample_rate || null,
            record.bit_depth || null,
            record.channels || null,
            record.bit_rate || null,
            record.singer_ids || null,
            record.singer_id || null,
            record.img || null,
            record.album_id || null,
            record.disc_number || null,
            record.disc_total || null,
            record.audio_quality || null,
        ];
        if (exists.length > 0 && exists[0].values.length > 0) {
            db.run(`
                UPDATE download_records
                SET song_name     = ?,
                    singer        = ?,
                    album         = ?,
                    quality       = ?,
                    file_path     = ?,
                    file_size     = ?,
                    duration      = ?,
                    status        = ?,
                    error_msg     = ?,
                    downloaded_at = CURRENT_TIMESTAMP,
                    relative_path = ?,
                    ext           = ?,
                    has_cover     = ?,
                    has_lyric     = ?,
                    mtime         = COALESCE(NULLIF(?, ''), datetime('now', 'localtime')),
                    genre         = ?,
                    year          = ?,
                    track_number  = ?,
                    album_artist  = ?,
                    composer      = ?,
                    sample_rate   = ?,
                    bit_depth     = ?,
                    channels      = ?,
                    bit_rate      = ?,
                    singer_ids    = ?,
                    singer_id     = ?,
                    img           = ?,
                    album_id      = ?,
                    disc_number   = ?,
                    disc_total    = ?,
                    audio_quality = ?
                WHERE source = ?
                  AND song_id = ?
            `, [...values, record.source, record.song_id]);
        }
        else {
            db.run(`
                INSERT INTO download_records (source, song_id, song_name, singer, album, quality, file_path, file_size,
                                              duration, status, error_msg, relative_path, ext, has_cover, has_lyric,
                                              mtime, genre, year, track_number, album_artist, composer, sample_rate,
                                              bit_depth, channels, bit_rate, singer_ids, singer_id, img, album_id,
                                              disc_number, disc_total, audio_quality)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), datetime('now', 'localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [record.source || 'unknown', record.song_id, ...values]);
        }
        (0, db_core_1.saveDatabase)();
    }
    catch (err) {
        console.error('[DB] Failed to upsert record:', err.message);
    }
};
exports.upsertDownloadRecord = upsertDownloadRecord;
/**
 * 更新下载记录元数据
 */
const updateMusicLibMeta = (source, songId, meta) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return;
    try {
        const sets = [];
        const values = [];
        if (meta.relative_path !== undefined) {
            sets.push('relative_path = ?');
            values.push(meta.relative_path);
        }
        if (meta.ext !== undefined) {
            sets.push('ext = ?');
            values.push(meta.ext);
        }
        if (meta.has_cover !== undefined) {
            sets.push('has_cover = ?');
            values.push(meta.has_cover ? 1 : 0);
        }
        if (meta.has_lyric !== undefined) {
            sets.push('has_lyric = ?');
            values.push(meta.has_lyric ? 1 : 0);
        }
        if (meta.mtime !== undefined) {
            sets.push('mtime = ?');
            values.push(meta.mtime);
        }
        if (meta.duration !== undefined) {
            sets.push('duration = ?');
            values.push(meta.duration);
        }
        if (meta.genre !== undefined) {
            sets.push('genre = ?');
            values.push(meta.genre);
        }
        if (meta.year !== undefined) {
            sets.push('year = ?');
            values.push(meta.year);
        }
        if (meta.track_number !== undefined) {
            sets.push('track_number = ?');
            values.push(meta.track_number);
        }
        if (meta.album_artist !== undefined) {
            sets.push('album_artist = ?');
            values.push(meta.album_artist);
        }
        if (meta.composer !== undefined) {
            sets.push('composer = ?');
            values.push(meta.composer);
        }
        if (meta.sample_rate !== undefined) {
            sets.push('sample_rate = ?');
            values.push(meta.sample_rate);
        }
        if (meta.bit_depth !== undefined) {
            sets.push('bit_depth = ?');
            values.push(meta.bit_depth);
        }
        if (meta.channels !== undefined) {
            sets.push('channels = ?');
            values.push(meta.channels);
        }
        if (meta.bit_rate !== undefined) {
            sets.push('bit_rate = ?');
            values.push(meta.bit_rate);
        }
        if (meta.meta_enriched !== undefined) {
            sets.push('meta_enriched = ?');
            values.push(meta.meta_enriched);
        }
        if (meta.singer_ids !== undefined) {
            sets.push('singer_ids = ?');
            values.push(meta.singer_ids);
        }
        if (meta.singer_id !== undefined) {
            sets.push('singer_id = ?');
            values.push(meta.singer_id);
        }
        if (meta.img !== undefined) {
            sets.push('img = ?');
            values.push(meta.img);
        }
        if (meta.album_id !== undefined) {
            sets.push('album_id = ?');
            values.push(meta.album_id);
        }
        if (sets.length === 0)
            return;
        values.push(source, songId);
        db.run(`UPDATE download_records
                SET ${sets.join(', ')}
                WHERE source = ?
                  AND song_id = ?`, values);
        (0, db_core_1.saveDatabase)();
    }
    catch (err) {
        console.error('[DB] Failed to update metadata:', err.message);
    }
};
exports.updateMusicLibMeta = updateMusicLibMeta;
/**
 * 批量更新指定库 + 专辑目录下所有音频记录的封面信息 (Watcher 图片变更时调用)
 * @param source 来源标识 (如 'local_MyLibrary')
 * @param albumRelativeDir 专辑目录相对于库根目录的路径 (用 / 分隔)
 * @param hasCover 是否有封面
 * @param imgPath 封面相对路径 (无封面时传空字符串)
 * @returns 受影响行数
 */
const updateAlbumCoverBatch = (source, albumRelativeDir, hasCover, imgPath) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const likePattern = albumRelativeDir.replace(/\\/g, '/') + '/%';
        db.run(`UPDATE download_records
             SET has_cover = ?, img = ?
             WHERE source = ?
               AND relative_path LIKE ?
               AND status = 'finished'`, [hasCover ? 1 : 0, imgPath || null, source, likePattern]);
        const result = db.exec(`SELECT changes() AS cnt`);
        const affected = result?.[0]?.values?.[0]?.[0] ?? 0;
        return affected;
    }
    catch (err) {
        console.error(`[DB] updateAlbumCoverBatch error: source=${source}, dir=${albumRelativeDir}`, err.message);
        return 0;
    }
};
exports.updateAlbumCoverBatch = updateAlbumCoverBatch;
/**
 * 按路径更新时长
 */
const updateDurationByPath = (filePath, duration) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return;
    try {
        db.run(`UPDATE download_records
                SET duration = ?
                WHERE file_path = ?`, [duration, filePath]);
        (0, db_core_1.saveDatabase)();
    }
    catch (err) {
        console.error('[DB] Failed to update duration:', err.message);
    }
};
exports.updateDurationByPath = updateDurationByPath;
/**
 * 更新歌曲名称
 */
const updateSongNameInDB = (source, songId, newName) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return;
    try {
        db.run(`UPDATE download_records
                SET song_name = ?
                WHERE source = ?
                  AND song_id = ?`, [newName, source, songId]);
        (0, db_core_1.saveDatabase)();
    }
    catch (err) {
        console.error('[DB] Failed to update song name:', err.message);
    }
};
exports.updateSongNameInDB = updateSongNameInDB;
/**
 * 全量更新歌曲TAG信息 (TAG编辑器专用)
 * 可同时更新 song_name, singer, album 以及所有 meta 字段
 * 如果 relative_path 变更，同步更新 file_path 和 relative_path
 *
 * @param source 来源标识
 * @param songId 歌曲ID
 * @param updates 更新内容
 * @returns 更新是否成功
 */
const updateSongFullTags = (source, songId, updates) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        const sets = [];
        const values = [];
        const fieldMap = {
            song_name: updates.song_name,
            singer: updates.singer,
            album: updates.album,
            genre: updates.genre,
            year: updates.year,
            track_number: updates.track_number,
            disc_number: updates.disc_number,
            disc_total: updates.disc_total,
            audio_quality: updates.audio_quality,
            album_artist: updates.album_artist,
            composer: updates.composer,
            file_path: updates.file_path,
            relative_path: updates.relative_path,
        };
        for (const [field, value] of Object.entries(fieldMap)) {
            if (value !== undefined) {
                sets.push(`${field} = ?`);
                values.push(value);
            }
        }
        if (updates.has_cover !== undefined) {
            sets.push('has_cover = ?');
            values.push(updates.has_cover ? 1 : 0);
        }
        if (sets.length === 0)
            return false;
        values.push(source, songId);
        db.run(`UPDATE download_records
                SET ${sets.join(', ')}
                WHERE source = ?
                  AND song_id = ?`, values);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (err) {
        console.error('[DB] Failed to update song full tags:', err.message);
        return false;
    }
};
exports.updateSongFullTags = updateSongFullTags;
// ==================== 歌手信息清理 (Singer Info Cleanup) ====================
/**
 * 清理孤立的歌手信息 (Cleanup orphaned singer info)
 * 删除 download_records 记录后调用，检查对应歌手是否还有歌曲，如无则删除 singer_info 记录
 *
 * 匹配策略: 按 name 唯一键，拆分多歌手字段后逐个检查 download_records（跨所有 source）
 *
 * @param singerName  歌手名字符串 (可能多歌手 "歌手A、歌手B")
 */
const cleanupOrphanedSingerInfo = (singerName) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db || !singerName || !singerName.trim())
        return;
    try {
        // 拆分多歌手字段
        const names = singerName
            .split(/[；;,、\/＆&]/)
            .map(s => s.trim())
            .filter(s => s);
        if (names.length === 0)
            return;
        let hasDeletion = false;
        for (const name of names) {
            // 检查该歌手是否还有任何关联歌曲（跨所有 source）
            const result = db.exec(`SELECT COUNT(*) FROM download_records
                 WHERE (singer = ? OR singer LIKE ? OR singer LIKE ? OR singer LIKE ?)`, [name, `${name}、%`, `%、${name}`, `%、${name}、%`]);
            const count = result?.[0]?.values?.[0]?.[0] ?? 0;
            if (count === 0) {
                db.run(`DELETE FROM singer_info WHERE name = ?`, [name]);
                hasDeletion = true;
                console.log(`[DB] Cleaned up orphaned singer_info: name=${name}`);
            }
        }
        if (hasDeletion) {
            (0, db_core_1.saveDatabase)();
        }
    }
    catch (err) {
        console.error('[DB] Failed to cleanup orphaned singer info:', err.message);
    }
};
exports.cleanupOrphanedSingerInfo = cleanupOrphanedSingerInfo;
// ==================== 删除操作 (Delete Operations) ====================
/**
 * 按 relative_path 删除下载记录
 */
const deleteDownloadRecordByPath = (relativePath) => {
    // 删除前查询歌手信息（用于后续清理 singer_info）
    const record = querySingle(`SELECT singer_id, source, singer FROM download_records WHERE relative_path = ?`, [relativePath]);
    const result = executeDelete(`DELETE
         FROM download_records
         WHERE relative_path = ?`, [relativePath]);
    if (result && record) {
        (0, exports.cleanupOrphanedSingerInfo)(record.singer || '');
    }
    return result;
};
exports.deleteDownloadRecordByPath = deleteDownloadRecordByPath;
/**
 * 按绝对路径删除下载记录
 */
const deleteDownloadRecordByFilePath = (filePath) => {
    // 删除前查询歌手信息（用于后续清理 singer_info）
    const record = querySingle(`SELECT singer_id, source, singer FROM download_records WHERE file_path = ?`, [filePath]);
    const result = executeDelete(`DELETE
         FROM download_records
         WHERE file_path = ?`, [filePath]);
    if (result && record) {
        (0, exports.cleanupOrphanedSingerInfo)(record.singer || '');
    }
    return result;
};
exports.deleteDownloadRecordByFilePath = deleteDownloadRecordByFilePath;
/**
 * 执行删除操作 (通用)
 */
const executeDelete = (sql, params) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        db.run(sql, params);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (err) {
        console.error('[DB] Delete failed:', err.message);
        return false;
    }
};
/**
 * 替换 file_ 前缀记录为标准 source + song_id 格式
 */
const replaceFileRecordWithSongId = (source, songId, singer, album, songName) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return null;
    // 检查目标记录是否已存在
    const exists = db.exec(`SELECT id
         FROM download_records
         WHERE source = ?
           AND song_id = ?`, [source, songId]);
    if (exists.length > 0 && exists[0].values.length > 0) {
        return null;
    }
    // 查找 file_ 前缀记录
    const fileRecord = (0, exports.getDownloadRecordByFileIdentity)(singer, album, songName);
    if (!fileRecord)
        return null;
    try {
        db.run(`DELETE
                FROM download_records
                WHERE song_id = ?`, [fileRecord.song_id]);
        (0, db_core_1.saveDatabase)();
        return fileRecord;
    }
    catch (err) {
        console.error('[DB] Failed to replace file record:', err.message);
        return null;
    }
};
exports.replaceFileRecordWithSongId = replaceFileRecordWithSongId;
// ==================== 统计操作 (Statistics Operations) ====================
/**
 * 获取下载统计信息
 */
const getDownloadStats = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { total: 0, finished: 0, error: 0 };
    try {
        const count = (sql) => {
            const result = db.exec(sql);
            return result[0]?.values[0]?.[0] || 0;
        };
        return {
            total: count(`SELECT COUNT(1)
                          FROM download_records`),
            finished: count(`SELECT COUNT(1)
                             FROM download_records
                             WHERE status = 'finished'`),
            error: count(`SELECT COUNT(1)
                          FROM download_records
                          WHERE status = 'error'`)
        };
    }
    catch (err) {
        console.error('[DB] Failed to get stats:', err.message);
        return { total: 0, finished: 0, error: 0 };
    }
};
exports.getDownloadStats = getDownloadStats;
// ==================== 维护操作 (Maintenance Operations) ====================
/**
 * 清空所有下载记录
 */
const clearAllDownloadRecords = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        db.run(`DELETE
                FROM download_records`);
        // 所有歌手信息均无关联歌曲，直接清空
        db.run(`DELETE FROM singer_info`);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (err) {
        console.error('[DB] Failed to clear records:', err.message);
        return false;
    }
};
exports.clearAllDownloadRecords = clearAllDownloadRecords;
/**
 * 获取文件不存在的过期记录
 */
const getStaleRecords = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const records = queryMultiple(`SELECT id, song_id, file_path, song_name, singer, source, singer_id
                                       FROM download_records
                                       WHERE status = 'finished'`);
        return records
            .filter(record => !record.file_path || !fs_1.default.existsSync(record.file_path))
            .map(record => ({
            id: record.id,
            song_id: record.song_id,
            file_path: record.file_path || '',
            song_name: record.song_name,
            singer: record.singer || '',
            source: record.source || '',
            singer_id: record.singer_id || ''
        }));
    }
    catch (err) {
        console.error('[DB] Failed to get stale records:', err.message);
        return [];
    }
};
exports.getStaleRecords = getStaleRecords;
/**
 * 删除过期记录 (文件不存在)
 */
const deleteStaleRecords = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const staleRecords = (0, exports.getStaleRecords)();
        if (staleRecords.length === 0)
            return 0;
        staleRecords.forEach(record => {
            db.run(`DELETE
                    FROM download_records
                    WHERE id = ?`, [record.id]);
            // 清理孤立的歌手信息
            (0, exports.cleanupOrphanedSingerInfo)(record.singer || '');
        });
        (0, db_core_1.saveDatabase)();
        return staleRecords.length;
    }
    catch (err) {
        console.error('[DB] Failed to delete stale records:', err.message);
        return 0;
    }
};
exports.deleteStaleRecords = deleteStaleRecords;
// ==================== 本地库批量操作 (Local Library Batch Operations) ====================
/**
 * 按 source + song_id 删除单条下载记录 (用于本地库文件监听删除)
 */
const deleteDownloadRecordBySourceAndSongId = (source, songId) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        // 删除前查询歌手信息（用于后续清理 singer_info）
        const record = querySingle(`SELECT singer_id, singer FROM download_records WHERE source = ? AND song_id = ?`, [source, songId]);
        db.run(`DELETE FROM download_records WHERE source = ? AND song_id = ?`, [source, songId]);
        (0, db_core_1.saveDatabase)();
        if (record) {
            (0, exports.cleanupOrphanedSingerInfo)(record.singer || '');
        }
        return true;
    }
    catch (err) {
        console.error('[DB] Failed to delete record by source+songId:', err.message);
        return false;
    }
};
exports.deleteDownloadRecordBySourceAndSongId = deleteDownloadRecordBySourceAndSongId;
/**
 * 按 source 统计已完成记录数 (用于本地库 songCount 更新)
 */
const getFinishedCountBySource = (source) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const result = db.exec(`SELECT COUNT(1) FROM download_records WHERE source = ? AND status = 'finished'`, [source]);
        return result.length > 0 && result[0].values.length > 0
            ? result[0].values[0][0]
            : 0;
    }
    catch (err) {
        console.error('[DB] Failed to get finished count:', err.message);
        return 0;
    }
};
exports.getFinishedCountBySource = getFinishedCountBySource;
/**
 * 按 source 删除所有下载记录 (用于本地库清理)
 * 删除后检查关联歌手是否仍有其他 source 的歌曲，若无则清理 singer_info
 */
const deleteDownloadRecordsBySource = (source) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        // 1. 删除前收集此 source 的所有去重歌手名（含多歌手拆分）
        const singerResult = db.exec(`SELECT DISTINCT singer FROM download_records WHERE source = ? AND singer IS NOT NULL AND singer != ''`, [source]);
        const singerSet = new Set();
        if (singerResult.length > 0) {
            for (const row of singerResult[0].values) {
                const singerStr = row[0] || '';
                singerStr.split(/[；;,、\/＆&]/).forEach(s => {
                    const trimmed = s.trim();
                    if (trimmed)
                        singerSet.add(trimmed);
                });
            }
        }
        // 2. 删除 download_records
        db.run(`DELETE FROM download_records WHERE source = ?`, [source]);
        const deletedCount = db.getRowsModified();
        // 3. 逐个检查歌手是否仍有关联歌曲（跨所有 source），若无则删除 singer_info
        for (const name of singerSet) {
            const countResult = db.exec(`SELECT COUNT(*) FROM download_records
                 WHERE (singer = ? OR singer LIKE ? OR singer LIKE ? OR singer LIKE ?)`, [name, `${name}、%`, `%、${name}`, `%、${name}、%`]);
            const count = countResult?.[0]?.values?.[0]?.[0] ?? 0;
            if (count === 0) {
                db.run(`DELETE FROM singer_info WHERE name = ?`, [name]);
            }
        }
        (0, db_core_1.saveDatabase)();
        return deletedCount;
    }
    catch (err) {
        console.error('[DB] Failed to delete records by source:', err.message);
        return 0;
    }
};
exports.deleteDownloadRecordsBySource = deleteDownloadRecordsBySource;
/**
 * 转义 LIKE 模式中的特殊字符 (% / _ / \\)
 * 用于 file_path 前缀匹配，避免用户目录名包含 % 或 _ 时误匹配
 */
const escapeLikePattern = (value) => {
    return value.replace(/[\\%_]/g, '\\$&');
};
/**
 * 按本地库根目录路径前缀删除记录 (多库场景: 删除单个库的所有记录)
 * file_path 存储绝对路径，以 `库根/` 前缀匹配，不影响其他库与下载记录
 */
const deleteDownloadRecordsByPathPrefix = (libraryPath) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const escapedPrefix = escapeLikePattern(path_1.default.resolve(libraryPath)) + '/%';
        // 1. 删除前收集该库的所有去重歌手名（含多歌手拆分）
        const singerResult = db.exec(`SELECT DISTINCT singer FROM download_records WHERE source = 'local' AND file_path LIKE ? ESCAPE '\\' AND singer IS NOT NULL AND singer != ''`, [escapedPrefix]);
        const singerSet = new Set();
        if (singerResult.length > 0) {
            for (const row of singerResult[0].values) {
                const singerStr = row[0] || '';
                singerStr.split(/[；;,、\/＆&]/).forEach(s => {
                    const trimmed = s.trim();
                    if (trimmed)
                        singerSet.add(trimmed);
                });
            }
        }
        // 2. 删除该库记录
        db.run(`DELETE FROM download_records WHERE source = 'local' AND file_path LIKE ? ESCAPE '\\'`, [escapedPrefix]);
        const deletedCount = db.getRowsModified();
        // 3. 逐个检查歌手是否仍有关联歌曲（跨所有 source），若无则删除 singer_info
        for (const name of singerSet) {
            const countResult = db.exec(`SELECT COUNT(*) FROM download_records
                 WHERE (singer = ? OR singer LIKE ? OR singer LIKE ? OR singer LIKE ?)`, [name, `${name}、%`, `%、${name}`, `%、${name}、%`]);
            const count = countResult?.[0]?.values?.[0]?.[0] ?? 0;
            if (count === 0) {
                db.run(`DELETE FROM singer_info WHERE name = ?`, [name]);
            }
        }
        (0, db_core_1.saveDatabase)();
        return deletedCount;
    }
    catch (err) {
        console.error('[DB] Failed to delete records by path prefix:', err.message);
        return 0;
    }
};
exports.deleteDownloadRecordsByPathPrefix = deleteDownloadRecordsByPathPrefix;
/**
 * 按本地库根目录路径前缀统计已完成记录数 (多库场景: 单个库的歌曲数)
 */
const getFinishedCountByPathPrefix = (libraryPath) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const escapedPrefix = escapeLikePattern(path_1.default.resolve(libraryPath)) + '/%';
        const result = db.exec(`SELECT COUNT(1) FROM download_records WHERE source = 'local' AND status = 'finished' AND file_path LIKE ? ESCAPE '\\'`, [escapedPrefix]);
        return result.length > 0 && result[0].values.length > 0
            ? result[0].values[0][0]
            : 0;
    }
    catch (err) {
        console.error('[DB] Failed to get finished count by path prefix:', err.message);
        return 0;
    }
};
exports.getFinishedCountByPathPrefix = getFinishedCountByPathPrefix;
/**
 * 按本地库根目录路径前缀获取所有 song_id (返回 Set，用于多库扫描查重)
 */
const getSongIdsByPathPrefix = (libraryPath) => {
    const ids = new Set();
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return ids;
    try {
        const escapedPrefix = escapeLikePattern(path_1.default.resolve(libraryPath)) + '/%';
        const result = db.exec(`SELECT song_id FROM download_records WHERE source = 'local' AND file_path LIKE ? ESCAPE '\\'`, [escapedPrefix]);
        if (result.length > 0) {
            result[0].values.forEach((row) => ids.add(row[0]));
        }
    }
    catch (err) {
        console.error('[DB] Failed to get song IDs by path prefix:', err.message);
    }
    return ids;
};
exports.getSongIdsByPathPrefix = getSongIdsByPathPrefix;
/**
 * 按 source 获取所有 song_id (返回 Set，用于扫描查重)
 */
const getSongIdsBySource = (source) => {
    const ids = new Set();
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return ids;
    try {
        const result = db.exec(`SELECT song_id FROM download_records WHERE source = ?`, [source]);
        if (result.length > 0) {
            result[0].values.forEach((row) => ids.add(row[0]));
        }
    }
    catch (err) {
        console.error('[DB] Failed to get song IDs by source:', err.message);
    }
    return ids;
};
exports.getSongIdsBySource = getSongIdsBySource;
/**
 * 按 source + songIds 批量删除记录 (用于扫描时清理过期记录)
 */
const deleteDownloadRecordsBySongIds = (source, songIds) => {
    if (songIds.length === 0)
        return 0;
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const placeholders = songIds.map(() => '?').join(',');
        // 删除前查询受影响的歌手信息（用于后续清理 singer_info）
        const affectedRecords = queryMultiple(`SELECT DISTINCT singer_id, singer FROM download_records WHERE source = ? AND song_id IN (${placeholders})`, [source, ...songIds]);
        db.run(`DELETE FROM download_records WHERE source = ? AND song_id IN (${placeholders})`, [source, ...songIds]);
        const deletedCount = db.getRowsModified();
        (0, db_core_1.saveDatabase)();
        // 逐个清理孤立的歌手信息
        for (const record of affectedRecords) {
            (0, exports.cleanupOrphanedSingerInfo)(record.singer || '');
        }
        return deletedCount;
    }
    catch (err) {
        console.error('[DB] Failed to batch delete records:', err.message);
        return 0;
    }
};
exports.deleteDownloadRecordsBySongIds = deleteDownloadRecordsBySongIds;
/**
 * 批量 upsert 下载记录 (用于本地库扫描批量写入)
 * 每 50 条执行一次 saveDatabase，INSERT 显式包含 downloaded_at 时间列
 */
const batchUpsertDownloadRecords = (records) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { added: 0, updated: 0 };
    let added = 0;
    let updated = 0;
    let processedSinceSave = 0;
    try {
        for (const record of records) {
            const exists = db.exec(`SELECT id FROM download_records WHERE source = ? AND song_id = ?`, [record.source, record.song_id]);
            const downloadedAt = record.downloaded_at || (0, db_core_1.formatLocalDateTime)(new Date());
            if (exists.length > 0 && exists[0].values.length > 0) {
                db.run(`
                    UPDATE download_records
                    SET song_name     = ?,
                        singer        = ?,
                        album         = ?,
                        quality       = ?,
                        file_path     = ?,
                        file_size     = ?,
                        duration      = ?,
                        status        = ?,
                        error_msg     = ?,
                        downloaded_at = ?,
                        relative_path = ?,
                        ext           = ?,
                        has_cover     = ?,
                        has_lyric     = ?,
                        mtime         = ?,
                        genre         = ?,
                        year          = ?,
                        track_number  = ?,
                        album_artist  = ?,
                        composer      = ?,
                        sample_rate   = ?,
                        bit_depth     = ?,
                        channels      = ?,
                        bit_rate      = ?,
                        singer_ids    = ?,
                        singer_id     = ?,
                        img           = ?,
                        album_id      = ?,
                        meta_enriched = ?,
                        disc_number   = ?,
                        disc_total    = ?,
                        audio_quality = ?
                    WHERE source = ?
                      AND song_id = ?
                `, [
                    record.song_name, record.singer || '', record.album || '',
                    record.quality || '', record.file_path || '', record.file_size || 0,
                    record.duration || null, record.status, record.error_msg || '',
                    downloadedAt, record.relative_path || '', record.ext || '',
                    record.has_cover ? 1 : 0, record.has_lyric ? 1 : 0,
                    record.mtime || '', record.genre || '', record.year || null,
                    record.track_number || null, record.album_artist || '',
                    record.composer || '', record.sample_rate || null,
                    record.bit_depth || null, record.channels || null,
                    record.bit_rate || null, record.singer_ids || null,
                    record.singer_id || null,
                    record.img || null, record.album_id || null,
                    record.meta_enriched || null,
                    record.disc_number || null, record.disc_total || null,
                    record.audio_quality || null,
                    record.source, record.song_id,
                ]);
                updated++;
            }
            else {
                db.run(`
                    INSERT INTO download_records
                        (source, song_id, song_name, singer, album, quality, file_path, file_size,
                         duration, status, error_msg, downloaded_at, relative_path, ext, has_cover, has_lyric,
                         mtime, genre, year, track_number, album_artist, composer, sample_rate,
                         bit_depth, channels, bit_rate, singer_ids, singer_id, img, album_id, meta_enriched,
                         disc_number, disc_total, audio_quality)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    record.source || 'unknown', record.song_id, record.song_name,
                    record.singer || '', record.album || '', record.quality || '',
                    record.file_path || '', record.file_size || 0,
                    record.duration || null, record.status, record.error_msg || '',
                    downloadedAt, record.relative_path || '', record.ext || '',
                    record.has_cover ? 1 : 0, record.has_lyric ? 1 : 0,
                    record.mtime || '', record.genre || '', record.year || null,
                    record.track_number || null, record.album_artist || '',
                    record.composer || '', record.sample_rate || null,
                    record.bit_depth || null, record.channels || null,
                    record.bit_rate || null, record.singer_ids || null,
                    record.singer_id || null,
                    record.img || null, record.album_id || null,
                    record.meta_enriched || null,
                    record.disc_number || null, record.disc_total || null,
                    record.audio_quality || null,
                ]);
                added++;
            }
            processedSinceSave++;
            if (processedSinceSave >= 50) {
                (0, db_core_1.saveDatabase)();
                processedSinceSave = 0;
            }
        }
        // 最终保存
        if (processedSinceSave > 0) {
            (0, db_core_1.saveDatabase)();
        }
    }
    catch (err) {
        console.error('[DB] Batch upsert failed:', err.message);
    }
    return { added, updated };
};
exports.batchUpsertDownloadRecords = batchUpsertDownloadRecords;
/**
 * 获取需要元数据补充的记录
 */
const getRecordsNeedingEnrichment = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const records = queryMultiple(`
            SELECT source,
                   song_id,
                   file_path,
                   song_name,
                   singer,
                   album,
                   relative_path,
                   COALESCE(has_lyric, 0) as has_lyric,
                   COALESCE(has_cover, 0) as has_cover
            FROM download_records
            WHERE status = 'finished'
              AND (meta_enriched IS NULL OR meta_enriched = 0)
              AND file_path IS NOT NULL
              AND (
                genre IS NULL OR genre = ''
                    OR year IS NULL OR year = 0
                    OR bit_depth IS NULL OR bit_depth = 0
                    OR sample_rate IS NULL OR sample_rate = 0
                    OR channels IS NULL OR channels = 0
                    OR bit_rate IS NULL OR bit_rate = 0
                    OR has_lyric IS NULL OR has_lyric = 0
                    OR has_cover IS NULL OR has_cover = 0
                )
        `);
        return records.map(row => ({
            source: row.source || '',
            song_id: row.song_id,
            file_path: row.file_path || '',
            song_name: row.song_name,
            singer: row.singer || '',
            album: row.album || '',
            relative_path: row.relative_path || '',
            has_lyric: row.has_lyric ? 1 : 0,
            has_cover: row.has_cover ? 1 : 0
        }));
    }
    catch (err) {
        console.error('[DB] Failed to get records needing enrichment:', err.message);
        return [];
    }
};
exports.getRecordsNeedingEnrichment = getRecordsNeedingEnrichment;
/**
 * 获取首页统计数据 (Get Home Page Statistics)
 * 返回艺术家数/专辑数/曲目数
 */
const getHomeStats = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { artistCount: 0, albumCount: 0, songCount: 0 };
    try {
        const count = (sql) => {
            const result = db.exec(sql);
            return result[0]?.values[0]?.[0] || 0;
        };
        return {
            artistCount: count(`SELECT COUNT(DISTINCT singer) FROM download_records WHERE status = 'finished' AND singer IS NOT NULL AND singer != ''`),
            albumCount: count(`SELECT COUNT(*) FROM v_album_info`),
            songCount: count(`SELECT COUNT(*) FROM download_records WHERE status = 'finished'`)
        };
    }
    catch (err) {
        console.error('[DB] Failed to get home stats:', err.message);
        return { artistCount: 0, albumCount: 0, songCount: 0 };
    }
};
exports.getHomeStats = getHomeStats;
