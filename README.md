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

## UI referansi

Admin footer'indaki **UI Kit** baglantisi (`/ui-kit`), mevcut buton, sekme, form,
rozet, kart, liste, sayfalama ve uyari stillerini canli ornekler ve kopyalanabilir
kodlarla toplar. Ornekler gercek ortak bilesenleri kullanir; demo islemleri
uretim API'lerine istek gondermez. Yeni UI calismalarinda
[UI referansini](docs/ui-reference.md) ve ilgili kaynak bileseni esas alin.

## Members Stock toplu Onliner baglantisi

Members Stock'ta secili hesaplar **Connect selected** ile kayitli tokenlari
kullanilarak Onliner'a eklenebilir. Rich Presence bir defa secilir; profil eklemeleri
sirayla yapilir. Zaten Onliner'da bulunanlar atlanir, basarisiz hesaplar hata
mesajlariyla secili kalir. Kontrol: `node --test tools/community-onliner-connect.test.mjs`.

## Mevcut Members siparislerini baska kategoriye tasima

Stock > Members Stock > kategori yonetimindeki **Move existing orders** (iki yonlu ok)
aksiyonunu kullanin. Kaynak kategoride `OAuth Premium`, hedefte `OAuth Online` secilip
**Preview transfer** ile sayilar gorulur; **Move … orders** aktarimi uygular.
Bu islem yalnizca siparislerin kategori baglantisini degistirir. Teslimat gecmisi,
monitor baglantilari, mevcut destek bitis tarihleri ve Auto Leave kayitlari korunur.
Uye stogu ayrica tasinmis olmalidir. Devam eden teslimat, kontrol ve Auto Leave
islemleri de kesilmeden tasinabilir; sonraki ilerleme kayitlari kategoriyi geri
ceviremez. Ilerleme, mevcut destek tarihleri ve tek kullanimlik leave kayitlari
korunur. Her iki kategoriyi zaten iceren karma siparisler de tasinir. Ayni havuzu
kullansalar da satin alinan bolumlerin uye sayilari, teslimat sayaclari ve destek
bitisleri ayri tutulur; Check members ve Auto Leave ilgili bolumun suresini kullanir.
Kontroller: `node --test server/community-order-category-transfer.test.mjs`.

Veritabani korumasi canli DB'ye baglanmadan, ayri bir bellek ici PostgreSQL ile
test edilebilir. Test paketi uygulamanin bagimliliklarini degistirmez:

```bash
npm install --prefix output/category-transfer-test --no-save --package-lock=false --ignore-scripts --no-audit --no-fund @electric-sql/pglite
node --test server/community-order-category-guard.test.mjs
```

## Kategoriye gore monitor Leave all izni

Kategori ayarlarindaki **Monitor Leave all > Enabled** secenegi musteriye bu
butonu acar. Yeni ve mevcut kategorilerde varsayilan kapalidir; ayar mevcut
siparislere de uygulanir. Karma siparislerde tum kategoriler izin vermelidir.
API her tiklamada guncel izinleri kontrol eder; kapali kategorilerdeki uyeler bu
aksiyonla cikarilamaz. Siparis basina tek kullanim kurali korunur. Admin islemleri
ve otomatik suresi dolan uyeleri cikarma bu ayardan bagimsizdir.

## Musteri monitorunde reaction

Kategori yonetiminde reaction iznini ve destek suresini acin. Siparis olustururken
**Customer reactions** secenegini isaretleyip **50 / 100 / 200 / 500** gunluk limit
secin. Ilk gun hak siparisin uye sayisidir: 500 uyede 500, 100 uyede 100 reaction.
Sonraki gunler secilen gunluk limitle devam eder. Ilk gun, etkinlestirmeden sonraki
ilk Turkiye gece yarisina kadardir.

Orders listesinin satir aksiyonlarindaki **Enable reactions / Manage reactions**
veya siparis detayindaki ayni kontrol ile sonradan acilabilir; gunluk limit
artirilabilir veya dusurulebilir. Hazir degerler veya ozel pozitif bir tam sayi kullanilabilir.
Sonradan ilk kez acilinca ilk gun yine uye sayisi kadar hak verilir. Acik bir
sipariste **Save limit**, ilk gun dahil bugunku hakki ve sonraki gunluk limiti
hemen degistirir; onceki kullanimi silmez veya gunu yeniden baslatmaz. Kullanimin
altina dusurulurse kalan hak 0 olur. Orders'in Reactions sutunu
bugunku limiti, tum gunlerin toplam kullanimini ve bugun kalani gosterir.

**Manage reactions → Disable reactions** musteri erisimini kapatir. Gecmis,
gunluk limit ve ilk acilis tarihi korunur. Tekrar acmak yeni bir ilk gun hakki
vermez; kapali siparisler Orders'ta **Disabled** olarak gorunur.

Reaction ayarlari kayit surumuyle korunur: eski teslimat snapshot'lari yeni
gunluk limiti veya acik/kapali durumunu geri alamaz. Backend baslangicinda
`pulcip_order_reaction_settings_guard` veritabani korumasi kurulur. Bu duzeltme
icin backend de guncellenip yeniden baslatilmalidir. Save limit yaniti,
veritabanina gercekten yazilan degerden uretilir.

Monitor, mevcut admin ReactionPanel bilesenini ve ayni gonderim motorunu
kullanir. Orders detayinda da ayni panel vardir; iki ekran ayni gunluk hakki ve
gecmisi gosterir. Basliktaki geri sayim saniyelik guncellenir; sifirlaninca haklar
yeniden alinir. Limit Turkiye saatiyle 00:00'da yenilenir; basarisiz/iptal edilmis
gonderimler hakki geri verir. Yalnizca o siparisteki, izinli ve destek suresi devam
eden bolumlerin uyeleri kullanilir. Sure dolunca panel kapanir; kuyruktaki musteri
reaction'lari da gonderilmeden once kontrol edilir. Eski siparisler otomatik acilmaz.

Kontroller: `node --test server/customer-order-reactions.test.mjs`.

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
