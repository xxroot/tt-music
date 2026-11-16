"use strict";
/**
 * DLNA 设备 Profile 差异化配置系统
 *
 * 不同 Hi-Fi 硬件对 UPnP 标准的实现千差万别。
 * 通过 DeviceProfile 进行差异化控制：
 * - DMP-A6: XMOS 继电器锁定采样率慢，开启动态就绪探测
 * - HQPlayer: 换歌前必须彻底 Stop，前 3 秒进度有回弹风险，引入进度过滤
 * - Yamaha: 必须传入完整 DIDL-Lite Metadata，禁止并发请求（串行轮询）
 * - DietPi: 系统休眠/网络唤醒慢，HTTP 超时放宽至 5000ms
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROFILE = exports.getProfile = exports.detectDeviceProfile = void 0;
// ==================== Device Profiles ====================
const DEVICE_PROFILES = {
    DMP_A6: {
        type: 'DMP_A6',
        dynamicReadiness: true,
        preStopRequired: true,
        minTransitionDelay: 500,
        readinessMaxRetry: 15,
        readinessInterval: 200,
        progressFilter: true,
        serialPoll: false,
        pollInterval: 1000,
        httpTimeout: 3000,
        maxRetry: 3,
    },
    HQPLAYER: {
        type: 'HQPLAYER',
        dynamicReadiness: true,
        preStopRequired: true,
        minTransitionDelay: 200,
        readinessMaxRetry: 15,
        readinessInterval: 200,
        progressFilter: true,
        serialPoll: false,
        pollInterval: 800,
        httpTimeout: 3000,
        maxRetry: 3,
    },
    YAMAHA: {
        type: 'YAMAHA',
        dynamicReadiness: true,
        preStopRequired: true,
        minTransitionDelay: 600,
        readinessMaxRetry: 0,
        readinessInterval: 200,
        progressFilter: false,
        serialPoll: true,
        pollInterval: 1200,
        httpTimeout: 3000,
        maxRetry: 3,
    },
    DIETPI: {
        type: 'DIETPI',
        dynamicReadiness: false,
        preStopRequired: false,
        minTransitionDelay: 100,
        readinessMaxRetry: 0,
        readinessInterval: 200,
        progressFilter: false,
        serialPoll: false,
        pollInterval: 1000,
        httpTimeout: 5000,
        maxRetry: 3,
    },
    GENERIC: {
        type: 'GENERIC',
        dynamicReadiness: false,
        preStopRequired: true,
        minTransitionDelay: 300,
        readinessMaxRetry: 0,
        readinessInterval: 200,
        progressFilter: false,
        serialPoll: false,
        pollInterval: 1000,
        httpTimeout: 3000,
        maxRetry: 2,
    },
};
// ==================== Auto Detection ====================
/**
 * 根据设备描述信息自动识别设备 Profile 类型
 *
 * 识别规则（基于 manufacturer / modelName / friendlyName）：
 * - DMP_A6:   manufacturer 包含 "EverSolo" 或 modelName 包含 "DMP-A6"
 * - HQPLAYER: friendlyName/modelName 包含 "HQPlayer"
 * - YAMAHA:   manufacturer 包含 "Yamaha"
 * - DIETPI:   friendlyName 包含 "GMediaRender"/"DietPi" 或 modelName 包含 "GMediaRender"
 * - 其余 → GENERIC
 *
 * @param friendlyName - 设备友好名称
 * @param manufacturer - 设备制造商
 * @param modelName - 设备型号
 * @returns 匹配的 DeviceProfile，未匹配则返回 GENERIC
 */
const detectDeviceProfile = (friendlyName, manufacturer, modelName) => {
    const name = (friendlyName || '').toLowerCase();
    const mfr = (manufacturer || '').toLowerCase();
    const model = (modelName || '').toLowerCase();
    const combined = `${name} ${mfr} ${model}`;
    // DMP-A6 (EverSolo)
    if (mfr.includes('eversolo') || model.includes('dmp-a6') || name.includes('dmp-a6')) {
        return DEVICE_PROFILES.DMP_A6;
    }
    // HQPlayer
    if (name.includes('hqplayer') || model.includes('hqplayer')) {
        return DEVICE_PROFILES.HQPLAYER;
    }
    // Yamaha
    if (mfr.includes('yamaha')) {
        return DEVICE_PROFILES.YAMAHA;
    }
    // DietPi (GMediaRender)
    if (name.includes('gmediarender') || name.includes('dietpi') || model.includes('gmediarender')) {
        return DEVICE_PROFILES.DIETPI;
    }
    // 默认通用
    return DEVICE_PROFILES.GENERIC;
};
exports.detectDeviceProfile = detectDeviceProfile;
/**
 * 根据 Profile 类型获取 Profile 配置
 */
const getProfile = (type) => {
    return DEVICE_PROFILES[type] || DEVICE_PROFILES.GENERIC;
};
exports.getProfile = getProfile;
/** 默认 Profile（GENERIC） */
exports.DEFAULT_PROFILE = DEVICE_PROFILES.GENERIC;
