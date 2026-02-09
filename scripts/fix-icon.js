/**
 * Fix or replace PNG icon so electron-builder succeeds (avoids "png: invalid format: invalid checksum").
 * Run: node scripts/fix-icon.js
 */
const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;

const iconPath = path.join(__dirname, '..', 'icons', 'icon.png');
const backupPath = path.join(__dirname, '..', 'icons', 'icon.png.bak');

function createPlaceholderIcon() {
  const size = 256;
  const png = {
    width: size,
    height: size,
    data: Buffer.alloc(size * size * 4),
    gamma: 0,
  };
  // Simple gradient: dark blue -> lighter blue (suitable for VPN/network app)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) << 2;
      const t = (x + y) / (2 * size);
      png.data[i] = Math.round(30 + t * 80);     // R
      png.data[i + 1] = Math.round(80 + t * 100); // G
      png.data[i + 2] = Math.round(180 + t * 60); // B
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

try {
  const buffer = fs.readFileSync(iconPath);
  let fixed;

  try {
    const png = PNG.sync.read(buffer, { checkCRC: false });
    fixed = PNG.sync.write(png);
    console.log('Icon re-encoded with correct checksums.');
  } catch (_) {
    fixed = createPlaceholderIcon();
    console.log('Icon was corrupted; replaced with a valid placeholder.');
  }

  fs.writeFileSync(backupPath, buffer);
  fs.writeFileSync(iconPath, fixed);
  console.log('Backup saved to icons/icon.png.bak');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
