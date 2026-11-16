/**
 * Bars Visualizer Renderer
 * 条形阵列：垂直柱状图从底部向上，支持 blocks / connected 两种风格
 */
const VisualizerBars = (function () {

  /**
   * 渲染一帧
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} params
   * @param {number} params.cw - 画布宽度（已乘 dpr）
   * @param {number} params.ch - 画布高度（已乘 dpr）
   * @param {Uint8Array} params.frequencyData - 频域数据
   * @param {number} params.bufferLength - 频域数据长度
   * @param {number} params.dpr - 设备像素比
   * @param {string} params.globalStyle - 'blocks' 或其他
   * @param {string|CanvasGradient} params.fillColor
   * @param {string|CanvasGradient} params.lineColor
   * @param {Function} params.resolveCanvasFill
   */
  function render(ctx, params) {
    const { cw, ch, frequencyData, bufferLength, dpr, globalStyle, fillColor, resolveCanvasFill } = params;

    const gap = globalStyle === 'blocks' ? 2 * dpr : 0;
    const targetPitch = 6 * dpr;
    const barCount = Math.min(Math.floor(cw / targetPitch), 1024);
    const barWidth = Math.max(1, Math.floor((cw - gap * barCount) / barCount));
    const step = Math.max(1, Math.floor(bufferLength / barCount));

    const fill = resolveCanvasFill(fillColor, ctx, cw, ch);
    ctx.fillStyle = fill;

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.min(i * step, bufferLength - 1);
      const value = frequencyData[dataIndex] || 0;
      const barHeight = Math.max(1, (value / 255) * ch);
      const x = i * (barWidth + gap);
      const y = ch - barHeight;

      if (globalStyle === 'blocks') {
        // Block style with rounded corners
        const radius = Math.min(barWidth / 2, 3 * dpr);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + barWidth, y, x + barWidth, y + barHeight, radius);
        ctx.arcTo(x + barWidth, y + barHeight, x, y + barHeight, 0);
        ctx.arcTo(x, y + barHeight, x, y, 0);
        ctx.arcTo(x, y, x + barWidth, y, radius);
        ctx.closePath();
        ctx.fill();
      } else {
        // Simple filled rectangle
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    }
  }

  function reset() {
    // No state to reset
  }

  return { render, reset };
})();

window.VisualizerBars = VisualizerBars;
