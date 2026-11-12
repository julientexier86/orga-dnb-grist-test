const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = __dirname;
const indexPath = path.join(root, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const dom = new JSDOM(html);
const { document } = dom.window;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

assert(!html.includes('local.adguard.org'), 'index.html contient encore une injection AdGuard.');
assert(document.documentElement.lang === 'fr', 'La langue HTML devrait rester fr.');
assert(document.querySelector('.sidebar'), 'La barre latérale est introuvable.');
assert(document.getElementById('dashboard'), 'La section Tableau de bord est introuvable.');
assert(document.getElementById('config'), 'La section Configuration est introuvable.');
assert(document.getElementById('tableStudents'), 'Le tableau des élèves est introuvable.');

const missingLocalScripts = [...document.querySelectorAll('script[src]')]
    .map(script => script.getAttribute('src'))
    .filter(src => !src.startsWith('http') && !src.startsWith('//'))
    .filter(src => !fs.existsSync(path.join(root, src.split(/[?#]/, 1)[0])));

assert(
    missingLocalScripts.length === 0,
    `Scripts locaux manquants: ${missingLocalScripts.join(', ')}`
);

console.log('Smoke test OK: index.html est cohérent et les scripts locaux existent.');
