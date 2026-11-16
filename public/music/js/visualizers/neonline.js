/**
 * Neon Line Visualizer Renderer
 * 霓虹线条频谱：LED灯条风格 + 直角条形 + 顶端白色弹跳方块 + 赛博朋克色彩渐变 + 底部倒影
 */
const VisualizerNeonline = (function () {
  let smoothBars = null;
  let capPositions = null;  // 每根柱子的白色块当前 Y 位置
  let capVelocities = null; // 每根柱子的白色块当前速度（负=向上，正=向下）

  /**
   * 赛博朋克色彩渐变：左=暖色(粉/品红) → 中=紫色 → 右=冷色(青/蓝)
   * @param {number} ratio 0..1 水平位置
   * @returns {number[]} [r, g, b]
   */
  function getNeonColor(ratio) {
    let r, g, b;
    if (ratio < 0.25) {
      const t = ratio / 0.25;
      r = 255; g = Math.round(20 + (0 - 20) * t); b = Math.round(147 + (255 - 147) * t);
    } else if (ratio < 0.5) {
      const t = (ratio - 0.25) / 0.25;
      r = Math.round(255 - 117 * t); g = 0; b = 255;
    } else if (ratio < 0.75) {
      const t = (ratio - 0.5) / 0.25;
      r = Math.round(138 * (1 - t)); g = Math.round(255 * t); b = 255;
    } else {
      const t = (ratio - 0.75) / 0.25;
      r = Math.round(30 * t); g = Math.round(255 - 60 * t); b = 255;
    }
    return [r, g, b];
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
   * @param {string} params.globalStyle - 'blocks' | 'connected'
   * @param {string|object} params.fillColor - 填充色（未使用，neonline 自带色彩）
   * @param {string|object} params.lineColor - 线条色（未使用）
   * @param {Function} params.resolveCanvasFill - 颜色解析函数（未使用）
   * @param {number} [params.barWidth] - 可选条形宽度（dpr 单位），不传则默认 12*dpr
   */
  function render(ctx, params) {
    const { cw, ch, frequencyData, bufferLength, dpr, barWidth: customBarWidth } = params;

    // --- 布局计算：直角条形 + 60% 间距 ---
    const barWidth = (customBarWidth || 12) * dpr;
    const gap = Math.round(barWidth * 0.6);
    const pitch = barWidth + gap;
    const barCount = Math.min(Math.floor(cw / pitch), 256);
    const step = Math.max(1, Math.floor(bufferLength / barCount));
    const baseY = ch * 0.88;

    // 白色块参数
    const capHeight = Math.max(3 * dpr, barWidth * 0.5); // 白色块固定高度
    const capGravity = 0.35 * dpr;  // 重力加速度（每帧速度增量）
    const capDamping = 0.92;        // 空气阻力（速度衰减系数，越小回落越慢）
    const capLaunchFactor = 1.6;    // 被顶时的向上抛出力度倍率

    // --- 指数移动平均平滑 ---
    if (!smoothBars || smoothBars.length !== barCount) {
      smoothBars = new Float32Array(barCount);
    }
    if (!capPositions || capPositions.length !== barCount) {
      capPositions = new Float32Array(barCount);
      capVelocities = new Float32Array(barCount);
      for (let i = 0; i < barCount; i++) {
        capPositions[i] = baseY - capHeight; // 初始位置在基线
        capVelocities[i] = 0;
      }
    }
    const smooth = 0.35;
    for (let i = 0; i < barCount; i++) {
      const idx = Math.min(i * step, bufferLength - 1);
      const raw = (frequencyData[idx] || 0) / 255;
      smoothBars[i] += (raw - smoothBars[i]) * smooth;
    }

    // --- 基线 / 地面 ---
    const groundGrad = ctx.createLinearGradient(0, baseY, 0, ch);
    groundGrad.addColorStop(0, 'rgba(40,0,60,0.3)');
    groundGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, baseY, cw, ch - baseY);

    // 细亮基线
    ctx.fillStyle = 'rgba(100,50,150,0.4)';
    ctx.fillRect(0, baseY, cw, 1 * dpr);

    // LED 灯珠分段参数
    const segmentH = barWidth * 0.6; // 每段高度
    const segmentGap = 2 * dpr; // 段间间隙
    const segmentPitch = segmentH + segmentGap;

    // --- 绘制条形：3 层辉光 + LED 灯珠分段 + 白色弹跳块 ---
    for (let i = 0; i < barCount; i++) {
      const val = smoothBars[i];
      if (val < 0.015) continue;

      const ratio = i / (barCount - 1);
      const [r, g, b] = getNeonColor(ratio);
      const x = i * pitch;
      const maxH = baseY * 0.95;
      const barH = Math.max(1, val * maxH);
      const barTopY = baseY - barH; // 主条顶端目标 Y

      // === 白色块弹跳物理（速度+重力模型）===
      // 主条顶端比白色块高时 → 给白色块一个向上的抛出速度（像顶皮球）
      if (barTopY < capPositions[i]) {
        // 计算主条的上升冲量（差值越大抛出越猛）
        const pushDelta = capPositions[i] - barTopY;
        capVelocities[i] = -pushDelta * capLaunchFactor; // 负速度=向上抛出
        capPositions[i] = barTopY; // 位置立即对齐
      } else {
        // 主条回落时，白色块受重力缓慢下落
        capVelocities[i] += capGravity;       // 重力加速
        capVelocities[i] *= capDamping;       // 空气阻力衰减
        capPositions[i] += capVelocities[i];  // 更新位置
      }
      // 限制白色块不能掉出基线以下
      const capMax = baseY - capHeight;
      if (capPositions[i] > capMax) {
        capPositions[i] = capMax;
        capVelocities[i] = 0; // 落地后速度归零
      }
      // 限制白色块不能飞出画布顶部
      if (capPositions[i] < 0) {
        capPositions[i] = 0;
        capVelocities[i] = Math.abs(capVelocities[i]) * 0.3; // 碰顶反弹，能量损失
      }

      // === Layer 1: 宽软辉光 ===
      const glowW1 = barWidth * 3;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.04 + val * 0.04})`;
      ctx.fillRect(x + barWidth / 2 - glowW1 / 2, barTopY, glowW1, barH);

      // === Layer 2: 中等辉光 ===
      const glowW2 = barWidth * 1.8;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.1 + val * 0.1})`;
      ctx.fillRect(x + barWidth / 2 - glowW2 / 2, barTopY, glowW2, barH);

      // === Layer 3: LED 灯珠分段（直角矩形）===
      const segCount = Math.max(1, Math.floor(barH / segmentPitch));
      for (let s = 0; s < segCount; s++) {
        const segY = baseY - (s + 1) * segmentPitch + segmentGap;
        if (segY < barTopY) break; // 超出主条范围则停止
        // 亮度变化：底部暗，顶部亮
        const segRatio = s / Math.max(1, segCount - 1);
        const brightness = 0.4 + segRatio * 0.6; // 0.4 ~ 1.0
        const sr = Math.round(r * brightness);
        const sg = Math.round(g * brightness);
        const sb = Math.round(b * brightness);
        const alpha = 0.6 + val * 0.4;
        ctx.fillStyle = `rgba(${sr},${sg},${sb},${alpha})`;
        ctx.fillRect(x, segY, barWidth, segmentH);
      }

      // === 顶端白色长方形（独立，无圆角）===
      const capY = capPositions[i];
      const capAlpha = 0.6 + val * 0.4;
      ctx.fillStyle = `rgba(255,255,255,${capAlpha})`;
      ctx.fillRect(x, capY, barWidth, capHeight);

      // === 底部倒影（渐隐镜像）===
      const refH = Math.min(barH * 0.35, ch - baseY);
      const refGrad = ctx.createLinearGradient(x, baseY, x, baseY + refH);
      refGrad.addColorStop(0, `rgba(${r},${g},${b},${0.12 * val})`);
      refGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = refGrad;
      ctx.fillRect(x, baseY, barWidth, refH);
    }
  }

  /**
   * 重置状态（退出全屏时调用）
   */
  function reset() {
    smoothBars = null;
    capPositions = null;
    capVelocities = null;
  }

  return { render, reset };
})();

window.VisualizerNeonline = VisualizerNeonline;
