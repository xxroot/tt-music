"use strict";
/**
 * 专辑相关数据库操作 (Album-related Database Operations)
 * 处理专辑查询、专辑名称更新等功能
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAlbumMetadataInDB = exports.getAlbumPageFromDB = exports.searchAlbums = exports.getAllAlbums = exports.updateAlbumNameInDB = exports.getSongsByAlbumName = void 0;
const db_core_1 = require("./db-core");
// ==================== 通用工具函数 ====================
/**
 * 将 v_album_info 视图行转换为前端 camelCase 格式
 */
const mapAlbumInfoToFrontendFormat = (record) => {
    return {
        album: record.album || '',
        singer: record.singer || '',
        source: record.source || '',
        img: record.img || '',
        duration: record.duration || 0,
        genre: record.genre || '',
        year: record.year || '',
        albumArtist: record.album_artist || '',
        discNumber: record.disc_number || '',
        discTotal: record.disc_total || '',
        singCount: record.sing_count || 0,
        mtime: record.mtime || '',
    };
};
/**
 * 将数据库查询结果转换为专辑列表格式
 */
const mapAlbumResult = (result) => {
    if (result.length === 0 || result[0].values.length === 0)
        return [];
    const albums = [];
    for (const row of result[0].values) {
        albums.push({
            album: row[0],
            singer: row[1],
            count: row[2]
        });
    }
    return albums;
};
/**
 * 按专辑名查询专辑中的歌曲 (优化专辑详情刷新)
 * @param albumName - 要查询的专辑名
 * @returns 专辑中的歌曲数组
 */
const getSongsByAlbumName = (albumName) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT song_id, song_name, singer, album, source, quality,
                   file_path, file_size, duration, relative_path, ext,
                   has_cover, has_lyric, mtime, downloaded_at,
                   genre, year, track_number, album_artist, composer,
                   disc_number, disc_total, audio_quality,
                   sample_rate, bit_depth, channels, bit_rate, singer_ids, singer_id
            FROM download_records
            WHERE status = 'finished' AND album = ?
            ORDER BY COALESCE(mtime, downloaded_at) DESC
        `, [albumName]);
        if (result.length === 0 || result[0].values.length === 0) {
            return [];
        }
        const columns = result[0].columns;
        const records = [];
        result[0].values.forEach((row) => {
            const record = {};
            columns.forEach((col, idx) => {
                record[col] = row[idx];
            });
            records.push((0, db_core_1.mapRecordToFrontendFormat)(record));
        });
        return records;
    }
    catch (err) {
        console.error('[DB] Failed to get songs by album name:', err.message);
        return [];
    }
};
exports.getSongsByAlbumName = getSongsByAlbumName;
/**
 * 批量更新专辑名称 (所有匹配旧名称的记录)
 */
const updateAlbumNameInDB = (oldName, newName) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return;
    try {
        db.run(`UPDATE download_records SET album = ? WHERE album = ?`, [newName, oldName]);
        (0, db_core_1.saveDatabase)();
        console.log(`[DB] Updated album name: "${oldName}" -> "${newName}"`);
    }
    catch (err) {
        console.error('[DB] Failed to update album name:', err.message);
    }
};
exports.updateAlbumNameInDB = updateAlbumNameInDB;
/**
 * 查询所有去重的专辑列表
 */
const getAllAlbums = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT album, singer, COUNT(*) as count
            FROM download_records
            WHERE status = 'finished' AND album IS NOT NULL AND album != ''
            GROUP BY album, singer
            ORDER BY album
        `);
        return mapAlbumResult(result);
    }
    catch (err) {
        console.error('[DB] Failed to get all albums:', err.message);
        return [];
    }
};
exports.getAllAlbums = getAllAlbums;
/**
 * 按专辑名搜索 (支持关键词模糊匹配)
 */
const searchAlbums = (keyword) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT album, singer, COUNT(*) as count
            FROM download_records
            WHERE status = 'finished' AND album IS NOT NULL AND album != ''
              AND album LIKE ?
            GROUP BY album, singer
            ORDER BY album
        `, [`%${keyword}%`]);
        return mapAlbumResult(result);
    }
    catch (err) {
        console.error('[DB] Failed to search albums:', err.message);
        return [];
    }
};
exports.searchAlbums = searchAlbums;
/**
 * 从 v_album_info 视图分页查询专辑列表
 * @param options.page - 页码（从1开始）
 * @param options.pageSize - 每页条数
 * @param options.sort - 排序字段：album | singer | singCount | duration | year
 * @param options.order - 排序方向：asc | desc
 * @param options.search - 搜索关键词（匹配 album、singer、album_artist）
 */
const getAlbumPageFromDB = (options) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { data: [], total: 0, page: 1, pageSize: 24, totalPages: 0 };
    const { page = 1, pageSize = 24, sort = 'album', order = 'asc', search = '', source = '' } = options;
    try {
        // 构建 WHERE 子句
        // 收集条件
        const conditions = [];
        const params = [];
        if (search) {
            conditions.push('(album LIKE ? OR singer LIKE ? OR album_artist LIKE ?)');
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }
        // 来源筛选: 通过子查询过滤 v_album_info 的专辑名
        // v_album_info 的 source 是 GROUP_CONCAT 结果，不能简单用等号匹配
        if (source) {
            if (source === 'download') {
                // 下载歌曲: 专辑下排除本地库歌曲
                conditions.push(`album IN (SELECT album FROM download_records WHERE status = 'finished' AND album IS NOT NULL AND album != '' AND source != 'local' GROUP BY album)`);
            }
            else {
                // 指定来源: 专辑下至少有一首歌的 source 匹配
                conditions.push(`album IN (SELECT album FROM download_records WHERE status = 'finished' AND album IS NOT NULL AND album != '' AND source = ? GROUP BY album)`);
                params.push(source);
            }
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        // 获取总数
        const countResult = db.exec(`SELECT COUNT(*) as total FROM v_album_info ${whereClause}`, params);
        const total = countResult.length > 0 && countResult[0].values.length > 0
            ? countResult[0].values[0][0]
            : 0;
        // 构建 ORDER BY 子句
        const sortMap = {
            'album': 'album',
            'singer': 'singer',
            'singCount': 'sing_count',
            'duration': 'duration',
            'year': 'year',
            'mtime': 'mtime'
        };
        const sortColumn = sortMap[sort] || sortMap['album'];
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        // 计算偏移量
        const offset = (page - 1) * pageSize;
        // 查询分页数据（album ASC 作为确定性 tiebreaker，防止并列值导致分页跨页重复）
        const result = db.exec(`SELECT album, singer, source, img, duration, genre, year, album_artist, disc_number, disc_total, mtime, sing_count
             FROM v_album_info
             ${whereClause}
             ORDER BY ${sortColumn} ${sortOrder}, album ASC
             LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
        const data = [];
        if (result.length > 0 && result[0].values.length > 0) {
            const columns = result[0].columns;
            for (const row of result[0].values) {
                const record = {};
                columns.forEach((col, idx) => {
                    record[col] = row[idx];
                });
                data.push(mapAlbumInfoToFrontendFormat(record));
            }
        }
        return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }
    catch (err) {
        console.error('[DB] Failed to get paginated album list:', err.message);
        return { data: [], total: 0, page: 1, pageSize: 24, totalPages: 0 };
    }
};
exports.getAlbumPageFromDB = getAlbumPageFromDB;
/**
 * 批量更新专辑所有歌曲的元数据字段
 * @param oldAlbumName - 当前专辑名
 * @param updates - 要更新的字段 (album, year, disc_number, disc_total, album_artist, genre, composer)
 * @returns 更新的行数
 */
const updateAlbumMetadataInDB = (oldAlbumName, updates) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        const sets = [];
        const values = [];
        for (const [field, value] of Object.entries(updates)) {
            if (value !== undefined) {
                sets.push(`${field} = ?`);
                values.push(value);
            }
        }
        if (sets.length === 0)
            return 0;
        values.push(oldAlbumName);
        db.run(`UPDATE download_records SET ${sets.join(', ')} WHERE album = ?`, values);
        (0, db_core_1.saveDatabase)();
        const modified = db.getRowsModified?.() ?? 0;
        console.log(`[DB] Updated album metadata: "${oldAlbumName}", ${sets.length} fields, ${modified} rows`);
        return modified;
    }
    catch (err) {
        console.error('[DB] Failed to update album metadata:', err.message);
        return 0;
    }
};
exports.updateAlbumMetadataInDB = updateAlbumMetadataInDB;
