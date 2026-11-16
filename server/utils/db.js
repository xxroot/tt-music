"use strict";
/**
 * 数据库总入口 (Database Main Entry Point)
 * 导出所有子模块的功能，保持向后兼容的 API
 *
 * 模块划分:
 * - db-core.ts: 数据库核心 (初始化、连接管理、表创建与迁移)
 * - db-songs.ts: 歌曲相关操作 (下载记录 CRUD、音乐库列表等)
 * - db-singers.ts: 歌手相关操作 (歌手信息表 CRUD、歌手查询等)
 * - db-albums.ts: 专辑相关操作 (专辑查询、专辑名称更新等)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAlbumNameInDB = exports.getSongsByAlbumName = exports.getIncompleteSingerInfo = exports.getUnsyncedSingersWithDetails = exports.getUnsyncedSingers = exports.getSingerDownloadRecords = exports.getDistinctSingersFromDownloads = exports.updateSingerInfoIfIncomplete = exports.deleteSingerInfo = exports.getAllSingerInfo = exports.getSingerInfoByName = exports.getSingerInfo = exports.updateSingerFieldsByName = exports.upsertSingerInfo = exports.cleanupOrphanedSingerInfo = exports.getHomeStats = exports.batchUpsertDownloadRecords = exports.deleteDownloadRecordsBySongIds = exports.getSongIdsBySource = exports.deleteDownloadRecordsBySource = exports.getRecordsNeedingEnrichment = exports.deleteStaleRecords = exports.getStaleRecords = exports.clearAllDownloadRecords = exports.getDownloadStats = exports.getRandomSongsFromDB = exports.getMusicLibPageFromDB = exports.getMusicLibListFromDB = exports.updateSongFullTags = exports.updateSongNameInDB = exports.updateDurationByPath = exports.updateMusicLibMeta = exports.replaceFileRecordWithSongId = exports.getDownloadRecordByFileIdentity = exports.getDownloadRecordByName = exports.getDownloadRecordBySongId = exports.getDownloadRecordsByRelativePathPrefix = exports.getDownloadRecordByRelativePath = exports.getDownloadRecordByPath = exports.deleteDownloadRecordByFilePath = exports.deleteDownloadRecordByPath = exports.getAllDownloadRecords = exports.getDownloadRecords = exports.getDownloadRecord = exports.upsertDownloadRecord = exports.deriveRelativePath = exports.getDbInstance = exports.saveDatabase = exports.closeDatabase = exports.initDatabase = void 0;
exports.searchStations = exports.getFilterOptions = exports.filterStations = exports.updateGroupSortOrder = exports.toggleGroupExpanded = exports.createGroup = exports.getAllGroups = exports.updatePlayStatus = exports.getFavoriteStations = exports.toggleFavorite = exports.deleteStation = exports.updateStation = exports.batchAddStations = exports.addStation = exports.getStationById = exports.getAllStations = exports.deleteDuplicateRecords = exports.getDuplicateRecords = exports.getAlbumPageFromDB = exports.searchAlbums = exports.getAllAlbums = exports.updateAlbumMetadataInDB = void 0;
// 导出核心模块
var db_core_1 = require("./db-core");
Object.defineProperty(exports, "initDatabase", { enumerable: true, get: function () { return db_core_1.initDatabase; } });
Object.defineProperty(exports, "closeDatabase", { enumerable: true, get: function () { return db_core_1.closeDatabase; } });
Object.defineProperty(exports, "saveDatabase", { enumerable: true, get: function () { return db_core_1.saveDatabase; } });
Object.defineProperty(exports, "getDbInstance", { enumerable: true, get: function () { return db_core_1.getDbInstance; } });
Object.defineProperty(exports, "deriveRelativePath", { enumerable: true, get: function () { return db_core_1.deriveRelativePath; } });
// 导出歌曲模块
var db_songs_1 = require("./db-songs");
Object.defineProperty(exports, "upsertDownloadRecord", { enumerable: true, get: function () { return db_songs_1.upsertDownloadRecord; } });
Object.defineProperty(exports, "getDownloadRecord", { enumerable: true, get: function () { return db_songs_1.getDownloadRecord; } });
Object.defineProperty(exports, "getDownloadRecords", { enumerable: true, get: function () { return db_songs_1.getDownloadRecords; } });
Object.defineProperty(exports, "getAllDownloadRecords", { enumerable: true, get: function () { return db_songs_1.getAllDownloadRecords; } });
Object.defineProperty(exports, "deleteDownloadRecordByPath", { enumerable: true, get: function () { return db_songs_1.deleteDownloadRecordByPath; } });
Object.defineProperty(exports, "deleteDownloadRecordByFilePath", { enumerable: true, get: function () { return db_songs_1.deleteDownloadRecordByFilePath; } });
Object.defineProperty(exports, "getDownloadRecordByPath", { enumerable: true, get: function () { return db_songs_1.getDownloadRecordByPath; } });
Object.defineProperty(exports, "getDownloadRecordByRelativePath", { enumerable: true, get: function () { return db_songs_1.getDownloadRecordByRelativePath; } });
Object.defineProperty(exports, "getDownloadRecordsByRelativePathPrefix", { enumerable: true, get: function () { return db_songs_1.getDownloadRecordsByRelativePathPrefix; } });
Object.defineProperty(exports, "getDownloadRecordBySongId", { enumerable: true, get: function () { return db_songs_1.getDownloadRecordBySongId; } });
Object.defineProperty(exports, "getDownloadRecordByName", { enumerable: true, get: function () { return db_songs_1.getDownloadRecordByName; } });
Object.defineProperty(exports, "getDownloadRecordByFileIdentity", { enumerable: true, get: function () { return db_songs_1.getDownloadRecordByFileIdentity; } });
Object.defineProperty(exports, "replaceFileRecordWithSongId", { enumerable: true, get: function () { return db_songs_1.replaceFileRecordWithSongId; } });
Object.defineProperty(exports, "updateMusicLibMeta", { enumerable: true, get: function () { return db_songs_1.updateMusicLibMeta; } });
Object.defineProperty(exports, "updateDurationByPath", { enumerable: true, get: function () { return db_songs_1.updateDurationByPath; } });
Object.defineProperty(exports, "updateSongNameInDB", { enumerable: true, get: function () { return db_songs_1.updateSongNameInDB; } });
Object.defineProperty(exports, "updateSongFullTags", { enumerable: true, get: function () { return db_songs_1.updateSongFullTags; } });
Object.defineProperty(exports, "getMusicLibListFromDB", { enumerable: true, get: function () { return db_songs_1.getMusicLibListFromDB; } });
Object.defineProperty(exports, "getMusicLibPageFromDB", { enumerable: true, get: function () { return db_songs_1.getMusicLibPageFromDB; } });
Object.defineProperty(exports, "getRandomSongsFromDB", { enumerable: true, get: function () { return db_songs_1.getRandomSongsFromDB; } });
Object.defineProperty(exports, "getDownloadStats", { enumerable: true, get: function () { return db_songs_1.getDownloadStats; } });
Object.defineProperty(exports, "clearAllDownloadRecords", { enumerable: true, get: function () { return db_songs_1.clearAllDownloadRecords; } });
Object.defineProperty(exports, "getStaleRecords", { enumerable: true, get: function () { return db_songs_1.getStaleRecords; } });
Object.defineProperty(exports, "deleteStaleRecords", { enumerable: true, get: function () { return db_songs_1.deleteStaleRecords; } });
Object.defineProperty(exports, "getRecordsNeedingEnrichment", { enumerable: true, get: function () { return db_songs_1.getRecordsNeedingEnrichment; } });
Object.defineProperty(exports, "deleteDownloadRecordsBySource", { enumerable: true, get: function () { return db_songs_1.deleteDownloadRecordsBySource; } });
Object.defineProperty(exports, "getSongIdsBySource", { enumerable: true, get: function () { return db_songs_1.getSongIdsBySource; } });
Object.defineProperty(exports, "deleteDownloadRecordsBySongIds", { enumerable: true, get: function () { return db_songs_1.deleteDownloadRecordsBySongIds; } });
Object.defineProperty(exports, "batchUpsertDownloadRecords", { enumerable: true, get: function () { return db_songs_1.batchUpsertDownloadRecords; } });
Object.defineProperty(exports, "getHomeStats", { enumerable: true, get: function () { return db_songs_1.getHomeStats; } });
Object.defineProperty(exports, "cleanupOrphanedSingerInfo", { enumerable: true, get: function () { return db_songs_1.cleanupOrphanedSingerInfo; } });
// 导出歌手模块
var db_singers_1 = require("./db-singers");
Object.defineProperty(exports, "upsertSingerInfo", { enumerable: true, get: function () { return db_singers_1.upsertSingerInfo; } });
Object.defineProperty(exports, "updateSingerFieldsByName", { enumerable: true, get: function () { return db_singers_1.updateSingerFieldsByName; } });
Object.defineProperty(exports, "getSingerInfo", { enumerable: true, get: function () { return db_singers_1.getSingerInfo; } });
Object.defineProperty(exports, "getSingerInfoByName", { enumerable: true, get: function () { return db_singers_1.getSingerInfoByName; } });
Object.defineProperty(exports, "getAllSingerInfo", { enumerable: true, get: function () { return db_singers_1.getAllSingerInfo; } });
Object.defineProperty(exports, "deleteSingerInfo", { enumerable: true, get: function () { return db_singers_1.deleteSingerInfo; } });
Object.defineProperty(exports, "updateSingerInfoIfIncomplete", { enumerable: true, get: function () { return db_singers_1.updateSingerInfoIfIncomplete; } });
Object.defineProperty(exports, "getDistinctSingersFromDownloads", { enumerable: true, get: function () { return db_singers_1.getDistinctSingersFromDownloads; } });
Object.defineProperty(exports, "getSingerDownloadRecords", { enumerable: true, get: function () { return db_singers_1.getSingerDownloadRecords; } });
Object.defineProperty(exports, "getUnsyncedSingers", { enumerable: true, get: function () { return db_singers_1.getUnsyncedSingers; } });
Object.defineProperty(exports, "getUnsyncedSingersWithDetails", { enumerable: true, get: function () { return db_singers_1.getUnsyncedSingersWithDetails; } });
Object.defineProperty(exports, "getIncompleteSingerInfo", { enumerable: true, get: function () { return db_singers_1.getIncompleteSingerInfo; } });
// 导出专辑模块
var db_albums_1 = require("./db-albums");
Object.defineProperty(exports, "getSongsByAlbumName", { enumerable: true, get: function () { return db_albums_1.getSongsByAlbumName; } });
Object.defineProperty(exports, "updateAlbumNameInDB", { enumerable: true, get: function () { return db_albums_1.updateAlbumNameInDB; } });
Object.defineProperty(exports, "updateAlbumMetadataInDB", { enumerable: true, get: function () { return db_albums_1.updateAlbumMetadataInDB; } });
Object.defineProperty(exports, "getAllAlbums", { enumerable: true, get: function () { return db_albums_1.getAllAlbums; } });
Object.defineProperty(exports, "searchAlbums", { enumerable: true, get: function () { return db_albums_1.searchAlbums; } });
Object.defineProperty(exports, "getAlbumPageFromDB", { enumerable: true, get: function () { return db_albums_1.getAlbumPageFromDB; } });
// 向后兼容：导出 duplicate 相关函数 (保留在 db.ts 中因为涉及多表操作)
var db_duplicates_1 = require("./db-duplicates");
Object.defineProperty(exports, "getDuplicateRecords", { enumerable: true, get: function () { return db_duplicates_1.getDuplicateRecords; } });
Object.defineProperty(exports, "deleteDuplicateRecords", { enumerable: true, get: function () { return db_duplicates_1.deleteDuplicateRecords; } });
// 导出电台模块
var db_radio_1 = require("./db-radio");
Object.defineProperty(exports, "getAllStations", { enumerable: true, get: function () { return db_radio_1.getAllStations; } });
Object.defineProperty(exports, "getStationById", { enumerable: true, get: function () { return db_radio_1.getStationById; } });
Object.defineProperty(exports, "addStation", { enumerable: true, get: function () { return db_radio_1.addStation; } });
Object.defineProperty(exports, "batchAddStations", { enumerable: true, get: function () { return db_radio_1.batchAddStations; } });
Object.defineProperty(exports, "updateStation", { enumerable: true, get: function () { return db_radio_1.updateStation; } });
Object.defineProperty(exports, "deleteStation", { enumerable: true, get: function () { return db_radio_1.deleteStation; } });
Object.defineProperty(exports, "toggleFavorite", { enumerable: true, get: function () { return db_radio_1.toggleFavorite; } });
Object.defineProperty(exports, "getFavoriteStations", { enumerable: true, get: function () { return db_radio_1.getFavoriteStations; } });
Object.defineProperty(exports, "updatePlayStatus", { enumerable: true, get: function () { return db_radio_1.updatePlayStatus; } });
Object.defineProperty(exports, "getAllGroups", { enumerable: true, get: function () { return db_radio_1.getAllGroups; } });
Object.defineProperty(exports, "createGroup", { enumerable: true, get: function () { return db_radio_1.createGroup; } });
Object.defineProperty(exports, "toggleGroupExpanded", { enumerable: true, get: function () { return db_radio_1.toggleGroupExpanded; } });
Object.defineProperty(exports, "updateGroupSortOrder", { enumerable: true, get: function () { return db_radio_1.updateGroupSortOrder; } });
Object.defineProperty(exports, "filterStations", { enumerable: true, get: function () { return db_radio_1.filterStations; } });
Object.defineProperty(exports, "getFilterOptions", { enumerable: true, get: function () { return db_radio_1.getFilterOptions; } });
Object.defineProperty(exports, "searchStations", { enumerable: true, get: function () { return db_radio_1.searchStations; } });
