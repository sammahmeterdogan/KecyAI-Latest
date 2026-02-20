import SubPage from './SubPage';
export default function Motors() {
    return <SubPage title="Motor Ayarları" description="USB portlarının tespit edilmesi, motor ID'lerinin ve baud rate değerlerinin ayarlanması. Her kol için ayrı USB port konfigürasyonu gereklidir. Feetech STS3215 servoları için SDK kurulumu: pip install -e '[feetech]'." sourceUrl="https://huggingface.co/docs/lerobot/so101#configure-the-motors" sourceLabel="SO-101 Docs → Configure Motors" />;
}
