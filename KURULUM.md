# KECYAI Kurulum

Bu dosya, KECYAI uygulamasını bir arkadaşın, ekip üyesinin veya müşterinin Windows bilgisayarında çalıştırmak için hazırlanmıştır.

## 1. Önerilen Kurulum Yolu

Kullanıcıya repo değil, kurulum dosyası verilmelidir.

Kullanılacak dosyalar:

- `desktop/src-tauri/target/release/bundle/nsis/KECY AI Desktop_0.1.0_x64-setup.exe`
- alternatif: `desktop/src-tauri/target/release/bundle/msi/KECY AI Desktop_0.1.0_x64_en-US.msi`

Önerilen dosya:

- `KECY AI Desktop_0.1.0_x64-setup.exe`

## 2. Son Kullanıcı Kurulum Adımları

1. `KECY AI Desktop_0.1.0_x64-setup.exe` dosyasını çalıştırın.
2. Kurulumu tamamlayın.
3. Kurulum bittikten sonra Başlat menüsünden `KECY AI Desktop` uygulamasını açın.

## 3. İlk Açılış

Uygulama açıldığında bir launcher ekranı gelir.

Launcher üzerindeki butonlar:

- `Start Service`
- `Open In Browser`
- `Stop Service`
- `Open Logs`

İlk kullanım sırası:

1. `Start Service` butonuna basın.
2. Durum `RUNNING` olana kadar bekleyin.
3. `Open In Browser` butonuna basın.
4. Uygulama tarayıcıda açılacaktır.

Varsayılan adres:

- `http://127.0.0.1:8040/kecy/platform`

Not:

- `8040` portu doluysa uygulama `8041` ile `8059` arasında boş bir porta geçebilir.

## 4. Teleop Kullanımı

Robot bilgisayara bağlıysa:

1. Tarayıcıda Teleop ekranını açın.
2. `Connect Robot` butonuna basın.
3. Bağlantı kurulduktan sonra eklemleri hareket ettirebilirsiniz.
4. İşiniz bitince `Disconnect` yapın.
5. Ardından launcher ekranından `Stop Service` ile servisi kapatın.

## 5. Calibration Kullanımı

Kalibrasyon için:

1. Uygulamayı açın.
2. Kalibrasyon ekranına gidin.
3. Ekrandaki adımları sırayla uygulayın.
4. Kalibrasyon çıktıları kullanıcı profilindeki KECYAI klasöründe tutulur.

## 6. Loglar ve Çalışma Dosyaları

KECYAI çalışma klasörü:

- `%USERPROFILE%\\.kecyai`

Log klasörü:

- `%USERPROFILE%\\.kecyai\\logs`

Launcher içinden `Open Logs` ile doğrudan açılabilir.

## 7. Sorun Giderme

### Uygulama açılıyor ama sayfa gelmiyor

Sıra şu şekilde olmalı:

1. `Start Service`
2. `RUNNING` durumunu gör
3. `Open In Browser`

### Robot bağlanmıyor

Kontrol edin:

- Robot USB/seri bağlantısı takılı mı
- Doğru COM port görünüyor mu
- Robotun güç bağlantısı açık mı
- Motor zinciri tam mı

### Tarayıcı başka portta açıldı

Bu normal olabilir.

Sebep:

- `8040` doluysa KECYAI boş port seçer

Doğru adres launcher üzerinde görünür.

### Hata olursa

Şu klasörü paylaşın:

- `%USERPROFILE%\\.kecyai\\logs`

## 8. Geliştirici / Teknik Kullanıcı İçin

Kurulum dosyası yerine repo üzerinden çalıştırmak gerekiyorsa:

```powershell
scripts\kecyai.cmd run
scripts\kecyai.cmd open
scripts\kecyai.cmd stop
scripts\kecyai.cmd doctor
```

Bu yol son kullanıcı için değil, teknik kullanım içindir.

## 9. Portable Paylaşım

Installer kullanılmayacaksa, en az şu dosyalar birlikte verilmelidir:

- `desktop/src-tauri/target/release/kecy-ai-desktop.exe`
- `desktop/src-tauri/target/release/kecyai-runtime.exe`

Bu iki dosya aynı klasörde tutulmalıdır.

Kullanıcı:

1. klasörü açar
2. `kecy-ai-desktop.exe` çalıştırır
3. launcher üzerinden `Start Service` ve `Open In Browser` yapar

## 10. Kısa Kullanım Özeti

Son kullanıcı için tek cümlelik akış:

`Kurulumu yap -> KECY AI Desktop aç -> Start Service -> Open In Browser -> Teleop/Calibration kullan -> iş bitince Stop Service`
