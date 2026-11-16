/**
 * VU Meter - Military (军绿色方形军用 VU 表)
 * 方形表盘、深军绿背景、直线刻度、LED 分段条(绿→黄→红)、四角铆钉装饰
 */
const VUMeterMilitary = (function () {
    let _smoothLevel = 0;

    /**
     * 渲染一帧
     */
    function render(ctx, params) {
        const { cw, ch, dpr, levelL, levelR, label } = params;
        const level = levelL || levelR;

        if (cw === 0 || ch === 0) return;

        // --- VU 弹道平滑 ---
        if (level > _smoothLevel) {
            _smoothLevel += (level - _smoothLevel) * 0.15;
        } else {
            _smoothLevel += (level - _smoothLevel) * 0.04;
        }

        const pad = 6 * dpr;
        const w = cw - pad * 2;
        const h = ch - pad * 2;

        // --- 背景: 深军绿色 ---
        ctx.fillStyle = '#1a2e1a';
        ctx.fillRect(0, 0, cw, ch);

        // --- 磨损纹理效果 (随机噪点) ---
        ctx.fillStyle = 'rgba(60, 80, 40, 0.15)';
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * cw;
            const y = Math.random() * ch;
            const s = Math.random() * 3 * dpr + 1;
            ctx.fillRect(x, y, s, s * 0.3);
        }

        // --- 内嵌显示屏区域 ---
        const screenPad = 12 * dpr;
        const screenX = pad + screenPad;
        const screenY = pad - screenPad * 0.5; // 屏幕上移，减少上方空白
        const screenW = w - screenPad * 2;
        const screenH = h * 0.8; // 增大屏幕高度

        // 屏幕背景 (更深的绿色)
        ctx.fillStyle = '#0d1a0d';
        ctx.fillRect(screenX, screenY, screenW, screenH);

        // 屏幕内阴影
        const screenShadow = ctx.createLinearGradient(screenX, screenY, screenX, screenY + screenH);
        screenShadow.addColorStop(0, 'rgba(0,0,0,0.4)');
        screenShadow.addColorStop(0.1, 'rgba(0,0,0,0)');
        screenShadow.addColorStop(0.9, 'rgba(0,0,0,0)');
        screenShadow.addColorStop(1, 'rgba(0,0,0,0.3)');
        ctx.fillStyle = screenShadow;
        ctx.fillRect(screenX, screenY, screenW, screenH);

        // --- LED 分段条 ---
        drawLEDBars(ctx, screenX, screenY, screenW, screenH, dpr, _smoothLevel);

        // --- 刻度数字 ---
        drawScaleNumbers(ctx, screenX, screenY, screenW, screenH, dpr);

        // --- 外框 ---
        ctx.strokeStyle = '#3a5a3a';
        ctx.lineWidth = 2 * dpr;
        ctx.strokeRect(pad, pad, w, h);

        // 内框线
        ctx.strokeStyle = 'rgba(80, 120, 60, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(pad + 2 * dpr, pad + 2 * dpr, w - 4 * dpr, h - 4 * dpr);

        // --- 四角铆钉 ---
        drawRivet(ctx, pad + 4 * dpr, pad + 4 * dpr, dpr);
        drawRivet(ctx, cw - pad - 4 * dpr, pad + 4 * dpr, dpr);
        drawRivet(ctx, pad + 4 * dpr, ch - pad - 4 * dpr, dpr);
        drawRivet(ctx, cw - pad - 4 * dpr, ch - pad - 4 * dpr, dpr);

        // --- 底部标签 ---
        ctx.fillStyle = 'rgba(160, 180, 100, 0.6)';
        ctx.font = `bold ${Math.round(10 * dpr)}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label || 'VU', cx(cw), ch - pad * 2.5);

        // --- "VU" 水印文字 (屏幕区域下方) ---
        ctx.fillStyle = 'rgba(100, 140, 60, 0.25)';
        ctx.font = `bold ${Math.round(12 * dpr)}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VU', cx(cw), screenY + screenH + (ch - screenY - screenH) * 0.3);
    }

    function cx(cw) { return cw / 2; }

    /**
     * 绘制 LED 分段条
     */
    function drawLEDBars(ctx, x, y, w, h, dpr, level) {
        const barCount = 20;
        const barH = (h - 8 * dpr) * 0.65;
        const gap = 2 * dpr;
        const barW = (w - gap * (barCount - 1)) / barCount;
        const startY = y + h * 0.35;

        const activeBars = Math.floor(level * barCount);

        for (let i = 0; i < barCount; i++) {
            const bx = x + i * (barW + gap);
            const ratio = i / barCount;

            // 颜色: 绿 → 黄 → 红
            let r, g, b;
            if (ratio < 0.6) {
                r = 40; g = Math.round(180 + ratio * 75); b = 40;
            } else if (ratio < 0.8) {
                const t = (ratio - 0.6) / 0.2;
                r = Math.round(40 + 215 * t); g = Math.round(255 - 55 * t); b = 40;
            } else {
                const t = (ratio - 0.8) / 0.2;
                r = 255; g = Math.round(200 - 160 * t); b = 40;
            }

            if (i < activeBars) {
                // 点亮
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
                ctx.fillRect(bx, startY, barW, barH);
                // 辉光
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;
                ctx.fillRect(bx - 1 * dpr, startY - 1 * dpr, barW + 2 * dpr, barH + 2 * dpr);
            } else {
                // 熄灭
                ctx.fillStyle = `rgba(${Math.round(r * 0.2)}, ${Math.round(g * 0.2)}, ${Math.round(b * 0.2)}, 0.3)`;
                ctx.fillRect(bx, startY, barW, barH);
            }
        }
    }

    /**
     * 绘制刻度数字
     */
    function drawScaleNumbers(ctx, x, y, w, h, dpr) {
        const nums = [-20, -10, -7, -5, -3, 0, 1, 2, 3];
        const MIN_DB = -20, MAX_DB = 3;
        const labelY = y + h * 0.2;

        nums.forEach(db => {
            const ratio = (db - MIN_DB) / (MAX_DB - MIN_DB);
            const lx = x + ratio * w;
            ctx.fillStyle = db >= 0 ? 'rgba(255, 100, 60, 0.7)' : 'rgba(160, 180, 100, 0.6)';
            ctx.font = `${Math.round(7 * dpr)}px "Courier New", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(db.toString(), lx, labelY);
        });
    }

    /**
     * 绘制铆钉
     */
    function drawRivet(ctx, x, y, dpr) {
        const r = 3.5 * dpr;
        // 外圈
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#4a6a4a';
        ctx.fill();
        // 内圈 (十字槽)
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#2a3a2a';
        ctx.fill();
        // 十字槽线
        ctx.strokeStyle = '#1a2a1a';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.4, y);
        ctx.lineTo(x + r * 0.4, y);
        ctx.moveTo(x, y - r * 0.4);
        ctx.lineTo(x, y + r * 0.4);
        ctx.stroke();
    }

    /** 重置平滑状态 */
    function reset() {
        _smoothLevel = 0;
    }

    return { render, reset };
})();

window.VUMeterMilitary = VUMeterMilitary;
