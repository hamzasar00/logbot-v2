const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    } = require('discord.js');

    const DEFAULT_EMOJIS = Object.freeze({
    delete: '🗑️', edit: '✏️', memberJoin: '📥', memberLeave: '📤', boost: '💎',
    ban: '🔨', unban: '🔓', timeout: '⏳', role: '🎭', channel: '#️⃣',
    voiceJoin: '🔊', voiceLeave: '🔇', voiceMove: '🔄', guild: '🛡️',
    emoji: '😀', sticker: '🖼️', security: '🛡️', clock: '🕒', user: '👤',
    });

    const EMOJI_ENV_KEYS = Object.freeze({
    delete: 'LOG_EMOJI_DELETE', edit: 'LOG_EMOJI_EDIT', memberJoin: 'LOG_EMOJI_MEMBER_JOIN',
    memberLeave: 'LOG_EMOJI_MEMBER_LEAVE', boost: 'LOG_EMOJI_BOOST', ban: 'LOG_EMOJI_BAN',
    unban: 'LOG_EMOJI_UNBAN', timeout: 'LOG_EMOJI_TIMEOUT', role: 'LOG_EMOJI_ROLE',
    channel: 'LOG_EMOJI_CHANNEL', voiceJoin: 'LOG_EMOJI_VOICE_JOIN', voiceLeave: 'LOG_EMOJI_VOICE_LEAVE',
    voiceMove: 'LOG_EMOJI_VOICE_MOVE', guild: 'LOG_EMOJI_GUILD', emoji: 'LOG_EMOJI_EMOJI',
    sticker: 'LOG_EMOJI_STICKER', security: 'LOG_EMOJI_SECURITY', clock: 'LOG_EMOJI_CLOCK', user: 'LOG_EMOJI_USER',
    });

    const NO_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });

    function truncateText(value, maxLength = 900) {
    const text = String(value ?? '').trim();
    return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
    }

    function cleanLabel(value) {
    return String(value ?? '')
      .replace(/<a?:[^:>]+:[0-9]+>/g, '')
      .replace(/^[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]+/, '')
      .trim() || 'Bilgi';
    }

    function resolveMentions(value, guild) {
    return String(value ?? '')
      .replace(/<@!?([0-9]+)>/g, (_, id) => {
        const member = guild?.members?.cache?.get(id);
        return '@' + (member?.displayName || member?.user?.username || 'Üye');
      })
      .replace(/<@&([0-9]+)>/g, (_, id) => {
        const role = guild?.roles?.cache?.get(id);
        return '@' + (role?.name || 'Rol');
      })
      .replace(/<#([0-9]+)>/g, (_, id) => {
        const channel = guild?.channels?.cache?.get(id);
        return '#' + (channel?.name || 'kanal');
      });
    }

    function safeText(value, guild, maxLength = 900) {
    let text = resolveMentions(value, guild)
      .replace(/@everyone/gi, '@​everyone')
      .replace(/@here/gi, '@​here')
      .replace(/[ *_~|]/g, '')
      .split(String.fromCharCode(96)).join('')
      .replace(/\r/g, '')
      .trim();
    return truncateText(text || 'Belirtilmedi', maxLength);
    }

    function safeSingleLine(value, guild, maxLength = 220) {
    return safeText(value, guild, maxLength).replace(/\n/g, ' ');
    }

    function getTitle(data) {
    return cleanLabel(data?.title || data?.author?.name || 'Sunucu Logu');
    }

    function getEventEmojiKey(title, logGroupKey) {
    if (logGroupKey === 'boost') return 'boost';
    if (/Mesaj Silindi|Toplu Mesaj Silindi/.test(title)) return 'delete';
    if (/Mesaj Düzenlendi|Bilgisi Değişti|Değiştirildi/.test(title)) return 'edit';
    if (/Sunucuya Katıldı/.test(title)) return 'memberJoin';
    if (/Sunucudan Ayrıldı/.test(title)) return 'memberLeave';
    if (/Banı Kaldırıldı|Yasağı Kaldırıldı/.test(title)) return 'unban';
    if (/Yasaklandı/.test(title)) return 'ban';
    if (/Atıldı/.test(title)) return 'security';
    if (/Timeout/.test(title)) return 'timeout';
    if (/Rol/.test(title)) return 'role';
    if (/Ses Kanalına Girdi/.test(title)) return 'voiceJoin';
    if (/Ses Kanalından Ayrıldı/.test(title)) return 'voiceLeave';
    if (/Ses Kanalı Değişti/.test(title)) return 'voiceMove';
    if (/Kanal/.test(title)) return 'channel';
    if (/Sunucu/.test(title)) return 'guild';
    if (/Emoji/.test(title)) return 'emoji';
    if (/Sticker/.test(title)) return 'sticker';
    if (/Kullanıcı|Üye/.test(title)) return 'user';
    return 'security';
    }

    function getEmoji(key, guild) {
    const configured = process.env[EMOJI_ENV_KEYS[key]]?.trim();
    if (configured) {
      const match = configured.match(/^<a?:([A-Za-z0-9_]+):([0-9]+)>$/);
      if (match && guild?.emojis?.cache?.get(match[2])?.available !== false) return configured;
    }
    return DEFAULT_EMOJIS[key] || DEFAULT_EMOJIS.security;
    }

    function getAccentColor(data, logGroupKey) {
    if (typeof data?.color === 'number') return data.color;
    const defaults = { delete: 0xed4245, message: 0xed4245, moderation: 0xf59e0b, member: 0x57f287, role: 0x9b59b6, channel: 0x3498db, voice: 0x1abc9c, guild: 0x5865f2, boost: 0xeb459e9 };
    return defaults[logGroupKey] || 0x5865f2;
    }

    function renderField(field, guild) {
    const label = cleanLabel(field.name).toLocaleUpperCase('tr-TR');
    const value = safeText(field.value, guild, 1000);
    const isId = /(^| )ID$| ID$/.test(label);
    const isLong = /MESAJ|İÇERİK|SEBEP|AÇIKLAMA|ROLLER/.test(label) || value.includes('\n');
    const display = isLong
      ? value.split('\n').slice(0, 8).map((line) => '> ' + line).join('\n')
      : isId ? '-# ' + value : value;
    return '**' + label + '**\n' + display;
    }

    function buildLogComponents(embed, guild, logGroupKey) {
    const data = embed?.data || embed || {};
    const title = getTitle(data);
    const emoji = getEmoji(getEventEmojiKey(title, logGroupKey), guild);
    const fields = Array.isArray(data.fields) ? data.fields : [];
    const visibleFields = fields.filter((field) => !/^(tarih|zaman|date|timestamp)$/i.test(cleanLabel(field.name)));
    const contextValues = [];
    for (const field of visibleFields) {
      const label = cleanLabel(field.name);
      if (/Kullanıcı|Kanal/.test(label) && contextValues.length < 2) contextValues.push(safeSingleLine(field.value, guild));
    }
    const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString('tr-TR') : new Date().toLocaleString('tr-TR');
    const context = contextValues.length ? contextValues.join('  •  ') : 'Sunucu güvenlik kaydı';
    const avatarUrl = data.author?.icon_url || data.thumbnail?.url;
    const container = new ContainerBuilder().setAccentColor(getAccentColor(data, logGroupKey));
    const header = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(emoji + ' **' + safeSingleLine(title, guild, 180) + '**\n-# Sunucu güvenlik kaydı • ' + timestamp + '\n-# ' + context),
    );
    if (/^https?:\/\//i.test(String(avatarUrl || ''))) header.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
    container.addSectionComponents(header);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

    const description = safeText(data.description, guild, 1200);
    if (data.description) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**AÇIKLAMA**\n' + description.split('\n').slice(0, 8).map((line) => '> ' + line).join('\n')));
    }
    if (visibleFields.length) {
      const fieldText = visibleFields.slice(0, 14).map((field) => renderField(field, guild)).join('\n\n');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldText));
    }
    const imageUrl = data.image?.url;
    if (/^https?:\/\//i.test(String(imageUrl || ''))) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Log Sistemi • ' + timestamp));
    return [container];
    }

    function buildLogFallbackComponents(embed, guild, logGroupKey, error) {
    const data = embed?.data || embed || {};
    const title = getTitle(data);
    const emoji = getEmoji(getEventEmojiKey(title, logGroupKey), guild);
    const container = new ContainerBuilder().setAccentColor(0xed4245);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(emoji + ' **' + safeSingleLine(title, guild) + '**\n-# Log kartı oluşturulamadı\n-# ' + safeSingleLine(error?.message || 'Bilinmeyen hata', guild, 240)));
    return [container];
    }

    module.exports = { buildLogComponents, buildLogFallbackComponents, NO_MENTIONS };
    