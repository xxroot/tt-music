/**
 * Neon Wave Visualizer Renderer
 * 霓虹光波图：多层渐变光带波形从右向左无限滚动 + 音频驱动起伏 + 悬浮发光音符
 * 紫→蓝霓虹渐变发光质感，深色渐变背景
 */
const VisualizerNeonwave = (function () {
  // --- 可配置参数（方便后期微调）---
  const SCROLL_SPEED = 1.5;        // 滚动速度（像素/帧，基于 dpr=1）
  const AUDIO_SENSITIVITY = 1.6;   // 音频敏感度
  const GLOW_INTENSITY = 20;       // 霓虹发光强度 (shadowBlur 基准值)
  const WAVE_LAYERS = 4;           // 波形层数
  const WAVE_OPACITY = 0.35;       // 波形基础透明度
  const COLOR_START = '#CC33FF';   // 紫色起点 (粉紫)
  const COLOR_END = '#00F0FF';     // 青色终点
  const MIN_AMPLITUDE = 0.05;      // 静音时最小振幅比例
  const WAVE_BASE_FREQ = 0.008;    // 基础波形空间频率
  const SMOOTH_FACTOR = 0.15;      // 音频平滑系数

  // --- 状态变量 ---
  let scrollOffset = 0;
  let time = 0;
  let smoothVolume = 0;           // 平滑后的全局音量
  let smoothBands = null;         // 平滑后的频段数据

  /**
   * 将 hex 颜色解析为 [r, g, b]
   * @param {string} hex
   * @returns {number[]}
   */
  function parseHex(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16)
    ];
  }

  const COLOR_START_RGB = parseHex(COLOR_START);
  const COLOR_END_RGB = parseHex(COLOR_END);

  /**
   * 在两个 RGB 颜色之间线性插值
   * @param {number[]} c1 - [r, g, b]
   * @param {number[]} c2 - [r, g, b]
   * @param {number} t - 0..1
   * @returns {number[]}
   */
  function lerpColor(c1, c2, t) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t)
    ];
  }

  /**
   * 绘制一条平滑波形路径（填充区域，从波形到画布底部）
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cw - 画布宽度
   * @param {number} ch - 画布高度
   * @param {number} baseY - 波形基线 Y
   * @param {number} amplitude - 振幅
   * @param {number} freq - 空间频率
   * @param {number} phase - 相位偏移
   * @param {number} layerIdx - 层索引（用于细微差异）
   */
  function traceWavePath(ctx, cw, ch, baseY, amplitude, freq, phase, layerIdx) {
    const step = 3; // 每 3 像素采样一次，平滑且高效
    ctx.beginPath();
    ctx.moveTo(0, ch); // 从左下角开始
    for (let x = 0; x <= cw; x += step) {
      // 多层正弦波叠加，营造自然波形
      const wave1 = Math.sin((x + scrollOffset) * freq + phase);
      const wave2 = Math.sin((x + scrollOffset) * freq * 2.3 + phase * 1.7) * 0.3;
      const wave3 = Math.sin((x + scrollOffset) * freq * 0.5 + phase * 0.6 + layerIdx * 0.4) * 0.2;
      const y = baseY - amplitude * (wave1 + wave2 + wave3);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cw, ch); // 到右下角
    ctx.closePath();
  }

  /**
   * 绘制一个简笔音符（圆头 + 竖线 + 旗帜）
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - 中心 X
   * @param {number} y - 中心 Y
   * @param {number} size - 音符大小
   * @param {number} rotation - 旋转角度
   * @param {string} color - rgba 颜色字符串
   * @param {number} alpha - 透明度
   */
  function drawNote(ctx, x, y, size, rotation, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.globalAlpha = alpha;

    // 音符头部（椭圆）
    const headW = size * 0.5;
    const headH = size * 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, headW, headH, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // 竖线（符干）
    const stemX = headW * 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.08;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(stemX, 0);
    ctx.lineTo(stemX, -size * 1.2);
    ctx.stroke();

    // 旗帜（符尾）
    ctx.lineWidth = size * 0.06;
    ctx.beginPath();
    ctx.moveTo(stemX, -size * 1.2);
    ctx.quadraticCurveTo(
      stemX + size * 0.5, -size * 0.8,
      stemX + size * 0.15, -size * 0.4
    );
    ctx.stroke();

    ctx.restore();
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

    // --- 计算全局音量（EMA 平滑）---
    let rawVolume = 0;
    for (let i = 0; i < bufferLength; i++) {
      rawVolume += frequencyData[i];
    }
    rawVolume = (rawVolume / bufferLength / 255) * AUDIO_SENSITIVITY;
    smoothVolume += (rawVolume - smoothVolume) * SMOOTH_FACTOR;

    // --- 频段平滑（用于波形调制）---
    const bandCount = 32;
    if (!smoothBands || smoothBands.length !== bandCount) {
      smoothBands = new Float32Array(bandCount);
    }
    const bandSize = Math.floor(bufferLength / bandCount);
    for (let b = 0; b < bandCount; b++) {
      let sum = 0;
      for (let i = b * bandSize; i < (b + 1) * bandSize && i < bufferLength; i++) {
        sum += frequencyData[i];
      }
      const raw = (sum / bandSize / 255) * AUDIO_SENSITIVITY;
      smoothBands[b] += (raw - smoothBands[b]) * SMOOTH_FACTOR;
    }

    // --- 更新滚动偏移和时间 ---
    scrollOffset += SCROLL_SPEED * dpr;
    // 使用一个足够大的周期长度取模，防止浮点溢出
    const waveLength = Math.PI * 2 / WAVE_BASE_FREQ;
    if (scrollOffset > waveLength * 100) {
      scrollOffset -= waveLength * 100;
    }
    time += 0.016; // 约 60fps

    // === (A) 绘制背景渐变 ===
    const bgGrad = ctx.createLinearGradient(0, 0, 0, ch);
    bgGrad.addColorStop(0, '#2A1A4A');
    bgGrad.addColorStop(0.5, '#1A1040');
    bgGrad.addColorStop(1, '#0D1B2A');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cw, ch);

    // === (B) 绘制多层波形光带 ===
    // 有效音量（包含最小基础波动）
    const effectiveVolume = Math.max(MIN_AMPLITUDE, smoothVolume);
    const maxAmplitude = ch * 0.38;

    for (let layer = 0; layer < WAVE_LAYERS; layer++) {
      const layerRatio = layer / (WAVE_LAYERS - 1); // 0..1

      // 每层参数差异化
      const freq = WAVE_BASE_FREQ * (1 + layer * 0.15);
      const phase = layer * (Math.PI / 4); // 层间相位差 PI/4
      const baseY = ch * (0.55 + layer * 0.06); // 层间基线略有偏移

      // 振幅：音频驱动 + 层间差异
      const layerAmp = maxAmplitude * effectiveVolume * (0.6 + layerRatio * 0.4);

      // 颜色：从左紫到右青蓝，每层略有差异
      const layerColorStart = lerpColor(COLOR_START_RGB, [200, 50, 255], layerRatio * 0.3);
      const layerColorEnd = lerpColor([50, 200, 255], COLOR_END_RGB, layerRatio * 0.3);

      // 创建水平渐变（紫 → 青蓝）
      const waveGrad = ctx.createLinearGradient(0, 0, cw, 0);
      const alpha = WAVE_OPACITY * (0.5 + effectiveVolume * 0.5) * (0.7 + layerRatio * 0.3);
      const [sr, sg, sb] = layerColorStart;
      const [er, eg, eb] = layerColorEnd;
      waveGrad.addColorStop(0, `rgba(${sr},${sg},${sb},${alpha})`);
      waveGrad.addColorStop(0.5, `rgba(${Math.round((sr + er) / 2)},${Math.round((sg + eg) / 2)},${Math.round((sb + eb) / 2)},${alpha * 0.9})`);
      waveGrad.addColorStop(1, `rgba(${er},${eg},${eb},${alpha})`);

      // --- 三层辉光绘制（纱雾质感）---

      // Layer 1: 宽辉光（最外层柔光）
      ctx.save();
      ctx.shadowBlur = GLOW_INTENSITY * dpr * (1.5 + effectiveVolume);
      ctx.shadowColor = `rgba(${sr},${sg},${sb},0.4)`;
      ctx.globalAlpha = 0.3 + effectiveVolume * 0.2;
      ctx.fillStyle = waveGrad;
      traceWavePath(ctx, cw, ch, baseY, layerAmp * 1.1, freq, phase, layer);
      ctx.fill();
      ctx.restore();

      // Layer 2: 中等辉光
      ctx.save();
      ctx.shadowBlur = GLOW_INTENSITY * dpr * 0.6;
      ctx.shadowColor = `rgba(${er},${eg},${eb},0.5)`;
      ctx.globalAlpha = 0.5 + effectiveVolume * 0.3;
      ctx.fillStyle = waveGrad;
      traceWavePath(ctx, cw, ch, baseY, layerAmp, freq, phase, layer);
      ctx.fill();
      ctx.restore();

      // Layer 3: 核心亮线（顶部边缘高亮）
      ctx.save();
      ctx.shadowBlur = GLOW_INTENSITY * dpr * 0.3;
      ctx.shadowColor = `rgba(255,255,255,0.3)`;
      ctx.globalAlpha = 0.6 + effectiveVolume * 0.4;
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + effectiveVolume * 0.2})`;
      ctx.lineWidth = 1.5 * dpr;
      // 绘制波形顶部边缘线
      ctx.beginPath();
      const step = 3;
      for (let x = 0; x <= cw; x += step) {
        const wave1 = Math.sin((x + scrollOffset) * freq + phase);
        const wave2 = Math.sin((x + scrollOffset) * freq * 2.3 + phase * 1.7) * 0.3;
        const wave3 = Math.sin((x + scrollOffset) * freq * 0.5 + phase * 0.6 + layer * 0.4) * 0.2;
        const y = baseY - layerAmp * (wave1 + wave2 + wave3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // === (C) 绘制悬浮音符 ===
    const noteConfigs = [
      { xRatio: 0.22, yRatio: 0.28, color: COLOR_START, speed: 0.8, breathSpeed: 1.1, rotSpeed: 0.15, size: 28 },
      { xRatio: 0.50, yRatio: 0.22, color: '#AA66FF', speed: 1.0, breathSpeed: 0.9, rotSpeed: 0.12, size: 32 },
      { xRatio: 0.76, yRatio: 0.26, color: COLOR_END, speed: 0.7, breathSpeed: 1.3, rotSpeed: 0.10, size: 26 }
    ];

    for (const note of noteConfigs) {
      const nx = cw * note.xRatio;
      const ny = ch * note.yRatio + Math.sin(time * note.speed) * 8 * dpr;
      const rotation = Math.sin(time * note.rotSpeed) * 0.12; // 极缓旋转
      const alpha = 0.5 + 0.3 * Math.sin(time * note.breathSpeed); // 呼吸闪烁
      const noteSize = note.size * dpr;

      // 音符辉光
      ctx.save();
      ctx.shadowBlur = 15 * dpr;
      ctx.shadowColor = note.color;
      drawNote(ctx, nx, ny, noteSize, rotation, note.color, alpha);
      ctx.restore();
    }

    // 恢复全局状态
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /**
   * 重置状态（退出全屏或切换样式时调用）
   */
  function reset() {
    scrollOffset = 0;
    time = 0;
    smoothVolume = 0;
    smoothBands = null;
  }

  return { render, reset };
})();

window.VisualizerNeonwave = VisualizerNeonwave;
