# Tokenu Members Console

React + Vite uygulamasi. Admin panelinden Tokenu reseller API ile:

- Siparis olusturma
- Siparisleri yerel olarak takip etme
- `/orders` uzerinden public siparis sorgulama
- API key'i kodda tutmadan PostgreSQL'de sifreli saklama
- Dcord uzerinden Boosts siparisi olusturma ve Boosts stok takibi
- Acik kullanici onayi ile tek bir Discord sunucusuna Community OAuth katilimi

## Gelistirme

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Production container `Dockerfile` ve `nginx.conf` ile SPA fallback destekli olarak calisir.

## Notlar

- API anahtarlari koda gommeli degil; admin panelindeki ayarlar bolumune girilir ve PostgreSQL'de sifreli saklanir.
- Varsayilan API tabani: `https://dev.tokenu.net/api/v1/reseller`
- Dcord Boosts siparisleri yerel token stokundan token ayirir; her token 2x boost olarak sayilir. Siparis once Dcord Tasks API ile olusturulur, donen `task_id` kaydedilir ve sonuc ayni gorev uzerinden takip edilir.
- Dcord proxy listesi Boost Stock panelinden yonetilir ve sifreli saklanir. Proxy'li bir sipariste her token icin bir proxy rezerve edilir, siparis eslesmesi sifreli saklanir ve rezerve edilen proxy listeden kaldirilir.
- Dcord Boosts concurrency de siparis formundan secilir; her siparis kendi paralel isleme sayisini saklar.
- Dcord endpointi ortam degiskenleriyle ayarlanir:
  - `DCORD_API_BASE_URL`
  - `DCORD_TASK_CREATE_PATH`
  - `DCORD_TASK_STATUS_PATH`
  - `DCORD_USER_AGENT` (varsayilan `plcp-dc/0.1 (+https://capheaven.dcord.co API client)`)
  - `DCORD_WGET_FALLBACK` (`false` yapilirsa HTML challenge durumunda wget fallback devre disi kalir)
  - `DCORD_REQUEST_TIMEOUT_MS` (varsayilan `30000`)
  - `DCORD_PROXY_CHECK_URL` (varsayilan `https://discord.com/api/v10/gateway`; Dcord'a gorev gondermeden once proxy baglantisini kontrol eder)
  - `DCORD_PROXY_CHECK_TIMEOUT_MS` (varsayilan `10000`)
  - `DCORD_TASK_POLL_INTERVAL_MS` (varsayilan `3000`)
  - `DCORD_TASK_MAX_WAIT_MS` (varsayilan `620000`)
  - `DCORD_RETRY_BASE_MS` (varsayilan `30000`)
  - `DCORD_RETRY_MAX_MS` (varsayilan `600000`)
  - `DCORD_MAX_RETRY_ATTEMPTS` (varsayilan `12`)
- Tokenu dokumani: [Reseller API Docs](https://tokenu.gitbook.io/reseller-api-docs/)

## Community OAuth testi

Bu akis Tokenu siparislerinden bagimsizdir. Kullanici `/join` sayfasinda hedef sunucuyu gorur ve
Discord uzerinden `identify guilds.join` izni verir. Yenilenebilir OAuth izni sifreli saklanir;
yonetici Ayarlar ekranindaki `Add authorized members` komutunu verdiginde bot bekleyen kullanicilari
yapilandirilmis sunucuya ekler. OAuth bilgileri tarayiciya geri dondurulmez.

Discord Developer Portal icindeki OAuth2 redirect adresi su sunucu adresiyle ayni olmalidir:

```text
https://your-domain.example/api/community/oauth/callback
```

Gerekli ortam degiskenleri `.env.example` dosyasinda listelenmistir. Bot hedef sunucuda bulunmali
ve Discord'un Add Guild Member endpointi icin gerekli izne sahip olmalidir.
