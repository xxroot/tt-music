"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Acoustid + MusicBrainz 刮削 CLI 测试脚本
 * 用法: npx tsx src/server/localLib/acoustidTest.ts <音频文件路径>
 */
const node_path_1 = __importDefault(require("node:path"));
const acoustidFingerprint_1 = require("./acoustidFingerprint");
const acoustidLookup_1 = require("./acoustidLookup");
const acoustidTagWriter_1 = require("./acoustidTagWriter");
const testFile = process.argv[2];
if (!testFile) {
    console.error('Usage: npx tsx src/server/localLib/acoustidTest.ts <音频文件路径>');
    process.exit(1);
}
const absolutePath = node_path_1.default.resolve(testFile);
async function main() {
    console.log('=== Acoustid + MusicBrainz 刮削测试 ===');
    console.log(`文件: ${absolutePath}`);
    console.log();
    // Step 1: 初始化 WASM
    console.log('--- Step 1: 初始化 WASM ---');
    await (0, acoustidFingerprint_1.initWasm)();
    console.log('✓ WASM 初始化成功');
    console.log();
    // Step 2: 生成指纹
    console.log('--- Step 2: 生成指纹 ---');
    const fpResult = await (0, acoustidFingerprint_1.generateFingerprint)(absolutePath);
    console.log(`  时长: ${fpResult.duration.toFixed(1)}s`);
    console.log(`  指纹: ${fpResult.fingerprint.substring(0, 80)}...`);
    console.log();
    // Step 3: 查询 Acoustid + MusicBrainz
    console.log('--- Step 3: 查询 Acoustid + MusicBrainz ---');
    const lookupResult = await (0, acoustidLookup_1.lookupByFingerprint)(fpResult.fingerprint, fpResult.duration);
    if (!lookupResult || !lookupResult.metadata) {
        console.log('  未找到匹配');
        return;
    }
    const m = lookupResult.metadata;
    console.log();
    console.log('=== 完整元数据 ===');
    console.log(`  Acoustid ID:      ${lookupResult.acoustidId}`);
    console.log(`  匹配分数:         ${lookupResult.score}`);
    console.log(`  ── 基本信息 ──`);
    console.log(`  标题:             ${m.title}`);
    console.log(`  艺术家:           ${m.artist}`);
    console.log(`  艺术家排序名:     ${m.artistSortName}`);
    console.log(`  ── 专辑信息 ──`);
    console.log(`  专辑:             ${m.album}`);
    console.log(`  专辑艺术家:       ${m.albumArtist}`);
    console.log(`  专辑艺术家排序名: ${m.albumArtistSortName}`);
    console.log(`  发行日期:         ${m.date}`);
    console.log(`  风格:             ${m.genre}`);
    console.log(`  发行类型:         ${m.releaseType}`);
    console.log(`  厂牌:             ${m.label}`);
    console.log(`  发行国家:         ${m.country}`);
    console.log(`  ── 位置信息 ──`);
    console.log(`  曲目号:           ${m.trackNumber}`);
    console.log(`  碟片号:           ${m.discNumber}`);
    console.log(`  ── MusicBrainz IDs ──`);
    console.log(`  Recording MBID:   ${m.recordingMbid}`);
    console.log(`  Release MBID:     ${m.releaseMbid}`);
    console.log(`  ReleaseGroup MBID:${m.releaseGroupMbid}`);
    console.log(`  ── 封面 ──`);
    console.log(`  封面 URL:         ${lookupResult.coverUrl || '无'}`);
    console.log();
    // Step 4: 写入标签
    console.log('--- Step 4: 写入标签 (dry-run=false) ---');
    const tagResult = await (0, acoustidTagWriter_1.writeAcoustidTags)(absolutePath, lookupResult.metadata, lookupResult.coverUrl, false, lookupResult.acoustidId);
    console.log(`  写入成功: ${tagResult.written}`);
    console.log(`  写入字段: ${tagResult.fieldsWritten.join(', ') || '无'}`);
    console.log(`  封面嵌入: ${tagResult.coverApplied}`);
    console.log(`  封面保存: ${tagResult.coverSaved}`);
    console.log(`  封面跳过: ${tagResult.coverSkipped}`);
    console.log();
    console.log('=== 测试完成 ===');
}
main().catch(err => {
    console.error('测试失败:', err.message);
    process.exit(1);
});
