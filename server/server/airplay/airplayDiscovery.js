"use strict";
/**
 * AirPlay 设备发现模块 (AirPlay Device Discovery)
 *
 * 使用 mDNS/DNS-SD (bonjour-hap) 扫描局域网 AirPlay 接收器。
 * 监听 _raop._tcp 和 _airplay._tcp 服务类型。
 *
 * 对应 DLNA 侧的 upnp.ts 中 SSDP 扫描功能。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shutdown = exports.getDevice = exports.getCachedDevices = exports.getActiveDeviceState = exports.getActiveDeviceId = exports.setActiveDevice = exports.scanDevices = void 0;
const bonjour_hap_1 = __importDefault(require("bonjour-hap"));
// ==================== Constants ====================
/** mDNS 服务类型 */
const RAOP_SERVICE_TYPE = 'raop';
const AIRPLAY_SERVICE_TYPE = 'airplay';
/** 设备缓存 & TTL */
const deviceMap = new Map();
const deviceExpiry = new Map();
const DEVICE_TTL = 5 * 60 * 1000; // 5 minutes
/** 活跃设备追踪 */
let activeDeviceId = null;
let activeDeviceName = '';
/** Bonjour 实例 & 浏览器 */
let bonjourInstance = null;
let raopBrowser = null;
let airplayBrowser = null;
// ==================== Discovery ====================
/**
 * 扫描局域网 AirPlay 设备
 * 启动 mDNS 浏览器，收集 5 秒内的响应，
 * 中途重启浏览器一次以补偿首次 mDNS 查询可能丢失的情况
 */
const scanDevices = () => {
    return new Promise((resolve) => {
        cleanup();
        try {
            bonjourInstance = (0, bonjour_hap_1.default)();
        }
        catch (err) {
            console.error('[AirPlay-Discovery] Bonjour 初始化失败:', err.message);
            resolve((0, exports.getCachedDevices)());
            return;
        }
        const discovered = new Map();
        const startBrowsers = () => {
            // 监听 _raop._tcp (AirPlay 1 音频流)
            raopBrowser = bonjourInstance.find({ type: RAOP_SERVICE_TYPE }, (service) => {
                const device = parseServiceToRAOPDevice(service);
                if (device) {
                    discovered.set(device.id, device);
                    console.log(`[AirPlay-Discovery] 发现 RAOP 设备: "${device.name}" @ ${device.host}:${device.port}`);
                }
            });
            // 监听 _airplay._tcp (AirPlay 2 特性补充)
            airplayBrowser = bonjourInstance.find({ type: AIRPLAY_SERVICE_TYPE }, (service) => {
                const device = parseServiceToAirPlayDevice(service);
                if (device) {
                    // 若已有同名 RAOP 设备，合并信息
                    const existing = discovered.get(device.id);
                    if (existing) {
                        existing.supportsAirPlay2 = true;
                        if (!existing.model && device.model)
                            existing.model = device.model;
                    }
                    else {
                        discovered.set(device.id, device);
                        console.log(`[AirPlay-Discovery] 发现 AirPlay 设备: "${device.name}" @ ${device.host}:${device.port}`);
                    }
                }
            });
        };
        const restartBrowsers = () => {
            // 停止当前浏览器，重新发起 mDNS 查询以补偿首次查询可能丢失的情况
            if (raopBrowser) {
                raopBrowser.stop();
                raopBrowser = null;
            }
            if (airplayBrowser) {
                airplayBrowser.stop();
                airplayBrowser = null;
            }
            startBrowsers();
            console.log('[AirPlay-Discovery] mDNS 浏览器已重启，发送新一轮查询');
        };
        // 启动初始浏览器
        startBrowsers();
        // 2.5 秒后重启浏览器，发送新的 mDNS 查询
        setTimeout(() => {
            restartBrowsers();
        }, 2500);
        // 5 秒后停止浏览器，返回结果
        setTimeout(() => {
            cleanup();
            // 更新缓存
            const now = Date.now();
            for (const [id, device] of discovered) {
                deviceMap.set(id, device);
                deviceExpiry.set(id, now + DEVICE_TTL);
            }
            // 合并历史缓存（未过期的）
            const allDevices = (0, exports.getCachedDevices)();
            console.log(`[AirPlay-Discovery] 扫描完成，发现 ${discovered.size} 台新设备，共 ${allDevices.length} 台可用`);
            resolve(allDevices);
        }, 5000);
    });
};
exports.scanDevices = scanDevices;
/**
 * 清理 Bonjour 浏览器资源
 */
const cleanup = () => {
    if (raopBrowser) {
        raopBrowser.stop();
        raopBrowser = null;
    }
    if (airplayBrowser) {
        airplayBrowser.stop();
        airplayBrowser = null;
    }
    if (bonjourInstance) {
        bonjourInstance.destroy();
        bonjourInstance = null;
    }
};
// ==================== Service Parsing ====================
/**
 * 将 mDNS _raop._tcp 服务解析为 AirPlayDevice
 */
const parseServiceToRAOPDevice = (service) => {
    if (!service.addresses || service.addresses.length === 0)
        return null;
    // 优先取 IPv4 地址
    const ipv4 = service.addresses.find((a) => !a.includes(':'));
    const host = ipv4 || service.addresses[0];
    const port = service.port;
    // 设备名: service.name 通常是 "设备名@MAC"
    const name = (service.name || '').split('@')[0] || service.name || 'Unknown AirPlay';
    // 解析 TXT 记录
    const txt = normalizeTxt(service.txt || {});
    const deviceId = txt['deviceid'] || `${host}:${port}`;
    // AirPlay 版本: features 字段位掩码
    const features = parseInt(txt['features'] || '0', 16);
    const airplayVersion = (features & 0x100000000) ? 2 : 1; // bit 32 = AirPlay 2
    return {
        id: `airplay:${deviceId}`,
        name,
        host,
        port,
        txt,
        airplayVersion,
        model: txt['am'] || txt['model'] || undefined,
        supportsAirPlay2: airplayVersion >= 2,
    };
};
/**
 * 将 mDNS _airplay._tcp 服务解析为 AirPlayDevice
 */
const parseServiceToAirPlayDevice = (service) => {
    if (!service.addresses || service.addresses.length === 0)
        return null;
    const ipv4 = service.addresses.find((a) => !a.includes(':'));
    const host = ipv4 || service.addresses[0];
    const port = service.port;
    const name = service.name || 'Unknown AirPlay';
    const txt = normalizeTxt(service.txt || {});
    const deviceId = txt['deviceid'] || `${host}:${port}`;
    // AirPlay 2 判断: srcvers >= 300 或 features 包含 bit 32
    const srcvers = txt['srcvers'] || '';
    const majorVersion = parseInt(srcvers.split('.')[0] || '0', 10);
    return {
        id: `airplay:${deviceId}`,
        name,
        host,
        port,
        txt,
        airplayVersion: majorVersion >= 3 ? 2 : 1,
        model: txt['model'] || undefined,
        supportsAirPlay2: majorVersion >= 3,
    };
};
/**
 * 规范化 TXT 记录（bonjour-hap 返回的 key 可能大小写不一）
 */
const normalizeTxt = (txt) => {
    const result = {};
    for (const [key, value] of Object.entries(txt)) {
        if (value !== null && value !== undefined) {
            result[key.toLowerCase()] = String(value);
        }
    }
    return result;
};
// ==================== Device Management ====================
/**
 * 设置活跃设备
 */
const setActiveDevice = (deviceId, deviceName) => {
    activeDeviceId = deviceId;
    activeDeviceName = deviceName || '';
    if (deviceId && deviceMap.has(deviceId)) {
        deviceExpiry.set(deviceId, Date.now() + DEVICE_TTL);
    }
};
exports.setActiveDevice = setActiveDevice;
/**
 * 获取活跃设备 ID
 */
const getActiveDeviceId = () => {
    return activeDeviceId;
};
exports.getActiveDeviceId = getActiveDeviceId;
/**
 * 获取活跃设备状态
 */
const getActiveDeviceState = () => {
    return {
        deviceId: activeDeviceId,
        deviceName: activeDeviceName,
        castType: activeDeviceId ? 'airplay' : '',
    };
};
exports.getActiveDeviceState = getActiveDeviceState;
/**
 * 获取缓存的设备列表
 */
const getCachedDevices = () => {
    const now = Date.now();
    const devices = [];
    for (const [id, device] of deviceMap) {
        const expiry = deviceExpiry.get(id) || 0;
        if (expiry > now || id === activeDeviceId) {
            devices.push(device);
        }
        else {
            deviceMap.delete(id);
            deviceExpiry.delete(id);
        }
    }
    return devices;
};
exports.getCachedDevices = getCachedDevices;
/**
 * 通过 ID 获取设备
 */
const getDevice = (deviceId) => {
    const device = deviceMap.get(deviceId);
    if (!device)
        return undefined;
    const now = Date.now();
    const expiry = deviceExpiry.get(deviceId) || 0;
    // 活跃设备不过期
    if (deviceId === activeDeviceId) {
        deviceExpiry.set(deviceId, now + DEVICE_TTL);
        return device;
    }
    if (expiry > now) {
        deviceExpiry.set(deviceId, now + DEVICE_TTL);
        return device;
    }
    // 过期但仍保留
    deviceExpiry.set(deviceId, now + DEVICE_TTL);
    return device;
};
exports.getDevice = getDevice;
/**
 * 关闭发现服务（进程退出时调用）
 */
const shutdown = () => {
    cleanup();
    console.log('[AirPlay-Discovery] 服务已关闭');
};
exports.shutdown = shutdown;
