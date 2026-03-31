export const NAV_CONFIG = [
    {
        section: 'SO-101',
        items: [
            { label: 'Genel Bakış', path: '/kecy/platform', sourceUrl: 'https://huggingface.co/docs/lerobot/so101' },
            { label: 'Kılavuz', path: '/kecy/platform/kilavuz', sourceUrl: 'https://huggingface.co/docs/lerobot/so101#so-101' },
            { label: 'Parça Listesi', path: '/kecy/platform/parca-listesi', sourceUrl: 'https://huggingface.co/docs/lerobot/so101#source-the-parts' },
            { label: 'Montaj', path: '/kecy/platform/montaj', sourceUrl: 'https://huggingface.co/docs/lerobot/so101#step-by-step-assembly-instructions' },
            { label: 'Motor Ayarları', path: '/kecy/platform/motor-ayarlar', sourceUrl: 'https://huggingface.co/docs/lerobot/so101#configure-the-motors' },
            { label: 'Kalibrasyon', path: '/kecy/platform/kalibrasyon', sourceUrl: 'https://huggingface.co/docs/lerobot/so101#calibrate' },
        ],
    },
    {
        section: 'Kullanım',
        items: [
            { label: 'Desktop Launcher', path: '/kecy/platform/launcher' },
            { label: 'Demo Launcher', path: '/kecy/platform/demo' },
            { label: 'Teleoperasyon', path: '/kecy/platform/teleop', sourceUrl: 'https://huggingface.co/docs/lerobot/il_robots#teleoperate' },
            { label: 'Kameralar', path: '/kecy/platform/cameras', sourceUrl: 'https://huggingface.co/docs/lerobot/cameras' },
            { label: 'Veri Toplama', path: '/kecy/platform/record', sourceUrl: 'https://huggingface.co/docs/lerobot/il_robots#record-a-dataset' },
        ],
    },
    {
        section: 'Eğitim',
        items: [
            { label: 'Politika Eğitimi', path: '/kecy/platform/policy', sourceUrl: 'https://huggingface.co/docs/lerobot/il_robots#train-a-policy' },
            { label: 'Çıkarım & Değerlendirme', path: '/kecy/platform/inference', sourceUrl: 'https://huggingface.co/docs/lerobot/il_robots#run-inference-and-evaluate-your-policy' },
        ],
    },
    {
        section: 'Modeller',
        items: [
            { label: 'ACT', path: '/kecy/platform/models/act', sourceUrl: 'https://huggingface.co/docs/lerobot/act' },
            { label: 'SmolVLA', path: '/kecy/platform/models/smolvla', sourceUrl: 'https://huggingface.co/docs/lerobot/smolvla' },
            { label: 'Pi0', path: '/kecy/platform/models/pi0', sourceUrl: 'https://huggingface.co/docs/lerobot/pi0' },
        ],
    },
];
