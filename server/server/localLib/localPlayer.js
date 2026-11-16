"use strict";
/**
 * Local Audio Player - Server-side playback through connected audio devices
 *
 * Uses ffplay (from FFmpeg) as the primary player, with fallbacks:
 *   - macOS: afplay (built-in)
 *   - Linux: mpv, aplay (ALSA)
 *   - Windows: ffplay (from FFmpeg)
 *
 * Audio device discovery:
 *   - Uses ffplay -devices / ffmpeg -devices to enumerate audio output devices
 *   - On macOS: also uses system_profiler for additional device info
 *   - On Linux: parses /proc/asound or PulseAudio for ALSA/Pulse devices
 *
 * No external npm dependencies - uses Node.js child_process for player control.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeToSeconds = exports.secondsToTime = exports.getDeviceWithRefresh = exports.getPlayerInfo = exports.getStatus = exports.getVolume = exports.setVolume = exports.seek = exports.stop = exports.resume = exports.pause = exports.play = exports.setActiveDevice = exports.getCachedDevices = exports.scanDevices = void 0;
const node_child_process_1 = require("node:child_process");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
// ========== Constants ==========
const currentPlatform = (0, node_os_1.platform)();
const DATA_PATH = process.env.DATA_PATH || node_path_1.default.join(process.cwd(), 'data');
// ========== State ==========
let cachedDevices = [];
let activeDeviceId = '';
let currentPlayerProcess = null;
let currentMediaUrl = '';
let currentTitle = '';
let currentVolume = 100;
let isPaused = false;
let playerStartTime = 0; // Timestamp when playback started
let estimatedDuration = 0; // Estimated duration from DB or probe
let lastProbeTime = 0;
let playbackPosition = 0;
// ========== Player Detection ==========
/**
 * Detect available audio players on the system
 * Returns the best available player command and its path
 */
function detectPlayer() {
    const candidates = [];
    // ffplay is the best option - supports most formats and device selection
    candidates.push({ cmd: 'ffplay', supportsDeviceSelect: true });
    if (currentPlatform === 'darwin') {
        // macOS built-in afplay - simple but reliable
        candidates.push({ cmd: 'afplay', supportsDeviceSelect: false });
    }
    else if (currentPlatform === 'linux') {
        candidates.push({ cmd: 'mpv', supportsDeviceSelect: true });
    }
    for (const candidate of candidates) {
        try {
            const playerPath = (0, node_child_process_1.execSync)(`which ${candidate.cmd} 2>/dev/null`, { encoding: 'utf8' }).trim();
            if (playerPath && node_fs_1.default.existsSync(playerPath)) {
                return { cmd: candidate.cmd, path: playerPath, supportsDeviceSelect: candidate.supportsDeviceSelect };
            }
        }
        catch {
            // Player not found, try next
        }
    }
    return null;
}
// ========== Audio Device Discovery ==========
/**
 * Enumerate audio output devices available on the server
 */
const scanDevices = () => {
    cachedDevices = [];
    const player = detectPlayer();
    if (currentPlatform === 'darwin') {
        // macOS: Use system_profiler to get audio devices
        scanMacOSDevices();
    }
    else if (currentPlatform === 'linux') {
        // Linux: Check ALSA and PulseAudio
        scanLinuxDevices();
    }
    else {
        // Windows or other: basic device list
        cachedDevices.push({
            id: 'default',
            name: '默认音频输出',
            type: 'speaker',
            isDefault: true,
            isAvailable: true,
        });
    }
    // Add ffplay/ffmpeg detected devices if available
    if (player && player.cmd === 'ffplay') {
        scanFFplayDevices();
    }
    // Always ensure there's at least a default device
    if (cachedDevices.length === 0) {
        cachedDevices.push({
            id: 'default',
            name: '默认音频输出',
            type: 'speaker',
            isDefault: true,
            isAvailable: true,
        });
    }
    // Mark duplicates by merging similar devices
    mergeDuplicateDevices();
    return cachedDevices;
};
exports.scanDevices = scanDevices;
/**
 * macOS: Scan audio devices using system_profiler
 */
function scanMacOSDevices() {
    try {
        const output = (0, node_child_process_1.execSync)('system_profiler AudioDevices -json 2>/dev/null', {
            encoding: 'utf8',
            timeout: 10000,
        });
        try {
            const data = JSON.parse(output);
            const devices = data.AudioDevices || data.audioDevices || [];
            for (const device of devices) {
                const isOutput = device.coreAudioDeviceOutputChannels > 0 ||
                    device.transport_type === 'built_in' ||
                    device._defaultOutputDevice === 'true';
                if (!isOutput && device.coreAudioDeviceInputChannels > 0 &&
                    !device.coreAudioDeviceOutputChannels)
                    continue;
                const name = device._name || device.name || 'Unknown Audio Device';
                const id = device.coreAudioDeviceUID || device.coreAudioDeviceID?.toString() || `mac_${name.replace(/\s+/g, '_')}`;
                const isDefault = device._defaultOutputDevice === 'true' ||
                    device.defaultOutputDevice === 'true';
                let type = 'other';
                const nameLower = name.toLowerCase();
                if (nameLower.includes('usb') || nameLower.includes('dac'))
                    type = 'dac';
                else if (nameLower.includes('hdmi') || nameLower.includes('display'))
                    type = 'hdmi';
                else if (nameLower.includes('headphone') || nameLower.includes('耳机'))
                    type = 'headphone';
                else if (nameLower.includes('bluetooth') || nameLower.includes('wireless'))
                    type = 'bluetooth';
                else if (nameLower.includes('built-in') || nameLower.includes('内置') || nameLower.includes('speaker'))
                    type = 'speaker';
                cachedDevices.push({
                    id,
                    name,
                    type,
                    isDefault,
                    isAvailable: true,
                });
            }
        }
        catch {
            // JSON parse failed, try text format
            parseMacOSTextDevices(output);
        }
    }
    catch {
        // system_profiler failed, add basic defaults
        cachedDevices.push({
            id: 'mac_builtin',
            name: '内置扬声器',
            type: 'speaker',
            isDefault: true,
            isAvailable: true,
        });
    }
}
/**
 * Parse macOS system_profiler text output (fallback)
 */
function parseMacOSTextDevices(output) {
    // Simple regex parsing of system_profiler text output
    const lines = output.split('\n');
    let currentDevice = null;
    for (const line of lines) {
        // Match device name lines (indented with spaces, contain colon)
        if (line.match(/^\s{2}\S.*:/) && !line.match(/^\s{4}/)) {
            if (currentDevice && currentDevice.id) {
                cachedDevices.push(currentDevice);
            }
            const name = line.replace(/\s*:/, '').trim();
            currentDevice = {
                id: `mac_${name.replace(/\s+/g, '_')}`,
                name,
                type: 'other',
                isDefault: false,
                isAvailable: true,
            };
            const nameLower = name.toLowerCase();
            if (nameLower.includes('usb') || nameLower.includes('dac'))
                currentDevice.type = 'dac';
            else if (nameLower.includes('hdmi') || nameLower.includes('display'))
                currentDevice.type = 'hdmi';
            else if (nameLower.includes('headphone') || nameLower.includes('耳机'))
                currentDevice.type = 'headphone';
            else if (nameLower.includes('bluetooth') || nameLower.includes('wireless'))
                currentDevice.type = 'bluetooth';
            else if (nameLower.includes('built-in') || nameLower.includes('内置') || nameLower.includes('speaker'))
                currentDevice.type = 'speaker';
        }
        if (currentDevice && line.includes('Default Output Device: Yes')) {
            currentDevice.isDefault = true;
        }
    }
    if (currentDevice && currentDevice.id) {
        cachedDevices.push(currentDevice);
    }
}
/**
 * Linux: Scan ALSA and PulseAudio devices
 */
function scanLinuxDevices() {
    // Try PulseAudio first (most modern Linux uses PulseAudio or PipeWire)
    try {
        const output = (0, node_child_process_1.execSync)('pactl list sinks 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        const sinkBlocks = output.split(/Sink #/);
        for (const block of sinkBlocks) {
            if (!block.trim())
                continue;
            const nameMatch = block.match(/Name:\s*(.+)/);
            const descMatch = block.match(/Description:\s*(.+)/);
            const stateMatch = block.match(/State:\s*(.+)/);
            if (nameMatch) {
                const name = descMatch ? descMatch[1].trim() : nameMatch[1].trim();
                const id = nameMatch[1].trim();
                const isRunning = stateMatch != null && stateMatch[1].trim() === 'RUNNING';
                let type = 'other';
                const nameLower = name.toLowerCase();
                if (nameLower.includes('usb') || nameLower.includes('dac'))
                    type = 'dac';
                else if (nameLower.includes('hdmi') || nameLower.includes('display'))
                    type = 'hdmi';
                else if (nameLower.includes('headphone') || nameLower.includes('耳机'))
                    type = 'headphone';
                else if (nameLower.includes('bluetooth') || nameLower.includes('wireless'))
                    type = 'bluetooth';
                else if (nameLower.includes('internal') || nameLower.includes('built-in'))
                    type = 'speaker';
                cachedDevices.push({
                    id: `pulse_${id}`,
                    name,
                    type,
                    isDefault: !!isRunning,
                    isAvailable: true,
                });
            }
        }
    }
    catch {
        // PulseAudio not available, try ALSA
        try {
            const output = (0, node_child_process_1.execSync)('cat /proc/asound/cards 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
            const lines = output.split('\n');
            for (let i = 0; i < lines.length; i += 2) {
                const line = lines[i];
                const match = line.match(/^\s*(\d+)\s+\[(.+)\]\s*:\s*(.+)/);
                if (match) {
                    const id = match[1];
                    const cardId = match[2];
                    const name = match[3].trim();
                    let type = 'other';
                    const nameLower = name.toLowerCase();
                    if (nameLower.includes('usb') || nameLower.includes('dac'))
                        type = 'dac';
                    else if (nameLower.includes('hdmi') || nameLower.includes('display'))
                        type = 'hdmi';
                    else if (nameLower.includes('headphone'))
                        type = 'headphone';
                    else if (nameLower.includes('bluetooth'))
                        type = 'bluetooth';
                    else
                        type = 'speaker';
                    cachedDevices.push({
                        id: `alsa_${id}`,
                        name,
                        type,
                        isDefault: id === '0',
                        isAvailable: true,
                    });
                }
            }
        }
        catch {
            // Neither PulseAudio nor ALSA info available
        }
    }
}
/**
 * Scan devices reported by ffplay/ffmpeg -devices
 */
function scanFFplayDevices() {
    try {
        const output = (0, node_child_process_1.execSync)('ffmpeg -devices 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        const lines = output.split('\n');
        let inAutoDetected = false;
        for (const line of lines) {
            if (line.includes('Auto-detected sources')) {
                inAutoDetected = true;
                continue;
            }
            if (inAutoDetected && line.match(/^\s+[A]/)) {
                // Audio output device line
                const match = line.match(/^\s+A\s+(\S+)\s+(.+)/);
                if (match) {
                    const deviceId = match[1];
                    const name = match[2].trim();
                    // Check if this device is already in our list (avoid duplicates)
                    const exists = cachedDevices.some(d => d.id.toLowerCase().includes(deviceId.toLowerCase()) ||
                        d.name.toLowerCase() === name.toLowerCase());
                    if (!exists) {
                        let type = 'other';
                        const nameLower = name.toLowerCase();
                        if (nameLower.includes('usb') || nameLower.includes('dac'))
                            type = 'dac';
                        else if (nameLower.includes('hdmi') || nameLower.includes('display'))
                            type = 'hdmi';
                        else if (nameLower.includes('headphone'))
                            type = 'headphone';
                        else if (nameLower.includes('bluetooth'))
                            type = 'bluetooth';
                        else if (nameLower.includes('speaker') || nameLower.includes('default'))
                            type = 'speaker';
                        cachedDevices.push({
                            id: `ff_${deviceId}`,
                            name,
                            type,
                            isDefault: deviceId.toLowerCase().includes('default'),
                            isAvailable: true,
                        });
                    }
                }
            }
            if (inAutoDetected && line.trim() === '') {
                inAutoDetected = false;
            }
        }
    }
    catch {
        // ffmpeg -devices not available or failed
    }
}
/**
 * Merge duplicate devices (same name or similar ID)
 */
function mergeDuplicateDevices() {
    const seen = new Map();
    for (const device of cachedDevices) {
        const key = device.name.toLowerCase().replace(/\s+/g, '_');
        if (!seen.has(key)) {
            seen.set(key, device);
        }
        else {
            // Merge: prefer the one with more specific info
            const existing = seen.get(key);
            if (device.isDefault && !existing.isDefault) {
                seen.set(key, device);
            }
        }
    }
    cachedDevices = Array.from(seen.values());
}
// ========== Playback Control ==========
/**
 * Get cached devices (no scan)
 */
const getCachedDevices = () => {
    return cachedDevices;
};
exports.getCachedDevices = getCachedDevices;
/**
 * Set active audio device
 */
const setActiveDevice = (deviceId) => {
    activeDeviceId = deviceId || '';
};
exports.setActiveDevice = setActiveDevice;
/**
 * Build full URL from relative path
 */
function buildFullUrl(mediaUrl) {
    if (mediaUrl.startsWith('/')) {
        const port = global.lx?.config?.port || 9527;
        // Get server LAN IP
        const addresses = getServerAddresses();
        const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
        return `http://${host}:${port}${mediaUrl}`;
    }
    return mediaUrl;
}
/**
 * Get server's LAN IP addresses
 */
function getServerAddresses() {
    const nets = require('node:os').networkInterfaces();
    const results = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            // Skip internal and non-IPv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                results.push(net.address);
            }
        }
    }
    return results;
}
/**
 * Play a media URL on a local audio device
 */
const play = async (deviceId, mediaUrl, options) => {
    // Stop any current playback first
    (0, exports.stop)();
    const fullUrl = buildFullUrl(mediaUrl);
    const startPos = options?.startPosition || 0;
    const player = detectPlayer();
    if (!player) {
        throw new Error('No audio player available on the server. Install ffplay (from FFmpeg) or afplay (macOS built-in).');
    }
    activeDeviceId = deviceId;
    currentMediaUrl = fullUrl;
    currentTitle = options?.title || '';
    isPaused = false;
    playerStartTime = Date.now();
    playbackPosition = startPos;
    // Probe duration first
    try {
        estimatedDuration = await probeDuration(fullUrl);
    }
    catch {
        estimatedDuration = 0;
    }
    // Build player arguments
    const args = [];
    if (player.cmd === 'ffplay') {
        // ffplay: -nodisp (no video window), -autoexit (exit when done), -nostats (no stats)
        args.push('-nodisp', '-autoexit', '-nostats');
        // Device selection: -audio_device <device_id>
        if (deviceId && deviceId !== 'default' && deviceId.startsWith('ff_')) {
            const rawDeviceId = deviceId.replace('ff_', '');
            args.push('-audio_device', rawDeviceId);
        }
        else if (deviceId && deviceId.startsWith('pulse_')) {
            // For PulseAudio devices on Linux, use ALSA env var or -audio_device
            const pulseId = deviceId.replace('pulse_', '');
            // ffplay uses PulseAudio sink names
            args.push('-audio_device', pulseId);
        }
        else if (deviceId && deviceId.startsWith('alsa_')) {
            const alsaCard = deviceId.replace('alsa_', '');
            args.push('-audio_device', `hw:${alsaCard}`);
        }
        // Volume: ffplay doesn't have a direct volume arg, but we can use -volume (0-100)
        args.push('-volume', String(currentVolume));
        // Start position
        if (startPos > 0) {
            args.push('-ss', String(startPos));
        }
        // The URL
        args.push(fullUrl);
    }
    else if (player.cmd === 'afplay') {
        // afplay: macOS built-in, simple but limited
        // No device selection support (uses system default)
        // But we can still play any URL or file
        args.push(fullUrl);
    }
    else if (player.cmd === 'mpv') {
        // mpv: advanced player for Linux
        args.push('--no-video', '--really-quiet');
        // Device selection via --audio-device
        if (deviceId && deviceId !== 'default') {
            let devSpec = deviceId;
            if (deviceId.startsWith('pulse_')) {
                devSpec = `pulse/${deviceId.replace('pulse_', '')}`;
            }
            else if (deviceId.startsWith('alsa_')) {
                devSpec = `alsa/${deviceId.replace('alsa_', '')}`;
            }
            args.push('--audio-device', devSpec);
        }
        // Volume (0-100, mpv uses 0-100)
        args.push('--volume', String(currentVolume));
        // Start position
        if (startPos > 0) {
            args.push('--start', String(startPos));
        }
        args.push(fullUrl);
    }
    console.log(`[LocalPlayer] Starting playback: ${player.cmd} ${args.join(' ')}`);
    // Spawn the player process
    // stdin must be 'pipe' so we can send 'p' key to ffplay for pause/resume
    currentPlayerProcess = (0, node_child_process_1.spawn)(player.path, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
    });
    currentPlayerProcess.on('error', (err) => {
        console.error(`[LocalPlayer] Player process error: ${err.message}`);
        currentPlayerProcess = null;
        isPaused = false;
    });
    currentPlayerProcess.on('close', (code) => {
        console.log(`[LocalPlayer] Player process exited with code ${code}`);
        if (code !== 0 && currentPlayerProcess) {
            // Non-normal exit might mean playback ended or error
        }
        currentPlayerProcess = null;
        isPaused = false;
    });
    // Handle stderr (ffplay outputs status to stderr)
    if (currentPlayerProcess.stderr) {
        currentPlayerProcess.stderr.on('data', (data) => {
            const text = data.toString();
            // Parse position/duration from ffplay output if possible
            const posMatch = text.match(/pos=\s*(\d+\.\d+)s/);
            if (posMatch) {
                playbackPosition = parseFloat(posMatch[1]);
            }
        });
    }
};
exports.play = play;
/**
 * Probe the duration of a media file/URL using ffprobe
 */
async function probeDuration(url) {
    return new Promise((resolve) => {
        try {
            const ffprobePath = (0, node_child_process_1.execSync)('which ffprobe 2>/dev/null', { encoding: 'utf8' }).trim();
            if (!ffprobePath) {
                resolve(0);
                return;
            }
            (0, node_child_process_1.exec)(`${ffprobePath} -v quiet -show_entries format=duration -of csv=p=0 "${url}" 2>/dev/null`, { timeout: 10000 }, (err, stdout) => {
                if (err || !stdout) {
                    resolve(0);
                    return;
                }
                const duration = parseFloat(stdout.trim());
                resolve(duration > 0 ? Math.round(duration) : 0);
            });
        }
        catch {
            resolve(0);
        }
    });
}
/**
 * Pause playback
 * For ffplay: Send SIGSTOP to suspend the process (works reliably)
 * For mpv: Send SIGSTOP as well
 * For afplay: Same approach
 */
const pause = () => {
    if (!currentPlayerProcess || isPaused)
        return;
    try {
        // SIGSTOP reliably suspends the process on Unix systems
        currentPlayerProcess.kill('SIGSTOP');
        isPaused = true;
    }
    catch {
        console.warn('[LocalPlayer] Could not send pause command');
    }
};
exports.pause = pause;
/**
 * Resume playback (send SIGCONT to resume the process)
 */
const resume = () => {
    if (!currentPlayerProcess || !isPaused)
        return;
    try {
        // SIGCONT resumes a SIGSTOP'd process
        currentPlayerProcess.kill('SIGCONT');
        isPaused = false;
    }
    catch {
        console.warn('[LocalPlayer] Could not send resume command');
    }
};
exports.resume = resume;
/**
 * Stop playback (kill the player process)
 */
const stop = () => {
    if (currentPlayerProcess) {
        try {
            currentPlayerProcess.kill('SIGTERM');
            // Give it a moment to exit gracefully
            setTimeout(() => {
                if (currentPlayerProcess) {
                    try {
                        currentPlayerProcess.kill('SIGKILL');
                    }
                    catch { /* already dead */ }
                    currentPlayerProcess = null;
                }
            }, 1000);
        }
        catch {
            // Process already dead
        }
        currentPlayerProcess = null;
    }
    currentMediaUrl = '';
    currentTitle = '';
    isPaused = false;
    playbackPosition = 0;
    playerStartTime = 0;
};
exports.stop = stop;
/**
 * Seek to a position (restart player with new start position)
 */
const seek = async (position) => {
    // ffplay doesn't support seeking via stdin easily, so restart the player
    const deviceId = activeDeviceId;
    const url = currentMediaUrl;
    const title = currentTitle;
    if (!url || !deviceId)
        return;
    await (0, exports.play)(deviceId, url, { title, startPosition: position });
};
exports.seek = seek;
/**
 * Set volume (0-100)
 * Note: For ffplay, this requires restarting the player with new volume
 * For a better UX, we track the desired volume and apply on next play
 */
const setVolume = (volume) => {
    currentVolume = Math.max(0, Math.min(100, Math.round(volume)));
    // Volume will be applied on next play() call
    // Current playback continues at original volume
};
exports.setVolume = setVolume;
/**
 * Get current volume
 */
const getVolume = () => {
    return currentVolume;
};
exports.getVolume = getVolume;
/**
 * Get current playback state
 */
const getStatus = () => {
    // Calculate estimated position based on elapsed time
    let pos = playbackPosition;
    if (currentPlayerProcess && !isPaused && playerStartTime > 0) {
        const elapsed = (Date.now() - playerStartTime) / 1000;
        pos = elapsed;
    }
    return {
        isPlaying: currentPlayerProcess !== null && !isPaused,
        isPaused: isPaused,
        mediaUrl: currentMediaUrl,
        title: currentTitle,
        position: Math.floor(pos),
        duration: estimatedDuration,
        deviceId: activeDeviceId,
        volume: currentVolume,
    };
};
exports.getStatus = getStatus;
/**
 * Get player availability info
 */
const getPlayerInfo = () => {
    const player = detectPlayer();
    return {
        available: player !== null,
        playerCmd: player?.cmd || '',
        playerPath: player?.path || '',
        supportsDeviceSelect: player?.supportsDeviceSelect || false,
        platform: currentPlatform,
    };
};
exports.getPlayerInfo = getPlayerInfo;
/**
 * Get device with refresh if expired
 */
const getDeviceWithRefresh = (deviceId) => {
    const device = cachedDevices.find(d => d.id === deviceId);
    if (!device && cachedDevices.length === 0) {
        (0, exports.scanDevices)();
        return cachedDevices.find(d => d.id === deviceId) || null;
    }
    return device || null;
};
exports.getDeviceWithRefresh = getDeviceWithRefresh;
/**
 * Convert seconds to HH:MM:SS format (UPNP compatible)
 */
const secondsToTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
exports.secondsToTime = secondsToTime;
/**
 * Convert HH:MM:SS to seconds
 */
const timeToSeconds = (timeStr) => {
    if (!timeStr)
        return 0;
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return parseInt(timeStr) || 0;
};
exports.timeToSeconds = timeToSeconds;
