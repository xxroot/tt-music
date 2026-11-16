/**
 * Grid Wave Visualizer Renderer
 * 网格波形：深炭黑磨砂背景 + 坐标网格矩阵 + 上下对称橙金竖线波形 + 浮雕立体效果 + XY轴刻度
 * 固定配色方案，不随颜色模式变化 (参考 spectrum.js 先例)
 * 设计规格来源：新的样式图.md
 *
 * [Perf] 性能优化：
 *   - 网格 + 噪点 + 刻度缓存到离屏 canvas，仅尺寸变化时重绘
 *   - 条形阵列使用 Path2D 批量绘制（3 次 fill 代替 N×3 次 fillRect）
 *   - 移除 shadowBlur，用偏移矩形模拟浮雕
 */
const VisualizerGridWave = (function () {
    let smoothVals = null;

    // [Perf] 离屏缓存：网格 + 噪点 + 刻度 (静态层)
    let _gridCache = null;   // offscreen canvas
    let _gridCacheKey = '';  // 'cw x ch' 用于判断是否需要重绘

    // 固定配色
    const BG_COLOR = '#191B1F';
    const BAR_COLOR = '#F19F00';
    const BAR_COLOR_DARK = '#9E6A00'; // 浮雕阴影色
    const BAR_COLOR_HIGHLIGHT = '#FFD060'; // 浮雕高光色
    const GRID_MAJOR = 'rgba(255,255,255,0.07)';
    const GRID_MINOR = 'rgba(255,255,255,0.025)';
    const CENTER_LINE_COLOR = 'rgba(255,255,255,0.18)';
    const LABEL_COLOR = 'rgba(255,255,255,0.22)';

    /**
     * [Perf] 预生成噪点纹理 (仅一次)
     */
    function _createNoiseCanvas() {
        const size = 128;
        const off = document.createElement('canvas');
        off.width = size;
        off.height = size;
        const octx = off.getContext('2d');
        const imgData = octx.createImageData(size, size);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const v = Math.floor(Math.random() * 255);
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
        }
        octx.putImageData(imgData, 0, 0);
        return off;
    }

    let _noiseCanvas = null;

    /**
     * [Perf] 构建静态层缓存 (网格 + 噪点 + 中线 + 刻度)
     * 仅在 canvas 尺寸变化时调用
     */
    function _buildGridCache(cw, ch, dpr) {
        const key = `${cw}x${ch}`;
        if (_gridCache && _gridCacheKey === key) return _gridCache;

        if (!_noiseCanvas) _noiseCanvas = _createNoiseCanvas();

        const off = document.createElement('canvas');
        off.width = cw;
        off.height = ch;
        const ctx = off.getContext('2d');
        const centerY = ch / 2;

        // 1. 深色背景
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, cw, ch);

        // 2. 噪点纹理叠加
        const noisePattern = ctx.createPattern(_noiseCanvas, 'repeat');
        if (noisePattern) {
            ctx.save();
            ctx.globalAlpha = 0.035;
            ctx.fillStyle = noisePattern;
            ctx.fillRect(0, 0, cw, ch);
            ctx.restore();
        }

        // 3. 绘制网格
        const majorSpacing = 80 * dpr;
        const minorSpacing = 20 * dpr;

        // 细分格线
        ctx.strokeStyle = GRID_MINOR;
        ctx.lineWidth = 0.5 * dpr;
        ctx.beginPath();
        for (let x = minorSpacing; x < cw; x += minorSpacing) {
            if (x % majorSpacing === 0) continue;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, ch);
        }
        for (let y = minorSpacing; y < ch; y += minorSpacing) {
            if (y % majorSpacing === 0) continue;
            ctx.moveTo(0, y);
            ctx.lineTo(cw, y);
        }
        ctx.stroke();

        // 主格线
        ctx.strokeStyle = GRID_MAJOR;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        for (let x = majorSpacing; x < cw; x += majorSpacing) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, ch);
        }
        for (let y = majorSpacing; y < ch; y += majorSpacing) {
            ctx.moveTo(0, y);
            ctx.lineTo(cw, y);
        }
        ctx.stroke();

        // 4. 0 振幅高亮中线
        ctx.strokeStyle = CENTER_LINE_COLOR;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(cw, centerY);
        ctx.stroke();

        // 5. XY 轴刻度文字
        if (ch > 150 * dpr) {
            const fontSize = Math.max(9, Math.min(11, ch / 50)) * dpr;
            ctx.font = `${fontSize}px "SF Mono", "Consolas", "Menlo", monospace`;
            ctx.fillStyle = LABEL_COLOR;
            ctx.textBaseline = 'middle';

            const labelMargin = 4 * dpr;

            // Y 轴左侧刻度
            const yLabels = ['120', '100', '80', '60', '40', '20', '0', '-20', '-40', '-60', '-80', '-100', '-120'];
            const yLabelCount = yLabels.length;
            ctx.textAlign = 'left';
            for (let i = 0; i < yLabelCount; i++) {
                const y = (i / (yLabelCount - 1)) * ch;
                ctx.fillText(yLabels[i], labelMargin, y);
            }

            // Y 轴右侧刻度
            ctx.textAlign = 'right';
            for (let i = 0; i < yLabelCount; i++) {
                const y = (i / (yLabelCount - 1)) * ch;
                ctx.fillText(yLabels[i], cw - labelMargin, y);
            }

            // X 轴底部刻度
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const xLabelCount = Math.max(5, Math.floor(cw / majorSpacing));
            const xStep = cw / (xLabelCount - 1);
            const bottomMargin = 2 * dpr;
            for (let i = 0; i < xLabelCount; i++) {
                const x = i * xStep;
                const val = Math.round(i * 1500 + (i % 3) * 37);
                ctx.fillText(String(val), x, ch - bottomMargin);
            }
        }

        _gridCache = off;
        _gridCacheKey = key;
        return off;
    }

    /**
     * 渲染一帧
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {Object} params - 渲染参数
     * @param {number} params.cw - 画布宽度（已乘 dpr）
     * @param {number} params.ch - 画布高度（已乘 dpr）
     * @param {Uint8Array} params.frequencyData - 频域数据
     * @param {number} params.bufferLength - 频域数据长度
     * @param {number} params.dpr - 设备像素比
     */
    function render(ctx, params) {
        const { cw, ch, frequencyData, bufferLength, dpr } = params;
        const centerY = ch / 2;

        // ===== 1. 绘制静态缓存层 (背景 + 网格 + 噪点 + 刻度) =====
        const gridCache = _buildGridCache(cw, ch, dpr);
        ctx.drawImage(gridCache, 0, 0);

        // ===== 2. 绘制上下对称橙金色竖线阵列 (Path2D 批量) =====
        const pitch = 2.5 * dpr;
        const barWidth = 1.5 * dpr;
        const barCount = Math.min(Math.floor(cw / pitch), 2048);
        // [Fix] 使用浮点比例映射，避免 barCount > bufferLength 时右侧空白
        const step = bufferLength / barCount;
        const maxHalfH = ch * 0.42;

        // EMA 平滑
        if (!smoothVals || smoothVals.length !== barCount) {
            smoothVals = new Float32Array(barCount);
        }
        const smoothFactor = 0.35;
        for (let i = 0; i < barCount; i++) {
            const idx = Math.min(Math.floor(i * step), bufferLength - 1);
            const raw = (frequencyData[idx] || 0) / 255;
            smoothVals[i] += (raw - smoothVals[i]) * smoothFactor;
        }

        // [Perf] 使用 Path2D 批量绘制，3 次 fill 代替 N×3 次 fillRect
        const shadowPath = new Path2D();
        const mainPath = new Path2D();
        const highlightPath = new Path2D();
        const shadowOffset = 0.5 * dpr;
        const highlightMinH = 1;

        for (let i = 0; i < barCount; i++) {
            const val = smoothVals[i];
            if (val < 0.008) continue;

            const x = i * pitch;
            const halfH = Math.max(0.5 * dpr, val * maxHalfH);
            const barH = halfH * 2;

            // 暗色底 (浮雕阴影，用偏移矩形代替 shadowBlur)
            shadowPath.rect(x + shadowOffset, centerY - halfH, barWidth, barH);

            // 亮色主体
            mainPath.rect(x, centerY - halfH, barWidth, barH);

            // 高光 (顶部/底部细线)
            if (val > 0.05) {
                const hlH = Math.max(highlightMinH, halfH * 0.08);
                highlightPath.rect(x, centerY - halfH, barWidth, hlH);
                highlightPath.rect(x, centerY + halfH - hlH, barWidth, hlH);
            }
        }

        // 三次 fill 完成所有条形绘制 (相比逐条 fillRect 减少 ~99% draw call)
        ctx.fillStyle = BAR_COLOR_DARK;
        ctx.fill(shadowPath);

        ctx.fillStyle = BAR_COLOR;
        ctx.fill(mainPath);

        ctx.fillStyle = BAR_COLOR_HIGHLIGHT;
        ctx.fill(highlightPath);
    }

    /**
     * 重置状态（退出全屏/切换样式时调用）
     */
    function reset() {
        smoothVals = null;
        _gridCache = null;
        _gridCacheKey = '';
        _noiseCanvas = null;
    }

    return { render, reset };
})();

window.VisualizerGridWave = VisualizerGridWave;
