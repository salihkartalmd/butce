# Bütçe — telefona kurulum

Uygulama bir PWA'dır: bir kez HTTPS adresinde yayınlanır, sonra Chrome'dan
"Uygulamayı yükle" ile telefona gerçek bir uygulama gibi kurulur (uygulama
çekmecesinde görünür, tam ekran açılır, internetsiz çalışır). Verilerin yalnızca
telefonunda kalır; sunucuya hiçbir şey gönderilmez.

Yayınlanacak dosyalar `butce-app.zip` içinde:
`index.html, styles.css, app.js, calc.js, sw.js, manifest.webmanifest, icons/`

## Seçenek A — GitHub Pages (ücretsiz, kalıcı, önerilen)

1. github.com'da oturum aç → sağ üst **+ → New repository** → ad: `butce` → **Public** → Create.
2. Açılan sayfada **uploading an existing file** bağlantısına tıkla; zip'in içindeki
   dosyaları ve `icons` klasörünü sürükle-bırak → **Commit changes**.
3. Repo'da **Settings → Pages** → Source: **Deploy from a branch**, Branch: `main` / `(root)` → Save.
4. 1–2 dakika sonra adres hazır: `https://KULLANICI_ADIN.github.io/butce/`

## Seçenek B — Netlify Drop (en hızlı)

1. app.netlify.com/drop adresine git, zip'ten çıkardığın klasörü sayfaya sürükle.
2. Ücretsiz hesapla kaydet (aksi halde site bir süre sonra silinir). Adres: `https://….netlify.app`

## Telefona kurma (Android, Chrome)

1. Telefonda Chrome ile yukarıdaki adresi aç.
2. Sağ üst **⋮ → Uygulamayı yükle** (bazı sürümlerde "Ana ekrana ekle") → **Yükle**.
3. "Bütçe" artık uygulama çekmecende. İkona uzun basınca **Ekle** kısayolu da çıkar.

İstersen pwabuilder.com'a adresi verip buradan imzalı bir `.apk` / Play Store paketi de üretebilirsin;
ama Chrome'un "Uygulamayı yükle" seçeneği zaten Android'de gerçek bir uygulama (WebAPK) kurar.

## Güncelleme ve yedek

- Dosyaları değiştirip yeniden yüklediğinde, uygulama internete bağlıyken açılışta yeni sürümü alır.
  Büyük güncellemelerde `sw.js` içindeki `CACHE` adını artır (ör. `butce-v1.0.1`).
- Ayarlar → **Dışa aktar** ile düzenli yedek al. Uygulamayı kaldırmak veya Chrome verilerini
  silmek kayıtları da siler.

## Geliştirme

```bash
npm test     # hesaplama ve kabul testleri (TZ=Europe/Istanbul)
npm start    # http://localhost:5173
```
