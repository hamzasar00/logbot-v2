# Logbot v2

V4 dalındaki log altyapısı temel alınarak hazırlanmış, sunucu logları ve boost bildirimlerine odaklanan Discord botu.

## Özellikler

- `.setup` ile log kategorisini ve kanallarını otomatik oluşturur.
- `.log` ile log türlerini açıp kapatabileceğin ve kanal seçebileceğin paneli açar.
- Üye, mesaj, rol, kanal, ses, moderasyon, sunucu, emoji/sticker ve boost loglarını destekler.
- Gerçek olay logları embed, Components V2 veya PNG kullanmadan normal Discord mesajı olarak gönderilir.
- `.setup`, mevcut hareketli `log_*` emojilerini otomatik bulur; eksik emojileri `assets/log-emojis/` altındaki GIF’lerden yükler.
- V4 boost bildirimleri: kanal, GIF, başlık, mesaj ayarı ve test komutu.
- JSON ayarları atomik biçimde kaydedilir.
- Supervisor ve bağlantı watchdog'u uzun süreli çalışmayı destekler.

## Komutlar

- `.setup` — Log kanallarını oluşturur.
- `.log` — Log kontrol panelini açar.
- `.boost-kanal #kanal` — Boost bildirim kanalını ayarlar.
- `.boost-gif URL` — Boost GIF'ini ayarlar; kaldırmak için `.boost-gif kaldır`.
- `.boost-baslik metin` — Boost başlığını ayarlar.
- `.boost-mesaj metin` — Boost mesajını ayarlar; `|` yeni satırdır.
- `.boost-test` — Test bildirimi gönderir.
- `.yardım` — Yardım mesajını gösterir.

## Hareketli log emojileri

İsteğe bağlı GIF dosyalarını `assets/log-emojis/` klasörüne koy. `.setup` komutu sunucuda aynı isimde hareketli emoji varsa onu kullanır; yoksa karşılık gelen GIF’i yükler. Emoji ID’sini `.env` dosyasına eklemen gerekmez.

Desteklenen dosyalar: `delete.gif`, `edit.gif`, `join.gif`, `leave.gif`, `ban.gif`, `unban.gif`, `timeout.gif`, `role.gif`, `channel.gif`, `voice.gif`, `user.gif`, `clock.gif`.

Botta `CreateGuildExpressions` izni yoksa, emoji kapasitesi doluysa veya GIF eksik ya da 256 KiB’tan büyükse Unicode emoji kullanılır.

## Kurulum

```bash
npm install
cp .env.example .env
npm start
```

Windows'ta `baslat.bat` kullanılabilir. Gerçek tokenı yalnızca yerel `.env` dosyasında tut.

## Gerekli Gateway Intents

- Server Members Intent
- Message Content Intent

Presence Intent gerekli değildir.
