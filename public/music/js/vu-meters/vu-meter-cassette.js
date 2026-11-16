/**
 * VU Meter - Cassette Tape (磁带 VU 表)
 * 白色磁带外壳、双卷轴动态转动、中央透明窗波形条形图
 * 双卷轴循环：正向 30 分钟 → 反向 30 分钟，往返总周期 60 分钟
 */
const VUMeterCassette = (function () {
    // --- 状态 ---
    let _smoothLevel = 0;       // VU 弹道平滑电平
    let _reelAngle = 0;         // 卷轴当前旋转角度 (rad)
    let _lastFrameTime = 0;     // 上一帧时间戳
    let _waveformHistory = [];  // 波形历史数据

    const CYCLE_MS = 60 * 60 * 1000; // 60 分钟周期
    const WAVEFORM_BARS = 28;        // 波形条形数
    const MAX_HISTORY = WAVEFORM_BARS;

    function render(ctx, params) {
        const { cw, ch, dpr, levelL, levelR, label } = params;
        const level = (levelL + levelR) / 2 || levelL || levelR;

        if (cw === 0 || ch === 0) return;

        // --- VU 弹道平滑 ---
        if (level > _smoothLevel) {
            _smoothLevel += (level - _smoothLevel) * 0.18;
        } else {
            _smoothLevel += (level - _smoothLevel) * 0.05;
        }

        // --- 时间增量 ---
        const now = performance.now();
        const dt = _lastFrameTime ? (now - _lastFrameTime) / 1000 : 0.016;
        _lastFrameTime = now;

        // --- 磁带相位 (基于真实时间) ---
        const phase = (Date.now() % CYCLE_MS) / CYCLE_MS; // 0~1
        const isForward = phase < 0.5;
        // tapeRatio: 0=磁带全在左卷轴, 1=磁带全在右卷轴
        const tapeRatio = isForward ? (phase * 2) : (1 - (phase - 0.5) * 2);

        // --- 卷轴旋转 ---
        const reelSpeed = 0.4 + _smoothLevel * 3.0; // rad/s
        const direction = isForward ? 1 : -1;
        _reelAngle += direction * reelSpeed * dt;

        // --- 波形历史 ---
        if (_waveformHistory.length === 0 || now - (_waveformHistory._lastPush || 0) > 60) {
            _waveformHistory.push(_smoothLevel);
            _waveformHistory._lastPush = now;
            if (_waveformHistory.length > MAX_HISTORY) {
                _waveformHistory.shift();
            }
        }

        // --- 坐标系 ---
        ctx.save();
        ctx.clearRect(0, 0, cw, ch);

        const w = cw;
        const h = ch;

        // === 绘制所有元素 ===
        drawCassetteBody(ctx, w, h, dpr);
        drawScrews(ctx, w, h, dpr);
        drawLabelArea(ctx, w, h, dpr, label);
        drawTapeWindow(ctx, w, h, dpr, tapeRatio);
        drawReels(ctx, w, h, dpr, tapeRatio);
        drawWaveform(ctx, w, h, dpr);
        drawBottomGrille(ctx, w, h, dpr);

        ctx.restore();
    }

    /**
     * 磁带白色外壳
     */
    function drawCassetteBody(ctx, w, h, dpr) {
        const margin = w * 0.03;
        const bw = w - margin * 2;
        const bh = h - margin * 2;
        const r = w * 0.04;

        // 外壳阴影
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
        ctx.shadowBlur = 8 * dpr;
        ctx.shadowOffsetY = 3 * dpr;

        // 白色外壳主体
        ctx.fillStyle = '#f5f3f0';
        roundRect(ctx, margin, margin, bw, bh, r);
        ctx.fill();
        ctx.restore();

        // 外壳边框
        ctx.strokeStyle = '#d8d4ce';
        ctx.lineWidth = 1.5 * dpr;
        roundRect(ctx, margin, margin, bw, bh, r);
        ctx.stroke();

        // 顶部细线装饰
        ctx.beginPath();
        ctx.moveTo(margin + r, margin + bh * 0.06);
        ctx.lineTo(margin + bw - r, margin + bh * 0.06);
        ctx.strokeStyle = 'rgba(200, 195, 188, 0.5)';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
    }

    /**
     * 四角螺丝
     */
    function drawScrews(ctx, w, h, dpr) {
        const margin = w * 0.03;
        const inset = w * 0.06;
        const sr = w * 0.015;
        const positions = [
            [margin + inset, margin + inset],
            [w - margin - inset, margin + inset],
            [margin + inset, h - margin - inset],
            [w - margin - inset, h - margin - inset],
        ];

        positions.forEach(([x, y]) => {
            // 螺丝底座
            ctx.beginPath();
            ctx.arc(x, y, sr, 0, Math.PI * 2);
            ctx.fillStyle = '#c8c4be';
            ctx.fill();
            ctx.strokeStyle = '#b0aca5';
            ctx.lineWidth = 0.5 * dpr;
            ctx.stroke();

            // X 槽纹
            const s = sr * 0.55;
            ctx.beginPath();
            ctx.moveTo(x - s, y - s);
            ctx.lineTo(x + s, y + s);
            ctx.moveTo(x + s, y - s);
            ctx.lineTo(x - s, y + s);
            ctx.strokeStyle = '#8a8580';
            ctx.lineWidth = 1 * dpr;
            ctx.stroke();
        });
    }

    /**
     * 标签区域（上半部分渐变 + 歌曲信息）
     */
    function drawLabelArea(ctx, w, h, dpr, label) {
        const margin = w * 0.03;
        const lx = margin + w * 0.08;
        const ly = margin + h * 0.06;
        const lw = w - margin * 2 - w * 0.16;
        const lh = h * 0.28;
        const r = w * 0.02;

        // 标签背景渐变
        const grad = ctx.createLinearGradient(lx, ly, lx + lw, ly + lh);
        grad.addColorStop(0, '#e8c4a8');
        grad.addColorStop(0.3, '#f0d4b8');
        grad.addColorStop(0.5, '#e8b8a0');
        grad.addColorStop(0.7, '#d4a090');
        grad.addColorStop(1, '#c89888');
        ctx.fillStyle = grad;
        roundRect(ctx, lx, ly, lw, lh, r);
        ctx.fill();

        // 标签边框
        ctx.strokeStyle = 'rgba(180, 140, 110, 0.6)';
        ctx.lineWidth = 1 * dpr;
        roundRect(ctx, lx, ly, lw, lh, r);
        ctx.stroke();

        // 花卉装饰纹理（简化为几何图案）
        drawFloralDecor(ctx, lx, ly, lw, lh, dpr);

        // 歌曲信息
        const songInfo = getSongInfo();
        const centerX = lx + lw / 2;

        // 标题
        ctx.fillStyle = '#4a3828';
        ctx.font = `bold ${Math.round(9 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(songInfo.title || 'CASSETTE TAPE', centerX, ly + lh * 0.35);

        // 副标题
        ctx.fillStyle = '#6a5040';
        ctx.font = `${Math.round(6.5 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(songInfo.artist || label || 'HIGH FIDELITY', centerX, ly + lh * 0.58);

        // 格式信息
        ctx.fillStyle = '#8a7060';
        ctx.font = `${Math.round(5 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(songInfo.format || 'STEREO  |  Hi-Fi', centerX, ly + lh * 0.78);
    }

    /**
     * 花卉装饰（简化几何图案）
     */
    function drawFloralDecor(ctx, lx, ly, lw, lh, dpr) {
        ctx.save();
        ctx.globalAlpha = 0.12;

        // 左侧花纹
        const flowerR = lh * 0.22;
        drawFlower(ctx, lx + lw * 0.1, ly + lh * 0.5, flowerR, dpr);
        drawFlower(ctx, lx + lw * 0.9, ly + lh * 0.5, flowerR, dpr);

        // 中间点缀
        drawFlower(ctx, lx + lw * 0.25, ly + lh * 0.25, flowerR * 0.5, dpr);
        drawFlower(ctx, lx + lw * 0.75, ly + lh * 0.25, flowerR * 0.5, dpr);

        ctx.restore();
    }

    function drawFlower(ctx, cx, cy, r, dpr) {
        const petals = 6;
        for (let i = 0; i < petals; i++) {
            const angle = (i / petals) * Math.PI * 2;
            const px = cx + Math.cos(angle) * r * 0.5;
            const py = cy + Math.sin(angle) * r * 0.5;
            ctx.beginPath();
            ctx.arc(px, py, r * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = '#a06040';
            ctx.fill();
        }
        // 花心
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = '#c08060';
        ctx.fill();
    }

    /**
     * 中央透明窗（黑色背景窗口区域）
     */
    function drawTapeWindow(ctx, w, h, dpr, tapeRatio) {
        const margin = w * 0.03;
        const wx = margin + w * 0.08;
        const wy = margin + h * 0.38;
        const ww = w - margin * 2 - w * 0.16;
        const wh = h * 0.38;
        const r = w * 0.025;

        // 窗口底色（深灰黑 - 模拟透明窗看到磁带内部）
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 4 * dpr;
        ctx.shadowOffsetY = 1 * dpr;

        const winGrad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
        winGrad.addColorStop(0, '#2a2520');
        winGrad.addColorStop(0.5, '#1e1a16');
        winGrad.addColorStop(1, '#252018');
        ctx.fillStyle = winGrad;
        roundRect(ctx, wx, wy, ww, wh, r);
        ctx.fill();
        ctx.restore();

        // 窗口边框
        ctx.strokeStyle = '#4a4540';
        ctx.lineWidth = 1.5 * dpr;
        roundRect(ctx, wx, wy, ww, wh, r);
        ctx.stroke();

        // 内侧高光
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 0.5 * dpr;
        roundRect(ctx, wx + 1.5 * dpr, wy + 1.5 * dpr, ww - 3 * dpr, wh - 3 * dpr, r - 1 * dpr);
        ctx.stroke();

        // 磁带路径（上下两条水平线 - 模拟磁带从左边卷轴到右边卷轴）
        const tapeY1 = wy + wh * 0.3;
        const tapeY2 = wy + wh * 0.7;
        const reelLX = wx + ww * 0.22;
        const reelRX = wx + ww * 0.78;
        const reelCY = wy + wh * 0.5;

        ctx.beginPath();
        ctx.moveTo(reelLX, tapeY1);
        ctx.lineTo(reelRX, tapeY1);
        ctx.moveTo(reelLX, tapeY2);
        ctx.lineTo(reelRX, tapeY2);
        ctx.strokeStyle = 'rgba(90, 60, 30, 0.45)';
        ctx.lineWidth = 0.8 * dpr;
        ctx.stroke();

        // 磁带中间区域路径引导线（到波形区域）
        const guideLX = wx + ww * 0.35;
        const guideRX = wx + ww * 0.65;
        ctx.beginPath();
        ctx.moveTo(reelLX + ww * 0.06, tapeY1);
        ctx.quadraticCurveTo(guideLX, tapeY1 - wh * 0.08, guideLX + ww * 0.02, wy + wh * 0.15);
        ctx.moveTo(reelRX - ww * 0.06, tapeY1);
        ctx.quadraticCurveTo(guideRX, tapeY1 - wh * 0.08, guideRX - ww * 0.02, wy + wh * 0.15);
        ctx.moveTo(reelLX + ww * 0.06, tapeY2);
        ctx.quadraticCurveTo(guideLX, tapeY2 + wh * 0.08, guideLX + ww * 0.02, wy + wh * 0.85);
        ctx.moveTo(reelRX - ww * 0.06, tapeY2);
        ctx.quadraticCurveTo(guideRX, tapeY2 + wh * 0.08, guideRX - ww * 0.02, wy + wh * 0.85);
        ctx.strokeStyle = 'rgba(90, 60, 30, 0.3)';
        ctx.lineWidth = 0.5 * dpr;
        ctx.stroke();
    }

    /**
     * 绘制双卷轴
     */
    function drawReels(ctx, w, h, dpr, tapeRatio) {
        const margin = w * 0.03;
        const wx = margin + w * 0.08;
        const wy = margin + h * 0.38;
        const ww = w - margin * 2 - w * 0.16;
        const wh = h * 0.38;

        const reelCY = wy + wh * 0.5;
        const reelLX = wx + ww * 0.22;
        const reelRX = wx + ww * 0.78;
        const hubR = wh * 0.12;          // 卷轴毂半径
        const maxTapeR = wh * 0.35;       // 最大磁带缠绕半径

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

        // 磁带缠绕（同心圆环 - 由外到内绘制）
        if (tapeAmount > 0.01) {
            const layers = Math.max(3, Math.round(tapeAmount * 12));
            for (let i = 0; i < layers; i++) {
                const ratio = i / layers;
                const r = tapeR - (tapeR - hubR) * ratio;
                const alpha = 0.25 + ratio * 0.35;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(70, 45, 25, ${alpha})`;
                ctx.lineWidth = Math.max(1, (tapeR - hubR) / layers * 0.8);
                ctx.stroke();
            }

            // 磁带最外圈填充
            ctx.beginPath();
            ctx.arc(cx, cy, tapeR, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(55, 35, 20, 0.35)';
            ctx.fill();
        }

        // 卷轴毂（白色圆盘）
        ctx.save();
        ctx.translate(cx, cy);

        // 毂底色
        ctx.beginPath();
        ctx.arc(0, 0, hubR, 0, Math.PI * 2);
        const hubGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, hubR);
        hubGrad.addColorStop(0, '#f0ece6');
        hubGrad.addColorStop(0.7, '#e0dcd5');
        hubGrad.addColorStop(1, '#c8c4be');
        ctx.fillStyle = hubGrad;
        ctx.fill();
        ctx.strokeStyle = '#a8a49e';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();

        // 三辐条（旋转）
        ctx.save();
        ctx.rotate(angle);

        const spokeLen = hubR * 0.85;
        const spokeWidth = hubR * 0.18;
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2;
            ctx.save();
            ctx.rotate(a);

            // 辐条
            ctx.beginPath();
            ctx.moveTo(0, -spokeWidth / 2);
            ctx.lineTo(spokeLen, -spokeWidth * 0.3);
            ctx.lineTo(spokeLen, spokeWidth * 0.3);
            ctx.lineTo(0, spokeWidth / 2);
            ctx.closePath();
            ctx.fillStyle = '#9a9590';
            ctx.fill();
            ctx.strokeStyle = '#807b76';
            ctx.lineWidth = 0.5 * dpr;
            ctx.stroke();

            ctx.restore();
        }

        // 中心孔
        ctx.beginPath();
        ctx.arc(0, 0, hubR * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = '#3a3530';
        ctx.fill();

        // 中心小圆点
        ctx.beginPath();
        ctx.arc(0, 0, hubR * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = '#6a6560';
        ctx.fill();

        ctx.restore(); // 旋转
        ctx.restore(); // 平移
    }

    /**
     * 中央波形条形图
     */
    function drawWaveform(ctx, w, h, dpr) {
        const margin = w * 0.03;
        const wx = margin + w * 0.08;
        const wy = margin + h * 0.38;
        const ww = w - margin * 2 - w * 0.16;
        const wh = h * 0.38;

        // 波形区域（窗口中央）
        const barAreaX = wx + ww * 0.36;
        const barAreaW = ww * 0.28;
        const barAreaY = wy + wh * 0.12;
        const barAreaH = wh * 0.76;

        const barCount = WAVEFORM_BARS;
        const barGap = 1 * dpr;
        const barW = Math.max(1, (barAreaW - barGap * (barCount - 1)) / barCount);
        const centerY = barAreaY + barAreaH / 2;

        for (let i = 0; i < barCount; i++) {
            // 使用历史数据或当前电平 + 随机扰动
            const historyIdx = Math.max(0, _waveformHistory.length - barCount + i);
            let barLevel = _waveformHistory[historyIdx] || _smoothLevel;

            // 添加位置差异（中间高两边低 - 模拟频谱）
            const posRatio = i / (barCount - 1);
            const posWeight = 1 - Math.abs(posRatio - 0.5) * 1.2;
            barLevel = barLevel * posWeight;

            const barH = Math.max(1 * dpr, barLevel * barAreaH * 0.85);

            const x = barAreaX + i * (barW + barGap);
            const halfH = barH / 2;

            // 上半部分
            const grad1 = ctx.createLinearGradient(x, centerY - halfH, x, centerY);
            grad1.addColorStop(0, '#44cc66');
            grad1.addColorStop(0.7, '#33aa55');
            grad1.addColorStop(1, '#228844');
            ctx.fillStyle = grad1;
            ctx.fillRect(x, centerY - halfH, barW, halfH);

            // 下半部分（镜像）
            const grad2 = ctx.createLinearGradient(x, centerY, x, centerY + halfH);
            grad2.addColorStop(0, '#228844');
            grad2.addColorStop(0.3, '#33aa55');
            grad2.addColorStop(1, '#44cc66');
            ctx.fillStyle = grad2;
            ctx.fillRect(x, centerY, barW, halfH);

            // 高光点（高电平时顶部发黄）
            if (barLevel > 0.5) {
                const alpha = (barLevel - 0.5) * 2;
                ctx.fillStyle = `rgba(255, 220, 80, ${alpha * 0.6})`;
                ctx.fillRect(x, centerY - halfH, barW, 2 * dpr);
                ctx.fillRect(x, centerY + halfH - 2 * dpr, barW, 2 * dpr);
            }

            // 过载指示（红色）
            if (barLevel > 0.85) {
                ctx.fillStyle = 'rgba(255, 80, 60, 0.7)';
                ctx.fillRect(x, centerY - halfH, barW, 1.5 * dpr);
                ctx.fillRect(x, centerY + halfH - 1.5 * dpr, barW, 1.5 * dpr);
            }
        }
    }

    /**
     * 底部格栅和装饰
     */
    function drawBottomGrille(ctx, w, h, dpr) {
        const margin = w * 0.03;
        const gx = margin + w * 0.12;
        const gy = margin + h * 0.80;
        const gw = w - margin * 2 - w * 0.24;
        const gh = h * 0.12;

        // 格栅水平线
        const lineCount = 4;
        const lineGap = gh / (lineCount + 1);
        ctx.strokeStyle = 'rgba(180, 175, 168, 0.4)';
        ctx.lineWidth = 0.8 * dpr;
        for (let i = 1; i <= lineCount; i++) {
            const y = gy + lineGap * i;
            ctx.beginPath();
            ctx.moveTo(gx, y);
            ctx.lineTo(gx + gw, y);
            ctx.stroke();
        }

        // 左侧圆形装饰（模拟磁带轴孔）
        const dotR = w * 0.012;
        const dotY = gy + gh * 0.5;

        ctx.beginPath();
        ctx.arc(gx - w * 0.03, dotY, dotR, 0, Math.PI * 2);
        ctx.fillStyle = '#c8c4be';
        ctx.fill();
        ctx.strokeStyle = '#b0aca5';
        ctx.lineWidth = 0.5 * dpr;
        ctx.stroke();

        // 右侧方形装饰
        const sqSize = dotR * 1.5;
        ctx.beginPath();
        ctx.rect(gx + gw + w * 0.03 - sqSize / 2, dotY - sqSize / 2, sqSize, sqSize);
        ctx.fillStyle = '#c8c4be';
        ctx.fill();
        ctx.strokeStyle = '#b0aca5';
        ctx.lineWidth = 0.5 * dpr;
        ctx.stroke();

        // 底部文字
        ctx.fillStyle = 'rgba(150, 145, 138, 0.5)';
        ctx.font = `${Math.round(5 * dpr)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('C-60  HIGH BIAS  CrO₂', w / 2, gy + gh + h * 0.02);
    }

    /**
     * 获取当前播放歌曲信息
     */
    function getSongInfo() {
        try {
            const song = window.currentPlayingSong || window._currentSong;
            if (!song) return {};
            return {
                title: truncate(song.name || song.title || '', 22),
                artist: truncate(song.artist || song.singer || '', 28),
                format: song.format || song.quality || 'STEREO  |  Hi-Fi',
            };
        } catch (e) {
            return {};
        }
    }

    function truncate(str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
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

    function reset() {
        _smoothLevel = 0;
        _reelAngle = 0;
        _lastFrameTime = 0;
        _waveformHistory = [];
    }

    return { render, reset };
})();

window.VUMeterCassette = VUMeterCassette;
