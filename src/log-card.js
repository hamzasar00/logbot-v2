const { createCanvas, loadImage } = require('@napi-rs/canvas');

    const WIDTH = 1000;
    const PAD = 58;
    const BACKGROUND = '#0d1117';
    const PANEL = '#171c24';
    const TEXT = '#f4f7fb';
    const MUTED = '#9aa5b5';
    const DIVIDER = '#2b3442';

    function cleanText(value, guild) {
    return String(value ?? '')
      .replace(/<a?:[^:>]+:\d+>/g, '')
      .replace(/<@!?([0-9]+)>/g, (_, id) => {
        const member = guild?.members?.cache?.get(id);
        return '@' + (member?.displayName || member?.user?.username || 'Üye');
      })
      .replace(/<#([0-9]+)>/g, (_, id) => {
        const channel = guild?.channels?.cache?.get(id);
        return '#' + (channel?.name || 'kanal');
      })
      .replace(/[\x60*_~]/g, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\uFE0F/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    }

    function stripLeadingIcon(value) {
    return value.replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Sunucu Logu';
    }

    function wrapText(ctx, value, maxWidth, maxLines = 3, guild) {
    const words = cleanText(value, guild).split(' ').filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (ctx.measureText(candidate).width <= maxWidth || !current) current = candidate;
      else { lines.push(current); current = word; if (lines.length === maxLines - 1) break; }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = last.slice(0, Math.max(1, last.length - 3)) + '...';
    }
    return lines;
    }

    function colorToHex(color) {
    if (typeof color !== 'number') return '#5865f2';
    return '#' + color.toString(16).padStart(6, '0');
    }

    function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
    }

    async function loadAvatar(url) {
    if (!url) return null;
    try { return await loadImage(url); } catch { return null; }
    }

    function makeRows(fields) {
    const rows = [];
    let inlineRow = [];
    const flushInline = () => {
      if (inlineRow.length) rows.push(inlineRow);
      inlineRow = [];
    };
    for (const field of fields) {
      if (field.inline) {
        inlineRow.push(field);
        if (inlineRow.length === 2) flushInline();
      } else {
        flushInline();
        rows.push([field]);
      }
    }
    flushInline();
    return rows;
    }

    async function renderLogCard(embed, guild) {
    const data = embed?.data || embed || {};
    const title = stripLeadingIcon(cleanText(data.author?.name || data.title || 'Sunucu Logu', guild));
    const description = cleanText(data.description, guild);
    const footer = cleanText(data.footer?.text || 'Log Sistemi', guild);
    const accent = colorToHex(data.color);
    const avatar = await loadAvatar(data.author?.icon_url || data.thumbnail?.url);
    const measure = createCanvas(WIDTH, 100).getContext('2d');
    measure.font = '22px Arial';
    const descriptionLines = description ? wrapText(measure, description, WIDTH - PAD * 2 - 30, 2, guild) : [];
    const fields = (Array.isArray(data.fields) ? data.fields : [])
      .map((field) => ({
        label: stripLeadingIcon(cleanText(field.name || 'Bilgi', guild)),
        valueLines: wrapText(measure, field.value || 'Belirtilmedi', WIDTH - PAD * 2 - 54, 3, guild),
        inline: Boolean(field.inline),
      }))
      .filter((field) => !/^(tarih|zaman|date|timestamp)$/i.test(field.label));
    const rows = makeRows(fields);
    const rowHeights = rows.map((row) => 82 + Math.max(...row.map((field) => field.valueLines.length)) * 27);
    const headerHeight = 180;
    const height = Math.max(430, headerHeight + rowHeights.reduce((sum, value) => sum + value + 16, 0) + 72);
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#090d18';
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(WIDTH - 80, 38, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.arc(70, height - 20, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const bannerGradient = ctx.createLinearGradient(34, 28, WIDTH - 34, 160);
    bannerGradient.addColorStop(0, accent);
    bannerGradient.addColorStop(0.55, '#4338ca');
    bannerGradient.addColorStop(1, '#7c3aed');
    ctx.fillStyle = bannerGradient;
    roundRect(ctx, 34, 28, WIDTH - 68, 132, 28);
    ctx.fill();

    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#ffffff';
    for (let index = 0; index < 7; index += 1) {
      ctx.beginPath();
      ctx.arc(WIDTH - 300 + index * 58, 38 + (index % 2) * 42, 42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(92, 94, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('LOG', 92, 101);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px Arial';
    ctx.fillText(title, 150, 89);
    ctx.font = '18px Arial';
    ctx.globalAlpha = 0.84;
    ctx.fillText(descriptionLines[0] || 'Sunucu olay kaydı', 150, 120);
    ctx.globalAlpha = 1;
    if (avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(WIDTH - 94, 94, 40, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, WIDTH - 134, 54, 80, 80);
      ctx.restore();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(WIDTH - 94, 94, 40, 0, Math.PI * 2);
      ctx.stroke();
    }

    let y = headerHeight;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const cellGap = 18;
      const cellWidth = (WIDTH - PAD * 2 - (row.length - 1) * cellGap) / row.length;
      const rowHeight = rowHeights[rowIndex];
      for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
        const field = row[cellIndex];
        const x = PAD + cellIndex * (cellWidth + cellGap);
        ctx.fillStyle = '#151b2a';
        roundRect(ctx, x, y, cellWidth, rowHeight, 18);
        ctx.fill();
        ctx.strokeStyle = '#273149';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = accent;
        roundRect(ctx, x, y, 5, rowHeight, 3);
        ctx.fill();
        ctx.fillStyle = MUTED;
        ctx.font = 'bold 15px Arial';
        ctx.fillText(field.label.toLocaleUpperCase('tr-TR'), x + 22, y + 28);
        ctx.fillStyle = TEXT;
        ctx.font = '22px Arial';
        let valueY = y + 58;
        for (const line of field.valueLines) { ctx.fillText(line, x + 22, valueY); valueY += 27; }
      }
      y += rowHeight + 16;
    }

    const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString('tr-TR') : new Date().toLocaleString('tr-TR');
    ctx.fillStyle = MUTED;
    ctx.font = '16px Arial';
    ctx.fillText(footer + '  •  ' + timestamp, PAD, height - 32);
    ctx.fillStyle = accent;
    ctx.fillRect(WIDTH - 150, height - 38, 92, 4);
    return canvas.toBuffer('image/png');
    }

    module.exports = { renderLogCard };
    