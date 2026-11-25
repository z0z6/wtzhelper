'use strict';
// Linux: część dystrybucji (np. Ubuntu 24.04) blokuje piaskownicę Chromium w AppImage
// („The SUID sandbox helper binary was found, but is not configured correctly”).
// Podmieniamy plik wykonywalny na skrypt, który uruchamia aplikację z --no-sandbox.
// Aplikacja wczytuje wyłącznie lokalne pliki (bez treści z internetu w oknie).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const exe = context.packager.executableName;
  const dir = context.appOutDir;
  const bin = path.join(dir, exe);
  const real = path.join(dir, exe + '.bin');
  if (!fs.existsSync(bin) || fs.existsSync(real)) return;
  fs.renameSync(bin, real);
  fs.writeFileSync(bin, `#!/bin/bash\nHERE="$(dirname "$(readlink -f "$0")")"\nexec "$HERE/${exe}.bin" --no-sandbox "$@"\n`, { mode: 0o755 });
};
