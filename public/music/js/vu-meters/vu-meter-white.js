/**
 * VU Meter - White (白色圆形简约 VU 表)
 * 圆形表盘、纯白/浅灰背景、极简灰色刻度、黑色细指针
 */
const VUMeterWhite = (function () {
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

        const cx = cw / 2;
        const cy = ch * 0.8; // 3:2 画布圆心继续下移
        const radius = cw * 0.48; // 按宽度计算半径，填满画布

        // 角度系统: 上半圆弧形 (210°→330°)
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB (左上)
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB (右上)

        // --- 背景: 浅灰白 ---
        ctx.fillStyle = '#f0ede8';
        ctx.fillRect(0, 0, cw, ch);

        // --- 表盘: 白色圆形 (上半圆) ---
        const dialGrad = ctx.createRadialGradient(cx, cy * 0.7, 0, cx, cy * 0.7, radius);
        dialGrad.addColorStop(0, '#ffffff');
        dialGrad.addColorStop(0.8, '#f8f6f2');
        dialGrad.addColorStop(1, '#e8e4de');
        ctx.fillStyle = dialGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, END_ANGLE, START_ANGLE, true); // 上半圆 (顺时针)
        ctx.closePath();
        ctx.fill();

        // --- 外圈: 细灰线 ---
        ctx.beginPath();
        ctx.arc(cx, cy, radius, END_ANGLE, START_ANGLE, true);
        ctx.strokeStyle = '#c0bbb4';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        // 内圈
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 3 * dpr, END_ANGLE, START_ANGLE, true);
        ctx.strokeStyle = 'rgba(180, 175, 168, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();

        // --- 刻度 ---
        drawScale(ctx, cx, cy, radius, dpr);

        // --- 指针 (黑色细线) ---
        const needleRatio = levelToRatio(_smoothNeedle);
        drawNeedle(ctx, cx, cy, radius, dpr, needleRatio);

        // --- 底部标签 (圆心下方) ---
        ctx.fillStyle = 'rgba(120, 115, 108, 0.6)';
        ctx.font = `${Math.round(10 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label || 'VU', cx, cy + radius * 0.2);
    }

    function levelToRatio(level) {
        if (level < 0.001) return 0;
        const db = 20 * Math.log10(level);
        return Math.max(0, Math.min(1, (db - (-20)) / (3 - (-20))));
    }

    function drawScale(ctx, cx, cy, r, dpr) {
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB (左上)
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB (右上)
        const majorTicks = [-20, -10, -7, -5, -3, 0, 1, 2, 3];
        const MIN_DB = -20, MAX_DB = 3;
        const scaleR = r * 0.88;

        majorTicks.forEach(db => {
            const ratio = (db - MIN_DB) / (MAX_DB - MIN_DB);
            const normAngle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);
            const cos = Math.cos(normAngle);
            const sin = Math.sin(normAngle);

            const innerR = scaleR - 8 * dpr;
            const outerR = scaleR;
            ctx.beginPath();
            ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
            ctx.lineTo(cx + cos * outerR, cy + sin * outerR);
            ctx.strokeStyle = db >= 0 ? '#cc4422' : 'rgba(100, 95, 88, 0.6)';
            ctx.lineWidth = 1.5 * dpr;
            ctx.stroke();

            const labelR = scaleR - 16 * dpr;
            ctx.fillStyle = db >= 0 ? '#cc6644' : 'rgba(100, 95, 88, 0.5)';
            ctx.font = `${Math.round(6 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
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
            ctx.moveTo(cx + cos * (scaleR - 5 * dpr), cy + sin * (scaleR - 5 * dpr));
            ctx.lineTo(cx + cos * scaleR, cy + sin * scaleR);
            ctx.strokeStyle = 'rgba(100, 95, 88, 0.25)';
            ctx.lineWidth = 1 * dpr;
            ctx.stroke();
        }

        // "VU" 水印文字 (圆心下方)
        ctx.fillStyle = 'rgba(120, 115, 108, 0.35)';
        ctx.font = `bold ${Math.round(13 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VU', cx, cy - r * 0.22);
    }

    function drawNeedle(ctx, cx, cy, r, dpr, ratio) {
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB
        const angle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);
        const needleLen = r * 0.78; // 摆幅加大 1.5 倍

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        ctx.shadowBlur = 2 * dpr;

        // 细黑色指针
        ctx.beginPath();
        ctx.moveTo(needleLen, 0);
        ctx.lineTo(0, -1.5 * dpr);
        ctx.lineTo(-5 * dpr, 0);
        ctx.lineTo(0, 1.5 * dpr);
        ctx.closePath();
        ctx.fillStyle = '#333';
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.restore();

        // 中心轴
        ctx.beginPath();
        ctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#555';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 2 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#777';
        ctx.fill();
    }

    function reset() {
        _smoothNeedle = 0;
    }

    return { render, reset };
})();

window.VUMeterWhite = VUMeterWhite;
