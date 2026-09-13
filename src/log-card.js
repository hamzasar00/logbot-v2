const { createCanvas, loadImage } = require('@napi-rs/canvas');

    const WIDTH = 1000;
    const PAD = 58;
    const BACKGROUND = '#0d1117';
    const PANEL = '#171c24';
    const TEXT = '#f4f7fb';
    const MUTED = '#9aa5b5';
    const DIVIDER = '#2b3442';

    function cleanText(value) {
    return String(value ?? '')
      .replace(/<a?:[^:>]+:\d+>/g, '')
      .replace(/<@!?\d+>/g, '@kullanıcı')
      .replace(/<#\d+>/g, '#kanal')
      .replace(/[\x60*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    }

    function stripLeadingIcon(value) {
    return value.replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Sunucu Logu';
    }

    function wrapText(ctx, value, maxWidth, maxLines = 4) {
    const words = cleanText(value).split(' ').filter(Boolean);
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

    async function renderLogCard(embed) {
    const data = embed?.data || embed || {};
    const title = stripLeadingIcon(cleanText(data.author?.name || data.title || 'Sunucu Logu'));
    const description = cleanText(data.description);
    const fields = Array.isArray(data.fields) ? data.fields : [];
    const footer = cleanText(data.footer?.text || 'Log Sistemi');
    const accent = colorToHex(data.color);
    const avatar = await loadAvatar(data.author?.icon_url || data.thumbnail?.url);
    const measure = createCanvas(WIDTH, 100).getContext('2d');
    measure.font = '24px Arial';
    const descriptionLines = description ? wrapText(measure, description, WIDTH - PAD * 2 - 30, 3) : [];
    const fieldRows = fields.map((field) => {
      measure.font = 'bold 18px Arial';
      const label = cleanText(field.name || 'Bilgi');
      measure.font = '22px Arial';
      const valueLines = wrapText(measure, field.value || 'Belirtilmedi', WIDTH - PAD * 2 - 44, 3);
      return { label, valueLines };
    });
    const fieldHeight = fieldRows.reduce((total, row) => total + 34 + row.valueLines.length * 28 + 24, 0);
    const height = Math.max(270, 158 + descriptionLines.length * 31 + fieldHeight);
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.fillStyle = PANEL;
    roundRect(ctx, 18, 18, WIDTH - 36, height - 36, 18);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, 18, 18, 9, height - 36, 5);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 32px Arial';
    ctx.fillText(title, PAD, 76);
    if (avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(WIDTH - 92, 72, 42, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, WIDTH - 134, 30, 84, 84);
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(WIDTH - 92, 72, 42, 0, Math.PI * 2);
      ctx.stroke();
    }
    let y = 122;
    if (descriptionLines.length) {
      ctx.fillStyle = MUTED;
      ctx.font = '24px Arial';
      for (const line of descriptionLines) { ctx.fillText(line, PAD, y); y += 31; }
      y += 12;
    }
    ctx.strokeStyle = DIVIDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(WIDTH - PAD, y);
    ctx.stroke();
    y += 28;
    for (const row of fieldRows) {
      ctx.fillStyle = MUTED;
      ctx.font = 'bold 17px Arial';
      ctx.fillText(row.label.toUpperCase(), PAD, y);
      y += 26;
      ctx.fillStyle = TEXT;
      ctx.font = '22px Arial';
      for (const line of row.valueLines) { ctx.fillText(line, PAD, y); y += 28; }
      y += 22;
    }
    const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString('tr-TR') : new Date().toLocaleString('tr-TR');
    ctx.fillStyle = MUTED;
    ctx.font = '16px Arial';
    ctx.fillText(footer + '  •  ' + timestamp, PAD, height - 40);
    return canvas.toBuffer('image/png');
    }

    module.exports = { renderLogCard };
    