# Tokenu Members Console

React + Vite uygulamasi. Admin panelinden Tokenu reseller API ile:

- Siparis olusturma
- Siparisleri yerel olarak takip etme
- `/orders` uzerinden public siparis sorgulama
- API key'i kodda tutmadan browser localStorage'da saklama

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

- API anahtari koda gommeli degil; admin panelindeki ayarlar bolumune girilir ve localStorage'da saklanir.
- Varsayilan API tabani: `https://dev.tokenu.net/api/v1/reseller`
- Tokenu dokumani: [Reseller API Docs](https://tokenu.gitbook.io/reseller-api-docs/)
