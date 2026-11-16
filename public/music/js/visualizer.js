/**
 * Music Visualizer Integration using Wave.js
 * Manages independent footer and detail view canvases and syncs with theme color.
 */

const musicVisualizer = (function () {
    let audioContext, audioSource, audioAnalyser;
    let muteGainNode;  // GainNode for muting output while keeping analyser data alive
    let waveFooter, waveDetail;
    let isInitialized = false;
    let isMuted = false;  // Track muted state for DLNA casting
    let currentRandomColor = '#10b981'; // Store random color per song

    // Fullscreen mode state
    let isFullscreen = false;
    let fullscreenOverlay = null;
    let fullscreenCanvas = null;
    let fullscreenAnimFrameId = null;
    let fullscreenDataArray = null;

    // Footer custom animation state (for neonline/waveform renderers)
    let footerAnimFrameId = null;
    let footerDataArray = null;

    // Optical Flow Spectrum state: now managed by VisualizerOpticalFlow module

    // External render state (for renderTo/stopRender API)
    const _externalRenders = new Map(); // canvas -> { animId, waveInstance, dataArray }

    // 频谱样式列表（全屏切换指示器使用）
    const SPECTRUM_STYLES = [
        { value: 'bars', name: '条形阵列' },
        { value: 'wave', name: '平滑波浪' },
        { value: 'opticalflow', name: '光流频谱' },
        { value: 'neonline', name: '霓虹线条' },
        { value: 'waveform', name: '双向波形' },
        { value: 'spectrum', name: '彩虹频谱' },
        { value: 'glow-bars', name: '辉光频谱' },
        { value: 'line-wave', name: '线性波形' },
        { value: 'neonwave', name: '霓虹光波' },
        { value: 'gridwave', name: '网格波形' },
        { value: 'mirrorwave', name: '镜面波形' },
    ];

    // 颜色模式列表（全屏 / 在线电台切换指示器使用）
    const COLOR_MODES = [
        { value: 'theme',      name: '主题色' },
        { value: 'custom',     name: '自定义' },
        { value: 'random',     name: '随机颜色' },
        { value: 'rainbow',    name: '五颜六色' },
        { value: 'monochrome', name: '黑白灰' },
    ];

    /**
     * 检测当前是否处于暗黑模式
     * @returns {boolean}
     */
    function isDarkMode() {
        const appearance = document.documentElement.getAttribute('data-appearance');
        if (appearance === 'dark') return true;
        if (appearance === 'light') return false;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    const audio = document.getElementById('audio-player');
    const footerCanvas = document.getElementById('footer-visualizer');
    const detailCanvas = document.getElementById('detail-visualizer');
    const playerFooter = document.getElementById('player-footer');

    /**
     * Generate a vibrant random color (HSL with high saturation).
     */
    function generateRandomColor() {
        const h = Math.floor(Math.random() * 360);
        const s = 70 + Math.floor(Math.random() * 30); // 70-100% saturation
        const l = 45 + Math.floor(Math.random() * 20); // 45-65% lightness
        return hslToHex(h, s, l);
    }

    /**
     * Convert HSL to hex color.
     */
    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    /**
     * Determine fill/line colors based on color mode setting.
     * Returns { fillColor, lineColor } (string or gradient object).
     */
    function resolveColors() {
        const s = window.settings || {};
        const mode = s.visualizerColorMode || 'theme';

        switch (mode) {
            case 'custom': {
                const custom = s.visualizerCustomColor || '#10b981';
                return { fillColor: custom, lineColor: custom };
            }
            case 'random':
                return { fillColor: currentRandomColor, lineColor: currentRandomColor };
            case 'rainbow': {
                // 降饱和彩虹色，区分明暗模式避免过于刺眼
                const dark = isDarkMode();
                const rainbowColors = dark
                    ? ['#c86464','#c89664','#c8c864','#64c890','#6496c8','#8064c0','#c064b8']
                    : ['#d04040','#d08040','#c0c040','#40a060','#4080c0','#7040b0','#b040a0'];
                return {
                    fillColor: { gradient: rainbowColors, rotate: 0 },
                    lineColor: { gradient: rainbowColors, rotate: 0 }
                };
            }
            case 'monochrome': {
                // 黑白灰渐变，区分明暗模式
                const dark = isDarkMode();
                const grayColors = dark
                    ? ['#505050','#707070','#909090','#b0b0b0','#909090','#707070','#505050']
                    : ['#202020','#404040','#606060','#808080','#606060','#404040','#202020'];
                return {
                    fillColor: { gradient: grayColors, rotate: 0 },
                    lineColor: { gradient: grayColors, rotate: 0 }
                };
            }
            case 'theme':
            default: {
                const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--c-500').trim() || '#10b981';
                return { fillColor: themeColor, lineColor: themeColor };
            }
        }
    }

    /**
     * Called when a new song starts playing.
     * Generates a new random color if in 'random' mode.
     */
    function onSongChange() {
        const s = window.settings || {};
        if (s.visualizerColorMode === 'random') {
            currentRandomColor = generateRandomColor();
            if (isInitialized) applySettings();
        }
    }

    /**
     * Initialize AudioContext and AnalyserNode.
     */
    function init() {
        if (isInitialized || !window.Wave || !audio) return;

        try {
            // 优先复用 soundEffects 的 AudioContext 和 analyser，避免跨 context 节点不兼容
            if (window.soundEffects && window.soundEffects.getAnalyser()) {
                console.log('[Visualizer] Reusing AudioContext and analyser from SoundEffectsManager');
                audioContext = window.soundEffects.getAudioContext();
                audioAnalyser = window.soundEffects.getAnalyser();
                muteGainNode = window.soundEffects.getOutputGainNode();
            } else {
                console.log('[Visualizer] Initializing AudioContext...');
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioSource = audioContext.createMediaElementSource(audio);
                audioAnalyser = audioContext.createAnalyser();
                muteGainNode = audioContext.createGain();
                muteGainNode.gain.value = 1;
                audioSource.connect(audioAnalyser);
                audioAnalyser.connect(muteGainNode);
                muteGainNode.connect(audioContext.destination);
            }

            audioAnalyser.smoothingTimeConstant = 0.8;
            audioAnalyser.fftSize = 512;

            waveFooter = new Wave(audioAnalyser, footerCanvas);
            waveDetail = new Wave(audioAnalyser, detailCanvas);

            isInitialized = true;
            console.log('[Visualizer] Initialized successfully');

            syncSize();
            applySettings();
        } catch (e) {
            console.error('[Visualizer] Initialization failed:', e);
        }
    }

    /**
     * Sync canvas resolutions.
     */
    function syncSize() {
        [footerCanvas, detailCanvas].forEach(canvas => {
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
        });
    }

    /**
     * Apply independent settings for Footer and Detail.
     */
    function applySettings() {
        if (!isInitialized) return;

        // 每次应用设置前同步一次尺寸，确保全宽对齐
        syncSize();

        const s = window.settings || {};
        const opacity = s.visualizerOpacity !== undefined ? s.visualizerOpacity : 0.5;
        const globalStyle = s.visualizerGlobalStyle || 'blocks';
        const globalGap = globalStyle === 'blocks' ? 2 : 0;

        // Resolve colors based on color mode
        const colors = resolveColors();

        // --- Handle Footer Visualizer ---
        waveFooter.clearAnimations();
        stopFooterCustomAnimation(); // 停止旧的自定义 footer 动画
        const visualizerContainer = document.getElementById('visualizer-container');

        if (s.showFooterVisualizer && footerCanvas && visualizerContainer) {
            const style = s.footerVisualizerStyle || 'bars';

            // 所有样式均使用独立渲染器模块
            const customFooterRenderer =
                (style === 'bars' && window.VisualizerBars) ? window.VisualizerBars :
                (style === 'wave' && window.VisualizerSmoothWave) ? window.VisualizerSmoothWave :
                (style === 'opticalflow' && window.VisualizerOpticalFlow) ? window.VisualizerOpticalFlow :
                (style === 'neonline' && window.VisualizerNeonline) ? window.VisualizerNeonline :
                (style === 'waveform' && window.VisualizerWaveform) ? window.VisualizerWaveform :
                (style === 'spectrum' && window.VisualizerSpectrum) ? window.VisualizerSpectrum :
                (style === 'glow-bars' && window.VisualizerGlowBars) ? window.VisualizerGlowBars :
                (style === 'line-wave' && window.VisualizerLineWave) ? window.VisualizerLineWave :
                (style === 'neonwave' && window.VisualizerNeonwave) ? window.VisualizerNeonwave :
                (style === 'gridwave' && window.VisualizerGridWave) ? window.VisualizerGridWave :
                (style === 'mirrorwave' && window.VisualizerMirrorWave) ? window.VisualizerMirrorWave :
                null;

            // 统一使用自定义渲染器
            footerCanvas.style.width = '100%';
            footerCanvas.style.height = '100%';
            syncSize();
            footerCanvas.style.opacity = opacity;
            if (customFooterRenderer) {
                startFooterCustomAnimation(customFooterRenderer);
            }

            // 调整内容区域高度
            const footerIsHidden = playerFooter && playerFooter.classList.contains('translate-y-[110%]');

            // 增加容器高度和 Footer 高度
            const isShortWindow = window.innerHeight <= 845;
            visualizerContainer.style.height = isShortWindow ? '40px' : '100px';
            visualizerContainer.style.zIndex = '1';
            visualizerContainer.style.display = 'flex'; // 确保可见
            if (playerFooter) {
                playerFooter.style.transition = 'height 0.3s ease';
                if (window.innerWidth >= 768) {
                    // 再次压缩：超矮窗口下，Footer 高度仅设为 90px
                    playerFooter.style.height = isShortWindow ? '90px' : '150px';
                    playerFooter.style.justifyContent = 'center'; // [Fix] 增加高度后内容保持垂直居中
                } else {
                    // 手机端保持自适应高度，避免 flex-center 导致内容溢出屏幕外
                    playerFooter.style.height = '';
                    playerFooter.style.justifyContent = '';
                }
            }

            // [Important] 如果音频正在播放但 Context 挂起了（常见于浏览器策略），立即恢复
            if (audioContext && audioContext.state === 'suspended' && audio && !audio.paused) {
                audioContext.resume();
            }

            // 调整内容区域的间距以防被遮挡
            const mainViews = document.querySelectorAll('#view-search, #view-favorites, #view-settings, #view-about, #view-player-detail, #view-songlist, #songlist-detail-view, #view-leaderboard');
            const isMobile = window.innerWidth < 768;
            let targetPb = footerIsHidden ? '' : (isShortWindow ? '120px' : '180px');

            mainViews.forEach(view => {
                view.style.transition = 'padding-bottom 0.3s ease, padding-top 0.3s ease';
                let pb = targetPb;

                if (view.id === 'view-player-detail') {
                    // [Fix] 详情页特殊处理：使用容器 Margin 而不是视图 Padding，防止背景图层因 Padding 出现视觉断层（黑线）
                    const container = view.querySelector('#player-detail-container');
                    if (container) {
                        const needsTopPadding = !footerIsHidden && window.innerWidth >= 768;
                        container.style.marginTop = needsTopPadding ? '60px' : '';

                        // [Important] 详情页父容器 view-player-detail 已有 pb-24 (96px)，
                        // 此处的 margin-bottom 应扣除这部分，否则会导致歌词区域被过度压缩
                        const extraPb = pb === '' ? '' : Math.max(0, parseInt(pb) - 96) + 'px';
                        container.style.marginBottom = extraPb;
                        container.style.transition = 'margin 0.3s ease';
                    }
                    view.style.paddingBottom = ''; // 确保详情页视图本身没有 Padding
                    view.style.paddingTop = '';
                } else {
                    // 其他列表页继续使用 Padding
                    view.style.paddingBottom = pb;
                }
            });

            // 调整侧边栏底部 Padding
            const sidebar = document.querySelector('aside');
            if (sidebar) {
                sidebar.style.transition = 'padding-bottom 0.3s ease';
                sidebar.style.paddingBottom = targetPb;
            }
        } else if (footerCanvas && visualizerContainer) {
            stopFooterCustomAnimation(); // 停止自定义 footer 渲染
            footerCanvas.style.opacity = '0';
            visualizerContainer.style.height = ''; // 复原 (h-12 / 48px)
            footerCanvas.style.width = '100%'; // 复原宽度
            if (playerFooter) {
                playerFooter.style.height = '';
                playerFooter.style.justifyContent = ''; // 复原
            }
            // 复原 Padding
            const mainViews = document.querySelectorAll('#view-search, #view-favorites, #view-settings, #view-about, #view-player-detail, #view-songlist, #songlist-detail-view, #view-leaderboard');
            mainViews.forEach(view => {
                view.style.paddingBottom = '';
                const container = view.querySelector('#player-detail-container');
                if (container) {
                    container.style.marginTop = '';
                    container.style.marginBottom = '';
                }
                view.style.paddingTop = '';
            });
            const sidebar = document.querySelector('aside');
            if (sidebar) {
                sidebar.style.paddingBottom = '';
            }
        }

        // --- Handle Detail Visualizer ---
        waveDetail.clearAnimations();
        if (s.showDetailVisualizer && detailCanvas) {
            const style = s.detailVisualizerStyle || 'pulse';
            const options = {
                fillColor: colors.fillColor,
                lineColor: colors.lineColor,
                lineWidth: 1.5,
                count: 60,
                rounded: true,
                diameter: 220,
                gap: globalGap // 为 Pulse 等样式应用全局风格间距
            };

            let AnimationClass = waveDetail.animations.Turntable; // Default for 'pulse'

            if (style === 'dots') {
                AnimationClass = waveDetail.animations.Glob;
                options.diameter = 180;
            } else if (style === 'flower') {
                AnimationClass = waveDetail.animations.Flower;
                options.diameter = 200;
            }

            waveDetail.addAnimation(new AnimationClass(options));
            detailCanvas.style.opacity = opacity;
        } else if (detailCanvas) {
            detailCanvas.style.opacity = '0';
        }
    }

    /**
     * 手动清除可视化内容
     * @param {string} type 'footer' | 'detail'
     */
    function clear(type) {
        if (type === 'footer' && waveFooter) {
            waveFooter.clearAnimations();
            if (footerCanvas) {
                const ctx = footerCanvas.getContext('2d');
                ctx.clearRect(0, 0, footerCanvas.width, footerCanvas.height);
            }
        } else if (type === 'detail' && waveDetail) {
            waveDetail.clearAnimations();
            if (detailCanvas) {
                const ctx = detailCanvas.getContext('2d');
                ctx.clearRect(0, 0, detailCanvas.width, detailCanvas.height);
            }
        }
    }

    /**
     * Create the fullscreen overlay element.
     */
    function createFullscreenOverlay() {
        fullscreenOverlay = document.createElement('div');
        fullscreenOverlay.id = 'visualizer-fullscreen-overlay';
        Object.assign(fullscreenOverlay.style, {
            position: 'fixed', top: '0', left: '0', right: '0', bottom: '7.5rem', zIndex: '30',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.92) 50%, rgba(0,0,0,0.97) 100%)',
            display: 'none', flexDirection: 'column',
            justifyContent: 'center', alignItems: 'center',
            transform: 'translateY(100%)', opacity: '0',
            transition: 'transform 0.6s ease, opacity 0.6s ease',
            cursor: 'pointer', userSelect: 'none',
            WebkitUserSelect: 'none'
        });

        // Fullscreen canvas — absolute positioned to fill overlay
        fullscreenCanvas = document.createElement('canvas');
        fullscreenCanvas.id = 'fullscreen-visualizer';
        Object.assign(fullscreenCanvas.style, {
            position: 'absolute', top: '0', left: '0',
            width: '100%', height: '100%'
        });
        fullscreenOverlay.appendChild(fullscreenCanvas);

        // 左上角关闭按钮 (与歌词面板一致)
        const closeBtn = document.createElement('button');
        closeBtn.id = 'vu-panel-close-btn';
        closeBtn.innerHTML = '<i class="fas fa-chevron-down text-lg"></i>';
        Object.assign(closeBtn.style, {
            position: 'absolute', top: '16px', left: '24px', zIndex: '40',
            width: '40px', height: '40px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.1)',
            border: 'none', borderRadius: '50%',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)'
        });
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255,255,255,0.2)';
            closeBtn.style.color = '#10b981'; // emerald-500
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255,255,255,0.1)';
            closeBtn.style.color = 'rgba(255,255,255,0.6)';
        });
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exitFullscreen();
        });
        closeBtn.addEventListener('dblclick', (e) => {
            e.stopPropagation(); // 防止触发 overlay 的 dblclick 切换
        });
        fullscreenOverlay.appendChild(closeBtn);

        // VU Meter 全屏样式指示器 (居中 + 名称 + 箭头)
        const vuStyleIndicator = document.createElement('div');
        vuStyleIndicator.id = 'fullscreen-vu-style-indicator';
        Object.assign(vuStyleIndicator.style, {
            position: 'absolute', top: '4px', left: '50%', transform: 'translateX(-50%)',
            display: 'none', alignItems: 'center', gap: '8px',
            background: 'rgba(0,0,0,0.4)', borderRadius: '20px',
            padding: '4px 16px', zIndex: '10',
            opacity: '0', transition: 'opacity 0.3s ease',
            pointerEvents: 'none'
        });
        vuStyleIndicator.innerHTML = `
            <button id="fullscreen-vu-arrow-left" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span id="fullscreen-vu-style-name" style="color:rgba(255,255,255,0.8);font-size:13px;font-weight:500;min-width:90px;text-align:center;letter-spacing:0.5px;">Classic Gold</span>
            <button id="fullscreen-vu-arrow-right" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
        fullscreenOverlay.appendChild(vuStyleIndicator);

        // VU 指示器 dblclick 阻止冒泡（防止快速点击箭头时退出全屏）
        vuStyleIndicator.addEventListener('dblclick', (e) => {
            e.stopPropagation();
        });

        // 绑定箭头点击事件
        vuStyleIndicator.querySelector('#fullscreen-vu-arrow-left')
            .addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.VUMeterController) window.VUMeterController.cycleStyle(-1);
            });
        vuStyleIndicator.querySelector('#fullscreen-vu-arrow-right')
            .addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.VUMeterController) window.VUMeterController.cycleStyle(1);
            });

        // 底部并排容器 (频谱样式 + 颜色模式)
        const bottomBar = document.createElement('div');
        bottomBar.id = 'fullscreen-bottom-bar';
        Object.assign(bottomBar.style, {
            position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: '12px',
            zIndex: '10',
            opacity: '0', transition: 'opacity 0.3s ease',
            pointerEvents: 'none'
        });
        fullscreenOverlay.appendChild(bottomBar);

        // bottomBar dblclick 阻止冒泡
        bottomBar.addEventListener('dblclick', (e) => {
            e.stopPropagation();
        });

        // 频谱样式切换指示器 (底部并排左侧)
        const spectrumStyleIndicator = document.createElement('div');
        spectrumStyleIndicator.id = 'fullscreen-spectrum-style-indicator';
        Object.assign(spectrumStyleIndicator.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(0,0,0,0.4)', borderRadius: '20px',
            padding: '4px 16px'
        });
        spectrumStyleIndicator.innerHTML = `
            <button id="fullscreen-spectrum-arrow-left" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span id="fullscreen-spectrum-style-name" style="color:rgba(255,255,255,0.8);font-size:13px;font-weight:500;min-width:90px;text-align:center;letter-spacing:0.5px;">条形阵列</span>
            <button id="fullscreen-spectrum-arrow-right" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
        bottomBar.appendChild(spectrumStyleIndicator);

        // 频谱指示器 dblclick 阻止冒泡
        spectrumStyleIndicator.addEventListener('dblclick', (e) => {
            e.stopPropagation();
        });

        // 绑定频谱箭头点击事件
        spectrumStyleIndicator.querySelector('#fullscreen-spectrum-arrow-left')
            .addEventListener('click', (e) => {
                e.stopPropagation();
                cycleSpectrumStyle(-1);
            });
        spectrumStyleIndicator.querySelector('#fullscreen-spectrum-arrow-right')
            .addEventListener('click', (e) => {
                e.stopPropagation();
                cycleSpectrumStyle(1);
            });

        // 颜色模式切换指示器 (底部并排右侧)
        const colorModeIndicator = document.createElement('div');
        colorModeIndicator.id = 'fullscreen-colormode-indicator';
        Object.assign(colorModeIndicator.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(0,0,0,0.4)', borderRadius: '20px',
            padding: '4px 16px'
        });
        colorModeIndicator.innerHTML = `
            <button id="fullscreen-colormode-arrow-left" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span id="fullscreen-colormode-name" style="color:rgba(255,255,255,0.8);font-size:13px;font-weight:500;min-width:80px;text-align:center;letter-spacing:0.5px;">主题色</span>
            <button id="fullscreen-colormode-arrow-right" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:2px 4px;">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
        bottomBar.appendChild(colorModeIndicator);

        // 颜色模式指示器 dblclick 阻止冒泡
        colorModeIndicator.addEventListener('dblclick', (e) => {
            e.stopPropagation();
        });

        // 绑定颜色模式箭头点击事件
        colorModeIndicator.querySelector('#fullscreen-colormode-arrow-left')
            .addEventListener('click', (e) => {
                e.stopPropagation();
                cycleColorMode(-1);
            });
        colorModeIndicator.querySelector('#fullscreen-colormode-arrow-right')
            .addEventListener('click', (e) => {
                e.stopPropagation();
                cycleColorMode(1);
            });

        // Hover 显示样式指示器（VU 顶部 25% / 底部 bar 15%）
        fullscreenOverlay.addEventListener('mousemove', (e) => {
            const s = window.settings || {};
            const rect = fullscreenOverlay.getBoundingClientRect();
            // VU 指示器：鼠标在顶部 25% 区域
            if (s.showFullscreenVU) {
                const vuZoneHeight = rect.height * 0.25;
                if (e.clientY < vuZoneHeight) {
                    vuStyleIndicator.style.opacity = '1';
                    vuStyleIndicator.style.pointerEvents = 'auto';
                } else {
                    vuStyleIndicator.style.opacity = '0';
                    vuStyleIndicator.style.pointerEvents = 'none';
                }
            }
            // 底部 bar (频谱+颜色模式)：鼠标在底部 15% 区域
            const bottomZoneHeight = rect.height * 0.15;
            const inBottom = e.clientY > rect.height - bottomZoneHeight;
            bottomBar.style.opacity = inBottom ? '1' : '0';
            bottomBar.style.pointerEvents = inBottom ? 'auto' : 'none';
        });

        // Exit hint at bottom（紧贴底部，两个 pill 在其上方）
        const exitHint = document.createElement('div');
        Object.assign(exitHint.style, {
            position: 'absolute', bottom: '2px', left: '0', right: '0',
            textAlign: 'center', color: 'rgba(255,255,255,0.18)',
            fontSize: '11px', fontFamily: 'inherit',
            pointerEvents: 'none'
        });
        exitHint.textContent = '双击或按 ESC 关闭';
        fullscreenOverlay.appendChild(exitHint);

        document.body.appendChild(fullscreenOverlay);

        // Double-click overlay to exit
        fullscreenOverlay.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            exitFullscreen();
        });

        return fullscreenOverlay;
    }

    /**
     * Resolve a color value for Canvas2D fillStyle.
     * Handles hex strings and gradient objects from resolveColors().
     */
    function resolveCanvasFill(colorValue, ctx, canvasWidth, canvasHeight) {
        if (typeof colorValue === 'string') return colorValue;
        if (colorValue && colorValue.gradient) {
            const grad = ctx.createLinearGradient(0, canvasHeight, canvasWidth, 0);
            colorValue.gradient.forEach((c, i) => {
                grad.addColorStop(i / (colorValue.gradient.length - 1), c);
            });
            return grad;
        }
        return '#10b981';
    }

    /**
     * 更新全屏频谱样式指示器名称
     */
    function _updateSpectrumIndicator() {
        const s = window.settings || {};
        const currentStyle = s.footerVisualizerStyle || 'bars';
        const entry = SPECTRUM_STYLES.find(e => e.value === currentStyle);
        const name = entry ? entry.name : currentStyle;
        const nameEl = document.getElementById('fullscreen-spectrum-style-name');
        if (nameEl) nameEl.textContent = name;
    }

    /**
     * 循环切换频谱样式 (全屏指示器箭头调用)
     * @param {number} direction - 1=下一个, -1=上一个
     */
    function cycleSpectrumStyle(direction) {
        const s = window.settings || {};
        const currentStyle = s.footerVisualizerStyle || 'bars';
        const idx = SPECTRUM_STYLES.findIndex(e => e.value === currentStyle);
        const newIdx = (idx + direction + SPECTRUM_STYLES.length) % SPECTRUM_STYLES.length;
        const newValue = SPECTRUM_STYLES[newIdx].value;

        // 同步设置
        if (typeof window.updateSetting === 'function') {
            window.updateSetting('footerVisualizerStyle', newValue);
        }

        // 重启全屏动画以应用新渲染器
        if (isFullscreen) {
            stopFullscreenAnimation();
            startFullscreenAnimation();
        }

        // 更新指示器名称
        _updateSpectrumIndicator();
    }

    /**
     * 更新所有颜色模式指示器名称（全屏 + 在线电台 pill）
     */
    function _updateColorModeIndicators() {
        const s = window.settings || {};
        const current = s.visualizerColorMode || 'theme';
        const entry = COLOR_MODES.find(e => e.value === current);
        const name = entry ? entry.name : current;
        ['fullscreen-colormode-name', 'or-vis-colormode-name'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = name;
        });
    }

    /**
     * 循环切换颜色模式 (全屏 / 在线电台 pill 箭头调用)
     * @param {number} direction - 1=下一个, -1=上一个
     */
    function cycleColorMode(direction) {
        const s = window.settings || {};
        const current = s.visualizerColorMode || 'theme';
        const idx = COLOR_MODES.findIndex(e => e.value === current);
        const newIdx = (idx + direction + COLOR_MODES.length) % COLOR_MODES.length;
        if (typeof window.updateSetting === 'function') {
            window.updateSetting('visualizerColorMode', COLOR_MODES[newIdx].value);
        }
        _updateColorModeIndicators();

        // 重启全屏动画以应用新颜色
        if (isFullscreen) {
            stopFullscreenAnimation();
            startFullscreenAnimation();
        }
    }

    /**
     * Start custom footer animation loop for neonline/waveform renderers.
     * Bypasses Wave.js and draws directly on footerCanvas.
     */
    function startFooterCustomAnimation(rendererObj) {
        if (!audioAnalyser || !footerCanvas) return;
        stopFooterCustomAnimation(); // 清理旧循环

        const ctx = footerCanvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        footerDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

        const s = window.settings || {};
        const colors = resolveColors();

        function draw() {
            if (!footerCanvas || !audioAnalyser) return;

            audioAnalyser.getByteFrequencyData(footerDataArray);

            const cw = footerCanvas.width;
            const ch = footerCanvas.height;
            ctx.clearRect(0, 0, cw, ch);

            rendererObj.render(ctx, {
                cw, ch,
                frequencyData: footerDataArray,
                bufferLength: audioAnalyser.frequencyBinCount,
                dpr,
                globalStyle: s.visualizerGlobalStyle || 'blocks',
                fillColor: colors.fillColor,
                lineColor: colors.lineColor,
                resolveCanvasFill,
                barWidth: 12 // footer 条形宽度
            });

            footerAnimFrameId = requestAnimationFrame(draw);
        }

        draw();
    }

    /**
     * Stop custom footer animation loop.
     */
    function stopFooterCustomAnimation() {
        if (footerAnimFrameId) {
            cancelAnimationFrame(footerAnimFrameId);
            footerAnimFrameId = null;
        }
        if (footerCanvas) {
            const ctx = footerCanvas.getContext('2d');
            ctx.clearRect(0, 0, footerCanvas.width, footerCanvas.height);
        }
        footerDataArray = null;
    }

    /**
     * Start custom fullscreen animation loop.
     * Reads AnalyserNode directly and draws on fullscreen canvas,
     * bypassing Wave.js to avoid its scaleData 255-limitation.
     */
    function startFullscreenAnimation() {
        if (!audioAnalyser || !fullscreenCanvas) return;

        const ctx = fullscreenCanvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        fullscreenCanvas.width = vw * dpr;
        fullscreenCanvas.height = vh * dpr;

        const s = window.settings || {};
        const colors = resolveColors();
        const globalStyle = s.visualizerGlobalStyle || 'blocks';
        const style = s.footerVisualizerStyle || 'bars';
        const gap = globalStyle === 'blocks' ? 2 * dpr : 0;

        // VU 表全屏叠加参数
        const showVU = s.showFullscreenVU && window.VUMeterController;
        const vuZoneRatio = 0.28; // VU 区域占画布高度 28%
        const vuOffsetY = showVU ? Math.floor(fullscreenCanvas.height * vuZoneRatio) : 0;
        // 预计算 VU 表实际底部位置，用于 visualizer 裁剪边界
        let vuMeterBottom = vuOffsetY;
        if (showVU) {
            const _vw = fullscreenCanvas.width;
            const _vuAreaH = vuOffsetY;
            const _vuMeterSize = Math.min(_vuAreaH * 0.85, _vw * 0.18);
            const _vuTopY = _vuAreaH * 0.16;
            vuMeterBottom = Math.floor(_vuTopY + _vuMeterSize);
        }
        const vuDrawHeight = showVU ? (fullscreenCanvas.height - vuMeterBottom) : fullscreenCanvas.height;

        // 显示/隐藏 VU 样式指示器
        const vuIndicator = document.getElementById('fullscreen-vu-style-indicator');
        if (vuIndicator) vuIndicator.style.display = showVU ? 'flex' : 'none';

        // 恢复 VU 箭头可见性 (stopFullscreenAnimation 会隐藏它们)
        if (showVU) {
            const arrowL = document.getElementById('fullscreen-vu-arrow-left');
            const arrowR = document.getElementById('fullscreen-vu-arrow-right');
            if (arrowL) { arrowL.style.display = ''; arrowL.style.opacity = ''; }
            if (arrowR) { arrowR.style.display = ''; arrowR.style.opacity = ''; }
        }

        const bufferLength = audioAnalyser.frequencyBinCount;
        fullscreenDataArray = new Uint8Array(bufferLength);

        // Calculate bar count and width (基于压缩后的可视区域高度)
        const targetPitch = style === 'wave' ? 8 : 6;
        const barCount = Math.min(Math.floor(vw / targetPitch), 1024);
        const barWidth = Math.max(1, Math.floor((fullscreenCanvas.width - gap * barCount) / barCount));
        const step = Math.max(1, Math.floor(bufferLength / barCount));

        // Reset all visualizer module states on start
        if (window.VisualizerBars) window.VisualizerBars.reset();
        if (window.VisualizerSmoothWave) window.VisualizerSmoothWave.reset();
        if (window.VisualizerOpticalFlow) window.VisualizerOpticalFlow.reset();
        if (window.VisualizerWaveform) window.VisualizerWaveform.reset();
        if (window.VisualizerSpectrum) window.VisualizerSpectrum.reset();
        if (window.VisualizerGlowBars) window.VisualizerGlowBars.reset();
        if (window.VisualizerLineWave) window.VisualizerLineWave.reset();
        if (window.VisualizerNeonwave) window.VisualizerNeonwave.reset();
        if (window.VisualizerGridWave) window.VisualizerGridWave.reset();
        if (window.VisualizerMirrorWave) window.VisualizerMirrorWave.reset();

        function draw() {
            if (!isFullscreen) return;

            audioAnalyser.getByteFrequencyData(fullscreenDataArray);

            const cw = fullscreenCanvas.width;
            const ch = fullscreenCanvas.height;
            ctx.clearRect(0, 0, cw, ch);

            // --- 绘制 VU 表 (上方区域) ---
            if (showVU) {
                const vuRenderer = window.VUMeterController.getFullscreenRenderer();
                if (vuRenderer) {
                    const levels = window.VUMeterController.getLevels();
                    const vuAreaH = vuOffsetY;
                    const vuMeterSize = Math.min(vuAreaH * 0.85, cw * 0.18) * 1.0;
                    // 3:2 长方形: 宽度 = 高度 * 3/2
                    const vuMeterW = vuMeterSize * 3 / 2;
                    const vuMeterH = vuMeterSize;
                    // 两个 VU 表之间的间隔
                    const vuGap = vuMeterW * 0.04;
                    // 居中并列: 两个 VU 表 + 间隔，整体居中
                    const totalWidth = vuMeterW * 2 + vuGap;
                    const startX = (cw - totalWidth) / 2;
                    const vuLeftX = startX;
                    const vuRightX = startX + vuMeterW + vuGap;
                    // VU 表紧贴顶部（已移除歌曲信息，无需留间距）
                    const vuTopY = vuAreaH * 0.16;
                    // 圆角半径
                    const vuCornerR = Math.min(vuMeterW, vuMeterH) * 0.08;

                    // 统一渲染左右声道 VU 表
                    const vuConfigs = [
                        { x: vuLeftX, level: levels.levelL, label: 'L' },
                        { x: vuRightX, level: levels.levelR, label: 'R' }
                    ];
                    for (const cfg of vuConfigs) {
                        ctx.save();
                        ctx.beginPath();
                        // 圆角裁切: 每个 VU 表独立圆角矩形
                        const rx = cfg.x, ry = vuTopY, rw = vuMeterW, rh = vuMeterH, rr = vuCornerR;
                        ctx.moveTo(rx + rr, ry);
                        ctx.lineTo(rx + rw - rr, ry);
                        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
                        ctx.lineTo(rx + rw, ry + rh - rr);
                        ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
                        ctx.lineTo(rx + rr, ry + rh);
                        ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
                        ctx.lineTo(rx, ry + rr);
                        ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
                        ctx.closePath();
                        ctx.clip();
                        ctx.translate(cfg.x, vuTopY);
                        vuRenderer.render(ctx, {
                            cw: vuMeterW,
                            ch: vuMeterH,
                            dpr: dpr,
                            levelL: cfg.level,
                            levelR: 0,
                            label: cfg.label
                        });
                        ctx.restore();
                    }
                }
            }

            // --- 绘制主可视化 (下方区域) ---
            // 如果有 VU 表，将可视化压缩到 VU 表底部以下，并留出间隙
            const vuGap = showVU ? 8 * dpr : 0; // VU 表与 visualizer 之间的间隙
            const vizStartY = showVU ? (vuMeterBottom + vuGap) : 0;
            const vizDrawH = showVU ? (ch - vizStartY) : ch;
            ctx.save();
            if (showVU) {
                ctx.beginPath();
                ctx.rect(0, vizStartY, cw, vizDrawH);
                ctx.clip();
                ctx.translate(0, vizStartY);
                // 缩放 Y 轴使可视化填满底部区域
                ctx.scale(1, vizDrawH / ch);
            }

            // Resolve fill color for this frame
            const fill = resolveCanvasFill(colors.fillColor, ctx, cw, ch);

            if (style === 'wave' && window.VisualizerSmoothWave) {
                window.VisualizerSmoothWave.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr,
                    globalStyle,
                    fillColor: colors.fillColor,
                    lineColor: colors.lineColor,
                    resolveCanvasFill
                });
            } else if (style === 'opticalflow' && window.VisualizerOpticalFlow) {
                window.VisualizerOpticalFlow.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr,
                    globalStyle,
                    fillColor: colors.fillColor,
                    lineColor: colors.lineColor,
                    resolveCanvasFill,
                    barWidth: barWidth
                });
            } else if (style === 'neonline' && window.VisualizerNeonline) {
                // Neon Line: 霓虹线条频谱 (独立渲染器模块)
                window.VisualizerNeonline.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr,
                    globalStyle,
                    fillColor: colors.fillColor,
                    lineColor: colors.lineColor,
                    resolveCanvasFill
                });
            } else if (style === 'waveform' && window.VisualizerWaveform) {
                // Waveform: 双向对称波形图 (独立渲染器模块)
                window.VisualizerWaveform.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr,
                    globalStyle,
                    fillColor: colors.fillColor,
                    lineColor: colors.lineColor,
                    resolveCanvasFill
                });
            } else if (style === 'spectrum' && window.VisualizerSpectrum) {
                // Spectrum: 彩虹折线频谱 (独立渲染器模块)
                window.VisualizerSpectrum.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr
                });
            } else if (style === 'glow-bars' && window.VisualizerGlowBars) {
                // Glow Bars: 辉光频谱 (独立渲染器模块)
                window.VisualizerGlowBars.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr,
                    globalStyle,
                    fillColor: colors.fillColor,
                    lineColor: colors.lineColor,
                    resolveCanvasFill
                });
            } else if (style === 'line-wave' && window.VisualizerLineWave) {
                // Line Wave: 线性波形 (独立渲染器模块)
                window.VisualizerLineWave.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr,
                    globalStyle,
                    fillColor: colors.fillColor,
                    lineColor: colors.lineColor,
                    resolveCanvasFill
                });
            } else if (style === 'neonwave' && window.VisualizerNeonwave) {
                // Neon Wave: 霓虹光波图 (独立渲染器模块)
                window.VisualizerNeonwave.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr
                });
            } else if (style === 'gridwave' && window.VisualizerGridWave) {
                // Grid Wave: 网格波形 (固定配色，不使用 fillColor)
                window.VisualizerGridWave.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr
                });
            } else if (style === 'mirrorwave' && window.VisualizerMirrorWave) {
                // Mirror Wave: 镜面波形 (固定配色，深蓝背景 + 霓虹倒影)
                window.VisualizerMirrorWave.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr
                });
            } else if (style === 'bars' && window.VisualizerBars) {
                window.VisualizerBars.render(ctx, {
                    cw, ch,
                    frequencyData: fullscreenDataArray,
                    bufferLength,
                    dpr,
                    globalStyle,
                    fillColor: colors.fillColor,
                    lineColor: colors.lineColor,
                    resolveCanvasFill
                });
            }

            // 恢复 canvas 变换 (VU 模式下)
            if (showVU) {
                ctx.restore();
            }

            fullscreenAnimFrameId = requestAnimationFrame(draw);
        }

        draw();
    }

    /**
     * Stop custom fullscreen animation loop.
     */
    function stopFullscreenAnimation() {
        if (fullscreenAnimFrameId) {
            cancelAnimationFrame(fullscreenAnimFrameId);
            fullscreenAnimFrameId = null;
        }
        if (fullscreenCanvas) {
            const ctx = fullscreenCanvas.getContext('2d');
            ctx.clearRect(0, 0, fullscreenCanvas.width, fullscreenCanvas.height);
        }
        fullscreenDataArray = null;
        // Waveform: reset renderer state
        if (window.VisualizerWaveform) window.VisualizerWaveform.reset();
        // NeonLine: reset renderer state
        if (window.VisualizerNeonline) window.VisualizerNeonline.reset();
        if (window.VisualizerSpectrum) window.VisualizerSpectrum.reset();
        // Glow Bars: reset renderer state
        if (window.VisualizerGlowBars) window.VisualizerGlowBars.reset();
        // Line Wave: reset renderer state
        if (window.VisualizerLineWave) window.VisualizerLineWave.reset();
        // Neon Wave: reset renderer state
        if (window.VisualizerNeonwave) window.VisualizerNeonwave.reset();
        // Grid Wave: reset renderer state
        if (window.VisualizerGridWave) window.VisualizerGridWave.reset();
        if (window.VisualizerMirrorWave) window.VisualizerMirrorWave.reset();
        // 隐藏 VU 箭头
        const arrowL = document.getElementById('fullscreen-vu-arrow-left');
        const arrowR = document.getElementById('fullscreen-vu-arrow-right');
        if (arrowL) { arrowL.style.display = 'none'; arrowL.style.opacity = '0'; }
        if (arrowR) { arrowR.style.display = 'none'; arrowR.style.opacity = '0'; }
    }

    /**
     * Enter fullscreen visualizer mode.
     */
    function enterFullscreen() {
        if (isFullscreen) return;
        if (!isInitialized) {
            init();
            if (!isInitialized) return;
        }
        isFullscreen = true;

        if (!fullscreenOverlay) createFullscreenOverlay();

        // 初始化频谱样式 + 颜色模式指示器名称
        _updateSpectrumIndicator();
        _updateColorModeIndicators();

        // 如果全屏 VU 表开启，确保 VUMeterController 音频分离已初始化
        const s = window.settings || {};
        if (s.showFullscreenVU && window.VUMeterController) {
            window.VUMeterController.start(); // 初始化音频通道分离 + 启动渲染循环
        }

        // 若歌词面板已打开，先关闭歌词面板（互斥）
        if (typeof isLyricViewOpen !== 'undefined' && isLyricViewOpen && typeof toggleLyrics === 'function') {
            toggleLyrics();
        }

        // Show overlay with slide-up animation (与歌词面板一致的滑出效果)
        fullscreenOverlay.style.display = 'flex';
        void fullscreenOverlay.offsetWidth;
        fullscreenOverlay.style.transform = 'translateY(0)';
        fullscreenOverlay.style.opacity = '1';

        // Start custom fullscreen animation (bypasses Wave.js scaleData limitation)
        startFullscreenAnimation();

        console.log('[Visualizer] Entered panel mode');
    }

    /**
     * Exit fullscreen visualizer mode.
     */
    function exitFullscreen() {
        if (!isFullscreen) return;
        isFullscreen = false;

        // Stop custom animation
        stopFullscreenAnimation();

        // 如果侧边栏 VU 表未开启，停止 VUMeterController
        const s = window.settings || {};
        if (!s.showSidebarVU && window.VUMeterController) {
            window.VUMeterController.stopSidebar();
        }

        // Hide overlay with slide-down animation (与歌词面板一致的滑出效果)
        if (fullscreenOverlay) {
            fullscreenOverlay.style.transform = 'translateY(100%)';
            fullscreenOverlay.style.opacity = '0';
            setTimeout(() => {
                fullscreenOverlay.style.display = 'none';
            }, 600);
        }

        console.log('[Visualizer] Exited fullscreen mode');
    }

    /**
     * Toggle fullscreen visualizer mode.
     */
    function toggleFullscreen() {
        if (isFullscreen) {
            exitFullscreen();
        } else {
            enterFullscreen();
        }
    }

    // ESC key handler for overlay mode (when not in native fullscreen)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFullscreen && !document.fullscreenElement) {
            exitFullscreen();
        }
    });

    // Double-click on visualizer container to toggle fullscreen
    const _vsContainer = document.getElementById('visualizer-container');
    if (_vsContainer) {
        _vsContainer.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Only toggle if footer visualizer is enabled
            const s = window.settings || {};
            if (s.showFooterVisualizer) {
                toggleFullscreen();
            }
        });
    }

    // 双击侧边栏 VU 表滑出 VU 面板 (Double-click sidebar VU meter to toggle VU panel)
    // 绑定在 canvas 上而非整个容器，避免双击样式切换箭头时误触发
    const _vuCanvas = document.getElementById('vu-meter-l');
    if (_vuCanvas) {
        _vuCanvas.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFullscreen();
        });
    }

    if (audio) {
        audio.addEventListener('play', () => {
            if (!isInitialized) {
                init();
            } else if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
        });
    }

    window.addEventListener('resize', () => {
        syncSize();
        if (isInitialized) applySettings();
        // Also resize fullscreen canvas when in fullscreen mode
        if (isFullscreen) {
            startFullscreenAnimation();
        }
    });

    /**
     * Mute/unmute the audio output while keeping the analyser fed with data.
     * Used by DLNA/UPNP casting: audio plays locally (muted) so the analyser
     * gets frequency data for the visualizer, but speakers are silent since
     * the actual audio plays on the cast device.
     * @param {boolean} muted - true to mute speakers, false to unmute
     */
    function setMute(muted) {
        isMuted = muted;
        if (!isInitialized || !muteGainNode) return;
        if (muted) {
            // Mute speakers but keep analyser data flowing
            muteGainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
            // Resume AudioContext if suspended (needed for DLNA casting)
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
        } else {
            // Restore normal volume
            muteGainNode.gain.setTargetAtTime(1, audioContext.currentTime, 0.05);
        }
        console.log('[Visualizer] Mute:', muted);
    }

    /**
     * 在目标 canvas 上启动可视化动画（供外部模块复用）
     * @param {HTMLCanvasElement} targetCanvas - 目标画布
     * @param {string} style - 样式名（与 SPECTRUM_STYLES 一致）
     */
    function renderTo(targetCanvas, style) {
        if (!targetCanvas) return;
        // 停止该 canvas 已有的渲染
        stopRender(targetCanvas);

        // 优先使用 soundEffects 的 analyser（它始终连接着正在播放的音频）
        // 这样不依赖 musicVisualizer 的 init 时序，避免跨 AudioContext 节点不兼容
        const sourceAnalyser = (window.soundEffects && window.soundEffects.getAnalyser()) || audioAnalyser;
        if (!sourceAnalyser) {
            console.warn('[Visualizer renderTo] no analyser available');
            return;
        }

        // 确保 soundEffects 的 AudioContext 处于运行状态
        if (window.soundEffects && window.soundEffects.getAudioContext()) {
            const seCtx = window.soundEffects.getAudioContext();
            if (seCtx.state === 'suspended') seCtx.resume();
        }
        // 同时确保 musicVisualizer 的 context 也运行
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const s = window.settings || {};
        const colors = resolveColors();
        const ctx = targetCanvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        // 同步 canvas 物理分辨率
        const rect = targetCanvas.getBoundingClientRect();
        // 如果高度太小，使用容器父元素的高度作为备选
        let canvasHeight = rect.height;
        if (canvasHeight < 10) {
            const parent = targetCanvas.parentElement;
            if (parent) {
                const parentRect = parent.getBoundingClientRect();
                canvasHeight = parentRect.height || 100;
                console.log(`[Visualizer renderTo] canvas height too small (${rect.height}), using parent height: ${canvasHeight}`);
            }
        }
        targetCanvas.width = rect.width * dpr;
        targetCanvas.height = canvasHeight * dpr;
        // 确保 canvas CSS 尺寸也正确
        targetCanvas.style.width = rect.width + 'px';
        targetCanvas.style.height = canvasHeight + 'px';

        // 所有样式均使用自定义渲染器模块
        const customRenderer =
            (style === 'bars' && window.VisualizerBars) ? window.VisualizerBars :
            (style === 'wave' && window.VisualizerSmoothWave) ? window.VisualizerSmoothWave :
            (style === 'opticalflow' && window.VisualizerOpticalFlow) ? window.VisualizerOpticalFlow :
            (style === 'neonline' && window.VisualizerNeonline) ? window.VisualizerNeonline :
            (style === 'waveform' && window.VisualizerWaveform) ? window.VisualizerWaveform :
            (style === 'spectrum' && window.VisualizerSpectrum) ? window.VisualizerSpectrum :
            (style === 'glow-bars' && window.VisualizerGlowBars) ? window.VisualizerGlowBars :
            (style === 'line-wave' && window.VisualizerLineWave) ? window.VisualizerLineWave :
            (style === 'neonwave' && window.VisualizerNeonwave) ? window.VisualizerNeonwave :
            (style === 'gridwave' && window.VisualizerGridWave) ? window.VisualizerGridWave :
            (style === 'mirrorwave' && window.VisualizerMirrorWave) ? window.VisualizerMirrorWave :
            null;

        if (!customRenderer) {
            console.warn(`[Visualizer renderTo] no renderer found for style: ${style}`);
            return;
        }

        const dataArray = new Uint8Array(sourceAnalyser.frequencyBinCount);
        // 先注册 state，确保 draw() 内能拿到 animId
        _externalRenders.set(targetCanvas, { animId: null, waveInstance: null, dataArray });
        let logged = false;
        function draw() {
            sourceAnalyser.getByteFrequencyData(dataArray);

            const cw = targetCanvas.width;
            const ch = targetCanvas.height;
            if (!logged) {
                console.log(`[Visualizer renderTo] canvas size: ${cw}x${ch} (CSS: ${targetCanvas.style.width}x${targetCanvas.style.height}, dpr: ${dpr})`);
                logged = true;
            }
            ctx.clearRect(0, 0, cw, ch);
            customRenderer.render(ctx, {
                cw, ch,
                frequencyData: dataArray,
                bufferLength: sourceAnalyser.frequencyBinCount,
                dpr,
                globalStyle: s.visualizerGlobalStyle || 'blocks',
                fillColor: colors.fillColor,
                lineColor: colors.lineColor,
                resolveCanvasFill,
                barWidth: 12
            });
            const state = _externalRenders.get(targetCanvas);
            if (state) state.animId = requestAnimationFrame(draw);
        }
        draw();
    }

    /**
     * 停止目标 canvas 上的可视化动画并清空
     * @param {HTMLCanvasElement} targetCanvas - 目标画布
     */
    function stopRender(targetCanvas) {
        const state = _externalRenders.get(targetCanvas);
        if (!state) return;
        if (state.animId) cancelAnimationFrame(state.animId);
        if (state.waveInstance) state.waveInstance.clearAnimations();
        if (targetCanvas) {
            const ctx = targetCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        }
        // 重置所有自定义渲染器状态
        ['VisualizerBars', 'VisualizerSmoothWave', 'VisualizerOpticalFlow',
         'VisualizerNeonline',
         'VisualizerWaveform', 'VisualizerSpectrum', 'VisualizerGlowBars',
         'VisualizerLineWave', 'VisualizerNeonwave', 'VisualizerGridWave', 'VisualizerMirrorWave'].forEach(name => {
            if (window[name] && window[name].reset) window[name].reset();
        });
        _externalRenders.delete(targetCanvas);
    }

    return { init, applySettings, syncSize, clear, onSongChange, setMute, toggleFullscreen, SPECTRUM_STYLES, COLOR_MODES, isDarkMode, renderTo, stopRender, cycleSpectrumStyle, cycleColorMode };
})();

window.musicVisualizer = musicVisualizer;
