# KECY AI Masaustu - Kurulum Kilavuzu

Bu kilavuz guncel masaustu mimarisini ozetler. Aktif urun yolu artik:

`Tauri / React arayuzu -> Python runtime servisi -> robotik mantik`

Java backend aktif akista yoktur.

## Gereksinimler

- Windows 10 veya 11
- Python 3.10+
- Miniforge3 onerilir
- `lerobot`, `pyserial`, `feetech-servo-sdk`

## Gelistirici calistirma

### Masaustu

```bash
cd desktop
npm install
npm run dev
```

### Tarayici + runtime

```bash
cd frontend
npm install
npm run dev
```

Ayrica Python runtime servisi `8040` portunda calismalidir.

## Docker

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

Istege bagli web konteyneri:

```bash
docker compose -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.web.yml up --build
```

## Saglik kontrolu

```powershell
Invoke-RestMethod http://localhost:8040/api/health
Invoke-RestMethod http://localhost:8040/api/lerobot/health
```

## Robot baglantisi

- Donanim ayarlari `~/.kecyai/hardware_config.json` altinda tutulur.
- Port tarama ve on ayar islemleri `/api/lerobot/admin/*` altindan yapilir.
- Kalibrasyon ve teleop rotalari dogrudan Python runtime servisi tarafindan sunulur.

## Notlar

- Eski `8080` ve `8100` referanslari artik legacy dokuman sayilmalidir.
- Onyuz API override degiskeni `VITE_API_BASE_URL` olarak birlestirildi.
