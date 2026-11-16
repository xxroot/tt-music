/**
 * VU Meter - Retro Tape (复古深色磁带 VU 表)
 * 深炭黑磁带外壳、双白色卷轴动态转动 (十字轴心 + 4方卡槽)、
 * 中央 VU 竖线电平条、顶部音频参数文本、底部曲目信息文本、银色金属散热格栅
 * 整体黑白灰单色调，高度还原复古磁带视觉效果
 * 双卷轴循环：正向 30 分钟 → 反向 30 分钟，往返总周期 60 分钟
 */
const VUMeterRetroTape = (function () {
    // --- 状态变量 ---
    let _reelAngle = 0;         // 卷轴当前旋转角度 (rad)
    let _lastFrameTime = 0;     // 上一帧时间戳
    let _smoothL = 0;           // 左声道 VU 弹道平滑电平
    let _smoothR = 0;           // 右声道 VU 弹道平滑电平

    const CYCLE_MS = 60 * 60 * 1000; // 60 分钟往返周期

    // --- 固定配色 ---
    const SHELL_BG = '#0a0a0a';
    const SHELL_BORDER = '#2a2a2a';
    const SCREW_BASE = '#888888';
    const SCREW_SLOT = '#444444';
    const REEL_HUB_COLOR = '#e8e8e8';
    const REEL_HUB_EDGE = '#aaaaaa';
    const REEL_SLOT_COLOR = '#2a2a2a';
    const TAPE_COLOR = 'rgba(45, 30, 18, 0.55)';
    const TAPE_LINE = 'rgba(70, 48, 28, 0.4)';
    const VU_BAR_COLOR = 'rgba(210, 210, 210, 0.85)';
    const VU_BAR_HOT = 'rgba(255, 255, 255, 1.0)';
    const TEXT_COLOR = '#ffffff';
    const TEXT_COLOR_DIM = 'rgba(255, 255, 255, 0.6)';
    const GRILLE_LIGHT = '#666666';
    const GRILLE_DARK = '#2a2a2a';

    /**
     * 主渲染入口
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} params - { cw, ch, dpr, levelL, levelR, label }
     */
    function render(ctx, params) {
        const { cw, ch, dpr, levelL, levelR } = params;
        if (cw === 0 || ch === 0) return;

        // VU 弹道平滑
        _smoothL = smoothVU(_smoothL, levelL || 0);
        _smoothR = smoothVU(_smoothR, levelR || 0);

        // 时间增量
        const now = performance.now();
        const dt = _lastFrameTime ? (now - _lastFrameTime) / 1000 : 0.016;
        _lastFrameTime = now;

        // 磁带相位 (基于真实时间，60分钟往返)
        const phase = (Date.now() % CYCLE_MS) / CYCLE_MS; // 0~1
        const isForward = phase < 0.5;
        const tapeRatio = isForward ? (phase * 2) : (1 - (phase - 0.5) * 2);

        // 卷轴旋转
        const avgLevel = (_smoothL + _smoothR) / 2;
        const reelSpeed = 0.5 + avgLevel * 3.5;
        const direction = isForward ? 1 : -1;
        _reelAngle += direction * reelSpeed * dt;

        // 坐标系
        ctx.save();
        ctx.clearRect(0, 0, cw, ch);

        const w = cw;
        const h = ch;

        // 按层级绘制所有元素
        drawShell(ctx, w, h, dpr);
        drawFloralDecor(ctx, w, h, dpr);
        drawScrews(ctx, w, h, dpr);
        drawTopText(ctx, w, h, dpr);
        drawTapeWindow(ctx, w, h, dpr);
        drawReels(ctx, w, h, dpr, tapeRatio);
        drawVUMeter(ctx, w, h, dpr);
        drawBottomText(ctx, w, h, dpr);
        drawGrille(ctx, w, h, dpr);

        ctx.restore();
    }

    /**
     * 磁带外壳 - 深黑圆角矩形 + 深灰金属描边
     */
    function drawShell(ctx, w, h, dpr) {
        const margin = w * 0.025;
        const bw = w - margin * 2;
        const bh = h - margin * 2;
        const r = w * 0.045;

        // 外壳阴影
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 6 * dpr;
        ctx.shadowOffsetY = 2 * dpr;

        // 深黑外壳主体
        const shellGrad = ctx.createLinearGradient(margin, margin, margin, margin + bh);
        shellGrad.addColorStop(0, '#141414');
        shellGrad.addColorStop(0.5, SHELL_BG);
        shellGrad.addColorStop(1, '#0e0e0e');
        ctx.fillStyle = shellGrad;
        roundRect(ctx, margin, margin, bw, bh, r);
        ctx.fill();
        ctx.restore();

        // 金属边框
        ctx.strokeStyle = SHELL_BORDER;
        ctx.lineWidth = 1.5 * dpr;
        roundRect(ctx, margin, margin, bw, bh, r);
        ctx.stroke();

        // 内侧高光
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 0.8 * dpr;
        roundRect(ctx, margin + 2 * dpr, margin + 2 * dpr, bw - 4 * dpr, bh - 4 * dpr, r - 1 * dpr);
        ctx.stroke();
    }

    /**
     * 微弱花卉暗纹装饰 (极低透明度)
     */
    function drawFloralDecor(ctx, w, h, dpr) {
        const margin = w * 0.025;
        const cx = w / 2;
        const cy = h * 0.35;

        ctx.save();
        ctx.globalAlpha = 0.035;

        // 中心大花
        drawRose(ctx, cx, cy, w * 0.14, dpr);
        // 左侧花
        drawRose(ctx, margin + w * 0.15, cy - h * 0.05, w * 0.09, dpr);
        // 右侧花
        drawRose(ctx, w - margin - w * 0.15, cy - h * 0.05, w * 0.09, dpr);
        // 叶片点缀
        drawLeaf(ctx, cx - w * 0.2, cy + h * 0.05, w * 0.06, Math.PI * 0.3, dpr);
        drawLeaf(ctx, cx + w * 0.2, cy + h * 0.05, w * 0.06, -Math.PI * 0.3, dpr);
        drawLeaf(ctx, cx - w * 0.12, cy - h * 0.1, w * 0.05, Math.PI * 0.6, dpr);
        drawLeaf(ctx, cx + w * 0.12, cy - h * 0.1, w * 0.05, -Math.PI * 0.6, dpr);

        ctx.restore();
    }

    /**
     * 简化玫瑰图案 (多层同心花瓣)
     */
    function drawRose(ctx, cx, cy, r, dpr) {
        const layers = 4;
        for (let layer = 0; layer < layers; layer++) {
            const lr = r * (1 - layer * 0.2);
            const petals = 5 + layer;
            const offsetAngle = layer * 0.3;
            for (let i = 0; i < petals; i++) {
                const a = offsetAngle + (i / petals) * Math.PI * 2;
                const px = cx + Math.cos(a) * lr * 0.4;
                const py = cy + Math.sin(a) * lr * 0.4;
                ctx.beginPath();
                ctx.ellipse(px, py, lr * 0.35, lr * 0.2, a, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            }
        }
        // 花心
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }

    /**
     * 简化叶片
     */
    function drawLeaf(ctx, cx, cy, size, angle, dpr) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(size * 0.5, -size * 0.3, size, 0);
        ctx.quadraticCurveTo(size * 0.5, size * 0.3, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
    }

    /**
     * 四角铆钉螺丝 (X 槽纹)
     */
    function drawScrews(ctx, w, h, dpr) {
        const margin = w * 0.025;
        const inset = w * 0.055;
        const sr = w * 0.016;
        const positions = [
            [margin + inset, margin + inset],
            [w - margin - inset, margin + inset],
            [margin + inset, h - margin - inset],
            [w - margin - inset, h - margin - inset],
        ];

        positions.forEach(([x, y]) => {
            // 螺丝底座
            const screwGrad = ctx.createRadialGradient(x - sr * 0.2, y - sr * 0.2, 0, x, y, sr);
            screwGrad.addColorStop(0, '#aaaaaa');
            screwGrad.addColorStop(0.6, SCREW_BASE);
            screwGrad.addColorStop(1, '#555555');
            ctx.beginPath();
            ctx.arc(x, y, sr, 0, Math.PI * 2);
            ctx.fillStyle = screwGrad;
            ctx.fill();

            // 外圈
            ctx.strokeStyle = '#555555';
            ctx.lineWidth = 0.5 * dpr;
            ctx.stroke();

            // X 槽纹
            const s = sr * 0.6;
            ctx.beginPath();
            ctx.moveTo(x - s, y - s);
            ctx.lineTo(x + s, y + s);
            ctx.moveTo(x + s, y - s);
            ctx.lineTo(x - s, y + s);
            ctx.strokeStyle = SCREW_SLOT;
            ctx.lineWidth = 1.2 * dpr;
            ctx.stroke();
        });
    }

    /**
     * 顶部音频参数文本 (DSD256 11.29MHz 格式)
     */
    function drawTopText(ctx, w, h, dpr) {
        const song = getSongInfo();
        const centerX = w / 2;
        const topY = h * 0.08;

        // 格式行 (大字体)
        const formatText = song.formatLine || 'DSD256 11.29MHz';
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `bold ${Math.round(11 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        // letterSpacing 兼容性保护
        try { ctx.letterSpacing = `${Math.round(1.5 * dpr)}px`; } catch (e) { /* ignore */ }
        ctx.fillText(formatText, centerX, topY);
        try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }
    }

    /**
     * 磁带透明窗 (中央深灰窗口区域)
     */
    function drawTapeWindow(ctx, w, h, dpr) {
        const margin = w * 0.025;
        const wx = margin + w * 0.08;
        const wy = margin + h * 0.28;
        const ww = w - margin * 2 - w * 0.16;
        const wh = h * 0.42;
        const r = w * 0.03;

        // 窗口底色 (半透明深灰)
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 4 * dpr;
        ctx.shadowOffsetY = 1 * dpr;

        const winGrad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
        winGrad.addColorStop(0, '#1a1a1a');
        winGrad.addColorStop(0.5, '#141414');
        winGrad.addColorStop(1, '#1a1a1a');
        ctx.fillStyle = winGrad;
        roundRect(ctx, wx, wy, ww, wh, r);
        ctx.fill();
        ctx.restore();

        // 窗口边框
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1 * dpr;
        roundRect(ctx, wx, wy, ww, wh, r);
        ctx.stroke();

        // 内侧高光边
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 0.5 * dpr;
        roundRect(ctx, wx + 1.5 * dpr, wy + 1.5 * dpr, ww - 3 * dpr, wh - 3 * dpr, Math.max(1, r - 1 * dpr));
        ctx.stroke();
    }

    /**
     * 双卷轴 (白色十字轴心 + 4方卡槽 + 磁带缠绕)
     */
    function drawReels(ctx, w, h, dpr, tapeRatio) {
        const margin = w * 0.025;
        const wx = margin + w * 0.08;
        const wy = margin + h * 0.28;
        const ww = w - margin * 2 - w * 0.16;
        const wh = h * 0.42;

        const reelCY = wy + wh * 0.5;
        const reelLX = wx + ww * 0.22;
        const reelRX = wx + ww * 0.78;
        const hubR = wh * 0.13;
        const maxTapeR = wh * 0.38;

        // 左卷轴：磁带量 = 1 - tapeRatio
        const leftTapeAmount = 1 - tapeRatio;
        // 右卷轴：磁带量 = tapeRatio
        const rightTapeAmount = tapeRatio;

        drawReel(ctx, reelLX, reelCY, _reelAngle, hubR, maxTapeR, leftTapeAmount, dpr);
        drawReel(ctx, reelRX, reelCY, -_reelAngle, hubR, maxTapeR, rightTapeAmount, dpr);
    }

    /**
     * 单个卷轴绘制
     * @param {number} cx - 中心 X
     * @param {number} cy - 中心 Y
     * @param {number} angle - 旋转角度
     * @param {number} hubR - 毂半径
     * @param {number} maxTapeR - 最大磁带半径
     * @param {number} tapeAmount - 磁带量 0~1
     */
    function drawReel(ctx, cx, cy, angle, hubR, maxTapeR, tapeAmount, dpr) {
        const tapeR = hubR + (maxTapeR - hubR) * tapeAmount;

        // 磁带缠绕 (同心圆环)
        if (tapeAmount > 0.01) {
            const layers = Math.max(3, Math.round(tapeAmount * 14));
            for (let i = 0; i < layers; i++) {
                const ratio = i / layers;
                const r = tapeR - (tapeR - hubR) * ratio;
                const alpha = 0.15 + ratio * 0.25;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(70, 48, 28, ${alpha})`;
                ctx.lineWidth = Math.max(1, (tapeR - hubR) / layers * 0.75);
                ctx.stroke();
            }

            // 磁带最外圈填充
            ctx.beginPath();
            ctx.arc(cx, cy, tapeR, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(55, 38, 22, 0.25)';
            ctx.fill();
        }

        // 卷轴毂 (白色圆盘)
        ctx.save();
        ctx.translate(cx, cy);

        // 毂底色渐变
        ctx.beginPath();
        ctx.arc(0, 0, hubR, 0, Math.PI * 2);
        const hubGrad = ctx.createRadialGradient(-hubR * 0.2, -hubR * 0.2, 0, 0, 0, hubR);
        hubGrad.addColorStop(0, '#f5f5f5');
        hubGrad.addColorStop(0.5, REEL_HUB_COLOR);
        hubGrad.addColorStop(1, '#b0b0b0');
        ctx.fillStyle = hubGrad;
        ctx.fill();
        ctx.strokeStyle = REEL_HUB_EDGE;
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();

        // 十字轴心 + 4方卡槽 (旋转)
        ctx.save();
        ctx.rotate(angle);

        // 十字辐条
        const spokeLen = hubR * 0.82;
        const spokeWidth = hubR * 0.12;
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            ctx.save();
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(hubR * 0.15, -spokeWidth / 2);
            ctx.lineTo(spokeLen, -spokeWidth * 0.35);
            ctx.lineTo(spokeLen, spokeWidth * 0.35);
            ctx.lineTo(hubR * 0.15, spokeWidth / 2);
            ctx.closePath();
            ctx.fillStyle = '#c0c0c0';
            ctx.fill();
            ctx.strokeStyle = '#999999';
            ctx.lineWidth = 0.5 * dpr;
            ctx.stroke();
            ctx.restore();
        }

        // 4方卡槽 (在辐条之间)
        const slotSize = hubR * 0.18;
        const slotDist = hubR * 0.55;
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const sx = Math.cos(a) * slotDist;
            const sy = Math.sin(a) * slotDist;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(a);
            ctx.fillStyle = REEL_SLOT_COLOR;
            ctx.fillRect(-slotSize / 2, -slotSize / 2, slotSize, slotSize);
            ctx.strokeStyle = '#444444';
            ctx.lineWidth = 0.3 * dpr;
            ctx.strokeRect(-slotSize / 2, -slotSize / 2, slotSize, slotSize);
            ctx.restore();
        }

        // 中心孔
        ctx.beginPath();
        ctx.arc(0, 0, hubR * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();

        // 中心小圆点
        ctx.beginPath();
        ctx.arc(0, 0, hubR * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = '#666666';
        ctx.fill();

        ctx.restore(); // 旋转
        ctx.restore(); // 平移
    }

    /**
     * 中央 VU 竖线电平条 (左右声道各一组)
     */
    function drawVUMeter(ctx, w, h, dpr) {
        const margin = w * 0.025;
        const wx = margin + w * 0.08;
        const wy = margin + h * 0.28;
        const ww = w - margin * 2 - w * 0.16;
        const wh = h * 0.42;

        // VU 区域 (窗口中央)
        const vuX = wx + ww * 0.36;
        const vuW = ww * 0.28;
        const vuY = wy + wh * 0.1;
        const vuH = wh * 0.8;

        // 刻度线 (背景)
        const tickCount = 20;
        const tickGap = vuW / (tickCount + 1);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 0.5 * dpr;
        for (let i = 1; i <= tickCount; i++) {
            const tx = vuX + tickGap * i;
            const tickH = (i % 5 === 0) ? vuH * 0.12 : vuH * 0.06;
            ctx.beginPath();
            ctx.moveTo(tx, vuY + vuH / 2 - tickH);
            ctx.lineTo(tx, vuY + vuH / 2 + tickH);
            ctx.stroke();
        }

        // 中央基准线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 0.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(vuX, vuY + vuH / 2);
        ctx.lineTo(vuX + vuW, vuY + vuH / 2);
        ctx.stroke();

        // 左声道电平条 (左半部分)
        const halfW = vuW / 2 - 1 * dpr;
        const barCountPerCh = 12;
        const barGap = 1 * dpr;
        const barW = Math.max(1, (halfW - barGap * (barCountPerCh - 1)) / barCountPerCh);

        // 左声道 (从中间向左展开)
        drawChannelBars(ctx, vuX + halfW - barW, vuY, vuH, barW, barGap, barCountPerCh, _smoothL, -1, dpr);
        // 右声道 (从中间向右展开)
        drawChannelBars(ctx, vuX + halfW + 2 * dpr, vuY, vuH, barW, barGap, barCountPerCh, _smoothR, 1, dpr);
    }

    /**
     * 单声道电平条绘制
     * @param {number} startX - 起始 X
     * @param {number} vuY - VU 区域顶部 Y
     * @param {number} vuH - VU 区域高度
     * @param {number} barW - 条宽
     * @param {number} barGap - 条间距
     * @param {number} barCount - 条数量
     * @param {number} level - 电平 0~1
     * @param {number} dir - 方向 1=向右, -1=向左
     */
    function drawChannelBars(ctx, startX, vuY, vuH, barW, barGap, barCount, level, dir, dpr) {
        const centerY = vuY + vuH / 2;

        for (let i = 0; i < barCount; i++) {
            // 位置权重 (中间高两边低)
            const posRatio = i / (barCount - 1);
            const posWeight = 1 - Math.abs(posRatio - 0.5) * 0.8;

            // 添加随机扰动使波形更自然
            const noise = 0.7 + Math.random() * 0.3;
            const barLevel = level * posWeight * noise;

            const barH = Math.max(1 * dpr, barLevel * vuH * 0.42);
            const x = startX + dir * i * (barW + barGap);
            const halfH = barH / 2;

            // 颜色根据高度变化
            const intensity = Math.min(1, barLevel * 1.5);
            const color = intensity > 0.7 ? VU_BAR_HOT : VU_BAR_COLOR;

            // 上半条
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.5 + intensity * 0.5;
            ctx.fillRect(x, centerY - halfH, barW, halfH);

            // 下半条 (镜像)
            ctx.fillRect(x, centerY, barW, halfH);

            // 高电平顶部高光
            if (barLevel > 0.6) {
                const alpha = (barLevel - 0.6) * 2.5;
                ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 0.8)})`;
                ctx.fillRect(x, centerY - halfH, barW, 1.5 * dpr);
                ctx.fillRect(x, centerY + halfH - 1.5 * dpr, barW, 1.5 * dpr);
            }
        }
        ctx.globalAlpha = 1;
    }

    /**
     * 底部曲目信息文本
     */
    function drawBottomText(ctx, w, h, dpr) {
        const song = getSongInfo();
        const centerX = w / 2;
        const bottomY = h * 0.76;

        // 曲目名称
        const trackText = song.trackLine || 'La Primavera (Spring), Op. 8-1';
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `${Math.round(7 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(trackText, centerX, bottomY);
    }

    /**
     * 银色金属散热格栅
     */
    function drawGrille(ctx, w, h, dpr) {
        const margin = w * 0.025;
        const gx = margin + w * 0.1;
        const gy = margin + h * 0.82;
        const gw = w - margin * 2 - w * 0.2;
        const gh = h * 0.1;

        // 格栅背景
        const grilleGrad = ctx.createLinearGradient(gx, gy, gx, gy + gh);
        grilleGrad.addColorStop(0, '#3a3a3a');
        grilleGrad.addColorStop(0.3, '#2a2a2a');
        grilleGrad.addColorStop(0.7, '#1e1e1e');
        grilleGrad.addColorStop(1, '#2a2a2a');
        ctx.fillStyle = grilleGrad;
        roundRect(ctx, gx, gy, gw, gh, w * 0.015);
        ctx.fill();

        // 水平条纹 (明暗交替营造立体感)
        const lineCount = 5;
        const lineGap = gh / (lineCount + 1);
        for (let i = 1; i <= lineCount; i++) {
            const y = gy + lineGap * i;
            // 高光条纹
            ctx.strokeStyle = `rgba(120, 120, 120, ${0.3 + (i % 2) * 0.15})`;
            ctx.lineWidth = 1.2 * dpr;
            ctx.beginPath();
            ctx.moveTo(gx + gw * 0.03, y);
            ctx.lineTo(gx + gw * 0.97, y);
            ctx.stroke();

            // 阴影条纹 (紧贴下方)
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 0.6 * dpr;
            ctx.beginPath();
            ctx.moveTo(gx + gw * 0.03, y + 1.2 * dpr);
            ctx.lineTo(gx + gw * 0.97, y + 1.2 * dpr);
            ctx.stroke();
        }

        // 左侧圆形装饰
        const dotR = w * 0.014;
        const dotY = gy + gh * 0.5;
        const leftCircleX = gx - w * 0.025;

        ctx.beginPath();
        ctx.arc(leftCircleX, dotY, dotR, 0, Math.PI * 2);
        const dotGrad1 = ctx.createRadialGradient(leftCircleX, dotY, 0, leftCircleX, dotY, dotR);
        dotGrad1.addColorStop(0, '#aaaaaa');
        dotGrad1.addColorStop(1, '#555555');
        ctx.fillStyle = dotGrad1;
        ctx.fill();
        ctx.strokeStyle = '#444444';
        ctx.lineWidth = 0.5 * dpr;
        ctx.stroke();

        // 右侧圆形装饰
        const rightCircleX = gx + gw + w * 0.025;
        ctx.beginPath();
        ctx.arc(rightCircleX, dotY, dotR, 0, Math.PI * 2);
        const dotGrad2 = ctx.createRadialGradient(rightCircleX, dotY, 0, rightCircleX, dotY, dotR);
        dotGrad2.addColorStop(0, '#aaaaaa');
        dotGrad2.addColorStop(1, '#555555');
        ctx.fillStyle = dotGrad2;
        ctx.fill();
        ctx.strokeStyle = '#444444';
        ctx.lineWidth = 0.5 * dpr;
        ctx.stroke();

        // 左侧方形凸点
        const sqSize = dotR * 1.6;
        const sqX = gx + gw * 0.22;
        ctx.beginPath();
        const sqGrad1 = ctx.createLinearGradient(sqX, dotY - sqSize / 2, sqX, dotY + sqSize / 2);
        sqGrad1.addColorStop(0, '#666666');
        sqGrad1.addColorStop(1, '#333333');
        ctx.fillStyle = sqGrad1;
        ctx.fillRect(sqX - sqSize / 2, dotY - sqSize / 2, sqSize, sqSize);
        ctx.strokeStyle = '#444444';
        ctx.lineWidth = 0.3 * dpr;
        ctx.strokeRect(sqX - sqSize / 2, dotY - sqSize / 2, sqSize, sqSize);

        // 中间方形凸点
        const sqX2 = gx + gw * 0.5;
        ctx.beginPath();
        ctx.fillStyle = sqGrad1;
        ctx.fillRect(sqX2 - sqSize / 2, dotY - sqSize / 2, sqSize, sqSize);
        ctx.strokeStyle = '#444444';
        ctx.strokeRect(sqX2 - sqSize / 2, dotY - sqSize / 2, sqSize, sqSize);

        // 右侧方形凸点
        const sqX3 = gx + gw * 0.78;
        ctx.beginPath();
        ctx.fillStyle = sqGrad1;
        ctx.fillRect(sqX3 - sqSize / 2, dotY - sqSize / 2, sqSize, sqSize);
        ctx.strokeStyle = '#444444';
        ctx.strokeRect(sqX3 - sqSize / 2, dotY - sqSize / 2, sqSize, sqSize);
    }

    /**
     * 获取当前播放歌曲信息
     */
    function getSongInfo() {
        try {
            const song = window.currentPlayingSong;
            if (!song) {
                return {
                    formatLine: 'DSD256  11.29MHz',
                    trackLine: 'La Primavera (Spring), Op. 8-1, RV',
                };
            }

            // 构造格式行
            const quality = (song.quality || song.ext || 'FLAC').toUpperCase();
            let sampleRateStr = '';
            if (song.sampleRate) {
                const sr = Number(song.sampleRate);
                if (sr >= 1000000) {
                    // DSD 或超高采样率: 显示为 MHz
                    sampleRateStr = (sr / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'MHz';
                } else {
                    // PCM: 显示为 kHz
                    sampleRateStr = (sr / 1000).toFixed(1).replace(/\.0$/, '') + 'kHz';
                }
            }
            const bitDepth = song.bitDepth ? `${song.bitDepth}bit` : '';

            let formatLine = quality;
            if (sampleRateStr) formatLine += `  ${sampleRateStr}`;
            else if (bitDepth) formatLine += `  ${bitDepth}`;

            // 构造曲目行
            const name = song.name || song.title || '';
            const singer = song.singer || song.artist || '';
            const album = song.albumName || song.album || '';
            let trackLine = name;
            if (singer) trackLine += ` - ${singer}`;
            if (trackLine.length > 38) trackLine = trackLine.slice(0, 37) + '…';

            return { formatLine, trackLine };
        } catch (e) {
            return {
                formatLine: 'DSD256  11.29MHz',
                trackLine: 'La Primavera (Spring), Op. 8-1, RV',
            };
        }
    }

    /**
     * VU 弹道平滑: 快升慢降
     */
    function smoothVU(current, target) {
        if (target > current) {
            return current + (target - current) * 0.18;
        }
        return current + (target - current) * 0.04;
    }

    /**
     * 圆角矩形辅助
     */
    function roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /**
     * 重置所有状态
     */
    function reset() {
        _reelAngle = 0;
        _lastFrameTime = 0;
        _smoothL = 0;
        _smoothR = 0;
    }

    return { render, reset };
})();

window.VUMeterRetroTape = VUMeterRetroTape;
