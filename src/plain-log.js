const { getLogEmoji } = require('./log-emojis');

const NO_MENTIONS = Object.freeze({
  parse: [],
  users: [],
  roles: [],
  repliedUser: false,
});

class PlainLogBuilder {
  constructor() {
    this.data = { fields: [] };
  }

  setAuthor(author) {
    this.data.author = {
      name: author?.name,
      icon_url: author?.iconURL,
    };
    return this;
  }

  setColor(color) {
    this.data.color = color;
    return this;
  }

  setDescription(description) {
    this.data.description = description;
    return this;
  }

  setFooter(footer) {
    this.data.footer = footer;
    return this;
  }

  setImage(url) {
    this.data.image = { url };
    return this;
  }

  setThumbnail(url) {
    this.data.thumbnail = { url };
    return this;
  }

  setTimestamp(timestamp = new Date()) {
    this.data.timestamp = new Date(timestamp).toISOString();
    return this;
  }

  setTitle(title) {
    this.data.title = title;
    return this;
  }

  addFields(...fields) {
    this.data.fields.push(...fields.flat());
    return this;
  }
}

function cleanLabel(value) {
  return String(value ?? '')
    .replace(/<a?:[^:>]+:[0-9]+>/g, '')
    .replace(/^[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]+/, '')
    .trim();
}

function getEventEmojiKey(title, logGroupKey) {
  if (logGroupKey === 'boost') return 'boost';
  if (/Mesaj Silindi|Toplu Mesaj Silindi/.test(title)) return 'delete';
  if (/Mesaj Düzenlendi|Bilgisi Değişti|Değiştirildi/.test(title)) return 'edit';
  if (/Üye Katıldı|Sunucuya Katıldı/.test(title)) return 'join';
  if (/Üye Ayrıldı|Sunucudan Ayrıldı/.test(title)) return 'leave';
  if (/Banı Kaldırıldı|Yasağı Kaldırıldı/.test(title)) return 'unban';
  if (/Yasaklandı/.test(title)) return 'ban';
  if (/Timeout/.test(title)) return 'timeout';
  if (/Rol/.test(title)) return 'role';
  if (/Ses Kanal/.test(title)) return 'voice';
  if (/Kanal/.test(title)) return 'channel';
  if (/Kullanıcı|Üye/.test(title)) return 'user';
  return 'user';
}

function getFieldEmojiKey(label) {
  if (/Tarih|Zaman/.test(label)) return 'clock';
  if (/Kullanıcı|Üye|Davet Eden|Oluşturan|Silen|Değiştiren|Yetkili/.test(label)) return 'user';
  if (/Rol/.test(label)) return 'role';
  if (/Kanal/.test(label)) return 'channel';
  return null;
}

function truncateContent(value, maxLength = 2000) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatPlainLog(logEntry, guild, logGroupKey) {
  const data = logEntry?.data || logEntry || {};
  const title = cleanLabel(data.title || data.author?.name || 'Sunucu Logu');
  const lines = [`${getLogEmoji(guild, getEventEmojiKey(title, logGroupKey))} **${title}**`];

  if (data.description) {
    lines.push('', String(data.description));
  }

  for (const field of Array.isArray(data.fields) ? data.fields : []) {
    const label = cleanLabel(field.name) || 'Bilgi';
    const emojiKey = getFieldEmojiKey(label);
    const emojiLead = emojiKey ? `${getLogEmoji(guild, emojiKey)} ` : '';
    lines.push(`${emojiLead}**${label}:** ${String(field.value ?? 'Belirtilmedi')}`);
  }

  if (data.image?.url) {
    lines.push('', String(data.image.url));
  }

  if (data.timestamp && !lines.some((line) => /\*\*(Tarih|Zaman):\*\*/.test(line))) {
    lines.push(`${getLogEmoji(guild, 'clock')} **Tarih:** ${new Date(data.timestamp).toLocaleString('tr-TR')}`);
  }

  return truncateContent(lines.join('\n'));
}

module.exports = {
  PlainLogBuilder,
  formatPlainLog,
  NO_MENTIONS,
};