/**
 * VU Meter Controller - VU 表控制器
 * 负责音频通道分离、RMS 电平计算、VU 弹道平滑、侧边栏/全屏渲染协调
 *
 * 音频链路:
 *   mixerNode → ChannelSplitterNode → leftAnalyser / rightAnalyser
 *   (分接点在 pannerNode 之前，不受空间声衰减影响)
 */
const VUMeterController = (function () {
    // --- 音频节点 ---
    let _audioSplitInited = false;
    let _channelSplitter = null;
    let _leftAnalyser = null;
    let _rightAnalyser = null;
    let _leftTimeDomain = null;
    let _rightTimeDomain = null;

    // --- 平滑电平状态 (VU 弹道) ---
    let _smoothL = 0; // 左声道
    let _smoothR = 0; // 右声道

    // --- 侧边栏渲染循环 ---
    let _sidebarAnimId = null;
    let _currentStyle = 'classic-gold';

    // --- 样式渲染器映射 ---
    const RENDERERS = {
        'classic-gold': () => window.VUMeterClassicGold,
        'military': () => window.VUMeterMilitary,
        'gold-square': () => window.VUMeterGoldSquare,
        'white': () => window.VUMeterWhite,
        'analog-classic': () => window.VUMeterAnalogClassic,
        'eversolo': () => window.VUMeterEversolo,
        'cassette': () => window.VUMeterCassette,
        'retro-tape': () => window.VUMeterRetroTape,
    };

    // 样式显示名称映射
    const STYLE_NAMES = {
        'classic-gold': 'Classic Gold (金色圆形)',
        'military': 'Military (军绿方形)',
        'gold-square': 'Gold Square (金色方形)',
        'white': 'White Clean (白色圆形)',
        'analog-classic': 'Analog Classic (经典模拟)',
        'eversolo': 'Eversolo (数播)',
        'cassette': 'Cassette Tape (磁带)',
        'retro-tape': 'Retro Tape (复古磁带)',
    };

    // VU 弹道系数 (IEC 60268-18 近似)
    // 60fps 下: attack ~300ms, decay ~1.2s
    const ATTACK_FACTOR = 0.12;
    const DECAY_FACTOR = 0.035;

    /**
     * VU 弹道平滑: 快升慢降
     * @param {number} current - 当前平滑值
     * @param {number} target - 目标值 (RMS 0~1)
     * @returns {number} 平滑后的值
     */
    function smoothVU(current, target) {
        if (target > current) {
            return current + (target - current) * ATTACK_FACTOR;
        }
        return current + (target - current) * DECAY_FACTOR;
    }

    /**
     * 计算时域数据的 RMS (均方根) 电平
     * @param {Float32Array} timeDomain - 时域采样数据
     * @returns {number} RMS 值 0~1
     */
    function computeRMS(timeDomain) {
        let sum = 0;
        for (let i = 0; i < timeDomain.length; i++) {
            sum += timeDomain[i] * timeDomain[i];
        }
        // mixerNode 分接的信号幅值仍偏低，放大 16 倍使正常音量落在 VU 表有效刻度内
        return Math.min(1.2, Math.sqrt(sum / timeDomain.length) * 3.5);
    }

    /**
     * 初始化音频通道分离 (懒加载)
     * 从 soundEffects 的 mixerNode 分接 ChannelSplitterNode
     */
    function _initAudio() {
        if (_audioSplitInited || !window.soundEffects) return;

        try {
            const ac = window.soundEffects.getAudioContext();
            const mixer = window.soundEffects.getMixerNode();
            if (!ac || !mixer) {
                console.warn('[VUMeter] AudioContext 或 MixerNode 不可用');
                return;
            }

            // 创建 2 通道分离器
            _channelSplitter = ac.createChannelSplitter(2);

            // 左声道分析器
            _leftAnalyser = ac.createAnalyser();
            _leftAnalyser.fftSize = 1024;
            _leftAnalyser.smoothingTimeConstant = 0.35;

            // 右声道分析器
            _rightAnalyser = ac.createAnalyser();
            _rightAnalyser.fftSize = 1024;
            _rightAnalyser.smoothingTimeConstant = 0.35;

            // 连接: mixerNode → channelSplitter → L/R analysers
            mixer.connect(_channelSplitter);
            _channelSplitter.connect(_leftAnalyser, 0);  // channel 0 = left
            _channelSplitter.connect(_rightAnalyser, 1); // channel 1 = right

            _leftTimeDomain = new Float32Array(_leftAnalyser.fftSize);
            _rightTimeDomain = new Float32Array(_rightAnalyser.fftSize);

            // 减弱 panner 距离衰减，使 VU 表信号更稳定
            const panner = window.soundEffects.getPannerNode();
            if (panner) {
                panner.distanceModel = 'linear';
                panner.refDistance = 10000;
                panner.rolloffFactor = 0.1;
            }

            _audioSplitInited = true;
            console.log('[VUMeter] 音频通道分离初始化成功 (mixerNode → Splitter → L/R Analyser)');
        } catch (e) {
            console.error('[VUMeter] 音频通道分离初始化失败:', e);
        }
    }

    /**
     * 获取当前左右声道电平 (供全屏模式调用)
     * @returns {{ levelL: number, levelR: number }}
     */
    function getLevels() {
        return { levelL: _smoothL, levelR: _smoothR };
    }

    /**
     * 获取当前全屏 VU 表渲染器
     * @returns {Object|null} { render, reset } 或 null
     */
    function getFullscreenRenderer() {
        return RENDERERS[_currentStyle]?.() || null;
    }

    /**
     * 同步侧边栏 canvas 物理分辨率
     */
    function _syncSidebarCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        ['vu-meter-l'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0) return;
            el.width = rect.width * dpr;
            el.height = rect.height * dpr;
        });
    }

    /**
     * 清空所有侧边栏 VU 表 canvas
     */
    function _clearSidebarCanvases() {
        ['vu-meter-l'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const ctx = el.getContext('2d');
                ctx.clearRect(0, 0, el.width, el.height);
            }
        });
    }

    /**
     * 启动侧边栏 VU 表渲染循环
     */
    function start() {
        if (!_audioSplitInited) _initAudio();
        if (_sidebarAnimId) return; // 已在运行

        const s = window.settings || {};
        _currentStyle = s.sidebarVUStyle || 'classic-gold';
        _updateStyleIndicators();

        // 同步 canvas 尺寸
        _syncSidebarCanvasSize();

        // 重置平滑状态
        _smoothL = 0;
        _smoothR = 0;

        function drawSidebar() {
            if (!_leftAnalyser || !_rightAnalyser) return;

            // 1. 获取时域数据并计算左右声道 RMS
            _leftAnalyser.getFloatTimeDomainData(_leftTimeDomain);
            _rightAnalyser.getFloatTimeDomainData(_rightTimeDomain);
            const rawL = computeRMS(_leftTimeDomain);
            const rawR = computeRMS(_rightTimeDomain);

            // 2. VU 弹道平滑（左右声道各自电平）
            _smoothL = smoothVU(_smoothL, rawL);
            _smoothR = smoothVU(_smoothR, rawR);

            // 3. 获取当前样式渲染器
            const renderer = RENDERERS[_currentStyle]?.();
            if (!renderer) return;

            // 4. 渲染 1 个 canvas (左声道)
            const dpr = window.devicePixelRatio || 1;
            const canvases = [
                { el: document.getElementById('vu-meter-l'), label: 'L' },
            ];

            canvases.forEach(({ el, label }) => {
                if (!el) return;
                const ctx = el.getContext('2d');
                renderer.render(ctx, {
                    cw: el.width,
                    ch: el.height,
                    dpr: dpr,
                    levelL: label === 'L' ? _smoothL : 0,
                    levelR: label === 'R' ? _smoothR : 0,
                    label: 'A',
                });
            });

            _sidebarAnimId = requestAnimationFrame(drawSidebar);
        }

        drawSidebar();
    }

    /**
     * 停止侧边栏渲染
     */
    function stopSidebar() {
        if (_sidebarAnimId) {
            cancelAnimationFrame(_sidebarAnimId);
            _sidebarAnimId = null;
        }
        _clearSidebarCanvases();
        // 重置平滑状态
        _smoothL = 0;
        _smoothR = 0;
    }

    /**
     * 设置 VU 表样式
     * @param {string} styleName - 样式名称
     */
    function setStyle(styleName) {
        if (RENDERERS[styleName]) {
            _currentStyle = styleName;
            // 重置所有渲染器的平滑状态
            Object.values(RENDERERS).forEach(fn => {
                const r = fn();
                if (r && typeof r.reset === 'function') r.reset();
            });
            _updateStyleIndicators();
        }
    }

    /**
     * 更新侧边栏 + 全屏的样式名称显示
     */
    function _updateStyleIndicators() {
        const name = STYLE_NAMES[_currentStyle] || _currentStyle;
        // 侧边栏指示器
        const sidebarName = document.getElementById('vu-style-name');
        if (sidebarName) sidebarName.textContent = name;
        // 全屏指示器 (由 visualizer.js 创建)
        const fsName = document.getElementById('fullscreen-vu-style-name');
        if (fsName) fsName.textContent = name;
    }

    /**
     * 循环切换样式 (hover 箭头调用)
     * @param {number} direction - 1=下一个, -1=上一个
     */
    function cycleStyle(direction) {
        const styles = Object.keys(RENDERERS);
        const idx = styles.indexOf(_currentStyle);
        const newIdx = (idx + direction + styles.length) % styles.length;
        setStyle(styles[newIdx]);
        // 同步设置
        if (typeof window.updateSetting === 'function') {
            window.updateSetting('sidebarVUStyle', styles[newIdx]);
        }
        _updateStyleIndicators();
    }

    /**
     * 重置所有电平 (切歌/暂停时调用)
     */
    function resetLevels() {
        _smoothL = 0;
        _smoothR = 0;
    }

    // 监听 resize
    window.addEventListener('resize', () => {
        if (_sidebarAnimId) _syncSidebarCanvasSize();
    });

    return {
        start,
        stopSidebar,
        setStyle,
        cycleStyle,
        getLevels,
        getFullscreenRenderer,
        getStyleName: () => STYLE_NAMES[_currentStyle] || _currentStyle,
        resetLevels,
    };
})();

window.VUMeterController = VUMeterController;
