#!/usr/bin/env node
/*
 * logo_dither_test.js —— 开机图"图片 -> 1bpp"的抖动算法 / 色阶回归测试。
 *
 *   node webhid-app/logo_dither_test.js
 *
 * 覆盖:
 *   1) none / bayer8 / fs 的黄金指纹(CRC16 + sha256 前 16 位)。这三个指纹是从"改动前的
 *      网页实现"录下来的, 录之前先与一套独立的 C++ 实现(tools/bootlogo_gen.cpp)逐字节
 *      对齐过, 之后任何时候都不许变。
 *      指纹的性质要说清楚: 它能挡住"无意改坏"(回归), 挡不住"两份实现都错"(当初就理解错)。
 *      后者由本文件里的误差扩散核权重和自检 + 灰阶还原曲线检查来兜 —— 它们直接盯算法本身,
 *      不依赖历史值。
 *
 *   关于"两套独立实现逐字节比对": C++ 工具和那个比对脚本(logo_convert_crosscheck.js)都已
 *   删除 —— 图片处理只保留网页这一份实现, 没有第二套可比。将来若又需要一次交叉验证,
 *   源码都在 git 历史里, 下面这套流程实测可用(用完删掉那个 exe, 它已不再被 gitignore):
 *     git show 3429fee:webhid-app/logo_convert_crosscheck.js > webhid-app/logo_convert_crosscheck.js
 *     git show 3429fee^:tools/bootlogo_gen.cpp > bootlogo_gen.cpp
 *     g++ -O2 -std=c++17 -o webhid-app/bootlogo_gen.exe bootlogo_gen.cpp
 *     node webhid-app/logo_convert_crosscheck.js
 *   (比对脚本要求可执行文件与它同目录; 另外那个 C++ 工具写不了系统 %TEMP%, 跑之前把 TEMP
 *    指到一个可写目录, 否则它会报 "cannot create ...out.h"。)
 *
 *   2) LOGO_DITHER_METHODS 里每个算法: 1024 字节 / 同参数可复现 / 不是全黑或全白。
 *   3) 灰阶还原: 均匀灰 v 抖动后, 点亮比例应当接近 v/255(单阈值算法除外)。
 *   4) 色阶: 默认参数必须是空操作 / 黑白场拉伸 / 伽马 / 亮度对比度 / 自动色阶。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const repo = __dirname;              // 本文件就在 webhid-app/ 下
const appSrc = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');

// ---------------------------------------------------------------- 载入 app.js
/** 记录调用的 2D 上下文桩: 用来验证 renderLogoSource 真的把选区交给了 drawImage */
function makeCtxStub() {
    const calls = [];
    return {
        calls: calls,
        fillStyle: '', strokeStyle: '', lineWidth: 1,
        imageSmoothingEnabled: false, imageSmoothingQuality: '',
        fillRect() { calls.push(['fillRect'].concat(Array.from(arguments))); },
        strokeRect() { calls.push(['strokeRect'].concat(Array.from(arguments))); },
        clearRect() { calls.push(['clearRect'].concat(Array.from(arguments))); },
        drawImage() { calls.push(['drawImage'].concat(Array.from(arguments))); },
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, putImageData() {},
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
        getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    };
}

function loadApp() {
    // 假的 <img>: 给 src 赋值的瞬间就回调 onload, 于是 loadLogoFile() 的同步部分
    // (设置 logoSourceImage + 重新生成)会在返回前跑完 —— 测试里不用 await
    const fakeSize = { w: 640, h: 480 };
    class FakeImage {
        constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null; this._src = ''; }
        get src() { return this._src; }
        set src(v) {
            this._src = v;
            this.width = fakeSize.w;
            this.height = fakeSize.h;
            if (this.onload) this.onload();
        }
    }

    function makeElement(id) {
        const store = { id, value: '', textContent: '', innerHTML: '', className: '', disabled: false, checked: false, dataset: {}, style: {}, children: [] };
        const ctx = makeCtxStub();
        const api = {
            classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
            addEventListener() {}, removeEventListener() {},
            appendChild(c) { store.children.push(c); return c; },
            insertBefore(c) { return c; }, removeChild() {}, remove() {},
            setAttribute() {}, getAttribute: () => null, focus() {}, click() {}, scrollIntoView() {},
            querySelector: () => makeElement(id + '-q'), querySelectorAll: () => [],
            getContext: () => ctx,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
            setPointerCapture() {}, releasePointerCapture() {},
        };
        return new Proxy(api, {
            get(t, k) { if (k in t) return t[k]; if (k in store) return store[k]; return undefined; },
            set(t, k, v) { store[k] = v; return true; },
        });
    }
    const els = new Map();
    const sandbox = {
        console, setTimeout, clearTimeout, setInterval, clearInterval,
        TextEncoder, TextDecoder, Uint8Array, Uint16Array, Float32Array, Uint8ClampedArray,
        Array, Object, Math, JSON, Promise, Date, Number, String, Boolean, Error, RegExp,
        isNaN, parseInt, parseFloat,
        document: {
            getElementById: (id) => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); },
            createElement: (tag) => makeElement('<' + tag + '>'),
            createTextNode: (t) => ({ textContent: t }),
            querySelector: () => makeElement('-q'), querySelectorAll: () => [],
            addEventListener() {}, body: makeElement('body'), documentElement: makeElement('html'),
        },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        navigator: { hid: {} },
        location: { protocol: 'https:', hostname: 'localhost' },
        window: {},
        URL: { createObjectURL: () => '', revokeObjectURL() {} },
        Image: FakeImage,
        __setFakeImageSize: (w, h) => { fakeSize.w = w; fakeSize.h = h; },
    };
    vm.createContext(sandbox);
    vm.runInContext(appSrc + `
;globalThis.__t = {
    imageDataToLogoBytes, imageDataToLuminance, logoDitherToBits, logoDitherUsesThreshold,
    applyLogoLevels, logoAutoLevels, logoLevelsAreIdentity,
    LOGO_DITHER_METHODS, LOGO_DIFFUSION_KERNELS, BAYER8, BAYER4, BAYER2,
    logoCrc16, LOGO_W, LOGO_H, LOGO_BYTES, LOGO_RANDOM_SEED,
    updateLogoThresholdEnabled, updateLogoDitherNote, document,
    // 选区裁切
    renderLogoSource, logoDefaultCrop, logoClampCrop, logoCropMove, logoCropResize,
    logoCropCursorAt, LOGO_CROP_HANDLE, LOGO_CROP_BOX,
    // 端到端: 真的载图 + 真的走指针事件
    loadLogoFile, onLogoCropPointerDown, onLogoCropPointerMove, onLogoCropPointerUp,
    onLogoCropPointerLeave, setFakeImageSize: __setFakeImageSize,
};
`, sandbox);
    return sandbox.__t;
}

const app = loadApp();

// ---------------------------------------------------------------- 工具
let failures = 0;
function check(name, got, want) {
    const ok = String(got) === String(want);
    if (!ok) failures++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ` : got "${got}" want "${want}"`}`);
}
function checkNear(name, got, want, tol) {
    const ok = Math.abs(got - want) <= tol;
    if (!ok) failures++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} : got ${got.toFixed(4)} want ${want.toFixed(4)}±${tol}`);
}
function sha16(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}
function litCount(bytes) {
    let n = 0;
    for (const b of bytes) {
        for (let k = 0; k < 8; k++) if (b & (0x80 >> k)) n++;
    }
    return n;
}

/** 128x64 的 ImageData: v(x,y) 返回灰度 */
function makeImageData(v) {
    const d = new Uint8ClampedArray(app.LOGO_W * app.LOGO_H * 4);
    for (let y = 0; y < app.LOGO_H; y++) {
        for (let x = 0; x < app.LOGO_W; x++) {
            const i = (y * app.LOGO_W + x) * 4;
            const g = v(x, y);
            d[i] = d[i + 1] = d[i + 2] = g;
            d[i + 3] = 255;
        }
    }
    return { data: d, width: app.LOGO_W, height: app.LOGO_H };
}

/** 当年与 C++ 实现做逐字节交叉校验时用的同一张测试图(黄金指纹就是在这张图上录的) */
const testImage = makeImageData((x, y) => {
    if (x < 32) return Math.round(x * 255 / 31);
    if (x < 64) return ((x + y) % 2) ? 40 : 210;
    if (x < 96) return 128;
    return Math.round(y * 255 / 63);
});

console.log('logo dither test (开机图 图片->1bpp)');

// ============ 1) 老算法黄金指纹 ============
// 这 9 个值是在引入新算法之前录下来的, 必须逐字节保持
const GOLDEN = {
    'none t128':    [{ threshold: 128, invert: false, dither: 'none' }, 'F6DE', '10e6f6ef704b74a4'],
    'none t160':    [{ threshold: 160, invert: false, dither: 'none' }, '701A', '8181d969d7b694e3'],
    'none t64':     [{ threshold: 64, invert: false, dither: 'none' }, '3F17', 'b60780dcf4a24c27'],
    'none t128 inv': [{ threshold: 128, invert: true, dither: 'none' }, '365A', '3a660c70d52d8441'],
    'bayer8':       [{ dither: 'bayer8' }, '5342', '50277bfe2ae21e46'],
    'bayer8 inv':   [{ dither: 'bayer8', invert: true }, '93C6', '7456a69201159d6b'],
    'fs':           [{ dither: 'fs' }, 'F316', '2ffe06a5305471d6'],
    'fs inv':       [{ dither: 'fs', invert: true }, '3392', '743d1de541c75a0f'],
    'fs t100':      [{ dither: 'fs', threshold: 100 }, '53DA', '18d917b1e41f26ee'],
};
console.log('-- 老算法黄金指纹(必须与重构前逐字节一致)');
for (const [name, [opts, crc, sha]] of Object.entries(GOLDEN)) {
    const bytes = Buffer.from(app.imageDataToLogoBytes(testImage, opts));
    const gotCrc = app.logoCrc16(bytes).toString(16).toUpperCase().padStart(4, '0');
    const gotSha = sha16(bytes);
    check(`${name} : CRC16`, gotCrc, crc);
    check(`${name} : sha256[0:16]`, gotSha, sha);
}

// ============ 2) 每个算法都能跑 ============
console.log('-- 算法清单');
check('算法数量', app.LOGO_DITHER_METHODS.length, 15);
check('算法 key 无重复',
    new Set(app.LOGO_DITHER_METHODS.map(m => m.key)).size, app.LOGO_DITHER_METHODS.length);
check('误差扩散核数量', Object.keys(app.LOGO_DIFFUSION_KERNELS).length, 7);
check('Bayer8 仍是 8x8/64 级', app.BAYER8.length + ':' + Math.max(...app.BAYER8), '64:63');
check('Bayer4 抽样为 4x4/16 级', app.BAYER4.length + ':' + Math.max(...app.BAYER4), '16:15');
check('Bayer2 抽样为 2x2/4 级', app.BAYER2.length + ':' + Math.max(...app.BAYER2), '4:3');

console.log('-- 每个算法: 长度 / 可复现 / 不是全黑或全白');
const gradient = makeImageData((x, y) => (x + y) % 256);
for (const m of app.LOGO_DITHER_METHODS) {
    const t0 = Date.now();
    const a = app.imageDataToLogoBytes(gradient, { dither: m.key, threshold: 128 });
    const ms = Date.now() - t0;
    const b = app.imageDataToLogoBytes(gradient, { dither: m.key, threshold: 128 });
    const lit = litCount(a);
    check(`${m.key.padEnd(12)} : 1024 字节`, a.length, app.LOGO_BYTES);
    check(`${m.key.padEnd(12)} : 同参数可复现`, sha16(Buffer.from(a)), sha16(Buffer.from(b)));
    check(`${m.key.padEnd(12)} : 非全黑/全白`, lit > 200 && lit < app.LOGO_BYTES * 8 - 200, true);
    console.log(`         (${m.key} 用时 ${ms}ms, 点亮 ${lit}/${app.LOGO_BYTES * 8})`);
}

// 未知算法名回退到单阈值
const unknown = app.imageDataToLogoBytes(gradient, { dither: 'no-such-dither', threshold: 128 });
const plain = app.imageDataToLogoBytes(gradient, { dither: 'none', threshold: 128 });
check('未知算法名回退到单阈值', sha16(Buffer.from(unknown)), sha16(Buffer.from(plain)));

// 每个算法都必须真的走到自己的分支(否则 key 写错会静默回退到单阈值, 上面那条检查照样通过)
for (const m of app.LOGO_DITHER_METHODS) {
    if (m.key === 'none') continue;
    const got = sha16(Buffer.from(app.imageDataToLogoBytes(gradient, { dither: m.key, threshold: 128 })));
    check(`${m.key.padEnd(12)} : 结果确实不等于单阈值`, got !== sha16(Buffer.from(plain)), true);
}

// ============ 3) 灰阶还原(点亮比例 ≈ v/255) ============
console.log('-- 误差扩散核自检(权重和必须等于除数, 否则会整片并阶)');
for (const [name, k] of Object.entries(app.LOGO_DIFFUSION_KERNELS)) {
    const sum = k.taps.reduce((a, t) => a + t[2], 0);
    if (name === 'atkinson') {
        // Atkinson 只扩散 6/8 = 3/4, 这是它"高对比"的来源, 属于预期行为
        check('atkinson 权重和 = 6(故意只扩散 3/4)', `${sum}/${k.div}`, '6/8');
    } else {
        check(`${name} 权重和 = 除数`, sum, k.div);
    }
}

console.log('-- 灰阶还原(均匀灰, 允许的偏差见括号)');
// bayer2 只有 4 级; Atkinson 因 3/4 扩散在暗部/亮部并阶, 只测中间调; dotdiffusion 在个别灰阶有低谷
const TONE = {
    bayer2:       { tol: 0.16,  levels: [32, 64, 96, 128, 160, 192, 224] },
    atkinson:     { tol: 0.05,  levels: [96, 112, 128, 144, 160] },
    dotdiffusion: { tol: 0.05,  levels: [32, 64, 96, 128, 160, 192, 224] },
    random:       { tol: 0.04,  levels: [32, 64, 96, 128, 160, 192, 224] },
    default:      { tol: 0.035, levels: [32, 64, 96, 128, 160, 192, 224] },
};
for (const m of app.LOGO_DITHER_METHODS) {
    if (m.key === 'none') continue;
    const cfg = TONE[m.key] || TONE.default;
    let worst = 0, worstV = 0;
    for (const v of cfg.levels) {
        const img = makeImageData(() => v);
        const lit = litCount(app.imageDataToLogoBytes(img, { dither: m.key, threshold: 128 }));
        const err = Math.abs(lit / (app.LOGO_BYTES * 8) - v / 255);
        if (err > worst) { worst = err; worstV = v; }
    }
    checkNear(`${m.key.padEnd(12)} 灰阶偏差(灰 ${worstV}, ±${cfg.tol})`, worst, 0, cfg.tol);
}
// Atkinson 的"并阶"特性: 灰 32(期望 12.5%)应当被压到几乎全黑
{
    const lit = litCount(app.imageDataToLogoBytes(makeImageData(() => 32), { dither: 'atkinson', threshold: 128 }));
    check('atkinson 暗部并阶(灰 32 -> <5%)', lit / (app.LOGO_BYTES * 8) < 0.05, true);
}

// ============ 4) 图案质量: 蓝噪声应该比白噪声"块内密度"更均匀 ============
console.log('-- 图案质量(8x8 块内点亮密度的方差, 越小越"均匀")');
function blockDensityVariance(bytes) {
    const B = 8, dens = [];
    for (let by = 0; by < app.LOGO_H / B; by++) {
        for (let bx = 0; bx < app.LOGO_W / B; bx++) {
            let n = 0;
            for (let y = 0; y < B; y++) {
                for (let x = 0; x < B; x++) {
                    const px = bx * B + x, py = by * B + y;
                    if (bytes[py * 16 + (px >> 3)] & (0x80 >> (px & 7))) n++;
                }
            }
            dens.push(n / (B * B));
        }
    }
    const mean = dens.reduce((a, b) => a + b, 0) / dens.length;
    return dens.reduce((a, d) => a + (d - mean) * (d - mean), 0) / dens.length;
}
{
    const mid = makeImageData(() => 128);
    const varOf = (key) => blockDensityVariance(app.imageDataToLogoBytes(mid, { dither: key, threshold: 128 }));
    const varBlue = varOf('bluenoise'), varRandom = varOf('random'), varBayer = varOf('bayer8'), varFs = varOf('fs');
    console.log(`         (bluenoise=${varBlue.toFixed(5)} random=${varRandom.toFixed(5)} bayer8=${varBayer.toFixed(5)} fs=${varFs.toFixed(5)})`);
    check('蓝噪声块内密度比白噪声更均匀', varBlue < varRandom * 0.7, true);
    check('Bayer8 在 8x8 块内密度恒定(方差≈0)', varBayer < 1e-6, true);
    check('误差扩散也比白噪声更均匀', varFs < varRandom, true);
}

// ============ 5) 色阶 ============
console.log('-- 色阶');
check('默认参数判定为空操作', app.logoLevelsAreIdentity({ black: 0, white: 255, gamma: 1, brightness: 0, contrast: 0 }), true);
check('缺省参数判定为空操作', app.logoLevelsAreIdentity(undefined), true);
check('带色阶参数时不再空操作', app.logoLevelsAreIdentity({ black: 10 }), false);

// 默认色阶参数不能改变老算法的结果
const withDefaultLevels = app.imageDataToLogoBytes(testImage, {
    dither: 'fs',
    levels: { black: 0, white: 255, gamma: 1, brightness: 0, contrast: 0 },
});
check('显式传默认色阶: fs 结果不变', sha16(Buffer.from(withDefaultLevels)), GOLDEN['fs'][2]);

// 黑白场拉伸: 输入 100..150 -> 0..255, 于是"小于中值"和"大于中值"两极分化
{
    const img = makeImageData((x) => (x < 64 ? 100 : 150));
    const noLevel = litCount(app.imageDataToLogoBytes(img, { dither: 'none', threshold: 128 }));
    const stretched = litCount(app.imageDataToLogoBytes(img, {
        dither: 'none', threshold: 128, levels: { black: 100, white: 150 },
    }));
    check('黑白场拉伸: 原图两侧都判成黑(100/150 都 >128 的只有 150)', noLevel, 64 * 64);
    check('黑白场拉伸: 拉伸后低侧变黑', stretched, 64 * 64);
}
// 反向: 把窗口放在亮侧, 于是 100/150 都落在窗口下方(全黑)
{
    const img = makeImageData(() => 120);
    const allBlack = litCount(app.imageDataToLogoBytes(img, {
        dither: 'none', threshold: 128, levels: { black: 200, white: 255 },
    }));
    check('黑白场窗口高于图像: 全部判黑', allBlack, 0);
}
// 全白 + 反色: 仍然全灭(灰度 255 反色后不点亮)
{
    const img = makeImageData(() => 255);
    check('全白 + 反色: 全灭', app.imageDataToLogoBytes(img, { invert: true }).every(b => b === 0), true);
}
// 伽马 > 1 提亮中间调: 中灰用 128 阈值 -> 提亮后应当有点亮
{
    const img = makeImageData(() => 140);
    const none = litCount(app.imageDataToLogoBytes(img, { dither: 'none', threshold: 128 }));
    const gamma = litCount(app.imageDataToLogoBytes(img, {
        dither: 'none', threshold: 128, levels: { gamma: 2.2 },
    }));
    check('灰 140 阈值 128: 原样点亮', none, app.LOGO_BYTES * 8);
    check('伽马 2.2 提亮: 仍点亮', gamma, app.LOGO_BYTES * 8);
    const dark = litCount(app.imageDataToLogoBytes(img, {
        dither: 'none', threshold: 128, levels: { gamma: 0.45 },
    }));
    check('伽马 0.45 压暗: 变全灭', dark, 0);
}
// 亮度/对比度
{
    const img = makeImageData(() => 100);
    check('亮度 +40: 灰 100 -> 140 点亮', litCount(app.imageDataToLogoBytes(img, {
        dither: 'none', threshold: 128, levels: { brightness: 40 },
    })), app.LOGO_BYTES * 8);
    check('亮度 -40: 灰 100 -> 60 全灭', litCount(app.imageDataToLogoBytes(img, {
        dither: 'none', threshold: 128, levels: { brightness: -40 },
    })), 0);
    check('对比度 +80: 灰 140 提亮到阈值以上', litCount(app.imageDataToLogoBytes(makeImageData(() => 140), {
        dither: 'none', threshold: 128, levels: { contrast: 80 },
    })), app.LOGO_BYTES * 8);
}
// 自动色阶
{
    const img = makeImageData((x) => (x < 64 ? 100 : 150));
    const lum = app.imageDataToLuminance(img, {});
    const auto = app.logoAutoLevels(lum, 0.5);
    check('自动色阶: 黑场落在 100 一侧', auto.black >= 99 && auto.black <= 101, true);
    check('自动色阶: 白场落在 150 一侧', auto.white >= 149 && auto.white <= 151, true);
    const flat = app.logoAutoLevels(app.imageDataToLuminance(makeImageData(() => 128), {}), 0.5);
    check('自动色阶: 纯色图窗口不超过 8', flat.white - flat.black <= 8, true);
}

// ============ 6) 静态一致性: app.js 引用的 DOM id 必须都在 index.html 里 ============
console.log('-- 静态一致性(app.js <-> index.html)');
{
    const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
    const htmlIds = new Set(Array.from(html.matchAll(/id="([^"]+)"/g)).map(m => m[1]));
    const wanted = Array.from(appSrc.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)).map(m => m[1]);
    const missing = Array.from(new Set(wanted)).filter(id => !htmlIds.has(id));
    check('app.js 引用的 DOM id 都能在 index.html 找到',
        missing.length ? missing.join(',') : '(无缺失)', '(无缺失)');
    // 抖动下拉框的选项由 JS 从 LOGO_DITHER_METHODS 生成, HTML 里应当是空壳
    check('index.html 的抖动下拉是空壳(选项由 JS 填充)',
        /id="logoDither"[^>]*>\s*<\/select>/.test(html), true);
    // 色阶滑杆的 id 必须和 app.js 里读的一致
    for (const id of ['logoBlack', 'logoWhite', 'logoGamma', 'logoBrightness', 'logoContrast']) {
        check(`色阶滑杆 #${id} 存在`, htmlIds.has(id), true);
    }
    check('灰度预览画布存在', htmlIds.has('logoGrayPreview'), true);
}

// ============ 7) 阈值滑块到底对哪些算法有效 ============
console.log('-- 阈值滑块的有效范围(改阈值后结果是否变化)');
// 有序/噪声抖动自带空间阈值矩阵, 固定阈值对它们没有意义;
// DBS 用感知误差最小化, 判决点固定在 0/255 中间, 也没有"阈值"这个概念。
// 其余算法都会用到阈值。
const THRESHOLD_APPLIES = ['none', 'fs', 'atkinson', 'sierralite', 'sierra2',
                           'burkes', 'stucki', 'jarvis', 'dotdiffusion'];
for (const m of app.LOGO_DITHER_METHODS) {
    const a = app.imageDataToLogoBytes(testImage, { dither: m.key, threshold: 128 });
    const b = app.imageDataToLogoBytes(testImage, { dither: m.key, threshold: 96 });
    const differs = sha16(Buffer.from(a)) !== sha16(Buffer.from(b));
    const expect = THRESHOLD_APPLIES.includes(m.key);
    check(`${m.key.padEnd(12)} : 阈值生效 = ${expect}`, differs, expect);
    check(`${m.key.padEnd(12)} : 与 usesThreshold 元数据一致`, !!m.usesThreshold, expect);
}

// 界面: 用不到阈值时必须真的禁用 + 给出原因
console.log('-- 阈值滑块的界面状态');
{
    const el = app.document.getElementById('logoThreshold');
    const row = app.document.getElementById('logoThresholdRow');
    const note = app.document.getElementById('logoThresholdNote');

    check('初始算法(none): 阈值滑块可用', el.disabled, false);
    check('初始算法(none): 行不变暗', row.style.opacity === '' || row.style.opacity === undefined, true);
    check('初始算法(none): 不显示"忽略阈值"说明', note.textContent, '');

    app.document.getElementById('logoDither').value = 'bayer8';
    app.updateLogoThresholdEnabled();
    check('切到 bayer8: 阈值滑块被禁用', el.disabled, true);
    check('切到 bayer8: 行变暗', row.style.opacity, '0.45');
    check('切到 bayer8: 给出原因', note.textContent.includes('自带空间阈值矩阵'), true);

    app.document.getElementById('logoDither').value = 'dbs';
    app.updateLogoThresholdEnabled();
    check('切到 dbs: 阈值滑块被禁用', el.disabled, true);
    check('切到 dbs: 原因说的是 DBS 而非有序抖动', note.textContent.includes('感知误差'), true);

    app.document.getElementById('logoDither').value = 'fs';
    app.updateLogoThresholdEnabled();
    check('切到 fs: 阈值滑块恢复可用', el.disabled, false);
    check('切到 fs: 说明清空', note.textContent, '');
}

// 阈值对不同算法"改的是什么": 单阈值改明暗; 全权重误差扩散只改纹理(平均密度守恒)
console.log('-- 阈值改的是明暗还是纹理');
{
    const mid = makeImageData(() => 128);
    const density = (key, t) => litCount(app.imageDataToLogoBytes(mid, { dither: key, threshold: t })) / (app.LOGO_BYTES * 8);
    check('单阈值: 灰 128 + 阈值 64 -> 全亮', density('none', 64), 1);
    check('单阈值: 灰 128 + 阈值 192 -> 全灭', density('none', 192), 0);
    const fsDens = [64, 128, 192].map(t => density('fs', t));
    checkNear('fs: 阈值 64/128/192 的平均密度都 ≈0.5(误差守恒, 阈值只改纹理)',
        Math.max(...fsDens) - Math.min(...fsDens), 0, 0.02);
    // Atkinson 只扩散 3/4 误差, 阈值会连带改变明暗; Dot Diffusion 在边界/末类上也会丢一点误差
    check('atkinson: 阈值会连带改变明暗', density('atkinson', 64) > density('atkinson', 192) + 0.05, true);
    check('dotdiffusion: 阈值也会连带改变明暗', density('dotdiffusion', 64) > density('dotdiffusion', 192) + 0.02, true);
}

// ============ 8) 选区裁切(大图框选 2:1 再转) ============
console.log('-- 选区几何(纯函数)');
const cropStr = (c) => `${c.x},${c.y},${c.w},${c.h}`;
check('默认选区 128x64(正好用满)', cropStr(app.logoDefaultCrop(128, 64)), '0,0,128,64');
check('默认选区 400x400(上下留边, 居中)', cropStr(app.logoDefaultCrop(400, 400)), '0,100,400,200');
check('默认选区 1000x100(左右留边, 居中)', cropStr(app.logoDefaultCrop(1000, 100)), '400,0,200,100');
check('默认选区 100x1000(受宽度限制)', cropStr(app.logoDefaultCrop(100, 1000)), '0,475,100,50');
check('默认选区 1920x1080', cropStr(app.logoDefaultCrop(1920, 1080)), '0,60,1920,960');

// 不变式: 永远 w = 2h, 且落在图内(宽 < 2 的退化图只要求不出负坐标)
{
    let bad = 0, badCase = '';
    const sizes = [[128, 64], [1000, 100], [100, 1000], [3, 3], [2, 1], [1, 1], [7, 300], [4000, 3]];
    for (const [w, h] of sizes) {
        for (const c of [app.logoDefaultCrop(w, h),
                         app.logoClampCrop({ x: -999, y: -999, w: 500, h: 500 }, w, h),
                         app.logoClampCrop({ x: 99999, y: 99999, w: 10, h: 5 }, w, h),
                         app.logoClampCrop({ x: 0, y: 0, w: 0, h: 0 }, w, h)]) {
            const ok = c.w === 2 * c.h && c.x >= 0 && c.y >= 0
                && c.h >= 1
                && (w < 2 || c.x + c.w <= w)
                && c.y + c.h <= h;
            if (!ok) { bad++; badCase = `${w}x${h} -> ${cropStr(c)}`; }
        }
    }
    check(`不变式: w=2h 且不出界(32 组)${bad ? ' 例:' + badCase : ''}`, bad, 0);
}

check('移动: 正常位移', cropStr(app.logoCropMove({ x: 10, y: 20, w: 100, h: 50 }, { x: 0, y: 0 }, { x: 30, y: 40 }, 400, 400)), '40,60,100,50');
check('移动: 撞左边界被夹住', cropStr(app.logoCropMove({ x: 10, y: 20, w: 100, h: 50 }, { x: 0, y: 0 }, { x: -500, y: -500 }, 400, 400)), '0,0,100,50');
check('移动: 撞右下边界被夹住', cropStr(app.logoCropMove({ x: 10, y: 20, w: 100, h: 50 }, { x: 0, y: 0 }, { x: 9999, y: 9999 }, 400, 400)), '300,350,100,50');
// 拖右上角: 不动的对角点是左下角(10,70), 往右下拖 -> 选区变大且仍 2:1
check('缩放: 拖角后仍是 2:1', (() => { const c = app.logoCropResize({ x: 10, y: 70 }, { x: 210, y: 170 }, 400, 400); return c.w === 2 * c.h; })(), true);
check('缩放: 锚点(对角)不动', (() => { const c = app.logoCropResize({ x: 10, y: 70 }, { x: 210, y: 170 }, 400, 400); return `${c.x},${c.y}`; })(), '10,70');
check('缩放: 拖到 (210,170) 得到 200x100', (() => { const c = app.logoCropResize({ x: 10, y: 70 }, { x: 210, y: 170 }, 400, 400); return `${c.w}x${c.h}`; })(), '200x100');
check('缩放: 往反方向拖会翻到另一侧且不出界', (() => {
    const c = app.logoCropResize({ x: 200, y: 200 }, { x: 0, y: 0 }, 400, 400);
    return c.w === 2 * c.h && c.x >= 0 && c.y >= 0 && c.x + c.w <= 400 && c.y + c.h <= 400;
})(), true);

console.log('-- 选区如何交给 drawImage(用 2D 上下文桩验证参数)');
{
    const fakeImg = { width: 640, height: 480 };
    const drawArgs = (mode, crop) => {
        const cv = app.renderLogoSource(fakeImg, mode, crop);
        const call = cv.getContext('2d').calls.filter(c => c[0] === 'drawImage').pop();
        return call.slice(1);            // 去掉 'drawImage'
    };

    const cropCall = drawArgs('crop', { x: 100, y: 50, w: 300, h: 150 });
    check('crop: 源矩形 = 选区, 目标 = 整个 128x64',
        `${cropCall[1]},${cropCall[2]},${cropCall[3]},${cropCall[4]} -> ${cropCall[5]},${cropCall[6]},${cropCall[7]},${cropCall[8]}`,
        '100,50,300,150 -> 0,0,128,64');
    check('crop: 第一参数是原图', cropCall[0] === fakeImg, true);

    const clamped = drawArgs('crop', { x: -50, y: -50, w: 300, h: 150 });
    check('crop: 越界选区先夹回图内', `${clamped[1]},${clamped[2]},${clamped[3]},${clamped[4]}`, '0,0,300,150');

    const noCrop = drawArgs('crop', null);
    // 640x480: 最大 2:1 = 640x320, 上下各留 (480-320)/2 = 80
    check('crop: 不给选区时用"最大 2:1 居中"', `${noCrop[1]},${noCrop[2]},${noCrop[3]},${noCrop[4]}`, '0,80,640,320');

    // 老三种方式不能被这次改动动过(640x480: fit 缩放比取小边 64/480)
    const fitCall = drawArgs('fit');
    check('fit: 参数与改动前一致', `${fitCall[1]},${fitCall[2]},${fitCall[3]},${fitCall[4]}`, '21,0,85,64');
    const stretchCall = drawArgs('stretch');
    check('stretch: 铺满 128x64', `${stretchCall[1]},${stretchCall[2]},${stretchCall[3]},${stretchCall[4]}`, '0,0,128,64');
    const fillCall = drawArgs('fill');
    // 640x480 按 0.2 放大到 128x96, 居中后上下各露出去 16 像素(会被画布裁掉, 改动前就是这样)
    check('fill: 参数与改动前一致', `${fillCall[1]},${fillCall[2]},${fillCall[3]},${fillCall[4]}`, '0,-16,128,96');
}

// ============ 9) 选框的指针图标 & 端到端交互 ============
console.log('-- 指针图标(纯函数)');
{
    const crop = { x: 100, y: 50, w: 200, h: 100 };
    const scale = 1;
    check('框内 -> move', app.logoCropCursorAt({ x: 200, y: 100 }, crop, scale), 'move');
    check('左上角 -> nwse-resize', app.logoCropCursorAt({ x: 100, y: 50 }, crop, scale), 'nwse-resize');
    check('右下角 -> nwse-resize', app.logoCropCursorAt({ x: 300, y: 150 }, crop, scale), 'nwse-resize');
    check('右上角 -> nesw-resize', app.logoCropCursorAt({ x: 300, y: 50 }, crop, scale), 'nesw-resize');
    check('左下角 -> nesw-resize', app.logoCropCursorAt({ x: 100, y: 150 }, crop, scale), 'nesw-resize');
    check('框外(上) -> default', app.logoCropCursorAt({ x: 200, y: 20 }, crop, scale), 'default');
    check('框外(左) -> default', app.logoCropCursorAt({ x: 50, y: 100 }, crop, scale), 'default');
    check('边中点(仍在框内) -> move', app.logoCropCursorAt({ x: 200, y: 50 }, crop, scale), 'move');
    check('没有选区 -> default', app.logoCropCursorAt({ x: 0, y: 0 }, null, scale), 'default');
    // 容差是"显示像素"折回源像素: 同一个源图偏移 (8,8), 0.5x 时 tol=16 算角, 2x 时 tol=4 不算
    check('容差随显示缩放比折算(0.5x -> tol=16, 算角)',
        app.logoCropCursorAt({ x: 108, y: 58 }, crop, 0.5), 'nwse-resize');
    check('容差随显示缩放比折算(2x -> tol=4, 不算角但在框内)',
        app.logoCropCursorAt({ x: 108, y: 58 }, crop, 2), 'move');
}

console.log('-- 端到端: 载图 -> 悬停 -> 拖动(走真实事件处理函数)');
{
    const el = (id) => app.document.getElementById(id);
    const canvas = el('logoCropCanvas');

    // 准备: 缩放方式选"选区框选", 其它控件给上合理初值
    el('logoFit').value = 'crop';
    el('logoThreshold').value = '128';
    el('logoDither').value = 'none';
    app.setFakeImageSize(640, 480);
    app.loadLogoFile({ name: 'fake.png' });          // 假 Image 同步触发 onload

    check('载图后提示里是默认选区(640x480 -> 640x320 @ 0,80)',
        el('logoCropInfo').textContent.indexOf('选区 640x320 @ (0,80)') >= 0, true);
    check('载图后选框可见', canvas.style.display, '');

    // 显示缩放比与默认选区(与 drawLogoCropEditor 里的算法一致)
    const scale = Math.min(app.LOGO_CROP_BOX / 640, app.LOGO_CROP_BOX / 480);
    const at = (sx, sy) => ({ clientX: sx * scale, clientY: sy * scale });

    app.onLogoCropPointerMove(at(320, 240));         // 框内
    check('悬停框内: 图标 = move', canvas.style.cursor, 'move');
    app.onLogoCropPointerMove(at(640, 400));         // 右下角
    check('悬停右下角: 图标 = nwse-resize', canvas.style.cursor, 'nwse-resize');
    app.onLogoCropPointerMove(at(0, 80));            // 左上角
    check('悬停左上角: 图标 = nwse-resize', canvas.style.cursor, 'nwse-resize');
    app.onLogoCropPointerMove(at(640, 80));          // 右上角
    check('悬停右上角: 图标 = nesw-resize', canvas.style.cursor, 'nesw-resize');
    app.onLogoCropPointerMove(at(320, 20));          // 框外(上方留白)
    check('悬停框外: 图标 = default', canvas.style.cursor, 'default');
    app.onLogoCropPointerLeave();
    check('移出画布: 图标复位为 default', canvas.style.cursor, 'default');

    // 三种状态必须互不相同(这就是本次报的 bug: 三态都是 move)
    const three = new Set([
        app.logoCropCursorAt({ x: 320, y: 240 }, { x: 0, y: 80, w: 640, h: 320 }, scale),
        app.logoCropCursorAt({ x: 640, y: 400 }, { x: 0, y: 80, w: 640, h: 320 }, scale),
        app.logoCropCursorAt({ x: 320, y: 20 }, { x: 0, y: 80, w: 640, h: 320 }, scale),
    ]);
    check('三种状态图标互不相同', three.size, 3);

    // 拖动整体: 框内按下 -> 往左上拖 -> 松手
    app.onLogoCropPointerMove(at(320, 240));
    app.onLogoCropPointerDown({ ...at(320, 240), pointerId: 1, preventDefault() {} });
    app.onLogoCropPointerMove(at(220, 140));
    app.onLogoCropPointerUp();
    check('拖动后选区被移动(尺寸不变)',
        el('logoCropInfo').textContent.indexOf('选区 640x320 @ (0,0)') >= 0, true);

    // 拖右下角: 往左上收 -> 选区变小, 且仍是 2:1
    app.onLogoCropPointerDown({ ...at(640, 320), pointerId: 1, preventDefault() {} });
    app.onLogoCropPointerMove(at(440, 220));
    app.onLogoCropPointerUp();
    const m = /选区 (\d+)x(\d+) @/.exec(el('logoCropInfo').textContent);
    check('拖角后仍是 2:1', m ? Number(m[1]) === 2 * Number(m[2]) : 'n/a', true);
    check('拖角后选区确实变小了', m ? Number(m[1]) < 640 : 'n/a', true);
}

console.log('-- 静态守门: 光标不能写死在 HTML 里');
{
    const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
    const canvasTag = /<canvas id="logoCropCanvas"[\s\S]{0,300}?><\/canvas>/.exec(html);
    check('选框画布的 inline style 不含 cursor:move(要由 JS 按状态切)',
        canvasTag ? !/cursor\s*:\s*move/.test(canvasTag[0]) : 'no-tag', true);
    check('app.js 里确实在按状态设置光标', /logoCropCanvas\.style\.cursor\s*=/.test(appSrc), true);
}

console.log(`logo_dither_test: ${failures ? 'FAILED' : 'all passed'} (${failures} failure${failures === 1 ? '' : 's'})`);
process.exit(failures ? 1 : 0);
