/**
 * VU Meter - Eversolo (暖色渐变模拟 VU 表)
 * 矩形表盘、暖色米黄/琥珀渐变背景、深灰边框、水平直线刻度、黑色细指针 (固定长度无箭头)
 * 刻度: -20, -10, -7, -5, -2, 0, +3 dB，红色过载区 (0~+3dB)，"dB" 白色标签
 */
const VUMeterEversolo = (function () {
    let _smoothNeedle = 0;

    /**
     * 渲染一帧
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} params
     * @param {number} params.cw - canvas 宽度 (已乘 dpr)
     * @param {number} params.ch - canvas 高度 (已乘 dpr)
     * @param {number} params.dpr - 设备像素比
     * @param {number} params.levelL - 左声道电平 0~1 (RMS)
     * @param {number} params.levelR - 右声道电平 0~1 (RMS)
     * @param {string} params.label - 显示标签 'L'/'R'/'SL'/'SR'
     */
    function render(ctx, params) {
        const { cw, ch, dpr, levelL, levelR, label } = params;
        const level = levelL || levelR;

        if (cw === 0 || ch === 0) return;

        // --- VU 弹道平滑 ---
        const targetNeedle = levelToNeedleRatio(level);
        if (targetNeedle > _smoothNeedle) {
            _smoothNeedle += (targetNeedle - _smoothNeedle) * 0.15;
        } else {
            _smoothNeedle += (targetNeedle - _smoothNeedle) * 0.04;
        }

        // --- 布局常量 ---
        const pad = 6 * dpr;
        const frameX = pad, frameY = pad;
        const frameW = cw - 2 * pad, frameH = ch - 2 * pad;
        const bezel = 7 * dpr;
        const dialX = frameX + bezel;
        const dialY = frameY + bezel;
        const dialW = frameW - 2 * bezel;
        const dialH = frameH - 2 * bezel;
        const cornerR = 6 * dpr;

        // 刻度区域
        const scalePadX = dialW * 0.08;
        const scaleLeftX = dialX + scalePadX;
        const scaleRightX = dialX + dialW - scalePadX;
        const scaleWidth = scaleRightX - scaleLeftX;
        const scaleY = dialY + dialH * 0.55;

        // 指针枢轴
        const pivotX = cw / 2;
        const pivotY = dialY + dialH * 0.92;

        // --- 绘制 ---
        drawBackground(ctx, frameX, frameY, frameW, frameH,
            dialX, dialY, dialW, dialH, dpr, cornerR);
        drawRedZone(ctx, scaleLeftX, scaleWidth, scaleY, dpr);
        drawScale(ctx, scaleLeftX, scaleWidth, scaleY, dpr);
        drawNeedle(ctx, pivotX, pivotY, scaleY, dpr, _smoothNeedle,
            scaleLeftX, scaleWidth);
        drawPivot(ctx, pivotX, pivotY, dpr);
        drawLabels(ctx, dialX, dialY, dialW, dialH, dpr, label);
    }

    /**
     * 将 RMS 电平映射到指针比例 (0~1)
     * -20dB ~ +3dB 对应 0 ~ 1
     */
    function levelToNeedleRatio(rms) {
        if (rms < 0.001) return 0;
        const db = 20 * Math.log10(rms);
        const MIN_DB = -20, MAX_DB = 3;
        return Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
    }

    /**
     * 绘制圆角矩形路径
     */
    function roundRect(ctx, x, y, w, h, r) {
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
     * 绘制背景: 深灰外框 + 暖色米黄/琥珀渐变表盘
     */
    function drawBackground(ctx, frameX, frameY, frameW, frameH,
        dialX, dialY, dialW, dialH, dpr, cornerR) {
        // 1. 外框: 深灰色圆角矩形
        ctx.fillStyle = '#2a2a2a';
        roundRect(ctx, frameX, frameY, frameW, frameH, cornerR);
        ctx.fill();

        // 2. 外框微光 (顶部高光)
        const bevelGrad = ctx.createLinearGradient(frameX, frameY, frameX, frameY + frameH);
        bevelGrad.addColorStop(0, 'rgba(80, 80, 80, 0.4)');
        bevelGrad.addColorStop(0.06, 'rgba(50, 50, 50, 0.1)');
        bevelGrad.addColorStop(0.94, 'rgba(0, 0, 0, 0.15)');
        bevelGrad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
        ctx.fillStyle = bevelGrad;
        roundRect(ctx, frameX, frameY, frameW, frameH, cornerR);
        ctx.fill();

        // 3. 表盘: 暖色米黄 → 琥珀渐变 (eversolo 风格)
        const warmGrad = ctx.createLinearGradient(dialX, dialY, dialX, dialY + dialH);
        warmGrad.addColorStop(0, '#f5e6c8');     // 暖米色顶部
        warmGrad.addColorStop(0.35, '#ecd8a8');   // 浅金黄
        warmGrad.addColorStop(0.7, '#dfc080');    // 琥珀金
        warmGrad.addColorStop(1, '#c8a050');      // 深琥珀底部
        ctx.fillStyle = warmGrad;
        roundRect(ctx, dialX, dialY, dialW, dialH, cornerR * 0.6);
        ctx.fill();

        // 4. 表盘内细边框
        ctx.strokeStyle = 'rgba(100, 70, 30, 0.25)';
        ctx.lineWidth = 1 * dpr;
        roundRect(ctx, dialX + 1 * dpr, dialY + 1 * dpr,
            dialW - 2 * dpr, dialH - 2 * dpr, cornerR * 0.5);
        ctx.stroke();
    }

    /**
     * 绘制红色过载区背景条 (0~+3dB)
     */
    function drawRedZone(ctx, scaleLeftX, scaleWidth, scaleY, dpr) {
        const MIN_DB = -20, MAX_DB = 3;
        const zeroX = scaleLeftX + ((0 - MIN_DB) / (MAX_DB - MIN_DB)) * scaleWidth;
        const maxX = scaleLeftX + scaleWidth;
        const barTop = scaleY - 14 * dpr;
        const barBottom = scaleY + 4 * dpr;

        ctx.fillStyle = 'rgba(180, 40, 30, 0.15)';
        ctx.fillRect(zeroX, barTop, maxX - zeroX, barBottom - barTop);
    }

    /**
     * 绘制水平直线刻度
     */
    function drawScale(ctx, scaleLeftX, scaleWidth, scaleY, dpr) {
        const majorTicks = [-20, -10, -7, -5, -2, 0, 3];
        const MIN_DB = -20, MAX_DB = 3;

        // 水平基线
        ctx.beginPath();
        ctx.moveTo(scaleLeftX, scaleY);
        ctx.lineTo(scaleLeftX + scaleWidth, scaleY);
        ctx.strokeStyle = 'rgba(40, 40, 40, 0.5)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();

        // 主刻度线 + 数字
        majorTicks.forEach(db => {
            const x = scaleLeftX + ((db - MIN_DB) / (MAX_DB - MIN_DB)) * scaleWidth;
            const isRed = db >= 0;

            // 主刻度线 (从基线向上)
            ctx.beginPath();
            ctx.moveTo(x, scaleY);
            ctx.lineTo(x, scaleY - 12 * dpr);
            ctx.strokeStyle = isRed ? '#bb2222' : '#2a2a2a';
            ctx.lineWidth = 2 * dpr;
            ctx.stroke();

            // 数字标签 (刻度线上方)
            ctx.fillStyle = isRed ? '#bb2222' : '#2a2a2a';
            ctx.font = `bold ${Math.round(8 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const displayText = db > 0 ? '+' + db.toString() : db.toString();
            ctx.fillText(displayText, x, scaleY - 14 * dpr);
        });

        // 细分小刻度 (每 1dB，跳过主刻度)
        for (let db = MIN_DB; db <= MAX_DB; db++) {
            if (majorTicks.includes(db)) continue;
            const x = scaleLeftX + ((db - MIN_DB) / (MAX_DB - MIN_DB)) * scaleWidth;
            ctx.beginPath();
            ctx.moveTo(x, scaleY);
            ctx.lineTo(x, scaleY - 5 * dpr);
            ctx.strokeStyle = db >= 0 ? 'rgba(180, 40, 30, 0.4)' : 'rgba(40, 40, 40, 0.3)';
            ctx.lineWidth = 1 * dpr;
            ctx.stroke();
        }
    }

    /**
     * 绘制黑色直线指针 (固定长度，无箭头)
     * @param {number} needleRatio - 0~1 指针位置比例
     */
    function drawNeedle(ctx, pivotX, pivotY, scaleY, dpr, needleRatio,
        scaleLeftX, scaleWidth) {
        const tipX = scaleLeftX + needleRatio * scaleWidth;

        // 计算从枢轴到尖端的角度
        const dx = tipX - pivotX;
        const dy = -(pivotY - scaleY);
        const angle = Math.atan2(dx, -dy);

        // 固定指针长度 (足够长以覆盖 -20dB 到 +3dB 全范围)
        const needleLen = (pivotY - scaleY) * 2;

        ctx.save();
        ctx.translate(pivotX, pivotY);
        ctx.rotate(angle);

        // 指针阴影
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 3 * dpr;
        ctx.shadowOffsetX = 1 * dpr;
        ctx.shadowOffsetY = 1 * dpr;

        // 黑色细线指针 (从枢轴向上，固定长度)
        ctx.beginPath();
        ctx.moveTo(0, 8 * dpr);      // 尾部 (枢轴下方一小段)
        ctx.lineTo(0, -needleLen);    // 尖端
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2.5 * dpr;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.shadowColor = 'transparent';
        ctx.restore();
    }

    /**
     * 绘制枢轴圆
     */
    function drawPivot(ctx, pivotX, pivotY, dpr) {
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#333';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 3 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#555';
        ctx.fill();
    }

    /**
     * 绘制标签: 底部 "dB" 白字 + 声道标签
     */
    function drawLabels(ctx, dialX, dialY, dialW, dialH, dpr, label) {
        // "dB" 标签 (刻度线下方居中，白色粗体)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = `bold ${Math.round(11 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('dB', dialX + dialW / 2, dialY + dialH * 0.60);

        // 底部声道标签 (白色字 + 半透明深色背景条)
        const labelText = label || 'VU';
        const labelW = 36 * dpr;
        const labelH = 16 * dpr;
        const labelX = dialX + dialW / 2 - labelW / 2;
        const labelY = dialY + dialH - 22 * dpr;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        roundRect(ctx, labelX, labelY, labelW, labelH, 3 * dpr);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(9 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, dialX + dialW / 2, labelY + labelH / 2);
    }

    /** 重置平滑状态 */
    function reset() {
        _smoothNeedle = 0;
    }

    return { render, reset };
})();

window.VUMeterEversolo = VUMeterEversolo;
