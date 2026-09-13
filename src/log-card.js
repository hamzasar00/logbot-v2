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
      .replace(/[\\x60*_~]/g, '')
      .replace(/\\p{Extended_Pictographic}/gu, '')
      .replace(/\\uFE0F/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
    }

    function stripLeadingIcon(value) {
    return value.replace(/^[^\\p{L}\\p{N}]+/u, '').trim() || 'Sunucu Logu';
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
    const descriptionLines = description ? wrapText(measure, description, WIDTH - PAD * 2 - 30, 3, guild) : [];
    const fields = (Array.isArray(data.fields) ? data.fields : [])
      .map((field) => ({
        label: stripLeadingIcon(cleanText(field.name || 'Bilgi', guild)),
        valueLines: wrapText(measure, field.value || 'Belirtilmedi', WIDTH - PAD * 2 - 44, 3, guild),
        inline: Boolean(field.inline),
      }))
      .filter((field) => !/^(tarih|zaman|date|timestamp)$/i.test(field.label));
    const rows = makeRows(fields);
    const rowHeights = rows.map((row) => {
      const maxLines = Math.max(...row.map((field) => field.valueLines.length));
      return 34 + maxLines * 28 + 24;
    });
    const height = Math.max(270, 158 + descriptionLines.length * 31 + rowHeights.reduce((sum, value) => sum + value, 0));
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
      ctx.font = '22px Arial';
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

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const cellWidth = (WIDTH - PAD * 2 - (row.length - 1) * 34) / row.length;
      for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
        const field = row[cellIndex];
        const x = PAD + cellIndex * (cellWidth + 34);
        ctx.fillStyle = MUTED;
        ctx.font = 'bold 16px Arial';
        ctx.fillText(field.label.toLocaleUpperCase('tr-TR'), x, y);
        ctx.fillStyle = TEXT;
        ctx.font = '22px Arial';
        let valueY = y + 26;
        for (const line of field.valueLines) { ctx.fillText(line, x, valueY); valueY += 28; }
      }
      y += rowHeights[rowIndex];
    }

    const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString('tr-TR') : new Date().toLocaleString('tr-TR');
    ctx.fillStyle = MUTED;
    ctx.font = '16px Arial';
    ctx.fillText(footer + '  •  ' + timestamp, PAD, height - 40);
    return canvas.toBuffer('image/png');
    }

    module.exports = { renderLogCard };
    