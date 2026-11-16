"use strict";
/**
 * 歌手相关数据库操作 (Singer-related Database Operations)
 * 处理 singer_info 表的 CRUD 操作及歌手相关查询
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIncompleteSingerInfo = exports.getUnsyncedSingersWithDetails = exports.getUnsyncedSingers = exports.getSingerDownloadRecords = exports.getDistinctSingersFromDownloads = exports.deleteSingerInfo = exports.getAllSingerInfo = exports.updateSingerInfoIfIncomplete = exports.getSingerInfoByName = exports.getSingerInfo = exports.updateSingerFieldsByName = exports.upsertSingerInfo = void 0;
const db_core_1 = require("./db-core");
/**
 * 歌手信息行到 camelCase 的映射
 */
const mapSingerRow = (columns, row) => {
    const raw = {};
    columns.forEach((col, idx) => { raw[col] = row[idx]; });
    return {
        id: raw.id,
        singer_id: raw.singer_id,
        source: raw.source,
        name: raw.name,
        avatar: raw.avatar,
        desc: raw.desc,
        gender: raw.gender,
        music_count: raw.music_count,
        album_count: raw.album_count,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
    };
};
/**
 * 新增或更新歌手信息 (UPSERT)
 * 按 name 去重（name 是 singer_info 表的逻辑主键）
 */
const upsertSingerInfo = (record) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return;
    try {
        // 仅按 name 去重
        const existing = db.exec(`SELECT id FROM singer_info WHERE name = ?`, [record.name]);
        if (existing.length > 0 && existing[0].values.length > 0) {
            // UPDATE: 用 COALESCE(NULLIF(?, ''), 原值) 保护已有非空值
            db.run(`
                UPDATE singer_info
                SET name = COALESCE(NULLIF(?, ''), name),
                    source = COALESCE(NULLIF(?, ''), source),
                    singer_id = COALESCE(NULLIF(?, ''), singer_id),
                    avatar = COALESCE(NULLIF(?, ''), avatar),
                    desc = COALESCE(NULLIF(?, ''), desc),
                    gender = COALESCE(NULLIF(?, ''), gender),
                    music_count = CASE WHEN ? > 0 THEN ? ELSE music_count END,
                    album_count = CASE WHEN ? > 0 THEN ? ELSE album_count END,
                    updated_at = datetime('now', 'localtime')
                WHERE name = ?
            `, [
                record.name,
                record.source || '',
                record.singer_id || '',
                record.avatar || '',
                record.desc || '',
                record.gender || '',
                record.music_count || 0, record.music_count || 0,
                record.album_count || 0, record.album_count || 0,
                record.name
            ]);
        }
        else {
            // INSERT: 显式包含时间列
            db.run(`
                INSERT INTO singer_info (singer_id, source, name, avatar, desc, gender, music_count, album_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
            `, [
                record.singer_id || '',
                record.source,
                record.name,
                record.avatar || null,
                record.desc || null,
                record.gender || null,
                record.music_count || 0,
                record.album_count || 0
            ]);
        }
        (0, db_core_1.saveDatabase)();
    }
    catch (err) {
        console.error('[DB] Failed to upsert singer info:', err.message);
    }
};
exports.upsertSingerInfo = upsertSingerInfo;
/**
 * 手动编辑场景：直接更新歌手字段（空值即清空，不做 COALESCE 保护）
 * 按 name 匹配记录，所有传入字段直接写入
 */
const updateSingerFieldsByName = (originalName, fields) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        db.run(`
            UPDATE singer_info
            SET name = ?,
                source = ?,
                singer_id = ?,
                avatar = ?,
                desc = ?,
                gender = ?,
                music_count = ?,
                album_count = ?,
                updated_at = datetime('now', 'localtime')
            WHERE name = ?
        `, [
            fields.name,
            fields.source,
            fields.singer_id,
            fields.avatar,
            fields.desc,
            fields.gender,
            fields.music_count,
            fields.album_count,
            originalName
        ]);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (err) {
        console.error('[DB] Failed to update singer fields by name:', err.message);
        return false;
    }
};
exports.updateSingerFieldsByName = updateSingerFieldsByName;
/**
 * 按 singer_id + source 查询单条歌手信息
 */
const getSingerInfo = (singerId, source) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return null;
    try {
        // [重构] 查询条件改为 source + singer_id
        const result = db.exec(`SELECT * FROM singer_info WHERE source = ? AND singer_id = ?`, [source, singerId]);
        if (result.length > 0 && result[0].values.length > 0) {
            return mapSingerRow(result[0].columns, result[0].values[0]);
        }
    }
    catch (err) {
        console.error('[DB] Failed to get singer info:', err.message);
    }
    return null;
};
exports.getSingerInfo = getSingerInfo;
/**
 * 按歌手名查询 (同名可能在多个平台)
 */
const getSingerInfoByName = (name) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`SELECT * FROM singer_info WHERE name = ? ORDER BY source`, [name]);
        if (result.length > 0 && result[0].values.length > 0) {
            return result[0].values.map((row) => mapSingerRow(result[0].columns, row));
        }
    }
    catch (err) {
        console.error('[DB] Failed to get singer info by name:', err.message);
    }
    return [];
};
exports.getSingerInfoByName = getSingerInfoByName;
/**
 * 异步检查并更新不完整的歌手信息 (仅UPDATE，不INSERT)
 * 用于在线播放场景：根据歌手名查找已有记录，补全缺失的 avatar/singer_id
 * @param singers 歌手数组 [{id, name, img}]
 * @param source 歌曲来源平台
 */
const updateSingerInfoIfIncomplete = (singers, source) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db || !singers || singers.length === 0)
        return;
    try {
        let hasUpdate = false;
        for (const singer of singers) {
            if (!singer || !singer.name)
                continue;
            // 按名称查找已有记录
            const result = db.exec(`SELECT singer_id, avatar FROM singer_info WHERE name = ?`, [singer.name]);
            if (result.length === 0 || result[0].values.length === 0)
                continue;
            for (const row of result[0].values) {
                const existingSingerId = row[0];
                const existingAvatar = row[1];
                // 检查是否需要更新：avatar/singer_id 任一不完整且有新值则更新
                const needUpdateAvatar = (!existingAvatar || existingAvatar.trim() === '') && singer.img;
                const needUpdateSingerId = (!existingSingerId || existingSingerId.trim() === '') && singer.id;
                if (!needUpdateAvatar && !needUpdateSingerId)
                    continue;
                db.run(`
                    UPDATE singer_info
                    SET avatar = COALESCE(NULLIF(?, ''), avatar),
                        singer_id = COALESCE(NULLIF(?, ''), singer_id),
                        updated_at = datetime('now', 'localtime')
                    WHERE name = ?
                `, [
                    needUpdateAvatar ? (singer.img || '') : '',
                    needUpdateSingerId ? (singer.id || '') : '',
                    singer.name
                ]);
                hasUpdate = true;
            }
        }
        if (hasUpdate)
            (0, db_core_1.saveDatabase)();
    }
    catch (err) {
        console.error('[DB] Failed to update singer info if incomplete:', err.message);
    }
};
exports.updateSingerInfoIfIncomplete = updateSingerInfoIfIncomplete;
/**
 * 查询全部歌手信息 (支持分页、过滤)
 */
const getAllSingerInfo = (params) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { list: [], total: 0 };
    try {
        const source = params?.source || '';
        const keyword = params?.keyword || '';
        const page = params?.page || 1;
        const limit = params?.limit || 24;
        const offset = (page - 1) * limit;
        // 本地库歌手: singer_info 中无 'local' 记录，从 download_records 构造
        if (source === 'local') {
            const keywordCondition = keyword ? "AND singer LIKE ?" : "";
            const keywordParam = keyword ? [`%${keyword}%`] : [];
            const countResult = db.exec(`SELECT COUNT(DISTINCT singer) FROM download_records
                 WHERE status = 'finished' AND source = 'local'
                 AND singer IS NOT NULL AND singer != '' ${keywordCondition}`, keywordParam);
            const total = countResult.length > 0 ? countResult[0].values[0]?.[0] || 0 : 0;
            const localSortMap = {
                'name': 'singer', 'musicCount': 'music_count', 'albumCount': 'album_count',
            };
            const localSortCol = localSortMap[params?.sort || 'name'] || 'singer';
            const localSortOrder = (params?.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
            const dataResult = db.exec(`SELECT singer, COUNT(*) as music_count, COUNT(DISTINCT album) as album_count
                 FROM download_records
                 WHERE status = 'finished' AND source = 'local'
                 AND singer IS NOT NULL AND singer != '' ${keywordCondition}
                 GROUP BY singer ORDER BY ${localSortCol} ${localSortOrder}, singer ASC
                 LIMIT ? OFFSET ?`, [...keywordParam, limit, offset]);
            const list = (dataResult[0]?.values || []).map((row) => ({
                singer_id: '', source: 'local',
                name: row[0],
                music_count: row[1],
                album_count: row[2],
            }));
            return { list, total };
        }
        const conditions = [];
        const values = [];
        if (source) {
            if (source === 'download') {
                conditions.push("source != 'local'");
            }
            else {
                conditions.push('source = ?');
                values.push(source);
            }
        }
        if (keyword) {
            conditions.push('name LIKE ?');
            values.push(`%${keyword}%`);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        // 构建排序子句
        const sortMap = {
            'name': 'name',
            'musicCount': 'music_count',
            'albumCount': 'album_count',
            'createdAt': 'created_at',
            'updatedAt': 'updated_at'
        };
        const sortColumn = sortMap[params?.sort || 'name'] || 'name';
        const sortOrder = (params?.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        // Count
        const countResult = db.exec(`SELECT COUNT(*) FROM singer_info ${where}`, values);
        const total = countResult.length > 0 ? countResult[0].values[0]?.[0] || 0 : 0;
        // Data（id ASC 作为确定性 tiebreaker，防止并列值导致分页跨页重复）
        const dataResult = db.exec(`SELECT * FROM singer_info ${where} ORDER BY ${sortColumn} ${sortOrder}, id ASC LIMIT ? OFFSET ?`, [...values, limit, offset]);
        const list = [];
        if (dataResult.length > 0 && dataResult[0].values.length > 0) {
            dataResult[0].values.forEach((row) => {
                list.push(mapSingerRow(dataResult[0].columns, row));
            });
        }
        return { list, total };
    }
    catch (err) {
        console.error('[DB] Failed to get all singer info:', err.message);
        return { list: [], total: 0 };
    }
};
exports.getAllSingerInfo = getAllSingerInfo;
/**
 * 删除歌手信息 (按 name 删除)
 */
const deleteSingerInfo = (name) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        db.run(`DELETE FROM singer_info WHERE name = ?`, [name]);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (err) {
        console.error('[DB] Failed to delete singer info:', err.message);
        return false;
    }
};
exports.deleteSingerInfo = deleteSingerInfo;
/**
 * 从 download_records 中提取所有去重的歌手名
 */
const getDistinctSingersFromDownloads = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`SELECT DISTINCT singer FROM download_records WHERE status = 'finished' AND singer IS NOT NULL AND singer != ''`);
        if (result.length === 0 || result[0].values.length === 0)
            return [];
        const singerSet = new Set();
        for (const row of result[0].values) {
            const singerStr = row[0] || '';
            // 按、和 / 分隔多歌手
            singerStr.split(/[；;,、\/＆&]/).forEach(s => {
                const trimmed = s.trim();
                if (trimmed)
                    singerSet.add(trimmed);
            });
        }
        return Array.from(singerSet).sort();
    }
    catch (err) {
        console.error('[DB] Failed to get distinct singers:', err.message);
        return [];
    }
};
exports.getDistinctSingersFromDownloads = getDistinctSingersFromDownloads;
/**
 * 按歌手名查询关联的下载记录 (用于歌手专辑视图)
 */
const getSingerDownloadRecords = (singerName) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        // 使用 LIKE 匹配，处理多歌手字段中包含目标歌手的情况
        // 分隔符与 getDistinctSingersFromDownloads 保持一致：、 / & ＆ ; ； ,
        // 将所有分隔符归一化为逗号并去除分隔符两侧空格，包裹两端后用单个 LIKE 完成精确成员匹配
        const normalizedSinger = `(',' || replace(replace(replace(replace(replace(replace(replace(replace(singer, '、', ','), '/', ','), '&', ','), '＆', ','), ';', ','), '；', ','), ', ', ','), ' ,', ',') || ',')`;
        // 搜索名同样归一化（singer_info 中可能存有 "Simon & Garfunkel" 这类完整多歌手字符串）
        const normalizedName = singerName.split(/[；;,、/＆&]/).map(s => s.trim()).filter(Boolean).join(',');
        const result = db.exec(`
            SELECT song_id, song_name, singer, album, source, quality,
                   file_path, file_size, duration, relative_path, ext,
                   has_cover, has_lyric, mtime, downloaded_at,
                   genre, year, track_number, album_artist, composer,
                   sample_rate, bit_depth, channels, bit_rate, singer_ids, singer_id, img
            FROM download_records
            WHERE status = 'finished'
              AND ${normalizedSinger} LIKE ?
            ORDER BY COALESCE(mtime, downloaded_at) DESC
        `, [`%,${normalizedName},%`]);
        if (result.length === 0 || result[0].values.length === 0)
            return [];
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
        console.error('[DB] Failed to get singer download records:', err.message);
        return [];
    }
};
exports.getSingerDownloadRecords = getSingerDownloadRecords;
/**
 * 根据已有的歌手名列表，一次性查出不在 singer_info 表中的未同步歌手
 * @param names - 已拆分好的歌手名数组（来自 getDistinctSingersFromDownloads）
 */
const getUnsyncedSingers = (names) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db || names.length === 0)
        return [];
    try {
        const placeholders = names.map(() => '?').join(',');
        const result = db.exec(`SELECT name FROM singer_info WHERE name IN (${placeholders})`, names);
        const existingSet = new Set();
        if (result.length > 0 && result[0].values.length > 0) {
            for (const row of result[0].values) {
                existingSet.add(row[0]);
            }
        }
        return names.filter(name => !existingSet.has(name));
    }
    catch (err) {
        console.error('[DB] Failed to get unsynced singers:', err.message);
        return [];
    }
};
exports.getUnsyncedSingers = getUnsyncedSingers;
/**
 * 一次查出 download_records 中不在 singer_info 表的歌手，附带 source 和 singer_id
 * 用于优化同步：优先使用 singer_id 直接调用 SDK，避免慢速名字搜索
 */
const getUnsyncedSingersWithDetails = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        // 查询 download_records 中所有已完成的记录（含 singer/source/singer_id）
        const result = db.exec(`
            SELECT DISTINCT singer, source, singer_id
            FROM download_records
            WHERE status = 'finished'
              AND singer IS NOT NULL AND singer != ''
        `);
        if (result.length === 0 || result[0].values.length === 0)
            return [];
        // 预取 singer_info 中所有已存在的名字（一次查询，避免 N+1）
        const existingResult = db.exec(`SELECT name FROM singer_info`);
        const existingSet = new Set();
        if (existingResult.length > 0 && existingResult[0].values.length > 0) {
            for (const row of existingResult[0].values) {
                existingSet.add(row[0]);
            }
        }
        const output = [];
        for (const row of result[0].values) {
            const singerStr = row[0] || '';
            const source = row[1] || '';
            const singerIdStr = row[2] || '';
            // 按分隔符拆分歌手名（与 getDistinctSingersFromDownloads 逻辑一致）
            const names = singerStr.split(/[；;,、\/＆&]/).map(s => s.trim()).filter(Boolean);
            const ids = singerIdStr.split(',').map(s => s.trim()).filter(Boolean);
            // 位置映射：names 和 ids 数量相同时一一对应，否则 ID 不可靠
            const canMap = names.length === ids.length && ids.length > 0;
            for (let i = 0; i < names.length; i++) {
                if (existingSet.has(names[i]))
                    continue;
                output.push({
                    name: names[i],
                    source,
                    singer_id: canMap ? ids[i] : '',
                });
            }
        }
        return output;
    }
    catch (err) {
        console.error('[DB] Failed to get unsynced singers with details:', err.message);
        return [];
    }
};
exports.getUnsyncedSingersWithDetails = getUnsyncedSingersWithDetails;
/**
 * 查出 singer_info 中有 source(tx/wy) + singer_id 但信息不完整（缺少 avatar 或 desc）的记录
 * 用于同步 Phase 2：直接通过 SDK 补全缺失字段
 */
const getIncompleteSingerInfo = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT id, singer_id, source, name, avatar, desc, gender, music_count, album_count, created_at, updated_at
            FROM singer_info
            WHERE source IN ('tx', 'wy')
              AND singer_id IS NOT NULL AND singer_id != ''
              AND ((avatar IS NULL OR avatar = '') OR (desc IS NULL OR desc = ''))
        `);
        if (result.length === 0 || result[0].values.length === 0)
            return [];
        return result[0].values.map((row) => mapSingerRow(result[0].columns, row));
    }
    catch (err) {
        console.error('[DB] Failed to get incomplete singer info:', err.message);
        return [];
    }
};
exports.getIncompleteSingerInfo = getIncompleteSingerInfo;
