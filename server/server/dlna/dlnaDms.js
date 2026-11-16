"use strict";
/**
 * DLNA DMS (Digital Media Server) 发现与浏览模块
 *
 * 通过 SSDP 发现局域网内的 DLNA Media Server 设备，
 * 使用 UPnP ContentDirectory Browse/Search SOAP 动作浏览其共享媒体内容。
 * 支持按分类（艺术家/专辑/流派）浏览和播放。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchDms = exports.getBrowseCategories = exports.browseContainer = exports.getCachedDmsDevices = exports.scanDmsDevices = void 0;
const node_dgram_1 = __importDefault(require("node:dgram"));
const node_http_1 = __importDefault(require("node:http"));
const node_url_1 = require("node:url");
const fast_xml_parser_1 = require("fast-xml-parser");
// ==================== XML Parser ====================
const xmlParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) => ['container', 'item', 'res', 'service', 'icon'].includes(name),
});
// ==================== Constants ====================
const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SSDP_MX = 3;
const MEDIA_SERVER_ST = 'urn:schemas-upnp-org:device:MediaServer:1';
const CONTENT_DIRECTORY_ST = 'urn:schemas-upnp-org:service:ContentDirectory';
// 设备缓存
const dmsDeviceMap = new Map();
const dmsDeviceExpiry = new Map();
const DMS_DEVICE_TTL = 5 * 60 * 1000; // 5 minutes
// ==================== SSDP Discovery ====================
/**
 * 扫描局域网内的 DLNA Media Server 设备
 */
const scanDmsDevices = () => {
    return new Promise((resolve) => {
        const socket = node_dgram_1.default.createSocket('udp4');
        const responses = [];
        const seenLocations = new Set();
        let resolved = false;
        const ssdpMessage = [
            'M-SEARCH * HTTP/1.1',
            `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
            'MAN: "ssdp:discover"',
            `MX: ${SSDP_MX}`,
            `ST: ${MEDIA_SERVER_ST}`,
            '',
            '',
        ].join('\r\n');
        const messageBuffer = Buffer.from(ssdpMessage);
        const finishScan = () => {
            if (resolved)
                return;
            resolved = true;
            try {
                socket.close();
            }
            catch { /* already closed */ }
            const devicePromises = responses.map(r => fetchDmsDescription(r.location, r.usn));
            Promise.allSettled(devicePromises).then((results) => {
                const devices = [];
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value) {
                        const device = result.value;
                        dmsDeviceMap.set(device.id, device);
                        dmsDeviceExpiry.set(device.id, Date.now() + DMS_DEVICE_TTL);
                        devices.push(device);
                    }
                }
                // 包含未过期的缓存设备
                const now = Date.now();
                for (const [id, device] of dmsDeviceMap) {
                    if (!devices.some(d => d.id === id)) {
                        const expiry = dmsDeviceExpiry.get(id) || 0;
                        if (expiry > now) {
                            devices.push(device);
                        }
                        else {
                            dmsDeviceMap.delete(id);
                            dmsDeviceExpiry.delete(id);
                        }
                    }
                }
                console.log(`[DMS] 扫描完成, 发现 ${devices.length} 个 Media Server`);
                resolve(devices);
            });
        };
        socket.on('message', (msg) => {
            const response = parseSSDPResponse(msg.toString());
            if (response && response.location && !seenLocations.has(response.location)) {
                seenLocations.add(response.location);
                responses.push(response);
            }
        });
        socket.on('error', (err) => {
            console.warn('[DMS] SSDP error:', err.message);
        });
        socket.bind(() => {
            socket.setBroadcast(true);
            socket.addMembership(SSDP_ADDR);
            socket.send(messageBuffer, 0, messageBuffer.length, SSDP_PORT, SSDP_ADDR);
            // 发送第二次提高可靠性
            setTimeout(() => {
                try {
                    socket.send(messageBuffer, 0, messageBuffer.length, SSDP_PORT, SSDP_ADDR);
                }
                catch { /* socket may be closed */ }
            }, 500);
        });
        // 也搜索 ContentDirectory 服务（某些设备响应更好）
        const cdMessage = [
            'M-SEARCH * HTTP/1.1',
            `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
            'MAN: "ssdp:discover"',
            `MX: ${SSDP_MX}`,
            `ST: ${CONTENT_DIRECTORY_ST}:1`,
            '',
            '',
        ].join('\r\n');
        const cdBuffer = Buffer.from(cdMessage);
        setTimeout(() => {
            try {
                socket.send(cdBuffer, 0, cdBuffer.length, SSDP_PORT, SSDP_ADDR);
            }
            catch { /* socket may be closed */ }
        }, 300);
        // 硬超时
        setTimeout(finishScan, (SSDP_MX + 1) * 1000);
    });
};
exports.scanDmsDevices = scanDmsDevices;
/**
 * 获取已缓存的 DMS 设备列表（不触发扫描）
 */
const getCachedDmsDevices = () => {
    const now = Date.now();
    const devices = [];
    for (const [id, device] of dmsDeviceMap) {
        const expiry = dmsDeviceExpiry.get(id) || 0;
        if (expiry > now) {
            devices.push(device);
        }
        else {
            dmsDeviceMap.delete(id);
            dmsDeviceExpiry.delete(id);
        }
    }
    return devices;
};
exports.getCachedDmsDevices = getCachedDmsDevices;
// ==================== ContentDirectory Browse ====================
/**
 * 浏览 DMS 容器内容
 * @param deviceId 设备 ID
 * @param objectId 容器 ObjectID (根为 "0")
 * @param startIndex 起始索引
 * @param count 请求数量
 */
const browseContainer = async (deviceId, objectId = '0', startIndex = 0, count = 100) => {
    const device = dmsDeviceMap.get(deviceId);
    if (!device) {
        throw new Error(`DMS 设备未找到: ${deviceId}`);
    }
    const soapBody = buildBrowseSoap(objectId, 'BrowseDirectChildren', startIndex, count);
    const responseXml = await sendSoapRequest(device.contentDirectoryUrl, 'Browse', soapBody);
    return parseBrowseResponse(responseXml);
};
exports.browseContainer = browseContainer;
/**
 * 获取设备顶层分类（Browse root）
 */
const getBrowseCategories = async (deviceId) => {
    const result = await (0, exports.browseContainer)(deviceId, '0', 0, 200);
    return result.containers;
};
exports.getBrowseCategories = getBrowseCategories;
/**
 * 搜索 DMS 内容
 * @param deviceId 设备 ID
 * @param keyword 搜索关键词
 */
const searchDms = async (deviceId, keyword, startIndex = 0, count = 100) => {
    const device = dmsDeviceMap.get(deviceId);
    if (!device) {
        throw new Error(`DMS 设备未找到: ${deviceId}`);
    }
    // ContentDirectory Search 动作
    const searchCriteria = `dc:title contains "${escapeXml(keyword)}" or dc:creator contains "${escapeXml(keyword)}"`;
    const soapBody = buildSearchSoap('0', searchCriteria, startIndex, count);
    const responseXml = await sendSoapRequest(device.contentDirectoryUrl, 'Search', soapBody);
    return parseBrowseResponse(responseXml, 'Search');
};
exports.searchDms = searchDms;
// ==================== SOAP Helpers ====================
/**
 * 构建 Browse SOAP 请求体
 */
const buildBrowseSoap = (objectId, browseFlag, startIndex, requestedCount) => {
    return `<u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
  <ObjectID>${escapeXml(objectId)}</ObjectID>
  <BrowseFlag>${browseFlag}</BrowseFlag>
  <Filter>*</Filter>
  <StartingIndex>${startIndex}</StartingIndex>
  <RequestedCount>${requestedCount}</RequestedCount>
  <SortCriteria></SortCriteria>
</u:Browse>`;
};
/**
 * 构建 Search SOAP 请求体
 */
const buildSearchSoap = (containerId, searchCriteria, startIndex, requestedCount) => {
    return `<u:Search xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
  <ContainerID>${escapeXml(containerId)}</ContainerID>
  <SearchCriteria>${searchCriteria}</SearchCriteria>
  <Filter>*</Filter>
  <StartingIndex>${startIndex}</StartingIndex>
  <RequestedCount>${requestedCount}</RequestedCount>
  <SortCriteria></SortCriteria>
</u:Search>`;
};
/**
 * 发送 SOAP 请求到 ContentDirectory 服务
 */
const sendSoapRequest = (controlUrl, action, soapBody) => {
    return new Promise((resolve, reject) => {
        const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    ${soapBody}
  </s:Body>
</s:Envelope>`;
        const url = new node_url_1.URL(controlUrl);
        const soapAction = `"urn:schemas-upnp-org:service:ContentDirectory:1#${action}"`;
        const req = node_http_1.default.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPAction': soapAction,
                'Content-Length': Buffer.byteLength(envelope),
            },
            timeout: 10000,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(data);
                }
                else {
                    reject(new Error(`SOAP ${action} 失败: HTTP ${res.statusCode}`));
                }
            });
        });
        req.on('error', (err) => {
            reject(new Error(`SOAP ${action} 请求失败: ${err.message}`));
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`SOAP ${action} 超时`));
        });
        req.write(envelope);
        req.end();
    });
};
// ==================== Response Parsing ====================
/**
 * 解析 Browse/Search SOAP 响应
 */
const parseBrowseResponse = (xml, action = 'Browse') => {
    console.log(`[DMS] ${action} 响应 (前500字符):`, xml.substring(0, 500));
    const parsed = xmlParser.parse(xml);
    // 定位 Result 字段 (BrowseResponse.Result 或 SearchResponse.Result)
    const body = parsed?.Envelope?.Body;
    if (!body) {
        console.warn('[DMS] 响应中未找到 Envelope.Body');
        return { containers: [], items: [], totalMatches: 0, numberReturned: 0 };
    }
    const responseKey = `${action}Response`;
    const response = body[responseKey];
    if (!response) {
        console.warn(`[DMS] 响应中未找到 ${responseKey}, Body keys:`, Object.keys(body));
        return { containers: [], items: [], totalMatches: 0, numberReturned: 0 };
    }
    const totalMatches = parseInt(String(response.TotalMatches ?? '0'), 10);
    const numberReturned = parseInt(String(response.NumberReturned ?? '0'), 10);
    // Result 可能是 DIDL-Lite XML 字符串（标准），也可能已被外层 parser 解析为对象（部分设备如 FNOS）
    const resultRaw = response.Result;
    console.log(`[DMS] Result 字段类型: ${typeof resultRaw}, totalMatches=${totalMatches}, numberReturned=${numberReturned}`);
    let didlRoot;
    if (typeof resultRaw === 'string') {
        // 标准情况: Result 是 DIDL-Lite XML 字符串，需二次解析
        if (!resultRaw) {
            return { containers: [], items: [], totalMatches, numberReturned };
        }
        console.log(`[DMS] DIDL-Lite 字符串 (前300字符):`, resultRaw.substring(0, 300));
        const didlParser = new fast_xml_parser_1.XMLParser({
            ignoreAttributes: false,
            removeNSPrefix: true,
            isArray: (name) => ['container', 'item', 'res', 'albumArtURI'].includes(name),
        });
        try {
            const didl = didlParser.parse(resultRaw);
            console.log(`[DMS] DIDL 解析后顶层 keys:`, Object.keys(didl || {}));
            // DIDL-Lite 标签含连字符，需用 bracket 访问；也兼容其他变体
            didlRoot = didl?.['DIDL-Lite'] || didl?.DIDL_Lite || didl?.DIDL || didl;
            if (didlRoot && didlRoot !== didl) {
                console.log(`[DMS] didlRoot keys:`, Object.keys(didlRoot));
            }
            else {
                // 如果顶层就是 root，尝试找到实际的 DIDL 内容
                const firstKey = Object.keys(didl || {})[0];
                if (firstKey && typeof didl[firstKey] === 'object') {
                    didlRoot = didl[firstKey];
                    console.log(`[DMS] 使用首个 key "${firstKey}" 作为 didlRoot, keys:`, Object.keys(didlRoot));
                }
            }
        }
        catch (err) {
            console.warn('[DMS] DIDL-Lite 字符串解析失败:', err.message);
            return { containers: [], items: [], totalMatches, numberReturned };
        }
    }
    else if (resultRaw && typeof resultRaw === 'object') {
        // 部分设备(如 FNOS)返回未转义 XML，已被外层 parser 解析为对象
        console.log(`[DMS] Result 对象 keys:`, Object.keys(resultRaw));
        didlRoot = resultRaw['DIDL-Lite'] || resultRaw.DIDL_Lite || resultRaw.DIDL || resultRaw;
    }
    else {
        console.warn('[DMS] Result 字段为空或类型不支持:', resultRaw);
        return { containers: [], items: [], totalMatches, numberReturned };
    }
    if (!didlRoot) {
        console.warn('[DMS] DIDL-Lite 根节点为空');
        return { containers: [], items: [], totalMatches, numberReturned };
    }
    // 解析 containers
    const containers = [];
    const rawContainers = ensureArray(didlRoot.container);
    for (const c of rawContainers) {
        containers.push({
            id: String(c['@_id'] ?? ''),
            title: String(c.title ?? ''),
            childCount: parseInt(String(c['@_childCount'] ?? '0'), 10),
            upnpClass: String(c.class ?? ''),
            albumArtUri: extractAlbumArt(c),
        });
    }
    // 解析 items (音频条目)
    const items = [];
    const rawItems = ensureArray(didlRoot.item);
    for (const it of rawItems) {
        const resList = ensureArray(it.res);
        // 优先选择音频类型的 res
        const audioRes = findBestRes(resList);
        items.push({
            id: String(it['@_id'] ?? ''),
            title: String(it.title ?? ''),
            artist: String(it.creator ?? it.artist ?? ''),
            album: String(it.album ?? ''),
            genre: String(it.genre ?? ''),
            duration: audioRes?.['@_duration'] ? String(audioRes['@_duration']) : '',
            protocolInfo: audioRes?.['@_protocolInfo'] ? String(audioRes['@_protocolInfo']) : '',
            url: audioRes ? String(audioRes['#text'] ?? audioRes) : '',
            size: audioRes?.['@_size'] ? parseInt(String(audioRes['@_size']), 10) : 0,
            albumArtUri: extractAlbumArt(it),
            format: audioRes?.['@_protocolInfo'] ? extractFormat(String(audioRes['@_protocolInfo'])) : '',
        });
    }
    console.log(`[DMS] 解析完成: ${containers.length} 个容器, ${items.length} 个条目`);
    return { containers, items, totalMatches, numberReturned };
};
// ==================== Device Description ====================
/**
 * 获取并解析 DMS 设备描述 XML
 */
const fetchDmsDescription = (location, usn) => {
    return new Promise((resolve) => {
        const url = new node_url_1.URL(location);
        const req = node_http_1.default.get({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            timeout: 5000,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    const device = parseDmsDescription(data, location, usn);
                    resolve(device);
                }
                catch (err) {
                    console.warn(`[DMS] 解析设备描述失败 ${location}:`, err.message);
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
};
/**
 * 解析 DMS 设备描述 XML，提取 ContentDirectory controlURL
 */
const parseDmsDescription = (xml, location, usn) => {
    let parsed;
    try {
        parsed = xmlParser.parse(xml);
    }
    catch {
        return null;
    }
    const device = parsed?.root?.device;
    if (!device)
        return null;
    const deviceType = String(device.deviceType ?? '');
    // 确认是 MediaServer 设备
    if (!deviceType.includes('MediaServer'))
        return null;
    const friendlyName = String(device.friendlyName ?? 'Unknown DMS');
    const manufacturer = device.manufacturer ? String(device.manufacturer) : undefined;
    const modelName = device.modelName ? String(device.modelName) : undefined;
    // 查找 ContentDirectory 服务
    const serviceList = Array.isArray(device.serviceList?.service)
        ? device.serviceList.service
        : device.serviceList?.service ? [device.serviceList.service] : [];
    const contentDirectoryUrl = findServiceControlUrl(serviceList, 'ContentDirectory');
    if (!contentDirectoryUrl)
        return null;
    // 图标
    const iconList = Array.isArray(device.iconList?.icon)
        ? device.iconList.icon
        : device.iconList?.icon ? [device.iconList.icon] : [];
    const iconUrl = findBestIcon(iconList, location);
    const uuidMatch = usn.match(/uuid:([a-fA-F0-9-]+)/);
    const deviceId = uuidMatch ? `uuid:${uuidMatch[1]}` : usn;
    console.log(`[DMS] 发现 Media Server: "${friendlyName}" @ ${location}`);
    return {
        id: deviceId,
        name: friendlyName,
        location,
        contentDirectoryUrl: resolveUrl(location, contentDirectoryUrl),
        iconUrl: iconUrl || undefined,
        manufacturer,
        model: modelName,
    };
};
// ==================== Utility Functions ====================
const parseSSDPResponse = (msg) => {
    try {
        const lines = msg.split('\r\n');
        const headers = {};
        for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const key = line.substring(0, colonIdx).trim().toLowerCase();
                const value = line.substring(colonIdx + 1).trim();
                headers[key] = value;
            }
        }
        return {
            location: headers['location'] || '',
            usn: headers['usn'] || '',
            st: headers['st'] || '',
        };
    }
    catch {
        return null;
    }
};
/**
 * 从服务列表中查找 ContentDirectory 的 controlURL
 */
const findServiceControlUrl = (services, serviceTypeSuffix) => {
    for (const svc of services) {
        const st = svc?.serviceType;
        if (st && String(st).toLowerCase().includes(serviceTypeSuffix.toLowerCase())) {
            const url = svc.controlURL;
            if (url)
                return String(url);
        }
    }
    return null;
};
/**
 * 查找最佳图标 URL
 */
const findBestIcon = (icons, deviceLocation) => {
    let bestIcon = null;
    for (const icon of icons) {
        const url = icon?.url ? String(icon.url) : '';
        const width = parseInt(String(icon?.width ?? '0'), 10);
        const mimetype = icon?.mimetype ? String(icon.mimetype) : '';
        if (url && (mimetype.includes('png') || mimetype.includes('jpeg') || mimetype.includes('jpg'))) {
            if (!bestIcon || (width >= 24 && width <= 120 && (bestIcon.width < 24 || bestIcon.width > 120 || width > bestIcon.width))) {
                bestIcon = { url: resolveUrl(deviceLocation, url), width };
            }
        }
    }
    return bestIcon?.url || null;
};
/**
 * 解析相对 URL
 */
const resolveUrl = (baseUrl, relativeUrl) => {
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
        return relativeUrl;
    }
    try {
        const base = new node_url_1.URL(baseUrl);
        if (relativeUrl.startsWith('/')) {
            return `${base.protocol}//${base.host}${relativeUrl}`;
        }
        const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
        return `${base.protocol}//${base.host}${basePath}${relativeUrl}`;
    }
    catch {
        return relativeUrl;
    }
};
/**
 * 从 res 列表中选择最佳媒体资源
 * 优先选择无损音频格式，其次视频格式
 */
const findBestRes = (resList) => {
    if (resList.length === 0)
        return null;
    if (resList.length === 1)
        return resList[0];
    const priority = [
        'audio/flac', 'audio/x-flac', 'audio/wav', 'audio/x-wav',
        'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/ogg',
        'video/mp4', 'video/x-matroska', 'video/avi', 'video/x-msvideo',
        'video/mpeg', 'video/x-flv', 'video/quicktime',
    ];
    let best = null;
    let bestPriority = 999;
    for (const res of resList) {
        const protocolInfo = String(res?.['@_protocolInfo'] ?? '');
        if (!protocolInfo.startsWith('http-get'))
            continue;
        for (let i = 0; i < priority.length; i++) {
            if (protocolInfo.includes(priority[i]) && i < bestPriority) {
                bestPriority = i;
                best = res;
                break;
            }
        }
    }
    // fallback: 任何 http-get 开头的 res（不再仅限 audio）
    return best || resList.find(r => String(r?.['@_protocolInfo'] ?? '').startsWith('http-get')) || resList[0];
};
/**
 * 从 protocolInfo 提取格式名称
 * e.g. "http-get:*:audio/flac:*" → "FLAC"
 */
const extractFormat = (protocolInfo) => {
    const parts = protocolInfo.split(':');
    if (parts.length >= 3) {
        const mime = parts[2]; // e.g. "audio/flac"
        const subtype = mime.split('/')[1] || '';
        const formatMap = {
            'flac': 'FLAC',
            'x-flac': 'FLAC',
            'mpeg': 'MP3',
            'mp3': 'MP3',
            'wav': 'WAV',
            'x-wav': 'WAV',
            'aac': 'AAC',
            'mp4': 'MP4',
            'ogg': 'OGG',
            'vorbis': 'OGG',
            'wma': 'WMA',
            'alac': 'ALAC',
            'aiff': 'AIFF',
            'dsd': 'DSD',
            'x-matroska': 'MKV',
            'avi': 'AVI',
            'x-msvideo': 'AVI',
            'x-flv': 'FLV',
            'quicktime': 'MOV',
        };
        return formatMap[subtype.toLowerCase()] || subtype.toUpperCase();
    }
    return '';
};
/**
 * 提取专辑封面 URI
 */
const extractAlbumArt = (obj) => {
    // upnp:albumArtURI
    const artUri = obj?.albumArtURI;
    if (artUri) {
        if (Array.isArray(artUri))
            return String(artUri[0]?.['#text'] ?? artUri[0] ?? '');
        return String(artUri?.['#text'] ?? artUri ?? '');
    }
    return undefined;
};
/**
 * 确保值为数组
 */
const ensureArray = (val) => {
    if (!val)
        return [];
    return Array.isArray(val) ? val : [val];
};
/**
 * XML 转义
 */
const escapeXml = (str) => {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
};
