/**
 * First-run helper: copies .env examples if missing (does not overwrite).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function copyIfMissing(src, dest) {
  if (fs.existsSync(dest)) {
    console.log(`[setup] keep existing: ${path.relative(root, dest)}`);
    return;
  }
  if (!fs.existsSync(src)) {
    console.warn(`[setup] missing source file: ${src}`);
    return;
  }
  fs.copyFileSync(src, dest);
  console.log(`[setup] created: ${path.relative(root, dest)}`);
}

copyIfMissing(path.join(root, '.env.example'), path.join(root, '.env.local'));
copyIfMissing(path.join(root, 'backend', '.env.example'), path.join(root, 'backend', '.env'));
console.log('[setup] Next: npm run dev:stack');
