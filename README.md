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
`/opt/primp-venv` altinda otomatik kurar. Humanizer, Discord web build numarasini
dinamik olarak cozer ve REST isteklerinde `/experiments` fingerprint'i ile Apex
installation kimligini kullanir; Onliner Gateway IDENTIFY akisi bundan bagimsizdir.

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
- Normal 1/3 aylik stokta her token icin tek kullanimlik proxy listesinden bir proxy rezerve edilir.
- Rotating stok kendi sabit proxy havuzunu kullanir; hesap-proxy eslesmesi sonraki siparislerde korunur.
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

## Rotating Boost Stock

Boost Stock includes a separate **Rotating stock** inventory. Existing 1-month and
3-month inventories keep their usual order flow. Use **Move from 3 month stock** and
choose how many accounts to transfer, then select **Rotating · 30 Days** when creating
an order. Transferred accounts are removed from 3-month inventory in the same database
transaction. Each account's 90-day clock starts on its first order assignment;
time spent unassigned in stock does not consume it. Later assignments do not reset
the clock. No expiry date or token entry is required.
Each account supplies two boosts to one order at a time. Reservations are protected
by a PostgreSQL transaction lock; the inventory and assignment history are encrypted
in `app_settings`, so no additional migration is required.

Accounts need at least 33 days remaining (30 days of service plus a 3-day buffer).
The customer period starts when delivery succeeds. Accounts move through Available,
Reserved, In use, and Insufficient time / expired. When the 30-day customer period
ends, the previous assignment is archived and the account automatically returns to
Available if at least 33 subscription days remain; otherwise it is retired. No
manual approval is required. This updates inventory availability only; it does not
remove or transfer boosts in Discord.

The panel refreshes every 30 seconds; reservations also reconcile elapsed periods.
Failed or uncertain deliveries are kept separate as delivery issues until resolved;
they are not treated as successfully completed 30-day periods.
Run lifecycle checks with `node --test server/rotating-boost-stock.test.mjs`.

Rotating inventory has its own **Fixed proxies** panel. Add proxies there, one per
line (`user:pass@host:port` or `host:port:user:pass`). On first delivery, a proxy
binds to the account and is saved in encrypted inventory. Later orders and
replacement deliveries use that account's same proxy; it is never consumed or
returned to the one-time pool. Existing account bindings are recovered from
the current or most recent saved order's token/proxy assignment when available.
New accounts require an unassigned fixed proxy; an insufficient pool leaves both
account reservations and subscription clocks unchanged. Saving proxies appends
and deduplicates without removing existing bindings. The session-protected admin
proxy panel displays complete saved proxy URLs, including authentication, for
review and copying. Account inventory responses retain endpoint-only labels.

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
