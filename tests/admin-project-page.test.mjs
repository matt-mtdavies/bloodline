import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.join(dirname, '../public/admin-project.html'), 'utf8');
const admin = readFileSync(path.join(dirname, '../public/admin.html'), 'utf8');

assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
assert.match(page, /fetch\('\/api\/admin\/project-activity'/);
assert.match(page, /role="tablist"/);
assert.match(page, /role="tabpanel"/);
assert.match(page, /Family activity remains separate/);
assert.doesNotMatch(page, /fetch\([^\n]*api\/activity/);
assert.match(page, /@media \(pointer: coarse\)/);
assert.match(page, /prefers-reduced-motion/);
assert.match(admin, /href="\/admin-project\.html"[^>]*aria-label="Open Product Operations"/);

console.log('PASS  Product Operations page keeps admin auth/activity boundaries and accessible navigation');
