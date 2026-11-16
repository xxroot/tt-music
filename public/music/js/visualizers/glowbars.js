/**
 * Glow Bars Visualizer Renderer
 * 辉光频谱：细条形 + 3层辉光 + 经典频谱分析仪风格
 * 尊重 fillColor/lineColor 颜色设置，支持 rainbow 模式
 */
const VisualizerGlowBars = (function () {
  let smoothBars = null;

  /**
   * 将颜色字符串解析为 [r, g, b] 数组
   * 支持 #rrggbb 和 #rgb 格式，不支持的格式回退为绿色
   * @param {string} color - hex 颜色字符串
   * @returns {number[]} [r, g, b]
   */
  function parseColor(color) {
    if (typeof color !== 'string') return [16, 185, 129]; // fallback #10b981
    let hex = color.replace('#', '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length !== 6) return [16, 185, 129];
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return [isNaN(r) ? 16 : r, isNaN(g) ? 185 : g, isNaN(b) ? 129 : b];
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
   * @param {string|object} params.fillColor - 填充色（hex 或渐变对象）
   * @param {string|object} params.lineColor - 线条色
   * @param {Function} params.resolveCanvasFill - 颜色解析函数
   */
  function render(ctx, params) {
    const { cw, ch, frequencyData, bufferLength, dpr, fillColor } = params;

    // --- 布局：细条形 + 窄间距，经典频谱分析仪风格 ---
    const barWidth = 3 * dpr;  // 固定细条宽度，忽略外部 barWidth
    const gap = 1 * dpr;
    const pitch = barWidth + gap;
    const barCount = Math.min(Math.floor(cw / pitch), 512);
    const step = Math.max(1, Math.floor(bufferLength / barCount));
    const baseY = ch * 0.92; // 基线靠近底部

    // --- 颜色解析 ---
    const isRainbow = fillColor && typeof fillColor === 'object' && Array.isArray(fillColor.gradient);
    const rainbowColors = isRainbow ? fillColor.gradient : null;
    // 非 rainbow 模式解析 fillColor 为 RGB
    const baseColor = isRainbow ? [16, 185, 129] : parseColor(fillColor);

    // --- EMA 指数移动平均平滑 ---
    if (!smoothBars || smoothBars.length !== barCount) {
      smoothBars = new Float32Array(barCount);
    }
    const smooth = 0.3;
    for (let i = 0; i < barCount; i++) {
      const idx = Math.min(i * step, bufferLength - 1);
      const raw = (frequencyData[idx] || 0) / 255;
      smoothBars[i] += (raw - smoothBars[i]) * smooth;
    }

    // --- 基线细线 ---
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, baseY, cw, 1 * dpr);

    // --- 绘制条形：3 层辉光 ---
    for (let i = 0; i < barCount; i++) {
      const val = smoothBars[i];
      if (val < 0.01) continue;

      const x = i * pitch;
      const maxH = baseY * 0.9;
      const barH = Math.max(1.5 * dpr, val * maxH);
      const y = baseY - barH;

      // 当前条形颜色（rainbow 按位置映射，其他模式统一色）
      const [r, g, b] = isRainbow
        ? parseColor(rainbowColors[i % rainbowColors.length])
        : baseColor;

      // Layer 1: 外层柔辉光（宽条形，极低透明度）
      const glowW1 = barWidth * 4;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.03 + val * 0.05})`;
      ctx.fillRect(x + barWidth / 2 - glowW1 / 2, y, glowW1, barH);

      // Layer 2: 中层辉光
      const glowW2 = barWidth * 2;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.08 + val * 0.12})`;
      ctx.fillRect(x + barWidth / 2 - glowW2 / 2, y, glowW2, barH);

      // Layer 3: 核心亮条（垂直渐变，底部暗→顶部亮）
      const coreGrad = ctx.createLinearGradient(x, baseY, x, y);
      coreGrad.addColorStop(0, `rgba(${r},${g},${b},0.3)`);
      coreGrad.addColorStop(0.4, `rgba(${r},${g},${b},0.85)`);
      coreGrad.addColorStop(1, `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},${0.9 + val * 0.1})`);
      ctx.fillStyle = coreGrad;
      ctx.fillRect(x, y, barWidth, barH);

      // 顶部白色高亮点（仅高振幅时显示）
      if (val > 0.35) {
        const dotAlpha = (val - 0.35) * 1.5;
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, dotAlpha)})`;
        ctx.fillRect(x, y, barWidth, 1.5 * dpr);
      }
    }
  }

  /**
   * 重置状态（退出全屏时调用）
   */
  function reset() {
    smoothBars = null;
  }

  return { render, reset };
})();

window.VisualizerGlowBars = VisualizerGlowBars;
