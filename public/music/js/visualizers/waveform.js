/**
 * Waveform Visualizer Renderer
 * 双向对称波形图：中心辉光线 + 渐变条形(中心暗→端点亮) + 端点高亮点
 */
const VisualizerWaveform = (function () {
  let smoothVals = null;

  /**
   * 渲染一帧
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   * @param {Object} params - 渲染参数
   * @param {number} params.cw - 画布宽度（已乘 dpr）
   * @param {number} params.ch - 画布高度（已乘 dpr）
   * @param {Uint8Array} params.frequencyData - 频域数据
   * @param {number} params.bufferLength - 频域数据长度
   * @param {number} params.dpr - 设备像素比
   * @param {string} params.globalStyle - 'blocks' | 'connected'
   * @param {string|object} params.fillColor - 填充色（hex 或渐变对象）
   * @param {string|object} params.lineColor - 线条色
   * @param {Function} params.resolveCanvasFill - 颜色解析函数
   */
  function render(ctx, params) {
    const { cw, ch, frequencyData, bufferLength, dpr, globalStyle, fillColor, resolveCanvasFill, barWidth: customBarWidth } = params;

    // --- 判断是否为 rainbow 渐变模式 ---
    // rainbow 模式 fillColor 为 { gradient: [...], rotate: 0 }，不能直接用于 addColorStop
    // 需要为每个条形按位置映射独立颜色
    const isRainbow = fillColor && typeof fillColor === 'object' && Array.isArray(fillColor.gradient);
    const rainbowColors = isRainbow ? fillColor.gradient : null;

    // 非 rainbow 模式使用 resolveCanvasFill 获取可用的 fill 样式
    const fill = isRainbow ? null : resolveCanvasFill(fillColor, ctx, cw, ch);

    // --- 布局计算：粗条形 + 60% 间距，卡通风格 ---
    const barWidth = (customBarWidth || 10) * dpr; // 默认 10*dpr，footer 可传入较小值
    const gap = Math.round(barWidth * 0.6); // 间距为条形宽度的 60%
    const pitch = barWidth + gap;
    const barCount = Math.min(Math.floor(cw / pitch), 1024);
    const step = Math.max(1, Math.floor(bufferLength / barCount));
    const cornerRadius = barWidth * 0.4; // 顶端圆弧半径，卡通感
    const centerY = ch / 2;

    // --- 指数移动平均平滑 ---
    if (!smoothVals || smoothVals.length !== barCount) {
      smoothVals = new Float32Array(barCount);
    }
    for (let i = 0; i < barCount; i++) {
      const idx = Math.min(i * step, bufferLength - 1);
      const raw = (frequencyData[idx] || 0) / 255;
      smoothVals[i] += (raw - smoothVals[i]) * 0.35;
    }

    // --- 全局音量（中心线辉光强度）---
    let gVol = 0;
    for (let i = 0; i < barCount; i++) gVol += smoothVals[i];
    gVol /= barCount;

    // --- (A) 中心辉光线 ---
    const glowH = (4 + gVol * 12) * dpr;
    const axisGrad = ctx.createLinearGradient(0, centerY - glowH, 0, centerY + glowH);
    axisGrad.addColorStop(0, 'rgba(255,255,255,0)');
    axisGrad.addColorStop(0.3, `rgba(255,255,255,${0.02 + gVol * 0.04})`);
    axisGrad.addColorStop(0.5, `rgba(255,255,255,${0.06 + gVol * 0.1})`);
    axisGrad.addColorStop(0.7, `rgba(255,255,255,${0.02 + gVol * 0.04})`);
    axisGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = axisGrad;
    ctx.fillRect(0, centerY - glowH, cw, glowH * 2);

    // 细亮中心线
    ctx.fillStyle = `rgba(255,255,255,${0.08 + gVol * 0.15})`;
    ctx.fillRect(0, centerY - 0.5 * dpr, cw, 1 * dpr);

    // --- (B) 双向渐变条形 ---
    for (let i = 0; i < barCount; i++) {
      const val = smoothVals[i];
      if (val < 0.01) continue;

      const x = i * (barWidth + gap);
      const halfH = Math.max(1.5 * dpr, val * (ch * 0.42));

      // 获取当前条形的填充色：rainbow 按位置映射，其他模式用统一 fill
      const barFill = isRainbow
        ? rainbowColors[i % rainbowColors.length]
        : fill;

      // 上半段渐变：中心透明 → 端部饱和
      const topGrad = ctx.createLinearGradient(x, centerY, x, centerY - halfH);
      topGrad.addColorStop(0, 'rgba(255,255,255,0)');
      topGrad.addColorStop(0.15, barFill);
      topGrad.addColorStop(1, barFill);
      ctx.fillStyle = topGrad;

      // 上半圆角条形（仅顶端圆弧，卡通风格）
      const topY = centerY - halfH;
      ctx.beginPath();
      ctx.moveTo(x + cornerRadius, topY);
      ctx.arcTo(x + barWidth, topY, x + barWidth, topY + halfH, cornerRadius);
      ctx.lineTo(x + barWidth, centerY);
      ctx.lineTo(x, centerY);
      ctx.arcTo(x, topY, x + barWidth, topY, cornerRadius);
      ctx.closePath();
      ctx.fill();

      // 下半段渐变（镜像）
      const botGrad = ctx.createLinearGradient(x, centerY, x, centerY + halfH);
      botGrad.addColorStop(0, 'rgba(255,255,255,0)');
      botGrad.addColorStop(0.15, barFill);
      botGrad.addColorStop(1, barFill);
      ctx.fillStyle = botGrad;

      // 下半圆角条形（仅底端圆弧，卡通风格）
      ctx.beginPath();
      ctx.moveTo(x, centerY);
      ctx.lineTo(x + barWidth, centerY);
      ctx.arcTo(x + barWidth, centerY + halfH, x, centerY + halfH, cornerRadius);
      ctx.arcTo(x, centerY + halfH, x, centerY, cornerRadius);
      ctx.closePath();
      ctx.fill();

      // --- (C) 端点高亮点 ---
      if (val > 0.1) {
        const dotR = Math.max(2 * dpr, barWidth * 0.45);
        const dotAlpha = 0.3 + val * 0.6;
        ctx.fillStyle = `rgba(255,255,255,${dotAlpha})`;
        // 上端点
        ctx.beginPath();
        ctx.arc(x + barWidth / 2, centerY - halfH, dotR, 0, Math.PI * 2);
        ctx.fill();
        // 下端点
        ctx.beginPath();
        ctx.arc(x + barWidth / 2, centerY + halfH, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * 重置状态（退出全屏时调用）
   */
  function reset() {
    smoothVals = null;
  }

  return { render, reset };
})();

window.VisualizerWaveform = VisualizerWaveform;
