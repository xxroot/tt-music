"use strict";
/**
 * DLNA GENA (General Event Notification Architecture) 事件订阅模块
 *
 * 负责 UPNP GENA 事件订阅/续订/退订，以及 NOTIFY 事件解析。
 * DMR 设备通过 GENA 推送状态变化（播放/暂停/停止/进度等），
 * 替代前端轮询机制。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.identifyServiceBySid = exports.parseLastChangeXml = exports.unsubscribeAll = exports.stopAutoRenew = exports.startAutoRenew = exports.renewSubscription = exports.subscribeEvents = exports.subscribeService = void 0;
const node_http_1 = __importDefault(require("node:http"));
const node_url_1 = require("node:url");
const fast_xml_parser_1 = require("fast-xml-parser");
const lastChangeParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    attributeNamePrefix: '@_',
    isArray: (name) => ['service', 'icon'].includes(name),
});
// ==================== GENA Subscribe ====================
/**
 * 向 DMR 的指定服务发送 GENA SUBSCRIBE 请求
 * Exported for use by dlnaDmc.ts resubscribe logic
 */
const subscribeService = (eventSubUrl, callbackUrl, timeoutSeconds = 1800) => {
    return new Promise((resolve) => {
        const url = new node_url_1.URL(eventSubUrl);
        const req = node_http_1.default.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'SUBSCRIBE',
            headers: {
                'CALLBACK': `<${callbackUrl}>`,
                'NT': 'upnp:event',
                'TIMEOUT': `Second-${timeoutSeconds}`,
                'Connection': 'close',
            },
            timeout: 8000,
        }, (res) => {
            if (res.statusCode === 200 || res.statusCode === 201) {
                const sid = res.headers['sid'];
                const timeoutStr = res.headers['timeout'];
                const timeout = parseTimeout(timeoutStr, timeoutSeconds);
                if (sid) {
                    resolve({ sid, eventSubUrl, serviceId: 'AVTransport', timeout, renewTimer: null });
                }
                else {
                    console.warn('[GENA] Subscribe response missing SID');
                    resolve(null);
                }
            }
            else {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk.toString();
                });
                res.on('end', () => {
                    console.warn(`[GENA] Subscribe failed: HTTP ${res.statusCode}`);
                    resolve(null);
                });
            }
        });
        req.on('error', (err) => {
            console.warn('[GENA] Subscribe error:', err.message);
            resolve(null);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
        req.end();
    });
};
exports.subscribeService = subscribeService;
/**
 * 向 DMR 设备订阅 AVTransport 和 RenderingControl 的 GENA 事件
 */
const subscribeEvents = async (device, callbackUrl) => {
    const subs = {
        avTransport: null,
        renderingControl: null,
    };
    if (device.avTransportEventUrl) {
        const avSub = await (0, exports.subscribeService)(device.avTransportEventUrl, callbackUrl);
        if (avSub) {
            avSub.serviceId = 'AVTransport';
            subs.avTransport = avSub;
        }
    }
    if (device.renderingControlEventUrl) {
        const rcSub = await (0, exports.subscribeService)(device.renderingControlEventUrl, callbackUrl);
        if (rcSub) {
            rcSub.serviceId = 'RenderingControl';
            subs.renderingControl = rcSub;
        }
    }
    return subs;
};
exports.subscribeEvents = subscribeEvents;
// ==================== GENA Renew ====================
/**
 * 续订 GENA 订阅 (使用 SID，不重新发送 CALLBACK)
 * 失败时指数退避重试（最多 2 次），重试耗尽后标记 needsResubscribe
 */
const renewSubscription = (sub, onRenewed, retryCount = 0) => {
    return new Promise((resolve) => {
        const url = new node_url_1.URL(sub.eventSubUrl);
        const req = node_http_1.default.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'SUBSCRIBE',
            headers: {
                'SID': sub.sid,
                'TIMEOUT': `Second-${sub.timeout}`,
                'Connection': 'close',
            },
            timeout: 8000,
        }, (res) => {
            if (res.statusCode === 200 || res.statusCode === 201) {
                const timeoutStr = res.headers['timeout'];
                sub.timeout = parseTimeout(timeoutStr, sub.timeout);
                sub.needsResubscribe = false;
                if (onRenewed)
                    onRenewed(sub);
                resolve();
            }
            else {
                console.warn(`[GENA] Renew failed: HTTP ${res.statusCode} (service=${sub.serviceId}, retry=${retryCount})`);
                handleRenewFailure(sub, onRenewed, retryCount, resolve);
            }
        });
        req.on('error', (err) => {
            console.warn(`[GENA] Renew error: ${err.message} (service=${sub.serviceId}, retry=${retryCount})`);
            handleRenewFailure(sub, onRenewed, retryCount, resolve);
        });
        req.on('timeout', () => {
            req.destroy();
            console.warn(`[GENA] Renew timeout (service=${sub.serviceId}, retry=${retryCount})`);
            handleRenewFailure(sub, onRenewed, retryCount, resolve);
        });
        req.end();
    });
};
exports.renewSubscription = renewSubscription;
/**
 * 处理续订失败：重试或标记 needsResubscribe
 */
const handleRenewFailure = async (sub, onRenewed, retryCount, resolve) => {
    if (retryCount < 2) {
        const delay = 1000 * Math.pow(2, retryCount); // 1s, 2s 指数退避
        console.log(`[GENA] Retrying renew in ${delay}ms (service=${sub.serviceId}, retry=${retryCount + 1})`);
        setTimeout(() => {
            void (0, exports.renewSubscription)(sub, onRenewed, retryCount + 1).then(resolve);
        }, delay);
    }
    else {
        console.warn(`[GENA] Renew exhausted after ${retryCount + 1} attempts, marking needsResubscribe (service=${sub.serviceId})`);
        sub.needsResubscribe = true;
        resolve();
    }
};
/**
 * 启动自动续订定时器（在 timeout 的 80% 时触发续订）
 * 续订失败后若 onResubscribe 回调存在，则尝试重新订阅
 */
const startAutoRenew = (sub, onRenewed, onResubscribe) => {
    (0, exports.stopAutoRenew)(sub);
    if (sub.timeout <= 0)
        return; // 无限超时不需要续订
    const renewDelay = Math.max(sub.timeout * 1000 * 0.8, 30000); // 至少 30s（timeout单位是秒，需*1000转毫秒）
    sub.renewTimer = setTimeout(async () => {
        await (0, exports.renewSubscription)(sub, onRenewed);
        if (sub.needsResubscribe && onResubscribe) {
            // 续订重试耗尽，调用重新订阅
            await onResubscribe(sub);
        }
        else if (!sub.needsResubscribe) {
            // 续订成功，继续下一轮自动续订
            (0, exports.startAutoRenew)(sub, onRenewed, onResubscribe);
        }
        // needsResubscribe && !onResubscribe: 无恢复手段，订阅静默死亡
    }, renewDelay);
};
exports.startAutoRenew = startAutoRenew;
/**
 * 停止自动续订定时器
 */
const stopAutoRenew = (sub) => {
    if (sub.renewTimer) {
        clearTimeout(sub.renewTimer);
        sub.renewTimer = null;
    }
};
exports.stopAutoRenew = stopAutoRenew;
// ==================== GENA Unsubscribe ====================
/**
 * 退订单个 GENA 订阅
 */
const unsubscribeService = (sub) => {
    return new Promise((resolve) => {
        (0, exports.stopAutoRenew)(sub);
        const url = new node_url_1.URL(sub.eventSubUrl);
        const req = node_http_1.default.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'UNSUBSCRIBE',
            headers: {
                'SID': sub.sid,
                'Connection': 'close',
            },
            timeout: 5000,
        }, (res) => {
            resolve();
        });
        req.on('error', (err) => {
            console.warn('[GENA] Unsubscribe error:', err.message);
            resolve();
        });
        req.on('timeout', () => {
            req.destroy();
            resolve();
        });
        req.end();
    });
};
/**
 * 退订所有 GENA 订阅
 */
const unsubscribeAll = async (subs) => {
    const promises = [];
    if (subs.avTransport) {
        promises.push(unsubscribeService(subs.avTransport));
    }
    if (subs.renderingControl) {
        promises.push(unsubscribeService(subs.renderingControl));
    }
    await Promise.allSettled(promises);
    subs.avTransport = null;
    subs.renderingControl = null;
};
exports.unsubscribeAll = unsubscribeAll;
// ==================== GENA Notify Parsing ====================
/**
 * 解析 GENA NOTIFY 请求体中的 LastChange XML
 *
 * NOTIFY body 格式示例:
 * <e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">
 *   <e:property>
 *     <LastChange>&lt;Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"&gt;
 *       &lt;InstanceID val="0"&gt;
 *         &lt;TransportState val="PLAYING"/&gt;
 *         &lt;RelativeTimePosition val="00:01:23"/&gt;
 *       &lt;/InstanceID&gt;
 *     &lt;/Event&gt;</LastChange>
 *   </e:property>
 * </e:propertyset>
 */
const parseLastChangeXml = (xmlBody) => {
    const event = { source: 'event' };
    try {
        const lastChangeMatch = xmlBody.match(/<LastChange[^>]*>([\s\S]*?)<\/LastChange>/i);
        if (!lastChangeMatch) {
            // Direct property (e.g. Volume from RenderingControl)
            const volumeMatch = xmlBody.match(/<Volume[^>]*val="(\d+)"[^/]*\/>/i)
                || xmlBody.match(/<Volume[^>]*>(\d+)<\/Volume>/i);
            if (volumeMatch) {
                event.volume = parseInt(volumeMatch[1], 10);
            }
            return event;
        }
        // Decode HTML entities in LastChange XML
        const decoded = lastChangeMatch[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#38;/g, '&')
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
        // Structured XML parsing via fast-xml-parser
        const parsed = lastChangeParser.parse(decoded);
        const instance = parsed?.Event?.InstanceID;
        if (instance && typeof instance === 'object') {
            const extractVal = (obj) => {
                if (obj == null)
                    return undefined;
                if (typeof obj === 'string')
                    return obj;
                if (typeof obj === 'object') {
                    // Handle attribute-based: { '@_val': 'PLAYING' }
                    if (obj['@_val'] !== undefined)
                        return String(obj['@_val']);
                    // Handle text-based: { '#text': 'value' }
                    if (obj['#text'] !== undefined)
                        return String(obj['#text']);
                }
                return undefined;
            };
            const ts = extractVal(instance.TransportState);
            if (ts)
                event.transportState = ts;
            const rt = extractVal(instance.RelativeTimePosition);
            if (rt)
                event.relTime = rt;
            const dur = extractVal(instance.CurrentTrackDuration) || extractVal(instance.CurrentMediaDuration);
            if (dur)
                event.trackDuration = dur;
            const uri = extractVal(instance.CurrentTrackURI) || extractVal(instance.AVTransportURI);
            if (uri)
                event.trackURI = uri;
            const actions = extractVal(instance.CurrentTransportActions);
            if (actions)
                event.currentTransportActions = actions;
            const vol = extractVal(instance.Volume);
            if (vol !== undefined)
                event.volume = parseInt(vol, 10);
        }
    }
    catch (err) {
        console.error('[GENA] Parse NOTIFY failed:', err.message, xmlBody);
    }
    console.log('[DMR] ===> Parse event:', decodeURIComponent(JSON.stringify(event)));
    return event;
};
exports.parseLastChangeXml = parseLastChangeXml;
// ==================== Helpers ====================
/**
 * 解析 GENA TIMEOUT 头 (如 "Second-1800" 或 "Second-infinite")
 */
const parseTimeout = (timeoutStr, defaultSeconds) => {
    if (!timeoutStr)
        return defaultSeconds;
    const match = timeoutStr.match(/Second-(\d+|infinite)/i);
    if (!match)
        return defaultSeconds;
    if (match[1].toLowerCase() === 'infinite')
        return 0;
    const parsed = parseInt(match[1], 10);
    // DLNA 1.5 合理范围：1秒 ~ 24小时（86400秒）
    return (parsed > 0 && parsed < 86400) ? parsed : defaultSeconds;
};
/**
 * 从 GENA NOTIFY 请求中识别服务类型
 * 通过 SID 查找对应的订阅信息
 */
const identifyServiceBySid = (sid, subs) => {
    if (subs.avTransport?.sid === sid)
        return 'AVTransport';
    if (subs.renderingControl?.sid === sid)
        return 'RenderingControl';
    return null;
};
exports.identifyServiceBySid = identifyServiceBySid;
