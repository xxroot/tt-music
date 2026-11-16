/**
 * Smooth Wave Visualizer Renderer
 * 平滑波浪：二次贝塞尔曲线平滑填充多边形，从底部向上
 */
const VisualizerSmoothWave = (function () {
  let smoothVals = null;

  /**
   * 渲染一帧
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} params
   */
  function render(ctx, params) {
    const { cw, ch, frequencyData, bufferLength, dpr, fillColor, resolveCanvasFill } = params;

    const targetPitch = 8 * dpr;
    const pointCount = Math.min(Math.floor(cw / targetPitch), 512);
    const step = Math.max(1, Math.floor(bufferLength / pointCount));

    // 指数移动平均平滑
    if (!smoothVals || smoothVals.length !== pointCount) {
      smoothVals = new Float32Array(pointCount);
    }
    for (let i = 0; i < pointCount; i++) {
      const idx = Math.min(i * step, bufferLength - 1);
      const raw = (frequencyData[idx] || 0) / 255;
      smoothVals[i] += (raw - smoothVals[i]) * 0.3;
    }

    const fill = resolveCanvasFill(fillColor, ctx, cw, ch);

    ctx.beginPath();
    ctx.moveTo(0, ch);

    for (let i = 0; i <= pointCount; i++) {
      const x = Math.floor(cw / pointCount) * i;
      const val = i < pointCount ? smoothVals[i] : smoothVals[pointCount - 1];
      const y = ch - val * ch;

      if (i === 0) {
        ctx.lineTo(x, y);
      } else {
        const prevVal = smoothVals[i - 1] || 0;
        const prevX = Math.floor(cw / pointCount) * (i - 1);
        const prevY = ch - prevVal * ch;
        const cpX = (prevX + x) / 2;
        ctx.quadraticCurveTo(prevX + (x - prevX) * 0.5, prevY, cpX, (prevY + y) / 2);
        ctx.quadraticCurveTo(cpX + (x - prevX) * 0.5, y, x, y);
      }
    }

    ctx.lineTo(cw, ch);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function reset() {
    smoothVals = null;
  }

  return { render, reset };
})();

window.VisualizerSmoothWave = VisualizerSmoothWave;
