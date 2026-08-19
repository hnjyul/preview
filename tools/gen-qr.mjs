// 시안별 모바일 QR 코드를 assets/qr-<ID>.svg 로 생성한다.
// 주소가 바뀌면 BASE 만 고치고 `npm run qr` 로 재생성할 것.
import QRCode from 'qrcode';
import { writeFile } from 'node:fs/promises';

const BASE = 'https://preview.j2inlab.workers.dev';
const IDS = ['A', 'B', 'C', 'D', 'E'];

for (const id of IDS) {
  const url = `${BASE}/s/${id}`;
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#1A1A18', light: '#FFFFFF' },
  });
  const path = `assets/qr-${id}.svg`;
  await writeFile(path, svg, 'utf8');
  console.log(`${path}  ->  ${url}`);
}
