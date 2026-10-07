import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Build the participant link from the CURRENT origin (works with custom domains,
// not just the CloudFront domain) and render it as a QR code.
export function playUrl(code) {
  const origin = window.location.origin;
  return `${origin}/play?code=${encodeURIComponent(code)}`;
}

export default function PlayQR({ code, size = 200 }) {
  const [dataUrl, setDataUrl] = useState('');
  const url = playUrl(code);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, {
      width: size,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((d) => { if (alive) setDataUrl(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [url, size]);

  return (
    <div className="play-qr">
      {dataUrl && <img src={dataUrl} alt="참여 QR 코드" width={size} height={size} />}
      <div className="play-qr-url">{url}</div>
    </div>
  );
}
