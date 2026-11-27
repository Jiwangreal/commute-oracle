import QRCode from 'qrcode';
await QRCode.toFile('video/assets/qr.png', 'https://jiwangreal.github.io/commute-oracle/', {
  width: 520, margin: 1, color: { dark: '#0b142e', light: '#ffffff' }, errorCorrectionLevel: 'H'
});
console.log('video/assets/qr.png');
