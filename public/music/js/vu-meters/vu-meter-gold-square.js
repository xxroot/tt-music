/**
 * VU Meter - Gold Square (金色方形 VU 表)
 * 方形表盘、深黑背景、弧形刻度+金色指针、金色外框+暗角效果
 */
const VUMeterGoldSquare = (function () {
    let _smoothNeedle = 0;

    function render(ctx, params) {
        const { cw, ch, dpr, levelL, levelR, label } = params;
        const level = levelL || levelR;

        if (cw === 0 || ch === 0) return;

        // --- VU 弹道平滑 ---
        if (level > _smoothNeedle) {
            _smoothNeedle += (level - _smoothNeedle) * 0.15;
        } else {
            _smoothNeedle += (level - _smoothNeedle) * 0.04;
        }

        const pad = 4 * dpr;
        const w = cw - pad * 2;
        const h = ch - pad * 2;

        // --- 背景: 深黑色 ---
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, cw, ch);

        // --- 暗角效果 ---
        const vignetteGrad = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
        vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = vignetteGrad;
        ctx.fillRect(0, 0, cw, ch);

        // --- 金色外框 ---
        const frameGrad = ctx.createLinearGradient(0, 0, cw, ch);
        frameGrad.addColorStop(0, '#c8a84e');
        frameGrad.addColorStop(0.3, '#e8d88e');
        frameGrad.addColorStop(0.5, '#a8882e');
        frameGrad.addColorStop(0.7, '#e8d88e');
        frameGrad.addColorStop(1, '#c8a84e');
        ctx.strokeStyle = frameGrad;
        ctx.lineWidth = 3 * dpr;
        ctx.strokeRect(pad, pad, w, h);

        // 内框
        ctx.strokeStyle = 'rgba(200, 168, 78, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(pad + 4 * dpr, pad + 4 * dpr, w - 8 * dpr, h - 8 * dpr);

        // --- 表盘区域 ---
        const dialPad = 14 * dpr;
        const dialX = pad + dialPad;
        const dialY = pad + dialPad * 1.2; // 表盘下移
        const dialW = w - dialPad * 2;
        const dialH = h * 0.82;

        // 表盘背景 (暖金色微光)
        const dialGrad = ctx.createRadialGradient(
            dialX + dialW / 2, dialY + dialH * 0.50, 0,
            dialX + dialW / 2, dialY + dialH * 0.50, dialW * 0.1
        );
        dialGrad.addColorStop(0, 'rgba(60, 45, 15, 0.6)');
        dialGrad.addColorStop(1, 'rgba(20, 15, 5, 0.8)');
        ctx.fillStyle = dialGrad;
        ctx.fillRect(dialX, dialY, dialW, dialH);

        // --- 弧形刻度 (上半圆: 210°→330°) ---
        const arcCx = dialX + dialW / 2;
        const arcCy = dialY + dialH * 0.85;
        const arcR = dialW * 0.48;
        drawArcScale(ctx, arcCx, arcCy, arcR, dpr);

        // --- 指针 ---
        const needleRatio = levelToRatio(_smoothNeedle);
        drawNeedle(ctx, arcCx, arcCy, arcR, dpr, needleRatio);

        // --- 底部标签 ---
        ctx.fillStyle = 'rgba(200, 168, 78, 0.6)';
        ctx.font = `bold ${Math.round(10 * dpr)}px "Georgia", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label || 'VU', cw / 2, ch - pad * 4);

        // --- "VU" 水印文字 (弧形刻度下方) ---
        ctx.fillStyle = 'rgba(200, 168, 78, 0.25)';
        ctx.font = `bold ${Math.round(12 * dpr)}px "Georgia", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VU', cw / 2, arcCy - arcR * 0.15);
    }

    function levelToRatio(level) {
        if (level < 0.001) return 0;
        const db = 20 * Math.log10(level);
        return Math.max(0, Math.min(1, (db - (-20)) / (3 - (-20))));
    }

    function drawArcScale(ctx, cx, cy, r, dpr) {
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB (左上)
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB (右上)
        const majorTicks = [-20, -10, -7, -5, -3, 0, 1, 2, 3];
        const MIN_DB = -20, MAX_DB = 3;

        majorTicks.forEach(db => {
            const ratio = (db - MIN_DB) / (MAX_DB - MIN_DB);
            const normAngle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);
            const cos = Math.cos(normAngle);
            const sin = Math.sin(normAngle);

            const innerR = r - 8 * dpr;
            const outerR = r;
            ctx.beginPath();
            ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
            ctx.lineTo(cx + cos * outerR, cy + sin * outerR);
            ctx.strokeStyle = db >= 0 ? '#cc4422' : 'rgba(200, 168, 78, 0.7)';
            ctx.lineWidth = 2 * dpr;
            ctx.stroke();

            const labelR = r - 16 * dpr;
            ctx.fillStyle = db >= 0 ? '#cc6644' : 'rgba(200, 168, 78, 0.6)';
            ctx.font = `${Math.round(7 * dpr)}px "Georgia", serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(db.toString(), cx + cos * labelR, cy + sin * labelR);
        });

        // 次刻度
        for (let db = MIN_DB; db <= MAX_DB; db++) {
            if (majorTicks.includes(db)) continue;
            const ratio = (db - MIN_DB) / (MAX_DB - MIN_DB);
            const normAngle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);
            const cos = Math.cos(normAngle);
            const sin = Math.sin(normAngle);
            ctx.beginPath();
            ctx.moveTo(cx + cos * (r - 5 * dpr), cy + sin * (r - 5 * dpr));
            ctx.lineTo(cx + cos * r, cy + sin * r);
            ctx.strokeStyle = 'rgba(200, 168, 78, 0.3)';
            ctx.lineWidth = 1 * dpr;
            ctx.stroke();
        }
    }

    function drawNeedle(ctx, cx, cy, r, dpr, ratio) {
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB
        const angle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);
        const needleLen = r * 0.85; // 摆幅加大 1.5 倍

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 3 * dpr;

        ctx.beginPath();
        ctx.moveTo(needleLen, 0);
        ctx.lineTo(0, -2 * dpr);
        ctx.lineTo(-6 * dpr, 0);
        ctx.lineTo(0, 2 * dpr);
        ctx.closePath();
        ctx.fillStyle = '#d4a843';
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.restore();

        // 中心轴
        ctx.beginPath();
        ctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#888';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#aaa';
        ctx.fill();
    }

    function reset() {
        _smoothNeedle = 0;
    }

    return { render, reset };
})();

window.VUMeterGoldSquare = VUMeterGoldSquare;
