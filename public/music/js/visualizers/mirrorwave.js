/**
 * Mirror Wave Visualizer Renderer
 * 镜面波形：深蓝径向渐变背景 + 青蓝色霓虹发光竖线波形 + 中心基准线 + 半透明镜面倒影
 * 固定配色方案，不随颜色模式变化 (参考 gridwave.js / neonwave.js 先例)
 * 设计规格来源：Visualizer3.md
 */
const VisualizerMirrorWave = (function () {
    let smoothVals = null;

    // 固定配色
    const BG_CENTER = '#004860';
    const BG_EDGE = '#05151E';
    const GLOW_COLOR = '#00E0FF';
    const BAR_COLOR = '#00D8FF';
    const CENTER_LINE_COLOR = '#00E0FF';

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

        // ===== 1. 径向渐变背景 =====
        const bgGrad = ctx.createRadialGradient(
            cw / 2, ch / 2, 0,
            cw / 2, ch / 2, cw
        );
        bgGrad.addColorStop(0, BG_CENTER);
        bgGrad.addColorStop(1, BG_EDGE);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, cw, ch);

        // ===== 2. EMA 平滑频域数据 =====
        // [Fix] 使用浮点比例映射，避免 barCount > bufferLength 时右侧空白
        const pitch = 2 * dpr; // 密集竖线间距
        const lineWidth = 1.2 * dpr;
        const barCount = Math.min(Math.floor(cw / pitch), 2048);
        const step = bufferLength / barCount; // 浮点步长，确保全宽覆盖
        const maxHalfH = ch * 0.42;

        if (!smoothVals || smoothVals.length !== barCount) {
            smoothVals = new Float32Array(barCount);
        }
        const smoothFactor = 0.35;
        for (let i = 0; i < barCount; i++) {
            const idx = Math.min(Math.floor(i * step), bufferLength - 1);
            const raw = (frequencyData[idx] || 0) / 255;
            smoothVals[i] += (raw - smoothVals[i]) * smoothFactor;
        }

        // ===== 3. 下半倒影波形 (先绘制，在中层) =====
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.shadowColor = GLOW_COLOR;
        ctx.shadowBlur = 22 * dpr; // 倒影发光更柔和
        ctx.strokeStyle = BAR_COLOR;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        for (let i = 0; i < barCount; i++) {
            const val = smoothVals[i];
            if (val < 0.008) continue;
            const x = i * pitch;
            const lineHeight = Math.max(0.5 * dpr, val * maxHalfH);
            ctx.moveTo(x, centerY);
            ctx.lineTo(x, centerY + lineHeight);
        }
        ctx.stroke();
        ctx.restore();

        // ===== 4. 中心发光基准线 =====
        ctx.save();
        ctx.shadowColor = CENTER_LINE_COLOR;
        ctx.shadowBlur = 12 * dpr;
        ctx.strokeStyle = CENTER_LINE_COLOR;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(cw, centerY);
        ctx.stroke();
        ctx.restore();

        // ===== 5. 上半主波形 (顶层，霓虹发光) =====
        ctx.save();
        ctx.shadowColor = GLOW_COLOR;
        ctx.shadowBlur = 18 * dpr;
        ctx.lineWidth = lineWidth;
        // 竖线内部亮度渐变：顶部偏亮、底部稍暗
        const barGrad = ctx.createLinearGradient(0, centerY - maxHalfH, 0, centerY);
        barGrad.addColorStop(0, '#80F8FF'); // 顶部更亮
        barGrad.addColorStop(1, BAR_COLOR); // 底部基准色
        ctx.strokeStyle = barGrad;
        ctx.beginPath();
        for (let i = 0; i < barCount; i++) {
            const val = smoothVals[i];
            if (val < 0.008) continue;
            const x = i * pitch;
            const lineHeight = Math.max(0.5 * dpr, val * maxHalfH);
            ctx.moveTo(x, centerY - lineHeight);
            ctx.lineTo(x, centerY);
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 重置状态（退出全屏或切换样式时调用）
     */
    function reset() {
        smoothVals = null;
    }

    return { render, reset };
})();

window.VisualizerMirrorWave = VisualizerMirrorWave;
