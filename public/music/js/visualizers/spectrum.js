/**
 * Spectrum Visualizer Renderer
 * 彩虹折线频谱：连续折线 + 彩虹渐变 + 基线在下方1/3处 + 辉光效果
 * 参考图：基线位于画布下方 1/3 处的锯齿折线，颜色从左到右呈彩虹渐变
 */
const VisualizerSpectrum = (function () {
    let smoothVals = null;

    /**
     * 彩虹色渐变：红 → 橙 → 黄 → 绿 → 青 → 蓝 → 靛 → 粉
     * 根据明暗主题使用降饱和色表，避免过于刺眼
     * @param {number} ratio 0..1 水平位置
     * @returns {string} rgb 颜色
     */
    function getRainbowColor(ratio) {
        // 复用 visualizer.js 暴露的 isDarkMode()，降级回内联检测
        const dark = (window.musicVisualizer && typeof window.musicVisualizer.isDarkMode === 'function')
            ? window.musicVisualizer.isDarkMode()
            : window.matchMedia('(prefers-color-scheme: dark)').matches;
        const colors = dark
            ? [
                [200, 100, 100], // 柔红
                [200, 150, 100], // 柔橙
                [200, 200, 100], // 柔黄
                [100, 200, 144], // 柔绿
                [100, 150, 200], // 柔青
                [128, 100, 192], // 柔蓝
                [192, 100, 184], // 柔粉
            ]
            : [
                [208, 64, 64],   // 深红
                [208, 128, 64],  // 深橙
                [192, 192, 64],  // 深黄
                [64, 160, 96],   // 深绿
                [64, 128, 192],  // 深青
                [112, 64, 176],  // 深蓝
                [176, 64, 160],  // 深粉
            ];
        const segCount = colors.length - 1;
        const seg = Math.min(Math.floor(ratio * segCount), segCount - 1);
        const t = (ratio * segCount) - seg;
        const [r1, g1, b1] = colors[seg];
        const [r2, g2, b2] = colors[seg + 1];
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return `rgb(${r},${g},${b})`;
    }

    /**
     * 渲染一帧
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} params
     * @param {number} params.cw - 画布宽度（已乘 dpr）
     * @param {number} params.ch - 画布高度（已乘 dpr）
     * @param {Uint8Array} params.frequencyData - 频域数据
     * @param {number} params.bufferLength - 频域数据长度
     * @param {number} params.dpr - 设备像素比
     */
    function render(ctx, params) {
        const {cw, ch, frequencyData, bufferLength, dpr} = params;

        // --- 布局 ---
        const pointCount = Math.min(Math.floor(cw / (3 * dpr)), 512);
        const step = Math.max(1, Math.floor(bufferLength / pointCount));
        const baseY = ch * 4 / 5; // 基线在画布下方 1/4 处，频谱从下向上延伸
        const maxAmp = baseY * 0.85; // 最大振幅不超过画布顶部

        // --- 指数移动平均平滑 ---
        if (!smoothVals || smoothVals.length !== pointCount) {
            smoothVals = new Float32Array(pointCount);
        }
        for (let i = 0; i < pointCount; i++) {
            const idx = Math.min(i * step, bufferLength - 1);
            const raw = (frequencyData[idx] || 0) / 255;
            smoothVals[i] += (raw - smoothVals[i]) * 0.3;
        }

        // --- 计算折线顶点 ---
        const points = [];
        for (let i = 0; i < pointCount; i++) {
            const x = (cw / (pointCount - 1)) * i;
            const amp = smoothVals[i] * maxAmp;
            const y = baseY - amp;
            points.push({x, y});
        }

        // --- 检测是否有有效频谱数据 ---
        const hasSignal = smoothVals.some(v => v > 0.01);

        // --- (A) 辉光层：宽线条 + 低透明度，逐段绘制彩虹色（仅有效频谱时绘制）---
        if (hasSignal) {
            const glowWidth = 12 * dpr;
            ctx.lineWidth = glowWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (let i = 0; i < points.length - 1; i++) {
                if (smoothVals[i] < 0.01 && smoothVals[i + 1] < 0.01) continue;
                const ratio = i / (points.length - 1);
                ctx.strokeStyle = getRainbowColor(ratio);
                ctx.globalAlpha = 0.12;
                ctx.beginPath();
                ctx.moveTo(points[i].x, points[i].y);
                ctx.lineTo(points[i + 1].x, points[i + 1].y);
                ctx.stroke();
            }

            // --- (B) 中等辉光层 ---
            const midWidth = 6 * dpr;
            ctx.lineWidth = midWidth;
            for (let i = 0; i < points.length - 1; i++) {
                if (smoothVals[i] < 0.01 && smoothVals[i + 1] < 0.01) continue;
                const ratio = i / (points.length - 1);
                ctx.strokeStyle = getRainbowColor(ratio);
                ctx.globalAlpha = 0.3;
                ctx.beginPath();
                ctx.moveTo(points[i].x, points[i].y);
                ctx.lineTo(points[i + 1].x, points[i + 1].y);
                ctx.stroke();
            }
        }

        // --- (C) 核心线条：细线 + 高透明度，逐段彩虹色 ---
        ctx.lineWidth = hasSignal ? 2.5 * dpr : 0.5 * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 0; i < points.length - 1; i++) {
            const ratio = i / (points.length - 1);
            ctx.strokeStyle = getRainbowColor(ratio);
            ctx.globalAlpha = hasSignal ? 1 : 0.3;
            ctx.beginPath();
            ctx.moveTo(points[i].x, points[i].y);
            ctx.lineTo(points[i + 1].x, points[i + 1].y);
            ctx.stroke();
        }

        // --- (D) 基线：极细半透明水平线 ---
        ctx.globalAlpha = 0.04;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / dpr; // 1 物理像素，极细
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        ctx.lineTo(cw, baseY);
        ctx.stroke();

        // --- (E) 峰值高亮点：高振幅处绘制白色圆点 ---
        for (let i = 0; i < points.length; i++) {
            const val = smoothVals[i];
            if (val > 0.5) {
                const ratio = i / (points.length - 1);
                const dotR = Math.max(1.5 * dpr, 3 * dpr * val);
                ctx.globalAlpha = 0.3 + val * 0.5;
                ctx.fillStyle = getRainbowColor(ratio);
                ctx.beginPath();
                ctx.arc(points[i].x, points[i].y, dotR, 0, Math.PI * 2);
                ctx.fill();

                // 白色亮心
                if (val > 0.7) {
                    ctx.globalAlpha = (val - 0.7) * 2;
                    ctx.fillStyle = 'rgba(255,255,255,0.8)';
                    ctx.beginPath();
                    ctx.arc(points[i].x, points[i].y, dotR * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        ctx.globalAlpha = 1;
    }

    /**
     * 重置状态
     */
    function reset() {
        smoothVals = null;
    }

    return {render, reset};
})();

window.VisualizerSpectrum = VisualizerSpectrum;
