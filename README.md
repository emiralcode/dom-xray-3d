# DOM·XRAY 3D — Web Sitesi Röntgeni

Herhangi bir web sitesinin **DOM yapısını** ve **ağ trafiğini** headless Chromium ile analiz edip
gezilebilir bir 3D dünyaya dönüştürür:

- **DOM şehri**: her HTML öğesi bir bina. Büyük `div` blokları geniş platformlara ve gökdelenlere dönüşür,
  derin iç içe sarmalayıcı zincirleri uzun ince kuleler olarak göze batar.
- **Ağ uzayı**: her alan adı bir gezegen, yüklenen her kaynak (script, görsel, CSS, font, API isteği)
  o gezegenin yörüngesinde dönen bir uydudur. Uydu boyutu = indirilen bayt. Ağır scriptler devasa uydulara dönüşür.
- **Bağımlılık grafiği**: akan ışık çizgileri “hangi alan adı hangisinden kaynak yükledi” (CDP initiator) zincirini gösterir.

## Hızlı başlangıç

```bash
npm install
npm run setup     # Playwright Chromium'u indirir (bir kez)
npm start         # http://localhost:3000
```

Node.js 18+ gerekir. Chromium indirilemezse sistemdeki Chrome veya Edge otomatik olarak kullanılır.

Doğrudan bir siteyle açmak için: `http://localhost:3000/?url=github.com`

## Özellikler

| Alan | Ayrıntı |
| --- | --- |
| İki 3D düzen | **Şehir** (squarified treemap: alan = alt öğe sayısı, yükseklik = derinlik) ve **Sayfa düzeni** (gerçek `getBoundingClientRect` konumları, her DOM seviyesi bir kat). Aralarında animasyonlu geçiş. |
| Şişkinlik skoru | DOM boyutu, derinlik, toplam transfer, JS ağırlığı, istek sayısı, 3. parti oranı ve “div çorbası” üzerinden A–F notu. |
| Denetçi | Bir binaya / uyduya / gezegene tıklayınca: CSS yolu, ata zinciri, çocuklar, boyut, transfer, sıkıştırma, durum kodu, protokol, initiator zinciri, “bu kaynağın yükledikleri”. |
| Seçici araması | `div`, `.card`, `#app`, `a.btn`, `img, video` gibi seçicilerle eşleşen binaları vurgular. |
| Zaman çizelgesi | Ağ trafiğini yeniden oynatır: kaynaklar yüklendikleri anda doküman çekirdeğinden fırlayıp yörüngelerine oturur. Arka planda mini şelale (waterfall) grafiği. |
| Filtreler | DOM kategorileri ve kaynak türleri lejanttan açılıp kapatılır; gizli (`display:none`) öğeler ayrıca gizlenebilir. |
| Performans | Binlerce öğe tek bir `InstancedMesh` ile çizilir; seçim, Three.js raycaster yerine özel ışın–AABB / ışın–küre testleriyle yapılır. Kenar parlaması ve röntgen tarama halkası shader'a enjekte edilmiştir. |
| Dışa/içe aktar | Analiz JSON olarak indirilebilir; JSON dosyasını pencereye sürükleyip bırakınca sunucusuz yeniden görüntülenir. |

### Kısayollar

`Tık` seç · `Çift tık`/`F` odaklan · `L` düzen değiştir · `/` arama · `S` tarama · `P` trafiği oynat · `U` üst öğe · `R` kamerayı sıfırla · `Esc` temizle

## Mimari

```
server/
  index.js      Express + SSE (/api/analyze): ilerleme adımlarını canlı yayınlar, 10 dk önbellek, hız sınırı
  analyzer.js   Playwright + Chrome DevTools Protocol: ağ kaydı (transfer, initiator, zamanlama),
                lazy-load için otomatik kaydırma, DOM ağacı + yerleşim çıkarımı, Web Vitals, ekran görüntüsü
  security.js   SSRF koruması: localhost / özel IP / bulut metadata adreslerini hem giriş URL'sinde
                hem de sayfanın yaptığı her istekte engeller
public/
  js/model.js         ham veri → ağaç istatistikleri, skor, seçici derleyici
  js/scene/engine.js  renderer, kamera, OrbitControls, UnrealBloom, CSS2D etiketler, kamera uçuşu
  js/scene/layouts.js treemap şehir ve gerçek sayfa düzeni algoritmaları
  js/scene/city.js    DOM binaları (InstancedMesh), animasyonlar, vurgulama, seçim
  js/scene/network.js gezegenler, uydular, yörüngeler, akış çizgileri, initiator zinciri
  js/scene/materials.js özel shader enjeksiyonları (kenar ışıması, fresnel, tarama, ızgara)
  js/ui/*             rapor ve denetçi panelleri
```

Derleme adımı yoktur: Three.js doğrudan `node_modules`'tan ES modülü olarak servis edilir.

## Yapılandırma (ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | Sunucu portu |
| `MAX_CONCURRENT` | `2` | Aynı anda çalışan analiz sayısı (fazlası sıraya girer) |
| `MAX_NODES` | `12000` | Görselleştirilecek en fazla DOM öğesi |
| `NAV_TIMEOUT` | `30000` | Sayfa yükleme zaman aşımı (ms) |
| `RATE_MAX` | `12` | IP başına dakikada en fazla analiz |
| `ALLOW_PRIVATE` | — | `1` yapılırsa localhost / iç ağ adresleri analiz edilebilir (yalnızca yerel geliştirme için) |

## Notlar

- “3. parti” ayrımı kayıtlı alan adına göre yapılır; sitenin kendi CDN'leri (ör. `github.com` → `githubassets.com`)
  ad benzerliğinden birinci parti sayılır. Farklı adlı kendi CDN'ler (ör. `wikipedia.org` → `wikimedia.org`) 3. parti görünür.
- Transfer boyutları CDP `encodedDataLength` değeridir (sıkıştırılmış, başlıklar dahil).
- `?debug` parametresi WebGL tamponunu korur (ekran görüntüsü / otomasyon testleri için).
