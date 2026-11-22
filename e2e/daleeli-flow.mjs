// E2E for daleeli/daleeli.html — static page, no network, no backend. Chromium only.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'daleeli');
const html = readFileSync(join(root, 'daleeli.html'));
const srv = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const tmp = mkdtempSync(join(tmpdir(), 'dal-'));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });

await page.goto(url);
const items = () => page.locator('#results .item');
const N = await page.evaluate(() => DEFAULTS.length);
ok(N >= 30 && await items().count() === N, 'يعرض كل المعاملات الافتراضية (' + N + ')');
ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'لا تمرير أفقي عند 390px (قائمة)');
ok(await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar'), 'dir=rtl و lang=ar');

await page.fill('.search', 'ضاعت هويتي');
ok((await items().allTextContents()).some(t => t.includes('فقدان الهوية')), 'البحث «ضاعت هويتي» يجد فقدان الهوية');
await page.fill('.search', 'تجديد جواز');
ok(await items().count() === 1, 'البحث «تجديد جواز» نتيجة واحدة');
await page.fill('.search', 'ءءءءء');
ok(await page.locator('#results .empty').count() === 1, 'رسالة عند عدم وجود نتيجة');
await page.fill('.search', '');

await items().first().click();
const body = await page.locator('article').innerText();
ok(body.includes('mofaex.gov.sy') && body.includes('قيد المراجعة'), 'بطاقة الجواز تعرض المصدر والوسم');
ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'لا تمرير أفقي عند 390px (تفاصيل)');
await page.click('#copyBtn');
let copyMsg = '';
try { await page.waitForFunction(() => document.getElementById('msg').textContent.length > 0, null, { timeout: 3000 }); copyMsg = await page.locator('#msg').innerText(); } catch {}
ok(copyMsg === 'تم النسخ' || copyMsg === 'تعذّر النسخ', 'زر النسخ يعطي رسالة (غير فارغة): «' + copyMsg + '»');
await page.click('#backBtn');

// edit mode
await page.click('#modeBtn');
ok(await page.locator('#exportBtn').count() === 1, 'وضع التعديل يظهر أدوات التصدير');
await page.locator('.item', { hasText: 'فقدان الهوية' }).click();
await page.fill('#f-fee', '123');
await page.selectOption('#f-status', 'confirmed');
await page.click('#saveBtn');
ok((await page.locator('#msg').innerText()).includes('لا يمكن وسم'), 'يرفض «مؤكد» دون مصدر وتاريخ');
ok(await page.inputValue('#f-status') === 'review', 'الحالة تُخفَّض إلى قيد المراجعة');
await page.fill('#f-source', 'تجربة');
await page.fill('#f-verified', '2026-11-22');
await page.selectOption('#f-status', 'confirmed');
await page.click('#saveBtn');
ok((await page.locator('#msg').innerText()) === 'تم الحفظ' && await page.inputValue('#f-status') === 'confirmed', 'يقبل «مؤكد» مع مصدر وتاريخ');
await page.click('#backBtn');

// persistence across reload
await page.reload();
ok((await items().allTextContents()).some(t => t.includes('فقدان الهوية') && t.includes('مؤكد')), 'الحفظ يبقى بعد إعادة التحميل');

// add + delete
await page.click('#modeBtn');
await page.click('#addBtn');
await page.fill('#f-title', 'معاملة اختبار');
await page.click('#saveBtn');
await page.click('#backBtn');
ok(await items().count() === N + 1, 'إضافة معاملة جديدة');
await page.locator('.item', { hasText: 'معاملة اختبار' }).click();
await page.click('#delBtn');
ok(await items().count() === 0 && await page.locator('#saveBtn').count() === 1, 'الضغطة الأولى على الحذف لا تحذف (تأكيد على خطوتين)');
await page.click('#delBtn');
ok(await items().count() === N, 'الضغطة الثانية تحذف المعاملة');

// export / import
await page.click('#exportBtn');
let parsed; try { parsed = JSON.parse(await page.inputValue('#exportText')); } catch {}
ok(parsed && parsed.entries.length === N, 'التصدير يعرض JSON صالحًا بكل المعاملات (بلا تنزيل)');
await page.click('#copyJsonBtn');
await page.waitForFunction(() => document.getElementById('msg').textContent === 'تم النسخ');
ok(true, 'نسخ نص التصدير');
const bad = join(tmp, 'bad.json'); writeFileSync(bad, '{"x":1}');
await page.setInputFiles('#importFile', bad);
await page.waitForFunction(() => document.getElementById('msg').textContent.includes('غير صالح'));
ok(true, 'استيراد ملف غير صالح يُرفض برسالة');
const good = join(tmp, 'good.json'); writeFileSync(good, JSON.stringify({ entries: [{ id: 'z', title: 'مستورد' }] }));
await page.setInputFiles('#importFile', good);
await page.waitForFunction(() => document.querySelectorAll('#results .item').length === 1);
ok((await items().first().innerText()).includes('مستورد'), 'استيراد ملف صالح يعمل');
await page.click('#resetBtn');
ok(await items().count() === 1, 'الضغطة الأولى على إعادة الافتراضي لا تُنفّذ');
await page.click('#resetBtn');
ok(await items().count() === N, 'الضغطة الثانية تعيد كل المعاملات الافتراضية');
ok(dialogs === 0, 'لا يُستخدم confirm/alert (محجوبة في العارض)');

// categories, live-data entries, safe merge with saved edits
await page.click('#modeBtn');
await page.click('#backBtn').catch(() => {});
const nJustice = await page.evaluate(() => DEFAULTS.filter(e => e.cat === 'justice').length);
await page.click('.chip[data-cat="justice"]');
ok(nJustice >= 4 && await items().count() === nJustice, 'مرشّح التصنيف «القضاء والعدل» يعرض ' + nJustice);
await page.click('.chip[data-cat=""]');
ok(await items().count() === N, 'مرشّح «الكل» يعيد الجميع');
await page.fill('.search', 'سعر الذهب');
ok((await items().first().innerText()).includes('غير متصلة'), 'وسم «بيانات حيّة — غير متصلة» في القائمة');
await items().first().click();
const gold = await page.locator('article').innerText();
ok(gold.includes('لا تُعرض أرقام') && !/\d{3,}/.test(gold), 'بطاقة الذهب: تنبيه بيانات حيّة وبلا أي سعر');
await page.click('#backBtn');
await page.fill('.search', '');
// migration: old store (v1, 2 entries, one edited, hotels marked removed) merges with new defaults
await page.evaluate(() => localStorage.setItem('daleeli.v1', JSON.stringify({ entries: [
  { id: 'passport', title: 'تجديد جواز السفر', keywords: '', status: 'confirmed', fee: 'تعديل المالك', docs: [], steps: [], mistakes: [], entity: '', who: '', time: '', source: 's', verified: '2026-11-22', notes: '' },
  { id: 'mine', title: 'معاملتي الخاصة', keywords: '', status: 'default', docs: [], steps: [], mistakes: [] }], removed: ['hotels'] })));
await page.reload();
ok(await items().count() === N - 1 + 1, 'الدمج: الافتراضيات الجديدة + معاملة المالك − المحذوفة (' + (N) + ')');
ok((await items().allTextContents()).every(t => !t.includes('حجوزات الفنادق')), 'المعاملة المحذوفة سابقًا لا تعود');
await page.locator('.item', { hasText: 'تجديد جواز السفر' }).click();
ok((await page.locator('article').innerText()).includes('تعديل المالك'), 'الدمج يحفظ تعديل المالك على المعاملة الموجودة');
await page.click('#backBtn');
await page.evaluate(() => localStorage.removeItem('daleeli.v1')); await page.reload();
// deleting a default persists across reload
await page.click('#modeBtn');
await page.locator('.item', { hasText: 'الأطباء والاختصاصات' }).click();
await page.click('#delBtn'); await page.click('#delBtn');
await page.reload();
ok((await items().allTextContents()).every(t => !t.includes('الأطباء والاختصاصات')), 'حذف معاملة افتراضية يبقى بعد إعادة التحميل');

// touch targets (visible buttons/inputs)
await page.click('#modeBtn');
const small = await page.evaluate(() => [...document.querySelectorAll('button,input:not([type=file]),select')]
  .filter(e => e.offsetParent).map(e => [e.id || e.className || e.tagName, Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 44));
ok(small.length === 0, 'أهداف اللمس ≥44px' + (small.length ? ' ' + JSON.stringify(small) : ''));

// dark scheme sanity: page still readable (no error), no overflow
const p2 = await (await browser.newContext({ viewport: { width: 320, height: 700 }, colorScheme: 'dark' })).newPage();
await p2.goto(url);
ok(await p2.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'لا تمرير أفقي عند 320px داكن');

ok(errs.length === 0, 'لا أخطاء في الكونسول' + (errs.length ? ' ' + errs.join('|') : ''));
await browser.close(); srv.close(); rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
