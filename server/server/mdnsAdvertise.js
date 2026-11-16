"use strict";
/**
 * mDNS 服务广播模块 (mDNS Service Advertisement)
 *
 * 使用 bonjour-hap 将本服务器广播为 _ttmusic._tcp 服务，
 * Android 客户端通过 NsdManager 监听该服务类型即可自动发现服务器。
 *
 * 复用现有 bonjour-hap 依赖（当前仅用于 AirPlay 接收器发现），无需新增 npm 包。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopMdnsAdvertise = exports.startMdnsAdvertise = exports.getMdnsServiceName = void 0;
const bonjour_hap_1 = __importDefault(require("bonjour-hap"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
/** Bonjour 实例 & 已发布的服务 */
let bonjourInstance = null;
let publishedService = null;
/**
 * 获取用于广播的主机名
 * - Docker 部署: 若 compose 只读挂载了宿主机 /etc/hostname，其内容为宿主机名
 *   (与容器内 os.hostname() 返回的容器 ID 不同，据此判定挂载场景)
 * - 常规部署: 使用 os.hostname()
 * - 失败回退: 返回空字符串，调用方省略主机名后缀
 */
const getHostName = () => {
    // 优先读取 /etc/hostname (Docker 挂载宿主机 hostname 场景)
    try {
        const etcHostname = fs_1.default.readFileSync('/etc/hostname', 'utf-8').trim();
        const osHostname = os_1.default.hostname();
        if (etcHostname && etcHostname !== osHostname)
            return etcHostname;
    }
    catch { }
    // 常规部署回退
    try {
        return os_1.default.hostname().replace(/\.local$/i, '');
    }
    catch {
        return '';
    }
};
/**
 * 从 package.json 读取版本号
 */
const getPackageVersion = () => {
    try {
        const pkgPath = path_1.default.join(__dirname, '..', '..', 'package.json');
        if (fs_1.default.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs_1.default.readFileSync(pkgPath, 'utf-8'));
            return pkg.version || '0.0.0';
        }
    }
    catch { }
    return '0.0.0';
};
/**
 * 构建 mDNS 广播名: "baseName (hostname)"
 * 与 /api/discovery 返回的 name 保持一致，避免两端显示差异
 *
 * @param baseName 可选自定义名称，默认取 config.serverName
 */
const getMdnsServiceName = (baseName) => {
    const hostName = getHostName();
    const name = baseName || global.lx.config.serverName || 'LX Music Server';
    return hostName ? `${name} (${hostName})` : name;
};
exports.getMdnsServiceName = getMdnsServiceName;
/**
 * 启动 mDNS 服务广播
 * 向局域网宣告本服务器为 _ttmusic._tcp 服务
 *
 * @param port       服务器 HTTP 端口
 * @param serverId   服务器唯一标识 (用于识别换 IP 的同一台服务器)
 * @param serverName 可选自定义名称，默认取 config.serverName
 */
const startMdnsAdvertise = (port, serverId, serverName) => {
    try {
        const name = (0, exports.getMdnsServiceName)(serverName);
        const version = getPackageVersion();
        bonjourInstance = (0, bonjour_hap_1.default)();
        publishedService = bonjourInstance.publish({
            name,
            type: '_ttmusic',
            port,
            txt: {
                version,
                serverId,
            },
        });
        console.log(`[mDNS] 服务已广播: "${name}" @ 端口 ${port} (_ttmusic._tcp.local, version=${version})`);
    }
    catch (err) {
        console.warn('[mDNS] 广播启动失败 (可能系统不支持 mDNS):', err.message);
    }
};
exports.startMdnsAdvertise = startMdnsAdvertise;
/**
 * 停止 mDNS 服务广播
 * 在服务器关闭时调用，从局域网注销服务
 */
const stopMdnsAdvertise = () => {
    try {
        if (bonjourInstance) {
            bonjourInstance.unpublishAll(() => {
                bonjourInstance?.destroy();
                bonjourInstance = null;
                publishedService = null;
                console.log('[mDNS] 服务广播已停止');
            });
        }
    }
    catch (err) {
        console.warn('[mDNS] 停止广播时出错:', err.message);
    }
};
exports.stopMdnsAdvertise = stopMdnsAdvertise;
