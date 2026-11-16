"use strict";
/**
 * UPNP/DLNA Media Renderer Discovery & Control
 *
 * Uses SSDP (Simple Service Discovery Protocol) to find MediaRenderer devices,
 * then controls them via UPNP AVTransport and RenderingControl SOAP actions.
 *
 * Uses Node.js built-in dgram and http modules, with fast-xml-parser for XML parsing.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.secondsToTime = exports.timeToSeconds = exports.supportsAction = exports.queryServiceActions = exports.getDeviceWithRefresh = exports.getDevice = exports.getCachedDevices = exports.getActiveCastState = exports.getActiveDeviceId = exports.setActiveDevice = exports.buildSongDIDL = exports.getVolume = exports.setVolume = exports.getMediaInfo = exports.previousTrack = exports.nextTrack = exports.setNextAVTransportURI = exports.getPositionInfo = exports.getTransportInfo = exports.seek = exports.stop = exports.pause = exports.play = exports.setAVTransportURI = exports.SoapFaultError = exports.extractXmlValue = exports.scanDevices = void 0;
const node_dgram_1 = __importDefault(require("node:dgram"));
const node_http_1 = __importDefault(require("node:http"));
const node_url_1 = require("node:url");
const fast_xml_parser_1 = require("fast-xml-parser");
const dlnaProfile_1 = require("./dlnaProfile");
// ==================== XML Parser ====================
const xmlParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) => ['service', 'icon'].includes(name),
});
// ==================== Constants ====================
const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SSDP_MX = 3; // Maximum wait time in seconds
const MEDIA_RENDERER_ST = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const AV_TRANSPORT_ST = 'urn:schemas-upnp-org:service:AVTransport';
const RENDERING_CONTROL_ST = 'urn:schemas-upnp-org:service:RenderingControl';
// Device cache & expiry
const deviceMap = new Map();
const deviceExpiry = new Map();
const DEVICE_TTL = 5 * 60 * 1000; // 5 minutes
// Active device tracking - active devices never expire
let activeDeviceId = null;
let activeDeviceName = '';
let activeCastType = ''; // 'upnp' or 'local'
// ==================== SSDP Discovery ====================
/**
 * Build a SSDP M-SEARCH message for a given search target
 */
const buildSearchMessage = (st) => {
    const msg = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        `MX: ${SSDP_MX}`,
        `ST: ${st}`,
        '',
        '',
    ].join('\r\n');
    return Buffer.from(msg);
};
/**
 * Send one round of SSDP M-SEARCH messages (MediaRenderer + AVTransport + retry)
 * UDP multicast is unreliable, so multiple rounds improve discovery reliability.
 */
const sendSearchRound = (socket) => {
    const mrBuf = buildSearchMessage(MEDIA_RENDERER_ST);
    try {
        socket.send(mrBuf, 0, mrBuf.length, SSDP_PORT, SSDP_ADDR);
    }
    catch (e) { /* socket may be closed */ }
    setTimeout(() => {
        const avBuf = buildSearchMessage(AV_TRANSPORT_ST);
        try {
            socket.send(avBuf, 0, avBuf.length, SSDP_PORT, SSDP_ADDR);
        }
        catch (e) { /* socket may be closed */ }
    }, 300);
    setTimeout(() => {
        try {
            socket.send(mrBuf, 0, mrBuf.length, SSDP_PORT, SSDP_ADDR);
        }
        catch (e) { /* socket may be closed */ }
    }, 500);
};
/**
 * Send SSDP M-SEARCH and collect responses.
 * Sends 3 rounds of M-SEARCH to improve reliability over UDP multicast.
 */
const scanDevices = () => {
    return new Promise((resolve) => {
        const socket = node_dgram_1.default.createSocket('udp4');
        const responses = [];
        const seenLocations = new Set();
        let resolved = false;
        const finishScan = () => {
            if (resolved)
                return;
            resolved = true;
            socket.close();
            // Process discovered devices
            const devicePromises = responses.map(r => fetchDeviceDescription(r.location, r.usn));
            Promise.allSettled(devicePromises).then((results) => {
                const devices = [];
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value) {
                        const device = result.value;
                        deviceMap.set(device.id, device);
                        deviceExpiry.set(device.id, Date.now() + DEVICE_TTL);
                        devices.push(device);
                    }
                }
                // Also include previously discovered devices that haven't expired
                const now = Date.now();
                for (const [id, device] of deviceMap) {
                    if (!devices.some(d => d.id === id)) {
                        const expiry = deviceExpiry.get(id) || 0;
                        if (expiry > now) {
                            devices.push(device);
                        }
                        else {
                            deviceMap.delete(id);
                            deviceExpiry.delete(id);
                        }
                    }
                }
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
            console.warn('[UPNP] SSDP error:', err.message);
        });
        socket.bind(() => {
            socket.setBroadcast(true);
            socket.addMembership(SSDP_ADDR);
            // Send 3 rounds of M-SEARCH at t=0, t=1.5s, t=3s
            // Multiple rounds mitigate UDP multicast packet loss
            sendSearchRound(socket);
            setTimeout(() => sendSearchRound(socket), 1500);
            setTimeout(() => sendSearchRound(socket), 3000);
        });
        // Hard timeout: 6 seconds (MX + 3) to cover all 3 rounds
        setTimeout(finishScan, (SSDP_MX + 3) * 1000);
    });
};
exports.scanDevices = scanDevices;
/**
 * Parse an SSDP response message
 */
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
            cacheControl: headers['cache-control'] || '',
        };
    }
    catch {
        return null;
    }
};
/**
 * Fetch and parse a UPNP device description XML
 */
const fetchDeviceDescription = (location, usn) => {
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
                    const device = parseDeviceDescription(data, location, usn);
                    resolve(device);
                }
                catch (err) {
                    console.warn(`[UPNP] Failed to parse device description from ${location}:`, err.message);
                    resolve(null);
                }
            });
        });
        req.on('error', (err) => {
            console.warn('[UPNP] Fetch device failed:', err.message);
            resolve(null);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
};
/**
 * Parse a UPNP device description XML (simple regex-based parser, no xml dependency)
 */
const parseDeviceDescription = (xml, location, usn) => {
    let parsed;
    try {
        parsed = xmlParser.parse(xml);
    }
    catch (err) {
        console.warn('[UPNP] XML parse failed:', err.message);
        return null;
    }
    const device = parsed?.root?.device;
    if (!device)
        return null;
    const friendlyName = device.friendlyName ?? 'Unknown Device';
    const modelName = device.modelName ?? '';
    const manufacturer = device.manufacturer ?? '';
    const specVersion = device.specVersion;
    const specMajor = specVersion?.major ?? '0';
    const specMinor = specVersion?.minor ?? '0';
    const upnpVersion = `${specMajor}.${specMinor}`;
    const deviceType = device.deviceType ?? '';
    const deviceTypeMatch = deviceType.match(/:(\d+\.\d+)$/);
    const dlnaVersion = deviceTypeMatch ? deviceTypeMatch[1] : undefined;
    const serviceList = Array.isArray(device.serviceList?.service)
        ? device.serviceList.service
        : device.serviceList?.service ? [device.serviceList.service] : [];
    const avTransportUrl = findServiceUrl(serviceList, AV_TRANSPORT_ST, 'controlURL');
    const renderingControlUrl = findServiceUrl(serviceList, RENDERING_CONTROL_ST, 'controlURL');
    const avTransportEventUrl = findServiceUrl(serviceList, AV_TRANSPORT_ST, 'eventSubURL');
    const renderingControlEventUrl = findServiceUrl(serviceList, RENDERING_CONTROL_ST, 'eventSubURL');
    const avTransportScpdUrl = findServiceUrl(serviceList, AV_TRANSPORT_ST, 'SCPDURL');
    if (!avTransportUrl)
        return null;
    const iconList = Array.isArray(device.iconList?.icon)
        ? device.iconList.icon
        : device.iconList?.icon ? [device.iconList.icon] : [];
    const iconUrl = findBestIcon(iconList, location);
    const uuidMatch = usn.match(/uuid:([a-fA-F0-9-]+)/);
    const deviceId = uuidMatch ? `uuid:${uuidMatch[1]}` : usn;
    // 自动识别设备 Profile（DMP-A6 / HQPlayer / Yamaha / DietPi / GENERIC）
    const profile = (0, dlnaProfile_1.detectDeviceProfile)(String(friendlyName), manufacturer ? String(manufacturer) : '', modelName ? String(modelName) : '');
    if (profile.type !== 'GENERIC') {
        console.log(`[UPNP] 设备 "${friendlyName}" 识别为 Profile: ${profile.type}`);
    }
    return {
        id: deviceId,
        name: String(friendlyName),
        location,
        avTransportUrl: resolveUrl(location, avTransportUrl),
        renderingControlUrl: renderingControlUrl ? resolveUrl(location, renderingControlUrl) : '',
        avTransportEventUrl: avTransportEventUrl ? resolveUrl(location, avTransportEventUrl) : '',
        renderingControlEventUrl: renderingControlEventUrl ? resolveUrl(location, renderingControlEventUrl) : '',
        iconUrl: iconUrl || undefined,
        model: modelName ? String(modelName) : undefined,
        manufacturer: manufacturer ? String(manufacturer) : undefined,
        upnpVersion: upnpVersion !== '0.0' ? upnpVersion : undefined,
        dlnaVersion,
        avTransportScpdUrl: avTransportScpdUrl ? resolveUrl(location, avTransportScpdUrl) : undefined,
        profile,
    };
};
/**
 * Recursively find a value in a parsed XML object by tag name (BFS)
 * Exported for reuse by dlnaGena.ts
 */
const extractXmlValue = (xml, tagName) => {
    try {
        const parsed = xmlParser.parse(xml);
        return findValueInObj(parsed, tagName);
    }
    catch {
        return null;
    }
};
exports.extractXmlValue = extractXmlValue;
/**
 * BFS search for a value by key name in a nested object
 */
const findValueInObj = (obj, tagName) => {
    if (obj == null || typeof obj !== 'object')
        return null;
    const tagLower = tagName.toLowerCase();
    const queue = [obj];
    while (queue.length > 0) {
        const current = queue.shift();
        if (current == null || typeof current !== 'object')
            continue;
        for (const key of Object.keys(current)) {
            if (key.toLowerCase() === tagLower) {
                const val = current[key];
                if (typeof val === 'string' || typeof val === 'number')
                    return String(val).trim();
            }
            if (typeof current[key] === 'object')
                queue.push(current[key]);
        }
    }
    return null;
};
/**
 * Find a service URL (controlURL or eventSubURL) from parsed service list
 */
const findServiceUrl = (services, serviceType, urlField) => {
    const typeSuffix = serviceType.split(':').pop().toLowerCase();
    for (const svc of services) {
        const st = svc?.serviceType;
        if (st && String(st).toLowerCase().includes(typeSuffix)) {
            const url = svc[urlField];
            if (url)
                return String(url);
        }
    }
    return null;
};
/**
 * Find the best icon URL from parsed icon list
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
 * Resolve a relative URL against a base URL
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
// ==================== SOAP Fault Error ====================
/**
 * Structured SOAP Fault error with UPNP error code and description
 */
class SoapFaultError extends Error {
    constructor(actionName, errorCode, errorDescription) {
        super(`SOAP action ${actionName} failed: [${errorCode}] ${errorDescription}`);
        this.name = 'SoapFaultError';
        this.errorCode = errorCode;
        this.errorDescription = errorDescription;
    }
}
exports.SoapFaultError = SoapFaultError;
/**
 * Parse a SOAP Fault response body and extract structured error info.
 * Returns null if the body is not a valid SOAP Fault.
 */
const parseSoapFault = (xml) => {
    try {
        const parsed = xmlParser.parse(xml);
        const body = parsed?.Envelope?.Body;
        if (!body)
            return null;
        // Standard UPNP fault: Body > Fault > detail > UPnPError
        const fault = body.Fault;
        if (!fault)
            return null;
        const detail = fault.detail;
        if (detail && typeof detail === 'object') {
            const upnpError = detail.UPnPError || detail.UPnPerror || detail.upnperror;
            if (upnpError) {
                return {
                    errorCode: String(upnpError.errorCode ?? upnpError.ErrorCode ?? '0'),
                    errorDescription: String(upnpError.errorDescription ?? upnpError.ErrorDescription ?? fault.faultstring ?? 'Unknown error'),
                };
            }
        }
        // Fallback: extract from faultstring
        const faultstring = String(fault.faultstring ?? '');
        const codeMatch = faultstring.match(/error\s*code[:\s]*(\d+)/i);
        return {
            errorCode: codeMatch ? codeMatch[1] : '0',
            errorDescription: faultstring || 'Unknown SOAP Fault',
        };
    }
    catch {
        return null;
    }
};
// ==================== UPNP SOAP Control ====================
/** 可重试的网络错误码 */
const RETRYABLE_NETWORK_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'];
/**
 * 发送单次 SOAP 请求（内部函数，不带重试）
 */
const sendSoapActionOnce = (controlUrl, serviceType, actionName, args = {}, timeout = 3000) => {
    return new Promise((resolve, reject) => {
        const url = new node_url_1.URL(controlUrl);
        // Build SOAP body
        const argsXml = Object.entries(args)
            .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
            .join('');
        const soapBody = [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
            '  <s:Body>',
            `    <u:${actionName} xmlns:u="${serviceType}">`,
            `      ${argsXml}`,
            `    </u:${actionName}>`,
            '  </s:Body>',
            '</s:Envelope>',
        ].join('\r\n');
        const req = node_http_1.default.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'Content-Length': Buffer.byteLength(soapBody),
                'SOAPAction': `"${serviceType}#${actionName}"`,
                'Connection': 'close',
            },
            timeout,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                }
                else if (res.statusCode === 500) {
                    const isSoapFault = data.includes('<s:Fault') || data.includes('<Fault') || data.includes('<faultcode') || data.includes('<faultstring');
                    if (!isSoapFault || data.length < 50) {
                        resolve(data);
                    }
                    else {
                        const faultInfo = parseSoapFault(data);
                        console.error(`[UPNP] SOAP action ${actionName} failed:`, {
                            controlUrl,
                            serviceType,
                            actionName,
                            statusCode: res.statusCode,
                            errorCode: faultInfo?.errorCode,
                            errorDescription: faultInfo?.errorDescription,
                            responseBody: data.substring(0, 1000),
                            requestBody: soapBody,
                        });
                        if (faultInfo) {
                            reject(new SoapFaultError(actionName, faultInfo.errorCode, faultInfo.errorDescription));
                        }
                        else {
                            reject(new Error(`SOAP action ${actionName} failed: HTTP 500 - ${data.substring(0, 500)}`));
                        }
                    }
                }
                else {
                    console.error(`[UPNP] SOAP action ${actionName} failed:`, {
                        controlUrl,
                        serviceType,
                        actionName,
                        statusCode: res.statusCode,
                        responseBody: data.substring(0, 1000),
                        requestBody: soapBody,
                    });
                    reject(new Error(`SOAP action ${actionName} failed: HTTP ${res.statusCode} - ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', (err) => {
            console.error(`[UPNP] SOAP action ${actionName} network error:`, {
                controlUrl,
                serviceType,
                actionName,
                error: err.message,
            });
            reject(err);
        });
        req.on('timeout', () => {
            req.destroy();
            console.error(`[UPNP] SOAP action ${actionName} timed out:`, {
                controlUrl,
                serviceType,
                actionName,
                timeout,
            });
            reject(new Error(`SOAP action ${actionName} timed out`));
        });
        req.write(soapBody);
        req.end();
    });
};
/**
 * 发送 SOAP 动作（带设备 Profile 感知超时与网络错误重试）
 *
 * 从 device.profile 读取 httpTimeout 和 maxRetry 配置。
 * ECONNRESET / ETIMEDOUT / ECONNREFUSED / EPIPE 等网络错误指数退避重试；
 * SOAP Fault（真正 500）不重试。
 */
const sendSoapAction = async (controlUrl, serviceType, actionName, args = {}, device) => {
    const profile = device?.profile;
    const timeout = profile?.httpTimeout ?? 3000;
    const maxRetry = profile?.maxRetry ?? 2;
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
        try {
            return await sendSoapActionOnce(controlUrl, serviceType, actionName, args, timeout);
        }
        catch (err) {
            const isNetworkError = RETRYABLE_NETWORK_ERRORS.includes(err.code);
            if (!isNetworkError || attempt >= maxRetry)
                throw err;
            const delay = (attempt + 1) * 300;
            console.warn(`[UPNP] SOAP ${actionName} 网络错误(${err.code}), ${delay}ms 后重试 (${attempt + 1}/${maxRetry})`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error(`SOAP action ${actionName} failed after retries`);
};
/**
 * Escape special XML characters
 */
const escapeXml = (str) => {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
};
/**
 * Extract a value from SOAP response XML using structured parsing
 */
const extractSoapValue = (xml, tagName) => {
    try {
        const parsed = xmlParser.parse(xml);
        // SOAP response: Envelope > Body > *Response > fields
        const body = parsed?.Envelope?.Body;
        if (!body || typeof body !== 'object')
            return null;
        // Iterate through response action elements to find the target tag
        for (const key of Object.keys(body)) {
            if (typeof body[key] === 'object' && body[key] !== null) {
                const val = findValueInObj(body[key], tagName);
                if (val !== null)
                    return val;
            }
        }
        return null;
    }
    catch {
        return null;
    }
};
// ==================== AVTransport Actions ====================
const AV_TRANSPORT_TYPE = 'urn:schemas-upnp-org:service:AVTransport:1';
const RENDERING_CONTROL_TYPE = 'urn:schemas-upnp-org:service:RenderingControl:1';
/**
 * Set the AV Transport URI (load a media URL for playback)
 */
const setAVTransportURI = async (device, mediaUrl, metadata) => {
    // Allow explicit empty string metadata (no DIDL), vs undefined (use default)
    const didl = metadata !== undefined ? metadata : buildDefaultDIDL(mediaUrl);
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'SetAVTransportURI', {
        InstanceID: '0',
        CurrentURI: mediaUrl,
        CurrentURIMetaData: didl,
    }, device);
};
exports.setAVTransportURI = setAVTransportURI;
/**
 * Start playback
 */
const play = async (device) => {
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'Play', {
        InstanceID: '0',
        Speed: '1',
    }, device);
};
exports.play = play;
/**
 * Pause playback
 */
const pause = async (device) => {
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'Pause', {
        InstanceID: '0',
    }, device);
};
exports.pause = pause;
/**
 * Stop playback
 */
const stop = async (device) => {
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'Stop', {
        InstanceID: '0',
    }, device);
};
exports.stop = stop;
/**
 * Seek to a specific position
 */
const seek = async (device, position) => {
    // position format: "HH:MM:SS" or "HH:MM:SS.fraction"
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'Seek', {
        InstanceID: '0',
        Unit: 'REL_TIME',
        Target: position,
    }, device);
};
exports.seek = seek;
/**
 * Get transport info (play state)
 */
const getTransportInfo = async (device) => {
    const response = await sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'GetTransportInfo', {
        InstanceID: '0',
    }, device);
    return {
        currentTransportState: extractSoapValue(response, 'CurrentTransportState') || 'NO_MEDIA_PRESENT',
        currentTransportStatus: extractSoapValue(response, 'CurrentTransportStatus') || 'OK',
        currentSpeed: extractSoapValue(response, 'CurrentSpeed') || '1',
    };
};
exports.getTransportInfo = getTransportInfo;
/**
 * Get position info (current time, duration, etc.)
 */
const getPositionInfo = async (device) => {
    const response = await sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'GetPositionInfo', {
        InstanceID: '0',
    }, device);
    return {
        track: extractSoapValue(response, 'Track') || '0',
        trackDuration: extractSoapValue(response, 'TrackDuration') || '00:00:00',
        trackMetaData: extractSoapValue(response, 'TrackMetaData') || '',
        trackURI: extractSoapValue(response, 'TrackURI') || '',
        relTime: extractSoapValue(response, 'RelTime') || '00:00:00',
        absTime: extractSoapValue(response, 'AbsTime') || '00:00:00',
    };
};
exports.getPositionInfo = getPositionInfo;
/**
 * Set the Next AV Transport URI (preload next track for seamless transition)
 */
const setNextAVTransportURI = async (device, mediaUrl, metadata) => {
    // Allow explicit empty string metadata (no DIDL), vs undefined (use default)
    const didl = metadata !== undefined ? metadata : buildDefaultDIDL(mediaUrl);
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'SetNextAVTransportURI', {
        InstanceID: '0',
        NextURI: mediaUrl,
        NextURIMetaData: didl,
    }, device);
};
exports.setNextAVTransportURI = setNextAVTransportURI;
/**
 * Skip to the next track (AVTransport Next action)
 */
const nextTrack = async (device) => {
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'Next', {
        InstanceID: '0',
    }, device);
};
exports.nextTrack = nextTrack;
/**
 * Go to the previous track (AVTransport Previous action)
 */
const previousTrack = async (device) => {
    return sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'Previous', {
        InstanceID: '0',
    }, device);
};
exports.previousTrack = previousTrack;
/**
 * Get media info (current URI, metadata)
 */
const getMediaInfo = async (device) => {
    const response = await sendSoapAction(device.avTransportUrl, AV_TRANSPORT_TYPE, 'GetMediaInfo', {
        InstanceID: '0',
    }, device);
    return {
        nrTracks: extractSoapValue(response, 'NrTracks') || '0',
        mediaDuration: extractSoapValue(response, 'MediaDuration') || '00:00:00',
        currentURI: extractSoapValue(response, 'CurrentURI') || '',
        currentURIMetaData: extractSoapValue(response, 'CurrentURIMetaData') || '',
        nextURI: extractSoapValue(response, 'NextURI') || '',
        nextURIMetaData: extractSoapValue(response, 'NextURIMetaData') || '',
    };
};
exports.getMediaInfo = getMediaInfo;
// ==================== RenderingControl Actions ====================
/**
 * Set volume (0-100)
 */
const setVolume = async (device, volume) => {
    return sendSoapAction(device.renderingControlUrl, RENDERING_CONTROL_TYPE, 'SetVolume', {
        InstanceID: '0',
        Channel: 'Master',
        DesiredVolume: String(Math.max(0, Math.min(100, Math.round(volume)))),
    }, device);
};
exports.setVolume = setVolume;
/**
 * Get volume (0-100)
 */
const getVolume = async (device) => {
    try {
        const response = await sendSoapAction(device.renderingControlUrl, RENDERING_CONTROL_TYPE, 'GetVolume', {
            InstanceID: '0',
            Channel: 'Master',
        }, device);
        const vol = extractSoapValue(response, 'CurrentVolume');
        return vol ? parseInt(vol, 10) : -1;
    }
    catch {
        return -1;
    }
};
exports.getVolume = getVolume;
// ==================== Helper: Build DIDL-Lite Metadata ====================
/** 检测 URL 是否为 HLS 流 */
const isHlsUrl = (url) => /\.m3u8(\?|$)/i.test(url);
/** URL extension -> MIME type mapping */
const MIME_MAP = {
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.ape': 'audio/x-ape',
    '.mp3': 'audio/mpeg',
    '.m3u8': 'application/vnd.apple.mpegurl',
};
/** Infer MIME type from URL path extension */
const inferMimeType = (url) => {
    try {
        const pathname = new node_url_1.URL(url).pathname;
        const dotIdx = pathname.lastIndexOf('.');
        if (dotIdx >= 0) {
            const ext = pathname.substring(dotIdx).toLowerCase();
            if (MIME_MAP[ext])
                return MIME_MAP[ext];
        }
    }
    catch { /* ignore */ }
    return 'audio/mpeg'; // safe default
};
/** Build DLNA protocol info string from MIME type */
const buildProtocolInfo = (mimeType) => {
    if (mimeType === 'audio/flac') {
        return 'DLNA.ORG_PN=FLAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    }
    if (mimeType === 'audio/mp4' || mimeType === 'audio/aac') {
        return 'DLNA.ORG_PN=AAC_ISO_320;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    }
    if (mimeType === 'audio/wav') {
        return 'DLNA.ORG_PN=LPCM;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    }
    return 'DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
};
/** 根据 URL 类型生成音频 res 元素的 protocolInfo 和 MIME */
const buildAudioResProtocolInfo = (mediaUrl, mimeTypeHint) => {
    if (isHlsUrl(mediaUrl)) {
        return { mimeType: 'application/vnd.apple.mpegurl', dlnaPn: '*' };
    }
    const mimeType = mimeTypeHint || inferMimeType(mediaUrl);
    return { mimeType, dlnaPn: buildProtocolInfo(mimeType) };
};
/**
 * Build a minimal DIDL-Lite metadata string for audio playback
 */
const buildDefaultDIDL = (mediaUrl, mimeTypeHint) => {
    const escapedUrl = escapeXml(mediaUrl);
    const { mimeType, dlnaPn } = buildAudioResProtocolInfo(mediaUrl, mimeTypeHint);
    return [
        '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">',
        '  <item id="0" parentID="-1" restricted="1">',
        `    <dc:title>Music</dc:title>`,
        `    <upnp:class>object.item.audioItem.musicTrack</upnp:class>`,
        `    <res protocolInfo="http-get:*:${mimeType}:${dlnaPn}">${escapedUrl}</res>`,
        '  </item>',
        '</DIDL-Lite>',
    ].join('');
};
/**
 * Build DIDL-Lite metadata with song details
 * @param durationSec 歌曲时长（秒），用于在 <res> 元素上输出 duration 属性，帮助 DMR 正确显示时长
 */
const buildSongDIDL = (mediaUrl, title, artist, album, albumArtUrl, mimeTypeHint, durationSec) => {
    const escapedUrl = escapeXml(mediaUrl);
    const escapedTitle = escapeXml(title || 'Music');
    const escapedArtist = escapeXml(artist || '');
    const escapedAlbum = escapeXml(album || '');
    const { mimeType, dlnaPn } = buildAudioResProtocolInfo(mediaUrl, mimeTypeHint);
    let albumArtTags = '';
    if (albumArtUrl) {
        const escapedArtUrl = escapeXml(albumArtUrl);
        albumArtTags = `<upnp:albumArtURI>${escapedArtUrl}</upnp:albumArtURI>`;
        albumArtTags += `<res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_SM;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00f00000000000000000000000000000">${escapedArtUrl}</res>`;
    }
    // duration 属性：帮助 DMR 正确显示时长，避免某些设备自行探测失败显示垃圾值
    const durationAttr = durationSec && durationSec > 0 ? ` duration="${(0, exports.secondsToTime)(durationSec)}"` : '';
    return [
        '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">',
        '  <item id="0" parentID="-1" restricted="1">',
        `    <dc:title>${escapedTitle}</dc:title>`,
        `    <upnp:class>object.item.audioItem.musicTrack</upnp:class>`,
        `    <upnp:artist>${escapedArtist}</upnp:artist>`,
        `    <upnp:album>${escapedAlbum}</upnp:album>`,
        albumArtTags,
        `    <res protocolInfo="http-get:*:${mimeType}:${dlnaPn}"${durationAttr}>${escapedUrl}</res>`,
        '  </item>',
        '</DIDL-Lite>',
    ].join('');
};
exports.buildSongDIDL = buildSongDIDL;
// ==================== Device Management ====================
const setActiveDevice = (deviceId, deviceName, castType) => {
    activeDeviceId = deviceId;
    activeDeviceName = deviceName || '';
    activeCastType = castType || '';
    // If setting an active device, ensure it stays in cache with extended TTL
    if (deviceId && deviceMap.has(deviceId)) {
        deviceExpiry.set(deviceId, Date.now() + DEVICE_TTL);
    }
};
exports.setActiveDevice = setActiveDevice;
/**
 * Get the active device ID
 */
const getActiveDeviceId = () => {
    return activeDeviceId;
};
exports.getActiveDeviceId = getActiveDeviceId;
/**
 * Get the active cast state (deviceId, deviceName, castType)
 */
const getActiveCastState = () => {
    return { deviceId: activeDeviceId, deviceName: activeDeviceName, castType: activeCastType };
};
exports.getActiveCastState = getActiveCastState;
/**
 * Try to refresh an expired device by re-fetching its description from its location URL.
 * Returns the refreshed device, or null if refresh failed.
 */
const refreshExpiredDevice = async (deviceId) => {
    const device = deviceMap.get(deviceId);
    if (!device || !device.location)
        return null;
    try {
        const refreshedDevice = await fetchDeviceDescription(device.location, device.id);
        if (refreshedDevice) {
            deviceMap.set(refreshedDevice.id, refreshedDevice);
            deviceExpiry.set(refreshedDevice.id, Date.now() + DEVICE_TTL);
            return refreshedDevice;
        }
    }
    catch (err) {
        console.warn('[UPNP] Auto-refresh failed:', err.message);
    }
    return null;
};
/**
 * Get all cached devices (including expired ones that haven't been cleaned)
 */
const getCachedDevices = () => {
    const now = Date.now();
    const activeDevices = [];
    for (const [id, device] of deviceMap) {
        const expiry = deviceExpiry.get(id) || 0;
        if (expiry > now || id === activeDeviceId) {
            activeDevices.push(device);
        }
        else {
            deviceMap.delete(id);
            deviceExpiry.delete(id);
        }
    }
    return activeDevices;
};
exports.getCachedDevices = getCachedDevices;
/**
 * Get a specific device by ID.
 * - If device is active (currently playing), it never expires.
 * - If device is expired, attempts auto-refresh from its location URL.
 * - Renews TTL on successful access to keep frequently-used devices alive.
 */
const getDevice = (deviceId) => {
    const now = Date.now();
    const device = deviceMap.get(deviceId);
    if (!device)
        return undefined;
    const expiry = deviceExpiry.get(deviceId) || 0;
    // Active device never expires - always return it and renew TTL
    if (deviceId === activeDeviceId) {
        deviceExpiry.set(deviceId, now + DEVICE_TTL);
        return device;
    }
    if (expiry > now) {
        // Device is still valid - renew TTL on access to keep it alive
        deviceExpiry.set(deviceId, now + DEVICE_TTL);
        return device;
    }
    // Device is expired
    deviceExpiry.set(deviceId, now + DEVICE_TTL);
    return device;
};
exports.getDevice = getDevice;
/**
 * Get a device by ID, with auto-refresh if expired.
 * If the device is expired, attempts to re-fetch its description from the network.
 * Returns undefined only if the device was never discovered or refresh fails AND the device is not in cache.
 */
const getDeviceWithRefresh = async (deviceId) => {
    const now = Date.now();
    const device = deviceMap.get(deviceId);
    if (!device)
        return undefined;
    const expiry = deviceExpiry.get(deviceId) || 0;
    // Active device never expires
    if (deviceId === activeDeviceId) {
        deviceExpiry.set(deviceId, now + DEVICE_TTL);
        return device;
    }
    if (expiry > now) {
        // Device is still valid - renew TTL on access
        deviceExpiry.set(deviceId, now + DEVICE_TTL);
        return device;
    }
    // Device is expired - try to auto-refresh
    const refreshed = await refreshExpiredDevice(deviceId);
    if (refreshed)
        return refreshed;
    // Refresh failed but device is still in cache
    deviceExpiry.set(deviceId, now + DEVICE_TTL);
    return device;
};
exports.getDeviceWithRefresh = getDeviceWithRefresh;
// ==================== Service Description Introspection ====================
/**
 * Query the AVTransport SCPD (Service Control Protocol Definition) from a device
 * and populate `device.supportedActions` with the list of action names.
 * This allows checking if optional actions like SetNextAVTransportURI are supported
 * before calling them.
 */
const queryServiceActions = async (device) => {
    if (!device.avTransportScpdUrl) {
        return [];
    }
    return new Promise((resolve) => {
        const url = new node_url_1.URL(device.avTransportScpdUrl);
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
                    const parsed = xmlParser.parse(data);
                    const actionList = parsed?.scpd?.actionList?.action;
                    if (!actionList) {
                        resolve([]);
                        return;
                    }
                    const actions = Array.isArray(actionList) ? actionList : [actionList];
                    const names = [];
                    for (const action of actions) {
                        if (action?.name) {
                            names.push(String(action.name));
                        }
                    }
                    device.supportedActions = names;
                    console.log(`[UPNP] Device "${device.name}" AVTransport actions:`, names.join(', '));
                    resolve(names);
                }
                catch (err) {
                    console.warn(`[UPNP] Failed to parse SCPD from ${device.avTransportScpdUrl}:`, err.message);
                    resolve([]);
                }
            });
        });
        req.on('error', (err) => {
            console.warn(`[UPNP] SCPD fetch failed for ${device.avTransportScpdUrl}:`, err.message);
            resolve([]);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve([]);
        });
    });
};
exports.queryServiceActions = queryServiceActions;
/**
 * Check if a device supports a specific AVTransport action.
 * Returns true if supportedActions is not populated (assume supported) or if the action is in the list.
 */
const supportsAction = (device, actionName) => {
    if (!device.supportedActions)
        return true; // not queried yet, assume supported
    return device.supportedActions.includes(actionName);
};
exports.supportsAction = supportsAction;
/**
 * Convert time string "HH:MM:SS" to seconds
 */
const timeToSeconds = (timeStr) => {
    if (!timeStr || timeStr === 'NOT_IMPLEMENTED' || timeStr === '00:00:00')
        return 0;
    const parts = timeStr.split(':');
    if (parts.length !== 3)
        return 0;
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
};
exports.timeToSeconds = timeToSeconds;
/**
 * Convert seconds to "HH:MM:SS" time string
 */
const secondsToTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0)
        return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
exports.secondsToTime = secondsToTime;
