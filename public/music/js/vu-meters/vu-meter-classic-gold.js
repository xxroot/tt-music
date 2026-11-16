/**
 * VU Meter - Classic Gold (金色圆形经典 VU 表)
 * 圆形表盘、暖金色背光径向渐变、弧形刻度(-20dB~+3dB)、金色旋转指针
 */
const VUMeterClassicGold = (function () {
    let _smoothNeedle = 0; // 指针平滑位置

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
        const level = levelL || levelR; // 单声道 VU 表取对应声道

        if (cw === 0 || ch === 0) return;

        const cx = cw / 2;
        const cy = ch * 0.85; // 3:2 画布圆心继续下移,就是那个圆心
        const radius = cw * 0.48; // 按宽度计算半径，填满画布

        // 角度系统: 上半圆弧形
        // -20dB → 210° (7π/6, 左上), +3dB → 330° (11π/6, 右上)
        // 顺时针从 330° 到 210° 经过顶部 (0°/360°)
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB (左上)
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB (右上)

        // --- VU 弹道平滑 (指针) ---
        const targetNeedle = levelToNeedleRatio(level);
        if (targetNeedle > _smoothNeedle) {
            _smoothNeedle += (targetNeedle - _smoothNeedle) * 0.15; // 快升
        } else {
            _smoothNeedle += (targetNeedle - _smoothNeedle) * 0.04; // 慢降
        }

        // --- 背景: 暖金色径向渐变 ---
        const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.3);
        bgGrad.addColorStop(0, '#5a4520');
        bgGrad.addColorStop(0.5, '#3a2a10');
        bgGrad.addColorStop(1, '#1a1208');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, cw, ch);

        // --- 表盘背光 (暖黄色径向渐变) ---
        const dialGrad = ctx.createRadialGradient(cx, cy * 0.7, 0, cx, cy * 0.7, radius * 0.95);
        dialGrad.addColorStop(0, 'rgba(255, 220, 130, 0.35)');
        dialGrad.addColorStop(0.6, 'rgba(220, 180, 80, 0.15)');
        dialGrad.addColorStop(1, 'rgba(180, 140, 40, 0.05)');
        ctx.fillStyle = dialGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, END_ANGLE, START_ANGLE, true); // 上半圆 (顺时针)
        ctx.closePath();
        ctx.fill();

        // --- 外圈金色圆环 ---
        ctx.beginPath();
        ctx.arc(cx, cy, radius, END_ANGLE, START_ANGLE, true);
        ctx.strokeStyle = '#c8a84e';
        ctx.lineWidth = 3 * dpr;
        ctx.stroke();

        // 内圈细线
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 4 * dpr, END_ANGLE, START_ANGLE, true);
        ctx.strokeStyle = 'rgba(200, 168, 78, 0.4)';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();

        // --- 刻度弧 ---
        drawScale(ctx, cx, cy, radius, dpr);

        // --- 指针 ---
        drawNeedle(ctx, cx, cy, radius, dpr, _smoothNeedle);

        // --- 底部标签 (圆心下方) ---
        ctx.fillStyle = 'rgba(200, 180, 120, 0.7)';
        ctx.font = `bold ${Math.round(11 * dpr)}px "Georgia", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label || 'VU', cx, cy + radius * 0.15);
    }

    /**
     * 将 RMS 电平映射到指针角度比例 (0~1)
     * -20dB ~ +3dB 对应 0 ~ 1
     */
    function levelToNeedleRatio(rms) {
        if (rms < 0.001) return 0;
        const db = 20 * Math.log10(rms);
        const MIN_DB = -20, MAX_DB = 3;
        return Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
    }

    /**
     * 绘制弧形刻度
     */
    function drawScale(ctx, cx, cy, radius, dpr) {
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB (左上)
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB (右上)
        const scaleRadius = radius * 0.88;

        // 刻度值: -20, -10, -7, -5, -3, 0, 1, 2, 3
        const majorTicks = [-20, -10, -7, -5, -3, 0, 1, 2, 3];
        const MIN_DB = -20, MAX_DB = 3;

        // 主刻度线 + 数字
        majorTicks.forEach(db => {
            const ratio = (db - MIN_DB) / (MAX_DB - MIN_DB);
            // 线性插值 210° → 330° (经过 270°=顶部)
            const normAngle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);
            const cos = Math.cos(normAngle);
            const sin = Math.sin(normAngle);

            // 主刻度线
            const innerR = scaleRadius - 10 * dpr;
            const outerR = scaleRadius;
            ctx.beginPath();
            ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
            ctx.lineTo(cx + cos * outerR, cy + sin * outerR);
            ctx.strokeStyle = db >= 0 ? '#ff4444' : 'rgba(220, 200, 150, 0.8)';
            ctx.lineWidth = 2 * dpr;
            ctx.stroke();

            // 数字标签
            const labelR = scaleRadius - 18 * dpr;
            ctx.fillStyle = db >= 0 ? '#ff6644' : 'rgba(220, 200, 150, 0.7)';
            ctx.font = `${Math.round(7 * dpr)}px "Georgia", serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(db.toString(), cx + cos * labelR, cy + sin * labelR);
        });

        // 次刻度线 (每 1dB)
        for (let db = MIN_DB; db <= MAX_DB; db++) {
            if (majorTicks.includes(db)) continue;
            const ratio = (db - MIN_DB) / (MAX_DB - MIN_DB);
            const normAngle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);
            const cos = Math.cos(normAngle);
            const sin = Math.sin(normAngle);

            const innerR = scaleRadius - 6 * dpr;
            const outerR = scaleRadius;
            ctx.beginPath();
            ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
            ctx.lineTo(cx + cos * outerR, cy + sin * outerR);
            ctx.strokeStyle = 'rgba(220, 200, 150, 0.4)';
            ctx.lineWidth = 1 * dpr;
            ctx.stroke();
        }

        // "VU" 水印文字 (圆心下方)
        ctx.fillStyle = 'rgba(180, 150, 80, 0.5)';
        ctx.font = `bold ${Math.round(14 * dpr)}px "Georgia", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VU', cx, cy - radius * 0.22);
    }

    /**
     * 绘制指针
     * @param {number} needleRatio - 0~1 指针位置比例
     */
    function drawNeedle(ctx, cx, cy, radius, dpr, needleRatio) {
        const START_ANGLE = 7 * Math.PI / 6;   // 210° = -20dB
        const END_ANGLE = 11 * Math.PI / 6;    // 330° = +3dB
        const angle = START_ANGLE + needleRatio * (END_ANGLE - START_ANGLE);
        const needleLen = radius * 0.78; // 摆幅加大 1.5 倍

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        // 指针阴影
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 4 * dpr;
        ctx.shadowOffsetX = 1 * dpr;
        ctx.shadowOffsetY = 1 * dpr;

        // 指针主体 (红色三角形)
        ctx.beginPath();
        ctx.moveTo(needleLen, 0);
        ctx.lineTo(0, -2.5 * dpr);
        ctx.lineTo(-8 * dpr, 0);
        ctx.lineTo(0, 2.5 * dpr);
        ctx.closePath();
        ctx.fillStyle = '#cc2222';
        ctx.fill();

        ctx.shadowColor = 'transparent';

        // 指针尖端高亮
        ctx.beginPath();
        ctx.moveTo(needleLen, 0);
        ctx.lineTo(needleLen - 12 * dpr, -1 * dpr);
        ctx.lineTo(needleLen - 12 * dpr, 1 * dpr);
        ctx.closePath();
        ctx.fillStyle = '#ff4444';
        ctx.fill();

        ctx.restore();

        // 中心轴圆
        ctx.beginPath();
        ctx.arc(cx, cy, 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#888';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#aaa';
        ctx.fill();
    }

    /** 重置平滑状态 */
    function reset() {
        _smoothNeedle = 0;
    }

    return { render, reset };
})();

window.VUMeterClassicGold = VUMeterClassicGold;
