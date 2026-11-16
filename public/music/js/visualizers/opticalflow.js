/**
 * Optical Flow Visualizer Renderer
 * 光流频谱：发光柱状图 + 向下拖尾效果，紫/品红/蓝色调色板
 */
const VisualizerOpticalFlow = (function () {
  let prevBars = null;
  let prevPrevBars = null;

  // Color palette for flowing light (purple, magenta, blue)
  const FLOW_COLORS = [
    [75, 0, 130],    // Indigo
    [138, 43, 226],  // BlueViolet
    [255, 20, 147],  // DeepPink
    [199, 21, 133],  // MediumVioletRed
    [65, 105, 225],  // RoyalBlue
    [148, 0, 211],   // DarkViolet
    [186, 85, 211],  // MediumOrchid
    [100, 149, 237], // CornflowerBlue
  ];

  /**
   * 渲染一帧
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} params
   */
  function render(ctx, params) {
    const { cw, ch, frequencyData, bufferLength, dpr, globalStyle } = params;

    const bw = Math.max(1, Math.floor(6 * dpr));
    const gap = globalStyle === 'blocks' ? 2 * dpr : 1 * dpr;
    const barCount = Math.min(Math.floor(cw / (bw + gap)), 1024);
    const step = Math.max(1, Math.floor(bufferLength / barCount));

    // Compute current bar heights
    const curBars = new Float32Array(barCount);
    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.min(i * step, bufferLength - 1);
      curBars[i] = (frequencyData[dataIndex] || 0) / 255;
    }

    // Initialize previous frame storage
    if (!prevBars || prevBars.length !== barCount) {
      prevBars = new Float32Array(barCount);
      prevPrevBars = new Float32Array(barCount);
    }

    // Draw trails from previous frames (fading ghost bars shifted downward)
    // Second-previous frame: faint, lower
    for (let i = 0; i < barCount; i++) {
      const val = prevPrevBars[i];
      if (val < 0.02) continue;
      const x = i * (bw + gap);
      const trailH = Math.max(1, val * ch * 0.6);
      const trailY = ch - trailH + trailH * 0.2;
      const colorIdx = i % FLOW_COLORS.length;
      const [r, g, b] = FLOW_COLORS[colorIdx];
      ctx.fillStyle = `rgba(${r},${g},${b},0.07)`;
      ctx.fillRect(x, trailY, bw, trailH * 0.5);
    }

    // Previous frame: medium ghost
    for (let i = 0; i < barCount; i++) {
      const val = prevBars[i];
      if (val < 0.02) continue;
      const x = i * (bw + gap);
      const trailH = Math.max(1, val * ch * 0.8);
      const trailY = ch - trailH + trailH * 0.1;
      const colorIdx = i % FLOW_COLORS.length;
      const [r, g, b] = FLOW_COLORS[colorIdx];
      ctx.fillStyle = `rgba(${r},${g},${b},0.14)`;
      ctx.fillRect(x, trailY, bw, trailH * 0.4);
    }

    // Draw current bars with glow
    for (let i = 0; i < barCount; i++) {
      const val = curBars[i];
      if (val < 0.01) continue;
      const x = i * (bw + gap);
      const barH = Math.max(1, val * ch);
      const y = ch - barH;
      const colorIdx = i % FLOW_COLORS.length;
      const [r, g, b] = FLOW_COLORS[colorIdx];

      // Outer glow layer (wider, very transparent)
      const glowR = bw * 3;
      const grd = ctx.createRadialGradient(
        x + bw / 2, y, 0,
        x + bw / 2, y, glowR
      );
      grd.addColorStop(0, `rgba(${r},${g},${b},${0.2 * val})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(x - glowR, y - glowR, bw + glowR * 2, glowR * 2);

      // Main bar with vertical gradient (brighter at top, fading toward bottom)
      const barGrad = ctx.createLinearGradient(x, y, x, ch);
      barGrad.addColorStop(0, `rgba(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)},${0.7 + val * 0.3})`);
      barGrad.addColorStop(0.3, `rgba(${r},${g},${b},0.6)`);
      barGrad.addColorStop(1, `rgba(${r},${g},${b},0.1)`);
      ctx.fillStyle = barGrad;

      if (globalStyle === 'blocks') {
        const radius = Math.min(bw / 2, 2 * dpr);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + bw, y, x + bw, y + barH, radius);
        ctx.lineTo(x + bw, ch);
        ctx.lineTo(x, ch);
        ctx.arcTo(x, y, x + bw, y, radius);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x, y, bw, barH);
      }

      // Bright tip at the top of each bar
      const tipH = Math.max(2, 4 * dpr);
      ctx.fillStyle = `rgba(255,255,255,${0.3 + val * 0.5})`;
      ctx.fillRect(x, y, bw, tipH);
    }

    // Save current bars for next frame's trails
    prevPrevBars = prevBars;
    prevBars = curBars;
  }

  function reset() {
    prevBars = null;
    prevPrevBars = null;
  }

  return { render, reset };
})();

window.VisualizerOpticalFlow = VisualizerOpticalFlow;
