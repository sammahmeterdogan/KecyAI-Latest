import SubPage from './SubPage';

const sections = [
    {
        title: 'Genel Özet',
        body: [
            'SO-101, LeRobot ekosisteminin amiral gemisi çift kollu (leader + follower) robotudur. Dokümantasyon, parça tedariki, kurulum, motor konfigürasyonu, montaj ve kalibrasyon adımlarını tek akışta anlatır.',
            'Amaç, iki kolun aynı fiziksel pozisyonda aynı pozisyon değerlerini üretmesi ve böylece bir robottan öğrenilen politikanın başka bir robota taşınabilmesidir.',
        ],
    },
    {
        title: 'Parça Tedariki ve 3D Baskı',
        body: [
            'İlk adım, resmi parçalar listesini takip ederek bileşenleri temin etmek ve 3D baskı parçalarını üretmektir. Doküman, yeni başlayanlar için baskı ile ilgili uyarılar içerir.',
        ],
    },
    {
        title: 'LeRobot + Feetech Kurulumu',
        body: [
            'LeRobot kurulumu tamamlandıktan sonra Feetech SDK kurulumu gerekir. Bu adım, SO-101 motorlarının sürülmesi için zorunludur.',
        ],
        chips: ['lerobot kurulumu', 'feetech SDK'],
    },
    {
        title: 'Motor Konfigürasyonu',
        body: [
            'Her motoru tek tek bağlayıp benzersiz ID atamak ve ortak baudrate kullanmak gerekir. Bu işlem kalıcı olarak motor EEPROM’una yazılır.',
            'LeRobot, bunun için `python lerobot/scripts/configure_motor.py` komutunu örnekler; port, motor modeli, baudrate ve ID parametreleriyle çalıştırılır.',
        ],
        chips: ['USB port', 'ID/baudrate', 'configure_motor.py'],
    },
    {
        title: 'Montajın Özeti',
        body: [
            'Follower kolu 6 adet STS3215 motor (1/345 oran) kullanır. Leader kolunda ise farklı oranlar tercih edilir ve her eklem için motor tablosu verilir.',
            'Montaj, eklem eklem ilerleyen bir sırayı izler (taban, omuz, dirsek, bilek, kavrayıcı). Her adımda uygun vida ve motor horn parçaları ile sabitleme yapılır.',
        ],
    },
    {
        title: 'Kalibrasyon',
        body: [
            'Follower ve leader kollar için ayrı kalibrasyon yapılır. Kalibrasyon sırasında eklemler orta konumdan başlayıp tüm hareket aralığı boyunca gezdirilir.',
            'LeRobot, hızlı kurulum için `lerobot-calibrate` komutunu önerir. Manuel kalibrasyon için `python lerobot/scripts/control_robot.py` komutu ile kalibrasyon modu da verilir.',
        ],
    },
    {
        title: 'Sonraki Adımlar',
        body: [
            'Kalibrasyon tamamlandıktan sonra robot, veri toplama ve politika eğitimi akışlarına hazır hale gelir. Doküman, gerçek dünya robotlarıyla eğitime yönlendiren bir başlangıç rehberine işaret eder.',
        ],
    },
];

export default function Kilavuz() {
    return (
        <SubPage
            title="Kılavuz (SO-101)"
            description="SO-101 kurulumu için kısa, pratik bir özet. Ayrıntılı adımlar ve komutlar için kaynak dokümana gidin."
            sourceUrl="https://huggingface.co/docs/lerobot/en/so101"
            sourceLabel="Hugging Face LeRobot • SO-101"
        >
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 14,
                marginTop: 6,
            }}>
                {sections.map((section) => (
                    <div key={section.title} style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(240,243,243,0.08)',
                        borderRadius: 14,
                        padding: '18px 18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                    }}>
                        <div style={{
                            fontFamily: "'pptelegraf-regular', sans-serif",
                            fontSize: 16,
                            color: '#fff',
                        }}>
                            {section.title}
                        </div>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                        }}>
                            {section.body.map((line) => (
                                <p key={line} style={{
                                    fontFamily: "'berkeleymonotrial-regular', monospace",
                                    fontSize: 12.5,
                                    color: '#a6a6a6',
                                    lineHeight: 1.6,
                                    margin: 0,
                                }}>
                                    {line}
                                </p>
                            ))}
                        </div>
                        {section.chips && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                                {section.chips.map((chip) => (
                                    <span key={chip} style={{
                                        fontFamily: "'berkeleymonotrial-regular', monospace",
                                        fontSize: 10.5,
                                        color: '#c9c5ff',
                                        border: '1px solid rgba(240,243,243,0.12)',
                                        borderRadius: 999,
                                        padding: '4px 8px',
                                        letterSpacing: '0.02em',
                                    }}>
                                        {chip}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </SubPage>
    );
}
