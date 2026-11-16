"use strict";
/**
 * 电台相关数据库操作 (Radio Station Database Operations)
 * 处理电台 CRUD、分组管理、收藏、播放状态追踪等功能
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchStations = exports.getFilterOptions = exports.filterStations = exports.updateGroupSortOrder = exports.toggleGroupExpanded = exports.createGroup = exports.getAllGroups = exports.updatePlayStatus = exports.getFavoriteStations = exports.toggleFavorite = exports.deleteStation = exports.updateStation = exports.batchAddStations = exports.addStation = exports.getStationById = exports.getAllStations = void 0;
const db_core_1 = require("./db-core");
// ==================== 辅助函数 ====================
/**
 * 将数据库行转换为 RadioStation 对象
 */
const mapRowToStation = (columns, row) => {
    const obj = {};
    columns.forEach((col, idx) => {
        obj[col] = row[idx];
    });
    return {
        id: obj.id ?? 0,
        name: obj.name ?? '',
        url: obj.url ?? '',
        group_name: obj.group_name ?? '默认分组',
        genres: obj.genres ?? '',
        country: obj.country ?? '',
        region: obj.region ?? '',
        city: obj.city ?? '',
        language: obj.language ?? '',
        logo: obj.logo ?? '',
        cover: obj.cover ?? '',
        quality: obj.quality ?? '',
        station_type: obj.station_type ?? '',
        is_favorite: obj.is_favorite ?? 0,
        last_play_status: obj.last_play_status ?? 'unplayed',
        last_play_time: obj.last_play_time ?? '',
        play_count: obj.play_count ?? 0,
        created_at: obj.created_at ?? '',
        updated_at: obj.updated_at ?? '',
    };
};
/**
 * 将数据库行转换为 RadioGroup 对象
 */
const mapRowToGroup = (columns, row) => {
    const obj = {};
    columns.forEach((col, idx) => {
        obj[col] = row[idx];
    });
    return {
        id: obj.id ?? 0,
        name: obj.name ?? '',
        sort_order: obj.sort_order ?? 0,
        is_expanded: obj.is_expanded ?? 1,
        created_at: obj.created_at ?? '',
        station_count: obj.station_count,
    };
};
/**
 * 确保分组存在（INSERT OR IGNORE）
 */
const ensureGroupExists = (groupName) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return;
    db.run(`INSERT OR IGNORE INTO radio_groups (name) VALUES (?)`, [groupName]);
};
// ==================== 电台 CRUD ====================
/**
 * 获取全部电台列表（按分组排序）
 */
const getAllStations = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT s.* FROM radio_stations s
            LEFT JOIN radio_groups g ON s.group_name = g.name
            ORDER BY g.sort_order ASC, s.group_name ASC, s.name ASC
        `);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => mapRowToStation(result[0].columns, row));
    }
    catch (e) {
        console.error('[DB-Radio] getAllStations failed:', e.message);
        return [];
    }
};
exports.getAllStations = getAllStations;
/**
 * 按 ID 查询单个电台
 */
const getStationById = (id) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return null;
    try {
        const result = db.exec(`SELECT * FROM radio_stations WHERE id = ?`, [id]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return mapRowToStation(result[0].columns, result[0].values[0]);
    }
    catch (e) {
        console.error('[DB-Radio] getStationById failed:', e.message);
        return null;
    }
};
exports.getStationById = getStationById;
/**
 * 添加单条电台记录，自动创建分组
 */
const addStation = (input) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return null;
    console.log('[DB-Radio] addStation input:', JSON.stringify({ name: input.name, url: input.url, group: input.group_name, city: input.city }));
    try {
        const groupName = input.group_name || '默认分组';
        ensureGroupExists(groupName);
        db.run(`
            INSERT INTO radio_stations
                (name, url, group_name, genres, country, region, city, language, logo, cover, quality, station_type,
                 is_favorite, last_play_status, play_count,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unplayed', 0,
                    datetime('now', 'localtime'), datetime('now', 'localtime'))
            ON CONFLICT(url) DO UPDATE SET
                name = excluded.name,
                group_name = excluded.group_name,
                genres = excluded.genres,
                country = excluded.country,
                region = excluded.region,
                city = excluded.city,
                language = excluded.language,
                logo = excluded.logo,
                cover = excluded.cover,
                quality = excluded.quality,
                station_type = excluded.station_type,
                updated_at = datetime('now', 'localtime')
        `, [
            input.name, input.url, groupName,
            input.genres || '', input.country || '', input.region || '',
            input.city || '', input.language || '', input.logo || '',
            input.cover || '', input.quality || '', input.station_type || ''
        ]);
        (0, db_core_1.saveDatabase)();
        // 获取刚插入/更新的记录
        const idResult = db.exec(`SELECT id FROM radio_stations WHERE url = ?`, [input.url]);
        const newId = idResult[0]?.values[0]?.[0];
        console.log('[DB-Radio] addStation success, id:', newId);
        return (0, exports.getStationById)(newId);
    }
    catch (e) {
        console.error('[DB-Radio] addStation failed:', e.message, e.stack);
        return null;
    }
};
exports.addStation = addStation;
/**
 * 批量插入电台记录（M3U 导入，使用事务）
 */
const batchAddStations = (stations) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { inserted: 0, updated: 0, errors: 0 };
    console.log('[DB-Radio] batchAddStations: processing', stations.length, 'stations');
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    try {
        db.run('BEGIN TRANSACTION');
        // 收集所有分组名并批量创建
        const groupNames = new Set(stations.map(s => s.group_name || '默认分组'));
        for (const name of groupNames) {
            db.run(`INSERT OR IGNORE INTO radio_groups (name) VALUES (?)`, [name]);
        }
        for (const input of stations) {
            try {
                const groupName = input.group_name || '默认分组';
                // 检查是否已存在
                const existing = db.exec(`SELECT id FROM radio_stations WHERE url = ?`, [input.url]);
                const exists = existing.length > 0 && existing[0].values.length > 0;
                if (exists) {
                    // 更新已有记录
                    db.run(`
                        UPDATE radio_stations SET
                            name = ?, group_name = ?, genres = ?, country = ?,
                            region = ?, city = ?, language = ?, logo = ?, cover = ?, quality = ?, station_type = ?,
                            updated_at = datetime('now', 'localtime')
                        WHERE url = ?
                    `, [
                        input.name, groupName,
                        input.genres || '', input.country || '', input.region || '',
                        input.city || '', input.language || '', input.logo || '',
                        input.cover || '', input.quality || '', input.station_type || '',
                        input.url
                    ]);
                    updated++;
                }
                else {
                    db.run(`
                        INSERT INTO radio_stations
                            (name, url, group_name, genres, country, region, city, language, logo, cover, quality, station_type,
                             is_favorite, last_play_status, play_count,
                             created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unplayed', 0,
                                datetime('now', 'localtime'), datetime('now', 'localtime'))
                    `, [
                        input.name, input.url, groupName,
                        input.genres || '', input.country || '', input.region || '',
                        input.city || '', input.language || '', input.logo || '',
                        input.cover || '', input.quality || '', input.station_type || ''
                    ]);
                    inserted++;
                }
            }
            catch (e) {
                errors++;
                console.warn('[DB-Radio] batchAddStations: skip station:', input.name, e.message);
            }
        }
        db.run('COMMIT');
        (0, db_core_1.saveDatabase)();
        console.log('[DB-Radio] batchAddStations done: inserted=' + inserted + ', updated=' + updated + ', errors=' + errors);
    }
    catch (e) {
        db.run('ROLLBACK');
        console.error('[DB-Radio] batchAddStations failed:', e.message, e.stack);
        errors = stations.length;
    }
    return { inserted, updated, errors };
};
exports.batchAddStations = batchAddStations;
/**
 * 更新电台字段
 */
const updateStation = (id, fields) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        const setClauses = [];
        const values = [];
        console.log('[DB-Radio] updateStation id:', id, 'fields:', Object.keys(fields));
        const fieldMap = {
            name: 'name', url: 'url', group_name: 'group_name',
            genres: 'genres', country: 'country', region: 'region',
            city: 'city', language: 'language', logo: 'logo',
            cover: 'cover', quality: 'quality', station_type: 'station_type',
        };
        for (const [key, col] of Object.entries(fieldMap)) {
            if (key in fields) {
                setClauses.push(`${col} = ?`);
                values.push(fields[key] ?? '');
            }
        }
        if (setClauses.length === 0)
            return false;
        setClauses.push(`updated_at = datetime('now', 'localtime')`);
        values.push(id);
        db.run(`UPDATE radio_stations SET ${setClauses.join(', ')} WHERE id = ?`, values);
        // 如果分组名变了，确保新分组存在
        if (fields.group_name) {
            ensureGroupExists(fields.group_name);
        }
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (e) {
        console.error('[DB-Radio] updateStation failed:', e.message);
        return false;
    }
};
exports.updateStation = updateStation;
/**
 * 删除电台
 */
const deleteStation = (id) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    console.log('[DB-Radio] deleteStation id:', id);
    try {
        db.run(`DELETE FROM radio_stations WHERE id = ?`, [id]);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (e) {
        console.error('[DB-Radio] deleteStation failed:', e.message);
        return false;
    }
};
exports.deleteStation = deleteStation;
// ==================== 收藏 ====================
/**
 * 切换收藏状态，返回新状态
 */
const toggleFavorite = (id) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 0;
    try {
        db.run(`UPDATE radio_stations SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END,
                updated_at = datetime('now', 'localtime') WHERE id = ?`, [id]);
        (0, db_core_1.saveDatabase)();
        const result = db.exec(`SELECT is_favorite FROM radio_stations WHERE id = ?`, [id]);
        return (result.length > 0 && result[0].values.length > 0) ? result[0].values[0][0] : 0;
    }
    catch (e) {
        console.error('[DB-Radio] toggleFavorite failed:', e.message);
        return 0;
    }
};
exports.toggleFavorite = toggleFavorite;
/**
 * 获取所有收藏电台
 */
const getFavoriteStations = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT * FROM radio_stations WHERE is_favorite = 1
            ORDER BY name ASC
        `);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => mapRowToStation(result[0].columns, row));
    }
    catch (e) {
        console.error('[DB-Radio] getFavoriteStations failed:', e.message);
        return [];
    }
};
exports.getFavoriteStations = getFavoriteStations;
// ==================== 播放状态 ====================
/**
 * 更新播放状态和时间
 */
const updatePlayStatus = (id, status) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        db.run(`
            UPDATE radio_stations SET
                last_play_status = ?,
                last_play_time = datetime('now', 'localtime'),
                play_count = play_count + 1,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `, [status, id]);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (e) {
        console.error('[DB-Radio] updatePlayStatus failed:', e.message);
        return false;
    }
};
exports.updatePlayStatus = updatePlayStatus;
// ==================== 分组管理 ====================
/**
 * 获取所有分组（含电台数量）
 */
const getAllGroups = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT g.*, COUNT(s.id) as station_count
            FROM radio_groups g
            LEFT JOIN radio_stations s ON g.name = s.group_name
            GROUP BY g.id
            ORDER BY g.sort_order ASC, g.name ASC
        `);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => mapRowToGroup(result[0].columns, row));
    }
    catch (e) {
        console.error('[DB-Radio] getAllGroups failed:', e.message);
        return [];
    }
};
exports.getAllGroups = getAllGroups;
/**
 * 创建分组
 */
const createGroup = (name) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return null;
    try {
        db.run(`INSERT OR IGNORE INTO radio_groups (name) VALUES (?)`, [name]);
        (0, db_core_1.saveDatabase)();
        const result = db.exec(`SELECT * FROM radio_groups WHERE name = ?`, [name]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return mapRowToGroup(result[0].columns, result[0].values[0]);
    }
    catch (e) {
        console.error('[DB-Radio] createGroup failed:', e.message);
        return null;
    }
};
exports.createGroup = createGroup;
/**
 * 切换分组展开/折叠状态
 */
const toggleGroupExpanded = (id) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return 1;
    try {
        db.run(`UPDATE radio_groups SET is_expanded = CASE WHEN is_expanded = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id]);
        (0, db_core_1.saveDatabase)();
        const result = db.exec(`SELECT is_expanded FROM radio_groups WHERE id = ?`, [id]);
        return (result.length > 0 && result[0].values.length > 0) ? result[0].values[0][0] : 1;
    }
    catch (e) {
        console.error('[DB-Radio] toggleGroupExpanded failed:', e.message);
        return 1;
    }
};
exports.toggleGroupExpanded = toggleGroupExpanded;
/**
 * 更新分组排序
 */
const updateGroupSortOrder = (id, sortOrder) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return false;
    try {
        db.run(`UPDATE radio_groups SET sort_order = ? WHERE id = ?`, [sortOrder, id]);
        (0, db_core_1.saveDatabase)();
        return true;
    }
    catch (e) {
        console.error('[DB-Radio] updateGroupSortOrder failed:', e.message);
        return false;
    }
};
exports.updateGroupSortOrder = updateGroupSortOrder;
// ==================== 过滤与搜索 ====================
/**
 * 按多维度过滤电台
 */
const filterStations = (filters) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const conditions = [];
        const values = [];
        if (filters.genres) {
            conditions.push(`genres LIKE ?`);
            values.push(`%${filters.genres}%`);
        }
        if (filters.country) {
            conditions.push(`country = ?`);
            values.push(filters.country);
        }
        if (filters.region) {
            conditions.push(`region = ?`);
            values.push(filters.region);
        }
        if (filters.city) {
            conditions.push(`city LIKE ?`);
            values.push(`%${filters.city}%`);
        }
        if (filters.language) {
            conditions.push(`language = ?`);
            values.push(filters.language);
        }
        if (filters.station_type) {
            conditions.push(`station_type = ?`);
            values.push(filters.station_type);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = db.exec(`
            SELECT s.* FROM radio_stations s
            ${whereClause}
            ORDER BY s.group_name ASC, s.name ASC
        `, values);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => mapRowToStation(result[0].columns, row));
    }
    catch (e) {
        console.error('[DB-Radio] filterStations failed:', e.message);
        return [];
    }
};
exports.filterStations = filterStations;
/**
 * 获取所有不重复的过滤选项（genres, country, region, language）
 */
const getFilterOptions = () => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return { genres: [], countries: [], regions: [], cities: [], languages: [] };
    try {
        const extractDistinct = (column) => {
            const result = db.exec(`
                SELECT DISTINCT ${column} FROM radio_stations
                WHERE ${column} IS NOT NULL AND ${column} != ''
                ORDER BY ${column} ASC
            `);
            if (result.length === 0)
                return [];
            return result[0].values.map((row) => row[0]);
        };
        // genres 可能是逗号分隔的多值，需要展开
        const genresResult = db.exec(`
            SELECT DISTINCT genres FROM radio_stations
            WHERE genres IS NOT NULL AND genres != ''
        `);
        const genreSet = new Set();
        if (genresResult.length > 0) {
            for (const row of genresResult[0].values) {
                const genreStr = row[0];
                genreStr.split(',').forEach((g) => {
                    const trimmed = g.trim();
                    if (trimmed)
                        genreSet.add(trimmed);
                });
            }
        }
        return {
            genres: Array.from(genreSet).sort(),
            countries: extractDistinct('country'),
            regions: extractDistinct('region'),
            cities: extractDistinct('city'),
            languages: extractDistinct('language'),
        };
    }
    catch (e) {
        console.error('[DB-Radio] getFilterOptions failed:', e.message);
        return { genres: [], countries: [], regions: [], cities: [], languages: [] };
    }
};
exports.getFilterOptions = getFilterOptions;
/**
 * 按名称模糊搜索电台
 */
const searchStations = (keyword) => {
    const db = (0, db_core_1.getDbInstance)();
    if (!db)
        return [];
    try {
        const result = db.exec(`
            SELECT * FROM radio_stations
            WHERE name LIKE ? OR group_name LIKE ?
            ORDER BY name ASC
        `, [`%${keyword}%`, `%${keyword}%`]);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => mapRowToStation(result[0].columns, row));
    }
    catch (e) {
        console.error('[DB-Radio] searchStations failed:', e.message);
        return [];
    }
};
exports.searchStations = searchStations;
