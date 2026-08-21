# Tokenu Members Console

React + Vite uygulamasi. Admin panelinden Tokenu reseller API ile:

- Siparis olusturma
- Siparisleri yerel olarak takip etme
- `/orders` uzerinden public siparis sorgulama
- API key'i kodda tutmadan PostgreSQL'de sifreli saklama
- Dcord uzerinden Boosts siparisi olusturma ve Boosts stok takibi

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
- Dcord Boosts siparisleri yerel token stokundan token ayirir; her token 2x boost olarak sayilir ve Dcord `/join` endpointine `boost: true` ile gonderilir.
- Dcord endpointi ortam degiskenleriyle ayarlanir:
  - `DCORD_API_BASE_URL`
  - `DCORD_JOIN_PATH`
- Tokenu dokumani: [Reseller API Docs](https://tokenu.gitbook.io/reseller-api-docs/)
