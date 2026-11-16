"use strict";
/**
 * 数据库核心模块 (Database Core Module)
 * 提供数据库初始化、连接管理、表创建与迁移等核心功能
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapRecordToFrontendFormat = exports.formatLocalDateTime = exports.getDbInstance = exports.closeDatabase = exports.initDatabase = exports.saveDatabase = exports.deriveRelativePath = exports.KNOWN_BASE_SUBDIRS = exports.db = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// @ts-ignore - sql.js has no type definitions
const sql_js_1 = __importDefault(require("sql.js"));
// Database instance
exports.db = null;
let dbPath = '';
// Known base directories for computing relative_path from file_path
exports.KNOWN_BASE_SUBDIRS = ['download', 'cache'];
/**
 * Derive relative_path from file_path by stripping known base directory prefix.
 * e.g. "/path/to/music/album/song.flac" -> "album/song.flac"
 */
const deriveRelativePath = (filePath) => {
    if (!filePath)
        return '';
    for (const sub of exports.KNOWN_BASE_SUBDIRS) {
        const sep = `${path_1.default.sep}${sub}${path_1.default.sep}`;
        const idx = filePath.indexOf(sep);
        if (idx !== -1) {
            return filePath.substring(idx + sep.length);
        }
    }
    return '';
};
exports.deriveRelativePath = deriveRelativePath;
/**
 * 保存数据库到磁盘
 */
const saveDatabase = () => {
    if (!exports.db || !dbPath)
        return;
    try {
        const data = exports.db.export();
        const buffer = Buffer.from(data);
        fs_1.default.writeFileSync(dbPath, buffer);
    }
    catch (err) {
        console.error('[DB] Failed to save database:', err.message);
    }
};
exports.saveDatabase = saveDatabase;
/**
 * 初始化数据库
 */
const initDatabase = async () => {
    if (exports.db)
        return;
    // Determine database path: data/sqlitedb/download_records.db
    const dataDir = global.lx?.dataPath || path_1.default.join(process.cwd(), 'data');
    const sqliteDir = path_1.default.join(dataDir, 'sqlitedb');
    dbPath = path_1.default.join(sqliteDir, 'download_records.db');
    // Ensure sqlitedb directory exists
    if (!fs_1.default.existsSync(sqliteDir)) {
        fs_1.default.mkdirSync(sqliteDir, { recursive: true });
    }
    // Initialize sql.js
    const SQL = await (0, sql_js_1.default)();
    // Load existing database or create new one
    if (fs_1.default.existsSync(dbPath)) {
        const buffer = fs_1.default.readFileSync(dbPath);
        exports.db = new SQL.Database(buffer);
        console.log('[DB] Loaded existing database from:', dbPath);
    }
    else {
        exports.db = new SQL.Database();
        console.log('[DB] Created new database');
    }
    // Create table if not exists
    exports.db.run(`
        CREATE TABLE IF NOT EXISTS download_records
        (
            id
            INTEGER
            PRIMARY
            KEY
            AUTOINCREMENT,
            source
            TEXT
            NOT
            NULL
            DEFAULT
            'unknown',
            song_id
            TEXT
            NOT
            NULL,
            song_name
            TEXT
            NOT
            NULL,
            singer
            TEXT,
            album
            TEXT,
            quality
            TEXT,
            file_path
            TEXT,
            file_size
            INTEGER,
            duration
            INTEGER,
            status
            TEXT
            DEFAULT
            'finished',
            error_msg
            TEXT,
            downloaded_at
            DATETIME
            DEFAULT
            CURRENT_TIMESTAMP,
            relative_path
            TEXT,
            ext
            TEXT,
            has_cover
            INTEGER
            DEFAULT
            0,
            has_lyric
            INTEGER
            DEFAULT
            0,
            mtime
            TEXT,
            genre
            TEXT,
            year
            INTEGER,
            track_number
            INTEGER,
            album_artist
            TEXT,
            composer
            TEXT,
            sample_rate
            INTEGER,
            bit_depth
            INTEGER,
            channels
            INTEGER,
            bit_rate
            INTEGER,
            meta_enriched
            INTEGER
            DEFAULT
            0,
            singer_ids
            TEXT,
            singer_id
            TEXT,
            img
            TEXT,
            album_id
            TEXT,
            disc_number
            INTEGER,
            disc_total
            INTEGER,
            audio_quality
            TEXT,
            UNIQUE
        (
            source,
            song_id
        )
            )
    `);
    // Create indexes
    // 1. 唯一约束索引 (用于 upsert 和去重)
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_source_song_id ON download_records(source, song_id)`);
    // 2. 高频单列查询 (文件路径查找、歌曲ID精确匹配)
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_song_id ON download_records(song_id)`);
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_file_path ON download_records(file_path)`);
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_relative_path ON download_records(relative_path)`);
    // 3. 音乐库分页查询优化 (覆盖 WHERE + ORDER BY + LIMIT)
    // status 过滤 + mtime 排序 (默认"最近添加")
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_status_mtime ON download_records(status, mtime DESC)`);
    // status 过滤 + downloaded_at 排序 (备选时间排序)
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_status_downloaded_at ON download_records(status, downloaded_at DESC)`);
    // status 过滤 + 歌名搜索 (覆盖 WHERE status + ORDER BY song_name)
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_status_song_name ON download_records(status, song_name)`);
    // status 过滤 + 歌手排序
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_status_singer ON download_records(status, singer)`);
    // status 过滤 + 专辑排序
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_status_album ON download_records(status, album)`);
    // 4. 专辑视图查询优化 (v_album_info 的底层查询需要)
    // status + album 过滤 (视图 WHERE 条件)
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_status_album ON download_records(status, album)`);
    // album 分组聚合辅助 (用于 GROUP BY album)
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_album_singer ON download_records(album, singer)`);
    // 专辑信息视图 (Album Info View)
    // 按 album 分组聚合，提供专辑维度的概要信息
    exports.db.run(`DROP VIEW IF EXISTS v_album_info`);
    exports.db.run(`
        CREATE VIEW v_album_info AS
        SELECT
            album,
            GROUP_CONCAT(DISTINCT NULLIF(singer, ''))              AS singer,
            GROUP_CONCAT(DISTINCT NULLIF(source, ''))              AS source,
            COALESCE(
                GROUP_CONCAT(DISTINCT NULLIF(img, '')),
                MIN(relative_path)
            )                                           AS img,
            SUM(COALESCE(duration, 0))                  AS duration,
            GROUP_CONCAT(DISTINCT NULLIF(genre, ''))                AS genre,
            GROUP_CONCAT(DISTINCT NULLIF(year, ''))                 AS year,
            GROUP_CONCAT(DISTINCT NULLIF(album_artist, ''))         AS album_artist,
            GROUP_CONCAT(DISTINCT NULLIF(disc_number, ''))          AS disc_number,
            GROUP_CONCAT(DISTINCT NULLIF(disc_total, ''))           AS disc_total,
            MAX(mtime)                                  AS mtime,
            COUNT(1)                                    AS sing_count
        FROM download_records
        WHERE status = 'finished' AND album IS NOT NULL AND album != ''
        GROUP BY album
    `);
    console.log('[DB] View v_album_info created/updated');
    // 歌手信息表 (Singer Info Table)
    // singer_id 可空（无 singers 数组时为空字符串），无 UNIQUE 约束
    exports.db.run(`
        CREATE TABLE IF NOT EXISTS singer_info
        (
            id
            INTEGER
            PRIMARY
            KEY
            AUTOINCREMENT,
            singer_id
            TEXT,
            source
            TEXT
            NOT
            NULL,
            name
            TEXT
            NOT
            NULL,
            avatar
            TEXT,
            desc
            TEXT,
            gender
            TEXT,
            music_count
            INTEGER
            DEFAULT
            0,
            album_count
            INTEGER
            DEFAULT
            0,
            created_at
            DATETIME
            DEFAULT
            (datetime('now', 'localtime')),
            updated_at
            DATETIME
            DEFAULT
            (datetime('now', 'localtime'))
        )
    `);
    // [Migration] singer_info: 移除旧的 singer_id NOT NULL 约束和 UNIQUE(source, singer_id) 约束
    try {
        const singerCols = exports.db.exec(`PRAGMA table_info(singer_info)`);
        if (singerCols.length > 0) {
            const singerIdCol = singerCols[0].values.find((r) => r[1] === 'singer_id');
            // notnull === 1 表示旧 schema（singer_id NOT NULL），需要迁移
            if (singerIdCol && singerIdCol[3] === 1) {
                console.log('[DB] Migrating singer_info: removing NOT NULL and UNIQUE constraints...');
                exports.db.run(`
                    CREATE TABLE singer_info_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        singer_id TEXT,
                        source TEXT NOT NULL,
                        name TEXT NOT NULL,
                        avatar TEXT,
                        desc TEXT,
                        gender TEXT,
                        music_count INTEGER DEFAULT 0,
                        album_count INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
                        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
                    )
                `);
                exports.db.run(`
                    INSERT INTO singer_info_new (id, singer_id, source, name, avatar, desc, gender, music_count, album_count, created_at, updated_at)
                    SELECT id, singer_id, source, name, avatar, desc, gender, music_count, album_count, created_at, updated_at
                    FROM singer_info
                `);
                exports.db.run(`DROP TABLE singer_info`);
                exports.db.run(`ALTER TABLE singer_info_new RENAME TO singer_info`);
                console.log('[DB] singer_info migration completed: constraints removed');
            }
        }
    }
    catch (e) {
        console.warn('[DB] singer_info schema migration failed:', e.message);
    }
    // 歌手信息表索引
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_singer_source ON singer_info(source)`);
    // [Migration] singer_info: 去重同名记录，然后添加 UNIQUE 索引（name 是逻辑主键）
    try {
        // 检查是否存在同名重复记录
        const dupCheck = exports.db.exec(`
            SELECT name, COUNT(*) as cnt FROM singer_info
            GROUP BY name HAVING cnt > 1
        `);
        if (dupCheck.length > 0 && dupCheck[0].values.length > 0) {
            console.log(`[DB] Deduplicating ${dupCheck[0].values.length} singer names with duplicates...`);
            for (const row of dupCheck[0].values) {
                const dupName = row[0];
                // 找出所有同名记录，按字段完整度排序（非空字段多的优先）
                const records = exports.db.exec(`
                    SELECT id, singer_id, avatar, \`desc\`, gender, music_count, album_count
                    FROM singer_info WHERE name = ?
                    ORDER BY
                        (CASE WHEN avatar IS NOT NULL AND avatar != '' THEN 1 ELSE 0 END
                        + CASE WHEN \`desc\` IS NOT NULL AND \`desc\` != '' THEN 1 ELSE 0 END
                        + CASE WHEN singer_id IS NOT NULL AND singer_id != '' THEN 1 ELSE 0 END
                        + CASE WHEN music_count > 0 THEN 1 ELSE 0 END
                        + CASE WHEN album_count > 0 THEN 1 ELSE 0 END) DESC,
                        id DESC
                `, [dupName]);
                if (records.length > 0 && records[0].values.length > 1) {
                    const keepId = records[0].values[0][0];
                    // 用其他记录的非空字段补全保留记录
                    for (let i = 1; i < records[0].values.length; i++) {
                        const r = records[0].values[i];
                        const otherSingerId = r[1] || '';
                        const otherAvatar = r[2] || '';
                        const otherDesc = r[3] || '';
                        const otherGender = r[4] || '';
                        const otherMusicCount = r[5] || 0;
                        const otherAlbumCount = r[6] || 0;
                        exports.db.run(`
                            UPDATE singer_info SET
                                singer_id = COALESCE(NULLIF(?, ''), singer_id),
                                avatar = COALESCE(NULLIF(?, ''), avatar),
                                \`desc\` = COALESCE(NULLIF(?, ''), \`desc\`),
                                gender = COALESCE(NULLIF(?, ''), gender),
                                music_count = CASE WHEN ? > 0 AND music_count = 0 THEN ? ELSE music_count END,
                                album_count = CASE WHEN ? > 0 AND album_count = 0 THEN ? ELSE album_count END
                            WHERE id = ?
                        `, [otherSingerId, otherAvatar, otherDesc, otherGender,
                            otherMusicCount, otherMusicCount,
                            otherAlbumCount, otherAlbumCount,
                            keepId]);
                    }
                    // 删除重复记录（保留 keepId）
                    exports.db.run(`DELETE FROM singer_info WHERE name = ? AND id != ?`, [dupName, keepId]);
                }
            }
            (0, exports.saveDatabase)();
            console.log('[DB] singer_info deduplication completed');
        }
        // 创建 UNIQUE 索引（name 为逻辑主键）
        exports.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_singer_info_name_unique ON singer_info(name)`);
        // 移除旧的非唯一索引（被 UNIQUE 索引替代）
        exports.db.run(`DROP INDEX IF EXISTS idx_singer_name`);
        exports.db.run(`DROP INDEX IF EXISTS idx_singer_source_name`);
    }
    catch (e) {
        console.warn('[DB] singer_info UNIQUE index migration failed:', e.message);
    }
    console.log('[DB] Tables and indexes created/verified');
    // Migrate: add columns if not exists
    try {
        const cols = exports.db.exec(`PRAGMA table_info(download_records)`);
        if (cols.length > 0) {
            const colNames = cols[0].values.map((r) => r[1]);
            const migrations = [
                { name: 'duration', sql: 'ALTER TABLE download_records ADD COLUMN duration INTEGER' },
                { name: 'relative_path', sql: 'ALTER TABLE download_records ADD COLUMN relative_path TEXT' },
                { name: 'ext', sql: 'ALTER TABLE download_records ADD COLUMN ext TEXT' },
                { name: 'has_cover', sql: 'ALTER TABLE download_records ADD COLUMN has_cover INTEGER DEFAULT 0' },
                { name: 'has_lyric', sql: 'ALTER TABLE download_records ADD COLUMN has_lyric INTEGER DEFAULT 0' },
                { name: 'mtime', sql: 'ALTER TABLE download_records ADD COLUMN mtime TEXT' },
                { name: 'genre', sql: 'ALTER TABLE download_records ADD COLUMN genre TEXT' },
                { name: 'year', sql: 'ALTER TABLE download_records ADD COLUMN year INTEGER' },
                { name: 'track_number', sql: 'ALTER TABLE download_records ADD COLUMN track_number INTEGER' },
                { name: 'album_artist', sql: 'ALTER TABLE download_records ADD COLUMN album_artist TEXT' },
                { name: 'composer', sql: 'ALTER TABLE download_records ADD COLUMN composer TEXT' },
                { name: 'sample_rate', sql: 'ALTER TABLE download_records ADD COLUMN sample_rate INTEGER' },
                { name: 'bit_depth', sql: 'ALTER TABLE download_records ADD COLUMN bit_depth INTEGER' },
                { name: 'channels', sql: 'ALTER TABLE download_records ADD COLUMN channels INTEGER' },
                { name: 'bit_rate', sql: 'ALTER TABLE download_records ADD COLUMN bit_rate INTEGER' },
                { name: 'meta_enriched', sql: 'ALTER TABLE download_records ADD COLUMN meta_enriched INTEGER DEFAULT 0' },
                { name: 'singer_ids', sql: 'ALTER TABLE download_records ADD COLUMN singer_ids TEXT' },
                { name: 'singer_id', sql: 'ALTER TABLE download_records ADD COLUMN singer_id TEXT' },
                { name: 'img', sql: 'ALTER TABLE download_records ADD COLUMN img TEXT' },
                { name: 'album_id', sql: 'ALTER TABLE download_records ADD COLUMN album_id TEXT' },
                { name: 'acoustid_mbid', sql: 'ALTER TABLE download_records ADD COLUMN acoustid_mbid TEXT' },
                { name: 'disc_number', sql: 'ALTER TABLE download_records ADD COLUMN disc_number INTEGER' },
                { name: 'disc_total', sql: 'ALTER TABLE download_records ADD COLUMN disc_total INTEGER' },
                { name: 'audio_quality', sql: 'ALTER TABLE download_records ADD COLUMN audio_quality TEXT' },
            ];
            for (const migration of migrations) {
                if (!colNames.includes(migration.name)) {
                    exports.db.run(migration.sql);
                    console.log(`[DB] Migrated: added ${migration.name} column`);
                }
            }
        }
    }
    catch (e) {
        console.warn('[DB] Migration check failed:', e.message);
    }
    // [Migration] Split song_id into source + song_id if still using old format (source_songId)
    // 例: wy_123456 → source='wy', song_id='123456'
    /*try {
        const cols = db.exec(`PRAGMA table_info(download_records)`)
        const colNames = cols.length > 0 ? cols[0].values.map((r: any[]) => r[1]) : []

        // 检查是否有旧格式记录 (song_id 包含下划线且 source 为空)
        // 使用 INSTR 函数检测下划线,避免 LIKE 转义问题
        const hasOldFormat = db.exec(`SELECT COUNT(*)
                                      FROM download_records
                                      WHERE (source IS NULL OR source = '')
                                        AND INSTR(song_id, '_') > 0
                                        AND song_id NOT LIKE 'file%'`)
        if (hasOldFormat.length > 0 && hasOldFormat[0].values.length > 0 && (hasOldFormat[0].values[0][0] as number) > 0) {
            console.log('[DB] Migrating old song_id format (source_songId) to separate source + song_id columns...')

            // Step 1: 确保 source 列存在
            if (!colNames.includes('source')) {
                db.run(`ALTER TABLE download_records
                    ADD COLUMN source TEXT DEFAULT 'unknown'`)
            }

            // Step 2: 提取 source 前缀并更新 (只处理 source 为空的记录)
            // 支持五大平台: wy/tx/kg/kw/mg
            db.run(`UPDATE download_records
                    SET source  = SUBSTR(song_id, 1, INSTR(song_id, '_') - 1),
                        song_id = SUBSTR(song_id, INSTR(song_id, '_') + 1)
                    WHERE (source IS NULL OR source = '')
                      AND INSTR(song_id, '_') > 0
                      AND song_id NOT LIKE 'file%'`)
            console.log('[DB] Migration completed: song_id split into source + song_id')
        }
    } catch (e: any) {
        console.warn('[DB] song_id migration failed:', e.message)
    }*/
    // [Migration] Fill mtime with downloaded_at for existing records where mtime is empty
    /*try {
        const mtimeEmpty = db.exec(`SELECT COUNT(*)
                                     FROM download_records
                                     WHERE (mtime IS NULL OR mtime = '')
                                       AND downloaded_at IS NOT NULL`)
        if (mtimeEmpty.length > 0 && mtimeEmpty[0].values.length > 0 && (mtimeEmpty[0].values[0][0] as number) > 0) {
            db.run(`UPDATE download_records
                    SET mtime = downloaded_at
                    WHERE (mtime IS NULL OR mtime = '')
                      AND downloaded_at IS NOT NULL`)
            console.log(`[DB] Migration: filled mtime from downloaded_at for ${mtimeEmpty[0].values[0][0]} record(s)`)
        }
    } catch (e: any) {
        console.warn('[DB] mtime backfill migration failed:', e.message)
    }*/
    // [Migration] Split singer_id into source + singer_id if still using old format (source_singerId)
    // 例: wy_11127 → source='wy', singer_id='11127'
    /*try {
        const singerCols = db.exec(`PRAGMA table_info(singer_info)`)
        const singerColNames = singerCols.length > 0 ? singerCols[0].values.map((r: any[]) => r[1]) : []

        // 检查是否有旧格式记录 (singer_id 包含下划线)
        const hasOldSingerFormat = db.exec(`SELECT COUNT(*)
                                            FROM singer_info
                                            WHERE INSTR(singer_id, '_') > 0`)
        if (hasOldSingerFormat.length > 0 && hasOldSingerFormat[0].values.length > 0 && (hasOldSingerFormat[0].values[0][0] as number) > 0) {
            console.log('[DB] Migrating old singer_id format (source_singerId) to separate source + singer_id columns...')

            // Step 1: 确保 source 列存在
            if (!singerColNames.includes('source')) {
                db.run(`ALTER TABLE singer_info
                    ADD COLUMN source TEXT DEFAULT 'unknown'`)
            }

            // Step 2: 提取 source 前缀并更新
            // 注意: 需要处理重复的 (source, singer_id) 组合,保留第一条
            db.run(`UPDATE singer_info
                    SET source    = SUBSTR(singer_id, 1, INSTR(singer_id, '_') - 1),
                        singer_id = SUBSTR(singer_id, INSTR(singer_id, '_') + 1)
                    WHERE INSTR(singer_id, '_') > 0`)
            console.log('[DB] Migration completed: singer_id split into source + singer_id')
        }
    } catch (e: any) {
        console.warn('[DB] singer_id migration failed:', e.message)
    }*/
    // [Migration] Unify local library source from 'local_xxx' to 'local'
    try {
        const oldLocalCount = exports.db.exec(`SELECT COUNT(*) FROM download_records WHERE source LIKE 'local_%' AND source != 'local'`);
        if (oldLocalCount.length > 0 && oldLocalCount[0].values.length > 0 && oldLocalCount[0].values[0][0] > 0) {
            const count = oldLocalCount[0].values[0][0];
            exports.db.run(`UPDATE download_records SET source = 'local' WHERE source LIKE 'local_%' AND source != 'local'`);
            console.log(`[DB] Migrated ${count} records from local_xxx to 'local' source`);
        }
    }
    catch (e) {
        console.warn('[DB] local source migration failed:', e.message);
    }
    // [Radio] Create radio stations and groups tables
    exports.db.run(`CREATE TABLE IF NOT EXISTS radio_stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        group_name TEXT DEFAULT '默认分组',
        genres TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        language TEXT,
        logo TEXT,
        cover TEXT,
        quality TEXT,
        station_type TEXT,
        is_favorite INTEGER DEFAULT 0,
        last_play_status TEXT DEFAULT 'unplayed',
        last_play_time TEXT,
        play_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(url)
    )`);
    exports.db.run(`CREATE TABLE IF NOT EXISTS radio_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0,
        is_expanded INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`);
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_radio_group ON radio_stations(group_name)`);
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_radio_favorite ON radio_stations(is_favorite)`);
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_radio_genres ON radio_stations(genres)`);
    exports.db.run(`CREATE INDEX IF NOT EXISTS idx_radio_country ON radio_stations(country)`);
    // [Radio] Migration: add city column if not exists (for existing databases)
    try {
        exports.db.run(`ALTER TABLE radio_stations ADD COLUMN city TEXT`);
        console.log('[DB] Radio migration: city column added');
    }
    catch (_e) {
        // Column already exists, ignore
    }
    // [Radio] Migration: add station_type column if not exists
    try {
        exports.db.run(`ALTER TABLE radio_stations ADD COLUMN station_type TEXT`);
        console.log('[DB] Radio migration: station_type column added');
    }
    catch (_e) {
        // Column already exists, ignore
    }
    console.log('[DB] Radio tables and indexes created');
    // Save initial state
    (0, exports.saveDatabase)();
    console.log('[DB] Database initialized successfully');
};
exports.initDatabase = initDatabase;
/**
 * 关闭数据库连接
 */
const closeDatabase = () => {
    if (exports.db) {
        (0, exports.saveDatabase)();
        exports.db.close();
        exports.db = null;
        console.log('[DB] Database closed');
    }
};
exports.closeDatabase = closeDatabase;
/**
 * 获取数据库实例 (供子模块使用)
 */
const getDbInstance = () => exports.db;
exports.getDbInstance = getDbInstance;
/**
 * 将数据库行转换为前端兼容的歌曲格式
 * 供 db-songs、db-singers、db-albums 共享使用
 */
/**
 * Format Date to local time string compatible with SQLite datetime format
 * SQLite datetime('now', 'localtime') returns: 'YYYY-MM-DD HH:MM:SS'
 * 注意: 不要使用 toISOString() — 它返回 UTC 时间，会导致存储时间比本地时间少8小时
 */
const formatLocalDateTime = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
exports.formatLocalDateTime = formatLocalDateTime;
const mapRecordToFrontendFormat = (record) => {
    if (!exports.db)
        return null;
    let relativePath = record.relative_path || '';
    let ext = record.ext || '';
    // Fallback: derive relative_path from file_path if not stored
    if (!relativePath && record.file_path) {
        relativePath = (0, exports.deriveRelativePath)(record.file_path);
        // Also fix the DB record for future reads
        if (relativePath) {
            try {
                exports.db.run(`UPDATE download_records
                        SET relative_path = ?
                        WHERE source = ?
                          AND song_id = ?`, [relativePath, record.source, record.song_id]);
                if (!ext) {
                    ext = path_1.default.extname(record.file_path);
                    exports.db.run(`UPDATE download_records
                            SET ext = ?
                            WHERE source = ?
                              AND song_id = ?`, [ext, record.source, record.song_id]);
                }
            }
            catch (e) {
            }
        }
    }
    if (!ext && record.file_path) {
        ext = path_1.default.extname(record.file_path);
    }
    return {
        id: record.song_id,
        songId: record.song_id,
        name: record.song_name,
        singer: record.singer || 'Unknown',
        album: record.album || 'Unknown',
        albumName: record.album || 'Unknown',
        source: record.source || '',
        quality: record.quality || '',
        type: record.quality ? [record.quality] : [],
        relativePath: relativePath,
        ext: ext,
        hasCover: !!record.has_cover,
        hasLyric: !!record.has_lyric,
        duration: record.duration || 0,
        size: record.file_size || 0,
        mtime: record.mtime || record.downloaded_at || (0, exports.formatLocalDateTime)(new Date()),
        filename: relativePath ? relativePath.split('/').pop() || relativePath.split(path_1.default.sep).pop() || '' : '',
        genre: record.genre || '',
        year: record.year || null,
        trackNumber: record.track_number || null,
        albumArtist: record.album_artist || '',
        composer: record.composer || '',
        sampleRate: record.sample_rate || null,
        bitDepth: record.bit_depth || null,
        channels: record.channels || null,
        bitRate: record.bit_rate || null,
        singerIds: record.singer_ids || '',
        singerId: record.singer_id || '',
        img: record.img || '',
        albumId: record.album_id || '',
        discNumber: record.disc_number || null,
        discTotal: record.disc_total || null,
        audioQuality: record.audio_quality || '',
    };
};
exports.mapRecordToFrontendFormat = mapRecordToFrontendFormat;
