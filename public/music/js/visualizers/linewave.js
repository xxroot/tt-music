/**
 * Line Wave Visualizer Renderer
 * 线性波形：连续平滑曲线 + 3层辉光 + 示波器风格双向对称
 * 尊重 fillColor/lineColor 颜色设置，支持 rainbow 模式
 */
const VisualizerLineWave = (function () {
  let smoothVals = null;

  /**
   * 将颜色字符串解析为 [r, g, b] 数组
   * 支持 #rrggbb 和 #rgb 格式，不支持的格式回退为绿色
   * @param {string} color - hex 颜色字符串
   * @returns {number[]} [r, g, b]
   */
  function parseColor(color) {
    if (typeof color !== 'string') return [16, 185, 129];
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
   * 构建平滑点数组
   * @param {number} pointCount - 采样点数
   * @param {number} cw - 画布宽度
   * @param {number} centerY - 中心 Y
   * @param {number} maxAmp - 最大振幅
   * @returns {Array<{x:number, y:number}>}
   */
  function buildPoints(pointCount, cw, centerY, maxAmp) {
    const points = [];
    for (let i = 0; i < pointCount; i++) {
      const x = (cw / (pointCount - 1)) * i;
      const amp = smoothVals[i] * maxAmp;
      const y = centerY - amp;
      points.push({ x, y });
    }
    return points;
  }

  /**
   * 绘制一条平滑曲线路径（仅 beginPath + moveTo + quadraticCurveTo，不 stroke）
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<{x:number, y:number}>} points
   */
  function traceSmoothPath(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const cpX = (points[i].x + points[i + 1].x) / 2;
      const cpY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, cpX, cpY);
    }
    // 连接到最后一个点
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
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
   * @param {string|object} params.fillColor - 填充色（hex 或渐变对象）
   * @param {string|object} params.lineColor - 线条色
   * @param {Function} params.resolveCanvasFill - 颜色解析函数
   */
  function render(ctx, params) {
    const { cw, ch, frequencyData, bufferLength, dpr, fillColor } = params;

    // --- 布局 ---
    const pointCount = Math.min(Math.floor(cw / (2 * dpr)), 384);
    const step = Math.max(1, Math.floor(bufferLength / pointCount));
    const centerY = ch / 2;
    const maxAmp = ch * 0.38;

    // --- 颜色解析 ---
    const isRainbow = fillColor && typeof fillColor === 'object' && Array.isArray(fillColor.gradient);
    const rainbowColors = isRainbow ? fillColor.gradient : null;
    const baseColor = isRainbow ? [16, 185, 129] : parseColor(fillColor);

    // --- EMA 指数移动平均平滑 ---
    if (!smoothVals || smoothVals.length !== pointCount) {
      smoothVals = new Float32Array(pointCount);
    }
    for (let i = 0; i < pointCount; i++) {
      const idx = Math.min(i * step, bufferLength - 1);
      const raw = (frequencyData[idx] || 0) / 255;
      smoothVals[i] += (raw - smoothVals[i]) * 0.25;
    }

    // --- 构建上半段曲线点 ---
    const topPoints = buildPoints(pointCount, cw, centerY, maxAmp);

    // --- 构建下半段镜像点 ---
    const botPoints = topPoints.map(p => ({ x: p.x, y: centerY + (centerY - p.y) }));

    // --- 检测是否有有效频谱数据 ---
    const hasSignal = smoothVals.some(v => v > 0.01);

    // --- (A) 中心基线：极细半透明线 ---
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.04;
    ctx.lineWidth = 1 / dpr; // 1 物理像素
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(cw, centerY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- 辅助函数：对一组曲线执行三层辉光绘制 ---
    function drawGlowCurve(points, direction) {
      if (isRainbow) {
        // rainbow 模式：逐段绘制，每段独立颜色 × 三层辉光
        const widths = hasSignal ? [12 * dpr, 5 * dpr, 2 * dpr] : [0, 0, 0.5 * dpr];
        const alphas = hasSignal ? [0.08, 0.25, 1.0] : [0, 0, 0.3];
        for (let layer = 0; layer < 3; layer++) {
          if (widths[layer] === 0) continue;
          ctx.lineWidth = widths[layer];
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = alphas[layer];
          for (let i = 0; i < points.length - 1; i++) {
            if (hasSignal && smoothVals[i] < 0.01 && smoothVals[i + 1] < 0.01) continue;
            const ratio = i / (points.length - 1);
            const cIdx = Math.floor(ratio * (rainbowColors.length - 1));
            ctx.strokeStyle = rainbowColors[Math.min(cIdx, rainbowColors.length - 1)];
            const cpX = (points[i].x + points[i + 1].x) / 2;
            const cpY = (points[i].y + points[i + 1].y) / 2;
            ctx.beginPath();
            ctx.moveTo(points[i].x, points[i].y);
            ctx.quadraticCurveTo(points[i].x, points[i].y, cpX, cpY);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      } else {
        // 非 rainbow 模式：整体路径 × 三层辉光
        const [r, g, b] = baseColor;
        const colorStr = `rgb(${r},${g},${b})`;
        const brightStr = `rgb(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, b + 50)})`;

        if (hasSignal) {
          // Layer 1: 宽辉光线
          ctx.lineWidth = 12 * dpr;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = 0.08;
          ctx.strokeStyle = colorStr;
          traceSmoothPath(ctx, points);
          ctx.stroke();

          // Layer 2: 中等辉光线
          ctx.lineWidth = 5 * dpr;
          ctx.globalAlpha = 0.25;
          ctx.strokeStyle = colorStr;
          traceSmoothPath(ctx, points);
          ctx.stroke();
        }

        // Layer 3: 核心亮线（无信号时极细）
        ctx.lineWidth = hasSignal ? 2 * dpr : 0.5 * dpr;
        ctx.globalAlpha = hasSignal ? 1 : 0.3;
        ctx.strokeStyle = brightStr;
        traceSmoothPath(ctx, points);
        ctx.stroke();
      }
    }

    // --- (B) 绘制上半段波形 ---
    drawGlowCurve(topPoints, 'top');

    // --- (C) 绘制下半段镜像波形（稍低透明度） ---
    ctx.globalAlpha = 0.55;
    drawGlowCurve(botPoints, 'bot');
    ctx.globalAlpha = 1;

    // --- (D) 峰值高亮点 ---
    for (let i = 0; i < pointCount; i++) {
      const val = smoothVals[i];
      if (val > 0.45) {
        const px = topPoints[i].x;
        const py = topPoints[i].y;
        const dotR = Math.max(1.5 * dpr, 3 * dpr * val);
        const dotAlpha = (val - 0.45) * 1.8;

        // 上半段白色圆点
        ctx.globalAlpha = Math.min(0.85, dotAlpha);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();

        // 下半段镜像圆点
        ctx.beginPath();
        ctx.arc(px, centerY + (centerY - py), dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }

  /**
   * 重置状态（退出全屏时调用）
   */
  function reset() {
    smoothVals = null;
  }

  return { render, reset };
})();

window.VisualizerLineWave = VisualizerLineWave;
