# PLCP Discord Console

React + Vite tabanli Discord operasyon paneli.

- Sifreli OAuth Members Stock yonetimi
- Kategori bazli uye teslimati, kontrol ve replacement
- Dcord uzerinden Boosts siparisi ve yerel token stok takibi
- Merkezi, dengeli ve saglik kontrollu Onliner proxy havuzu
- Discord Gateway Onliner ve Rich Presence yonetimi
- Public siparis monitoru

## Gelistirme

```bash
npm install
npm run dev
```

Humanizer REST transportu icin Python 3.10+ ve `primp==2.0.1` gerekir. Varsayilan
Python komutu Windows'ta `python`, diger platformlarda `python3` olur; gerekirse
`PRIMP_PYTHON` ile tam executable yolu verilebilir. Production image bu ortami
`/opt/primp-venv` altinda otomatik kurar.

## Build

```bash
npm run build
```

Production container `Dockerfile` ve `nginx.conf` ile SPA fallback destekli olarak calisir.

## EasyPanel servis rolleri

Ayni image iki ayri EasyPanel App servisinde calistirilabilir:

- `plcp-dc`: `SERVICE_ROLE=web` — paneli ve API'yi sunar, Discord Onliner Gateway baglantisi acmaz.
- `plcp-onliner`: `SERVICE_ROLE=onliner` — yalnizca Discord Onliner worker'ini calistirir, domain gerektirmez.
- `SERVICE_ROLE=all`: yerel gelistirme icin iki rolu ayni process'te calistirir.

Iki servis ayni PostgreSQL baglanti ve sifreleme ortam degiskenlerini kullanmalidir. Onliner servisi
tek replica olarak calistirilmalidir. PostgreSQL advisory lock ikinci worker'in ayni hesaplari
baglamasini engeller. Ayarlar, runtime durumu ve loglar ortak PostgreSQL uzerinden senkronize edilir.

## Dcord Boosts

- Siparisler yerel token stokundan token ayirir; her token 2x boost olarak sayilir.
- Her token icin Boost Stock panelindeki listeden bir proxy rezerve edilir.
- `host:port:user:pass` girdileri `user:pass@host:port` formatina donusturulur.
- Dcord endpointi su ortam degiskenleriyle ayarlanabilir:
  - `DCORD_API_BASE_URL`
  - `DCORD_TASK_CREATE_PATH`
  - `DCORD_TASK_STATUS_PATH`
  - `DCORD_USER_AGENT`
  - `DCORD_WGET_FALLBACK`
  - `DCORD_REQUEST_TIMEOUT_MS`
  - `DCORD_PROXY_CHECK_URL`
  - `DCORD_PROXY_CHECK_TIMEOUT_MS`
  - `DCORD_TASK_POLL_INTERVAL_MS`
  - `DCORD_TASK_MAX_WAIT_MS`
  - `DCORD_RETRY_BASE_MS`
  - `DCORD_RETRY_MAX_MS`
  - `DCORD_MAX_RETRY_ATTEMPTS`

## Members OAuth

Discord uygulamasinda `identify guilds.join` kapsamli OAuth yetkisi kullanilir. Access token,
refresh token ve yeniden kullanilmasi gereken hesap tokenlari PostgreSQL'de sifreli saklanir.

Discord Developer Portal OAuth2 redirect adresi:

```text
https://your-domain.example/api/community/oauth/callback
```

Bot hedef sunucuda bulunmali ve Add Guild Member islemi icin gerekli izinlere sahip olmalidir.
Apply-to-Join otomasyonu `EXPERIMENTAL_JOIN_ENABLED` ile kontrol edilir.

## Onliner

Onliner hesaplari merkezi proxy havuzundan en az kullanilan saglikli proxy'yi otomatik alir.
Basarisiz proxyler gecici cooldown'a girer. Hesap bazinda Rich Presence kapatilabilir ve proxy
manuel olarak degistirilebilir.

Gerekli ortam degiskenleri `.env.example` dosyasinda listelenmistir.
