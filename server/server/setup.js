"use strict";
/**
 * 首次部署初始化向导（TT-Music 本地补丁）
 *
 * 判定「未初始化」= global.lx.config['frontend.password'] 为空：
 *   - 镜像内 /server/config.js（config.clean.js）在没有 FRONTEND_PASSWORD 时给出空密码 → 触发向导
 *   - 用户在 .env 里预设了 FRONTEND_PASSWORD → 视为已初始化，跳过向导（兼容旧部署方式）
 *   - 向导把密码写回 CONFIG_PATH（/server/data/config.js），重启后 margeConfig 会加载回来，不会重复引导
 *
 * 未初始化期间：除 /setup 与 /api/setup/* 外，所有请求一律拦截，
 * 避免任何人在没有管理员密码的状态下访问后台、API 或播放器。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSetup = void 0;

// 只依赖 Node 内置模块：守卫位于请求入口最前面，不应把整套业务依赖拉进来
const fs = require('node:fs');
const path = require('node:path');

const SETUP_PATH = '/setup';
const STATUS_API = '/api/setup/status';
const INIT_API = '/api/setup/init';
const ADMIN_ENTRY = '/admin';

const WEAK_PASSWORDS = new Set([
    '12345678', '123456789', '1234567890', '11111111', '00000000',
    'password', 'password1', 'passw0rd', 'admin123', 'admin1234',
    'qwerty123', 'abc12345', 'iloveyou', 'letmein1', 'welcome1',
]);

let initializing = false;
const rateLimit = new Map();

const sendJson = (res, code, data) => {
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
};

const isSetupRequired = () => !String(global.lx.config['frontend.password'] ?? '');

/** 与 server/utils/tools.js 的 getIP 口径一致（支持反向代理头） */
const getClientIP = (req) => {
    let ip;
    if (global.lx.config['proxy.enabled']) {
        const proxyIp = req.headers[global.lx.config['proxy.header']];
        if (typeof proxyIp === 'string')
            ip = proxyIp;
    }
    ip ||= req.socket.remoteAddress;
    return ip;
};

const normalizeIP = (ip) => String(ip || '').replace(/^::ffff:/, '').trim();

/** 默认只允许本机 / 私有地址设置，防止服务暴露公网时被他人抢先初始化 */
const isPrivateAddress = (raw) => {
    if (process.env.SETUP_ALLOW_PUBLIC === 'true')
        return true;
    const ip = normalizeIP(raw);
    if (!ip)
        return false;
    if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd'))
        return true;
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.'))
        return true;
    return /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
};

const validatePassword = (pwd) => {
    if (typeof pwd !== 'string' || !pwd)
        return '请输入密码';
    if (pwd.length < 8 || pwd.length > 128)
        return '密码长度需为 8–128 位';
    if (/^\d+$/.test(pwd))
        return '密码不能是纯数字';
    if (/^(.)\1+$/.test(pwd))
        return '密码不能是重复字符';
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9\u4e00-\u9fa5]/, /[\u4e00-\u9fa5]/]
        .filter(r => r.test(pwd)).length;
    if (classes < 2)
        return '请至少使用两类字符（大小写字母、数字、符号或汉字）';
    if (WEAK_PASSWORDS.has(pwd.toLowerCase()))
        return '该密码过于常见，请换一个';
    return null;
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (msg) => {
        if (!settled) {
            settled = true;
            reject(new Error(msg));
        }
    };
    req.on('data', (chunk) => {
        if (settled)
            return;
        size += chunk.length;
        if (size > 16 * 1024) {
            fail('请求体过大');
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (settled)
            return;
        settled = true;
        try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        }
        catch {
            reject(new Error('请求体不是合法 JSON'));
        }
    });
    req.on('error', () => fail('读取请求体失败'));
});

const checkRate = (raw) => {
    const key = normalizeIP(raw);
    const now = Date.now();
    const rec = rateLimit.get(key);
    if (!rec || now > rec.resetAt) {
        rateLimit.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 });
        return true;
    }
    if (rec.count >= 10)
        return false;
    rec.count++;
    return true;
};

const configFilePath = () => process.env.CONFIG_PATH || path.join(process.cwd(), 'config.js');

/** 用 require 读取现有配置，可兼容带注释的手写 config.js；失败时安全降级为空对象 */
const readConfigFile = (p) => {
    if (!fs.existsSync(p))
        return {};
    try {
        delete require.cache[require.resolve(p)];
        const cfg = require(p);
        return (cfg && typeof cfg === 'object') ? { ...cfg } : {};
    }
    catch {
        return {};
    }
};

/** 保留已有高级配置，仅覆盖凭据字段；写完回读校验，避免因卷不可写而「设置成功但重启丢失」 */
const persistConfig = (values) => {
    const p = configFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const next = { ...readConfigFile(p), ...values };
    fs.writeFileSync(p, `module.exports = ${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const saved = readConfigFile(p);
    for (const [key, value] of Object.entries(values)) {
        if (saved[key] !== value)
            throw new Error(`配置回读校验失败（${key}），请检查数据卷是否可写`);
    }
    return saved;
};

const handleInit = async (req, res) => {
    const ip = getClientIP(req);
    if (!isPrivateAddress(ip)) {
        sendJson(res, 403, {
            success: false,
            message: '初始化仅允许在本机或局域网内完成。如确需公网访问，请设置环境变量 SETUP_ALLOW_PUBLIC=true 后重启容器。',
        });
        return;
    }
    if (!checkRate(ip)) {
        sendJson(res, 429, { success: false, message: '尝试次数过多，请 5 分钟后再试' });
        return;
    }
    if (initializing) {
        sendJson(res, 409, { success: false, message: '正在初始化，请稍候' });
        return;
    }
    let body;
    try {
        body = await readJsonBody(req);
    }
    catch (err) {
        sendJson(res, 400, { success: false, message: err.message });
        return;
    }
    const adminPassword = body.adminPassword;
    const confirmPassword = body.confirmPassword;
    const enablePlayerAuth = body.enablePlayerAuth === true;
    const playerPasswordInput = body.playerPassword;
    const err = validatePassword(adminPassword);
    if (err) {
        sendJson(res, 400, { success: false, message: err });
        return;
    }
    if (adminPassword !== confirmPassword) {
        sendJson(res, 400, { success: false, message: '两次输入的管理员密码不一致' });
        return;
    }
    let playerPassword = '';
    if (enablePlayerAuth) {
        playerPassword = playerPasswordInput || adminPassword;
        const playerErr = validatePassword(playerPassword);
        if (playerErr) {
            sendJson(res, 400, { success: false, message: `播放器密码：${playerErr}` });
            return;
        }
    }
    initializing = true;
    try {
        // 双重检查：防止并发请求或重复提交覆盖已有密码
        if (!isSetupRequired()) {
            sendJson(res, 409, { success: false, message: '管理员密码已设置，请直接登录' });
            return;
        }
        persistConfig({
            'frontend.password': adminPassword,
            'player.password': playerPassword,
            'player.enableAuth': enablePlayerAuth,
        });
        // 同步内存：否则本次进程仍认为未初始化，守卫不会放行
        global.lx.config['frontend.password'] = adminPassword;
        global.lx.config['player.password'] = playerPassword;
        global.lx.config['player.enableAuth'] = enablePlayerAuth;
        console.log('[Setup] Admin password initialized via /setup');
        sendJson(res, 200, { success: true, message: '设置完成', redirect: ADMIN_ENTRY });
    }
    catch (e) {
        console.error('[Setup] Failed to persist config:', e);
        sendJson(res, 500, { success: false, message: `保存失败：${e.message}` });
    }
    finally {
        initializing = false;
    }
};

const serveSetupPage = (res) => {
    const p = path.join(global.lx.staticPath, 'setup.html');
    if (!fs.existsSync(p)) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('缺少 public/setup.html，无法打开初始化页面。请重新构建镜像。');
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
    });
    res.end(fs.readFileSync(p));
};

/** 返回 true 表示请求已被本模块处理，调用方应直接 return */
const handleSetup = async (req, res, pathname) => {
    const required = isSetupRequired();
    if (pathname === STATUS_API && req.method === 'GET') {
        sendJson(res, 200, { required });
        return true;
    }
    if (!required) {
        // 已初始化后彻底关闭向导入口，避免留下未鉴权的设置接口
        if (pathname === SETUP_PATH || pathname === `${SETUP_PATH}/` || pathname.startsWith('/api/setup/')) {
            res.writeHead(302, { 'Location': ADMIN_ENTRY });
            res.end();
            return true;
        }
        return false;
    }
    if (pathname === SETUP_PATH || pathname === `${SETUP_PATH}/` || pathname === `${SETUP_PATH}/index.html`) {
        serveSetupPage(res);
        return true;
    }
    if (pathname === INIT_API && req.method === 'POST') {
        await handleInit(req, res);
        return true;
    }
    // 未初始化：其它一切请求拦截
    if (pathname.startsWith('/api/')) {
        sendJson(res, 503, {
            success: false,
            code: 'SETUP_REQUIRED',
            message: '服务尚未初始化，请先访问 /setup 设置管理员密码',
        });
    }
    else {
        res.writeHead(302, { 'Location': SETUP_PATH });
        res.end();
    }
    return true;
};
exports.handleSetup = handleSetup;
