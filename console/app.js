/**
 * WebHID 设备调试工具 - 主逻辑
 * 
 * 功能：
 * - 连接 HID 设备
 * - 发送 Output Report / 获取 Feature Report
 * - 实时接收 Input Report 数据
 * - 配置项管理（打包成 2 字节：Byte0=配置类型, Byte1=配置数据）
 */

// ============ DOM 引用 ============
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const deviceInfo = document.getElementById('deviceInfo');
const deviceInfoContent = document.getElementById('deviceInfoContent');

const clearReportsBtn = document.getElementById('clearReportsBtn');
const receiveStatus = document.getElementById('receiveStatus');
const reportsContainer = document.getElementById('reportsContainer');

// 配置区域 DOM 引用
const wirelessModeSelect = document.getElementById('wirelessMode');
const socdSelect = document.getElementById('socd');
const sleepEnableSelect = document.getElementById('sleepEnable');
const sleepTimeInput = document.getElementById('sleepTime');
const enableModifyKeySelect = document.getElementById('enableModifyKey');
const swapDirDpadSelect = document.getElementById('swapDirDpad');
const rfCapSelect = document.getElementById('rfCap');
const networkNameInput = document.getElementById('networkName');
const configPreviewSpan = document.getElementById('configPreview');
const networkNamePreviewSpan = document.getElementById('networkNamePreview');
const sendConfigBtn = document.getElementById('sendConfigBtn');
const sendNetworkNameBtn = document.getElementById('sendNetworkNameBtn');
const resetConfigBtn = document.getElementById('resetConfigBtn');
const readConfigBtn = document.getElementById('readConfigBtn');
const readKeymapBtn = document.getElementById('readKeymapBtn');
const readNameBtn = document.getElementById('readNameBtn');
const saveAndRebootBtn = document.getElementById('saveAndRebootBtn');
const exportConfigBtn = document.getElementById('exportConfigBtn');
const importConfigBtn = document.getElementById('importConfigBtn');
const importFileInput = document.getElementById('importFileInput');

// 配置标签切换 DOM
const configTab1 = document.getElementById('configTab1');
const configTab2 = document.getElementById('configTab2');
const configTab3 = document.getElementById('configTab3');
const configTab4 = document.getElementById('configTab4');
const configPanel1 = document.getElementById('configPanel1');
const configPanel2 = document.getElementById('configPanel2');
const configPanel3 = document.getElementById('configPanel3');
const configPanel4 = document.getElementById('configPanel4');

// 开机图面板
const logoFileInput = document.getElementById('logoFile');
const logoThresholdInput = document.getElementById('logoThreshold');
const logoInvertCheckbox = document.getElementById('logoInvert');
const logoFitSelect = document.getElementById('logoFit');
const logoDitherSelect = document.getElementById('logoDither');
const logoPreviewCanvas = document.getElementById('logoPreview');
const logoStatSpan = document.getElementById('logoStat');
const logoProgressSpan = document.getElementById('logoProgress');
const logoDeviceStatSpan = document.getElementById('logoDeviceStat');
const uploadLogoBtn = document.getElementById('uploadLogoBtn');
const restoreLogoBtn = document.getElementById('restoreLogoBtn');

// 注册区域 DOM
const readMacBtn = document.getElementById('readMacBtn');
const deviceMacEl = document.getElementById('deviceMac');
const regCodeInput = document.getElementById('regCodeInput');
const sendRegCodeBtn = document.getElementById('sendRegCodeBtn');
const regStatusEl = document.getElementById('regStatus');

// 按键映射 DOM
const keymapContainer = document.getElementById('keymapContainer');
const sendKeymapBtn = document.getElementById('sendKeymapBtn');
const resetKeymapBtn = document.getElementById('resetKeymapBtn');

// ============ 状态变量 ============
let device = null;           // 当前连接的 HIDDevice
let isListening = false;     // 是否正在监听 input 事件

// 存储 input 事件处理函数引用，以便移除
let inputReportHandler = null;

// 各 Report ID 的最新数据缓存 { reportId: { data: Uint8Array, count: number } }
const reportDataMap = {};

// ============ 配置管理 ============

/**
 * 配置项的默认值
 */
const DEFAULT_CONFIG = {
    wirelessMode: 1,   // 1=BLE
    socd: 0,           // 0=回中
    sleepEnable: 1,    // 1=启用
    sleepTime: 5,      // 5 分钟
    enableModifyKey: 0, // 方向修饰键: 0=禁用(LS/RS 仅作普通按键), 1=启用(LS/RS 作修饰键)
    swapDirDpad: 0,     // 交换 D-Pad/左摇杆: 0=默认方向→左摇杆(LS+方向→D-Pad), 1=默认方向→D-Pad(LS+方向→左摇杆)
    rfCap: 0,           // 32M 晶振负载电容档位: 0=10pF .. 7=24pF (2.4G 频偏补偿)
    networkName: 'CH58X-Gamepad'
};

// ============ 按键映射数据 ============

/**
 * xinput 按钮列表（名称 -> 数值）
 */
const XINPUT_BUTTONS = [
    { name: 'LB', value: 0 },
    { name: 'RB', value: 1 },
    { name: 'HOME', value: 2 },
    { name: 'EMPTY', value: 3 },
    { name: 'A', value: 4 },
    { name: 'B', value: 5 },
    { name: 'X', value: 6 },
    { name: 'Y', value: 7 },
    { name: 'UP', value: 8 },
    { name: 'DOWN', value: 9 },
    { name: 'LEFT', value: 10 },
    { name: 'RIGHT', value: 11 },
    { name: 'START', value: 12 },
    { name: 'BACK', value: 13 },
    { name: 'LS', value: 14 },
    { name: 'RS', value: 15 },
    { name: 'LT', value: 16 },
    { name: 'RT', value: 17 },
    { name: 'INVALID', value: 19 }
];

/**
 * 根据 xinput 按钮值获取名称
 */
function getXinputName(value) {
    const btn = XINPUT_BUTTONS.find(b => b.value === value);
    return btn ? btn.name : `UNKNOWN(${value})`;
}

/**
 * 20 个键位的默认映射
 * 每个键位: { primary: xinput按钮值, secondary: [最多4个xinput按钮值] }
 * secondary 仅在 primary 不是 INVALID(19) 时有效
 */
const DEFAULT_KEYMAP = [
    { primary: 8,  secondary: [] },  // 0: UP
    { primary: 9,  secondary: [] },  // 1: DOWN
    { primary: 10, secondary: [] },  // 2: LEFT
    { primary: 11, secondary: [] },  // 3: RIGHT
    { primary: 4,  secondary: [] },  // 4: A
    { primary: 5,  secondary: [] },  // 5: B
    { primary: 16, secondary: [] },  // 6: LT
    { primary: 17, secondary: [] },  // 7: RT
    { primary: 6,  secondary: [] },  // 8: X
    { primary: 7,  secondary: [] },  // 9: Y
    { primary: 0,  secondary: [] },  // 10: LB
    { primary: 1,  secondary: [] },  // 11: RB
    { primary: 14, secondary: [] },  // 12: LS
    { primary: 15, secondary: [] },  // 13: RS
    { primary: 13, secondary: [] },  // 14: BACK
    { primary: 12, secondary: [] },  // 15: START
    { primary: 2,  secondary: [] },  // 16: HOME
    { primary: 8,  secondary: [] },  // 17: UP
    { primary: 19, secondary: [] },  // 18: INVALID
    { primary: 19, secondary: [] }   // 19: INVALID
];

/**
 * 将 UI 配置项打包成 16 字节数据 (配置类型 0x01)
 * Byte 0: 0x01 (固定配置类型)
 * Byte 1: 位域打包:
 *   Bit 0   - 无线模式 (1=BLE, 0=2.4G)
 *   Bits 1-2 - SOCD (0=回中, 1=后覆盖, 2=前覆盖, 3=上优先)
 *   Bit 3   - 启用睡眠 (1=启用, 0=禁用)
 *   Bits 4-7 - 无线睡眠时间 (编码: 0~15 映射到 5~20 分钟)
 * Byte 2: 位域打包:
 *   Bit 0   - 方向修饰键 (0=禁用, 1=启用)
 *   Bits 3-1 - 晶振负载电容档位 (0..7 = 10/12/.../24 pF)
 *   Bit 4   - 交换 D-Pad/左摇杆 (0=默认方向→左摇杆, 1=默认方向→D-Pad)
 * Byte 3-15: 填充 0x00
 */
function packConfig() {
    const wirelessMode = parseInt(wirelessModeSelect.value, 10);
    const socd = parseInt(socdSelect.value, 10);
    const sleepEnable = parseInt(sleepEnableSelect.value, 10);
    let sleepTime = parseInt(sleepTimeInput.value, 10);
    const enableModifyKey = parseInt(enableModifyKeySelect.value, 10);
    const swapDirDpad = parseInt(swapDirDpadSelect.value, 10);
    const rfCap = parseInt(rfCapSelect.value, 10);

    // 限制睡眠时间范围 5~20，编码为 0~15
    sleepTime = Math.max(5, Math.min(20, sleepTime));
    const sleepCode = sleepTime - 5; // 5→0, 6→1, ..., 20→15

    let configByte = 0;
    configByte |= (wirelessMode & 0x01) << 0;       // Bit 0
    configByte |= (socd & 0x03) << 1;               // Bits 2-1
    configByte |= (sleepEnable & 0x01) << 3;        // Bit 3
    configByte |= (sleepCode & 0x0F) << 4;          // Bits 7-4

    const report = new Uint8Array(16);
    report[0] = 0x01;
    report[1] = configByte;
    report[2] = (enableModifyKey & 0x01) | ((rfCap & 0x07) << 1) | ((swapDirDpad & 0x01) << 4);
    //          Bit0: 修饰键, Bits3-1: 晶振电容, Bit4: 交换 D-Pad/左摇杆
    // bytes 3-15 已初始化为 0x00

    return report;
}

/**
 * 将网络名称打包成 16 字节数据 (配置类型 0x03)
 * Byte 0: 0x03 (固定配置类型)
 * Byte 1-15: 网络名称 (15 bytes, null-terminated ASCII)
 */
function packNetworkName() {
    const report = new Uint8Array(16);
    report[0] = 0x03;

    const name = (networkNameInput.value || '').trim() || DEFAULT_CONFIG.networkName;
    const encoder = new TextEncoder();
    const nameBytes = encoder.encode(name);
    for (let i = 0; i < 15; i++) {
        report[1 + i] = i < nameBytes.length ? nameBytes[i] : 0x00;
    }

    return report;
}

/**
 * 解析配置数据并更新 UI
 */
function unpackConfig(data) {
    if (data.length < 2) {
        appendLog('⚠️ 配置数据不足 2 字节，无法解析', 'error');
        return;
    }

    const configType = data[0];

    if (configType === 0x01) {
        const configByte = data[1];
        const wirelessMode = (configByte >> 0) & 0x01;
        const socd = (configByte >> 1) & 0x03;
        const sleepEnable = (configByte >> 3) & 0x01;
        const sleepCode = (configByte >> 4) & 0x0F;
        const sleepTime = sleepCode + 5;
        const enableModifyKey = data.length >= 3 ? (data[2] & 0x01) : 0;
        const rfCap = data.length >= 3 ? ((data[2] >> 1) & 0x07) : 0;
        const swapDirDpad = data.length >= 3 ? ((data[2] >> 4) & 0x01) : 0;

        wirelessModeSelect.value = String(wirelessMode);
        socdSelect.value = String(socd);
        sleepEnableSelect.value = String(sleepEnable);
        sleepTimeInput.value = sleepTime;
        enableModifyKeySelect.value = String(enableModifyKey);
        swapDirDpadSelect.value = String(swapDirDpad);
        rfCapSelect.value = String(rfCap);

        updateConfigPreview();

        appendLog(
            `⚙️ 配置已解析: 类型=0x01` +
            ` | 无线模式=${wirelessMode === 1 ? 'BLE' : '2.4G'}` +
            ` | SOCD=${['回中', '后覆盖', '前覆盖', '上优先'][socd]}` +
            ` | 方向修饰键=${enableModifyKey === 1 ? '启用' : '禁用'}` +
            ` | 交换D-Pad/左摇杆=${swapDirDpad === 1 ? '默认→D-Pad' : '默认→左摇杆'}` +
            ` | 晶振电容=${10 + 2 * rfCap} pF` +
            ` | 睡眠=${sleepEnable === 1 ? '启用' : '禁用'}` +
            ` | 睡眠时间=${sleepTime}分钟`,
            'info'
        );
    } else if (configType === 0x03) {
        // 解析网络名称 (Bytes 1-15, null-terminated ASCII)
        const nameBytes = data.slice(1, 16);
        const nullIdx = nameBytes.indexOf(0);
        const nameSlice = nullIdx >= 0 ? nameBytes.slice(0, nullIdx) : nameBytes;
        const decoder = new TextDecoder();
        networkNameInput.value = decoder.decode(nameSlice);

        updateNetworkNamePreview();

        appendLog(
            `⚙️ 配置已解析: 类型=0x03 | 网络名称="${networkNameInput.value}"`,
            'info'
        );
    }
}

// ============ WebHID 读回协议 ============
// 与固件 APP/include/webhid_read_proto.h 一一对应:
//   读请求 : Output Report 16 字节 = [0x80 | 段号, 参数, 0...]
//   读响应 : Feature Report 16 字节, 第 0 字节 = 段号, 负载与对应的写包布局完全一致
// 读请求最高位为 1, 和写包(type 1..4/0xFF)区分开 —— 早期版本"读取配置"按钮直接发
// [0x01,0,...], 被固件当成写包, 结果把配置清零了。
const READ_FLAG = 0x80;
const SEC_CONFIG = 0x01;    // 配置(与写包 0x01 同布局)
const SEC_KEYMAP = 0x02;    // 按键映射(与写包 0x02 同布局, 一包 2 个键)
const SEC_NAME = 0x03;      // 网络名(与写包 0x03 同布局)
const SEC_INFO = 0x04;      // 设备信息(MAC/注册状态/晶振电容)
const KEYS_PER_READ = 2;    // 固件每个映射读包返回的键数
const FEATURE_LEN = 16;     // Feature Report 长度(固件描述符里 Report Count = 16)

/**
 * 发送读请求(不修改设备上的任何配置)
 */
async function sendReadRequest(section, arg = 0) {
    const req = new Uint8Array(FEATURE_LEN);
    req[0] = READ_FLAG | section;
    req[1] = arg & 0xFF;
    await device.sendReport(0, req);
}

/**
 * 读一个段: 先发读请求, 再读 Feature Report, 并校验段号
 * @returns {Promise<Uint8Array>} 16 字节响应
 */
async function readSection(section, arg = 0) {
    await sendReadRequest(section, arg);
    const report = await device.receiveFeatureReport(0);
    const data = new Uint8Array(report.buffer);
    if (data.length < 2 || data[0] !== section) {
        const got = data.length > 0 ? `0x${data[0].toString(16).padStart(2, '0')}` : '空';
        throw new Error(`设备未返回段 0x${section.toString(16).padStart(2, '0')} 的数据(收到 ${got}, ${data.length}B)`
            + (data.length < FEATURE_LEN ? ' —— 固件可能还是旧版(读回功能需要新版固件)' : ''));
    }
    return data;
}

/**
 * 更新配置字节预览 (0x01)
 */
function updateConfigPreview() {
    const packed = packConfig();
    configPreviewSpan.textContent = bytesToHex(packed);
}

/**
 * 更新网络名称字节预览 (0x03)
 */
function updateNetworkNamePreview() {
    const packed = packNetworkName();
    networkNamePreviewSpan.textContent = bytesToHex(packed);
}

/**
 * 重置配置为默认值
 */
function resetConfig() {
    wirelessModeSelect.value = String(DEFAULT_CONFIG.wirelessMode);
    socdSelect.value = String(DEFAULT_CONFIG.socd);
    sleepEnableSelect.value = String(DEFAULT_CONFIG.sleepEnable);
    sleepTimeInput.value = String(DEFAULT_CONFIG.sleepTime);
    enableModifyKeySelect.value = String(DEFAULT_CONFIG.enableModifyKey);
    swapDirDpadSelect.value = String(DEFAULT_CONFIG.swapDirDpad);
    rfCapSelect.value = String(DEFAULT_CONFIG.rfCap);
    networkNameInput.value = DEFAULT_CONFIG.networkName;
    updateConfigPreview();
    updateNetworkNamePreview();
    appendLog('↺ 配置已重置为默认值', 'info');
}

/**
 * 发送配置到设备 (Report ID = 0, Output Report)
 */
async function sendConfig() {
    if (!device) {
        appendLog('⚠️ 请先连接设备', 'error');
        return;
    }

    const packedData = packConfig();
    const reportId = 0; // 配置使用 Report ID 0

    try {
        await device.sendReport(reportId, packedData);
        appendLog(
            `📤 配置已发送 [ID=${reportId}] | 16B: ${bytesToHex(packedData)}`,
            'sent',
            packedData
        );
    } catch (err) {
        console.error('发送配置失败:', err);
        appendLog(`❌ 发送配置失败: ${err.message}`, 'error');
    }
}

/**
 * 发送网络名称到设备 (Report ID = 0, Output Report, 类型 0x03)
 */
async function sendNetworkName() {
    if (!device) {
        appendLog('⚠️ 请先连接设备', 'error');
        return;
    }

    const packedData = packNetworkName();
    const reportId = 0;

    try {
        await device.sendReport(reportId, packedData);
        appendLog(
            `📤 网络名称已发送 [ID=${reportId}] | 16B: ${bytesToHex(packedData)}`,
            'sent',
            packedData
        );
    } catch (err) {
        console.error('发送网络名称失败:', err);
        appendLog(`❌ 发送网络名称失败: ${err.message}`, 'error');
    }
}

/**
 * 读取当前面板对应的配置(通过读请求 + Feature Report)
 * 注意: 请求包带 READ_FLAG, 固件只准备响应, 不会改动设备上的配置。
 */
async function readConfig() {
    if (!device) {
        appendLog('⚠️ 请先连接设备', 'error');
        return;
    }

    try {
        // 按当前激活的面板决定读哪一段
        let section = SEC_CONFIG;
        if (!configPanel2.classList.contains('hidden')) section = SEC_KEYMAP;
        else if (!configPanel3.classList.contains('hidden')) section = SEC_NAME;

        if (section === SEC_KEYMAP) {
            const n = await readKeymapAll();
            appendLog(`📩 已读取按键映射: ${n}/20 个键位`, n > 0 ? 'info' : 'error');
            return;
        }

        const data = await readSection(section);
        appendLog(
            `📩 读取响应 [段=0x${section.toString(16).padStart(2, '0')}] | ${data.length}B: ${bytesToHex(data)}`,
            'received',
            data
        );
        unpackConfig(data);
    } catch (err) {
        console.error('读取配置失败:', err);
        appendLog(`❌ 读取配置失败: ${err.message}`, 'error');
    }
}

/**
 * 解析一个按键映射读包 (一包 2 个键)
 * 布局: [0x02][起始键号][键 i 的 4 个映射值][键 i+1 的 4 个映射值][填充]
 * 每个键的 4 个映射值顺序与写包一致: 主键 + 3 个副键(19 = INVALID)
 *
 * 关键: 4 个槽位的有效范围以**第一个 INVALID 为界** —— 固件扫描时也是
 * "遇到 INVALID 就 break"(见 input_scanner.cpp), 后面的槽位是无效数据。
 * 老固件保存默认映射时把多余槽位留成了 0(=LB), 于是"键 0 只有 UP"会读成
 * UP, INVALID, LB, LB; 这里按固件的真实语义截断, 只保留 INVALID 之前的部分。
 * @returns {number} 本次解析成功的键数
 */
function unpackKeymap(data) {
    if (data.length < 2) return 0;
    const first = data[1];
    let parsed = 0;

    for (let k = 0; k < KEYS_PER_READ; k++) {
        const keyIndex = first + k;
        if (keyIndex >= currentKeymap.length) break;
        const base = 2 + k * 4;
        if (data.length < base + 4) break;

        const slots = [data[base], data[base + 1], data[base + 2], data[base + 3]];
        const primary = slots[0];
        const secondary = [];
        for (let s = 1; s < slots.length; s++) {
            if (slots[s] === 19) break;      // 与固件一致: INVALID 之后的数据无效
            secondary.push(slots[s]);
        }

        currentKeymap[keyIndex] = { primary, secondary };
        parsed++;
    }
    return parsed;
}

/**
 * 读取全部 20 个键位的映射并刷新界面
 * @returns {Promise<number>} 成功解析的键数
 */
async function readKeymapAll() {
    let got = 0;
    for (let first = 0; first < currentKeymap.length; first += KEYS_PER_READ) {
        const data = await readSection(SEC_KEYMAP, first);
        const n = unpackKeymap(data);
        got += n;
        if (n === 0) break;         // 设备返回的起始键号对不上, 不再继续
    }
    renderKeymap();
    return got;
}

/**
 * 连接后自动把设备里的设置读回来填到页面上
 * 顺序: 设备信息(MAC/注册/晶振电容) -> 配置 -> 网络名 -> 按键映射(20 键)
 * 每一步都单独 try/catch: 任一步失败只记警告, 不影响其它步骤和连接本身;
 * 旧版固件不支持读回时, 这里会留下明确的提示信息。
 */
async function syncAllFromDevice() {
    if (!device) return;

    appendLog('🔄 正在从设备读取当前设置...', 'info');
    const done = [];

    try {
        await readMacAddress();
        done.push('设备信息');
    } catch (err) {
        appendLog(`⚠️ 读取设备信息失败: ${err.message}`, 'error');
    }

    try {
        unpackConfig(await readSection(SEC_CONFIG));
        done.push('配置');
    } catch (err) {
        appendLog(`⚠️ 读取配置失败: ${err.message}`, 'error');
    }

    try {
        unpackConfig(await readSection(SEC_NAME));
        done.push('网络名');
    } catch (err) {
        appendLog(`⚠️ 读取网络名失败: ${err.message}`, 'error');
    }

    try {
        const n = await readKeymapAll();
        done.push(`按键映射 ${n}/20`);
    } catch (err) {
        appendLog(`⚠️ 读取按键映射失败: ${err.message}`, 'error');
    }

    try {
        await readLogoStatus(false);
        done.push('开机图');
    } catch (err) {
        appendLog(`⚠️ 读取开机图状态失败: ${err.message}`, 'error');
    }

    if (done.length) {
        appendLog(`✅ 已同步到页面: ${done.join(' / ')}`, 'info');
    } else {
        appendLog('⚠️ 没能从设备读到任何设置(固件可能还是旧版, 读回需要新版固件)', 'error');
    }
}

/**
 * 保存配置并重启 (发送 Report ID=0, 16字节: [0xFF][0][0]...[0])
 */
async function saveAndReboot() {
    if (!device) {
        appendLog('⚠️ 请先连接设备', 'error');
        return;
    }

    const data = new Uint8Array(16);
    data[0] = 0xFF;
    const reportId = 0;

    try {
        await device.sendReport(reportId, data);
        appendLog(
            `💾 保存配置并重启命令已发送 [ID=${reportId}] | 16B: ${bytesToHex(data)}`,
            'sent',
            data
        );
    } catch (err) {
        console.error('保存配置并重启失败:', err);
        appendLog(`❌ 保存配置并重启失败: ${err.message}`, 'error');
    }
}

// ============ 按键映射管理 ============

/**
 * 当前按键映射数组（20个键位）
 * 每个元素: { primary: number (xinput按钮值), secondary: number[] (最多4个) }
 */
let currentKeymap = JSON.parse(JSON.stringify(DEFAULT_KEYMAP));

/**
 * 生成 xinput 按钮下拉选项 HTML（排除 INVALID）
 */
function generateXinputOptions(selectedValue, includeInvalid = false) {
    let buttons = XINPUT_BUTTONS;
    if (!includeInvalid) {
        buttons = buttons.filter(b => b.value !== 19); // 排除 INVALID
    }
    return buttons.map(btn => {
        const selected = btn.value === selectedValue ? ' selected' : '';
        return `<option value="${btn.value}"${selected}>${btn.name} (${btn.value})</option>`;
    }).join('');
}

/**
 * 渲染单个键位的 secondary 选择器（右侧最多4个）
 */
function renderSecondarySelectors(keyIndex, container, entry) {
    // 清除旧的 secondary 区域
    const oldSecondary = container.querySelector('.keymap-secondary');
    if (oldSecondary) oldSecondary.remove();

    // 如果 primary 是 INVALID，不显示 secondary
    if (entry.primary === 19) return;

    const secondaryDiv = document.createElement('div');
    secondaryDiv.className = 'keymap-secondary';

    // 确保至少有一个 secondary 选择项（默认 INVALID）
    if (entry.secondary.length === 0) {
        entry.secondary.push(19);
    }

    // 确保不超过 4 个
    while (entry.secondary.length > 4) {
        entry.secondary.pop();
    }

    for (let s = 0; s < entry.secondary.length; s++) {
        const sel = document.createElement('select');
        sel.className = 'input-field keymap-secondary-select';
        sel.innerHTML = generateXinputOptions(entry.secondary[s], true);

        sel.addEventListener('change', () => {
            entry.secondary[s] = parseInt(sel.value, 10);
            // 如果这个选项变成非 INVALID 且后面没有空位了，添加一个新的 INVALID 选项
            if (entry.secondary[s] !== 19 && entry.secondary.length < 4) {
                const lastVal = entry.secondary[entry.secondary.length - 1];
                if (lastVal !== 19) {
                    entry.secondary.push(19);
                    renderSecondarySelectors(keyIndex, container, entry);
                }
            }
            // 如果这个变成 INVALID 且后面还有有效的，截掉后面的
            if (entry.secondary[s] === 19 && s < entry.secondary.length - 1) {
                entry.secondary = entry.secondary.slice(0, s + 1);
                renderSecondarySelectors(keyIndex, container, entry);
            }
        });

        secondaryDiv.appendChild(sel);
    }

    container.appendChild(secondaryDiv);
}

/**
 * 渲染按键映射 UI（所有下拉框在同一行）
 */
function renderKeymap() {
    keymapContainer.innerHTML = '';

    for (let i = 0; i < 20; i++) {
        const entry = currentKeymap[i];
        const item = document.createElement('div');
        item.className = 'keymap-item';
        item.dataset.keyIndex = i;

        // 发送按钮（放在最左边）
        const sendBtn = document.createElement('button');
        sendBtn.className = 'keymap-send-btn';
        sendBtn.title = `发送键位 ${i} 的映射 Report`;
        sendBtn.textContent = '▶';
        sendBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!device) {
                appendLog('⚠️ 请先连接设备', 'error');
                return;
            }
            try {
                await sendSingleKeymap(device, i, entry);
                appendLog(`📤 键位 ${i} Report 已发送`, 'sent');
            } catch (err) {
                appendLog(`❌ 键位 ${i} 发送失败: ${err.message}`, 'error');
            }
        });

        const indexSpan = document.createElement('span');
        indexSpan.className = 'keymap-index';
        indexSpan.textContent = String(i).padStart(2, '0');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'keymap-label';
        labelSpan.textContent = `键位 ${i}`;

        const primarySelect = document.createElement('select');
        primarySelect.className = 'input-field keymap-primary-select';
        primarySelect.innerHTML = generateXinputOptions(entry.primary, true);

        primarySelect.addEventListener('change', () => {
            const newVal = parseInt(primarySelect.value, 10);
            entry.primary = newVal;
            if (newVal === 19) {
                // primary 变 INVALID，清空 secondary
                entry.secondary = [];
            } else {
                // primary 从 INVALID 变有效，添加一个默认 INVALID 的 secondary
                if (entry.secondary.length === 0) {
                    entry.secondary.push(19);
                }
            }
            // 重绘 secondary 部分
            renderSecondarySelectors(i, item, entry);
        });

        item.appendChild(sendBtn);
        item.appendChild(indexSpan);
        item.appendChild(labelSpan);
        item.appendChild(primarySelect);

        // secondary 选择器
        renderSecondarySelectors(i, item, entry);

        keymapContainer.appendChild(item);
    }
}

/**
 * 根据 3 字节状态数据更新按键映射高亮
 * 3 字节共 24 位，前 20 位对应键位 0~19
 */
function updateKeymapHighlights(stateData) {
    if (!stateData || stateData.length < 3) return;

    // 拼装 24 位整数（小端序：byte0 = bits 0-7, byte1 = bits 8-15, byte2 = bits 16-23）
    const bits = (stateData[2] << 16) | (stateData[1] << 8) | stateData[0];

    for (let i = 0; i < 20; i++) {
        const item = keymapContainer.querySelector(`.keymap-item[data-key-index="${i}"]`);
        if (!item) continue;

        const isActive = (bits >> i) & 0x01;
        item.classList.toggle('keymap-active', isActive);
    }
}

/**
 * 重置按键映射为默认值
 */
function resetKeymap() {
    currentKeymap = JSON.parse(JSON.stringify(DEFAULT_KEYMAP));
    renderKeymap();
    appendLog('↺ 按键映射已重置为默认值', 'info');
}

/**
 * 发送单个键位的映射 Report
 * 16 字节: [0x02] [键位索引] [映射值1] [映射值2] [映射值3] [映射值4] [0x00×10]
 */
async function sendSingleKeymap(device, keyIndex, entry) {
    const data = new Uint8Array(16);
    data[0] = 0x02;
    data[1] = keyIndex & 0xFF;
    data[2] = entry.primary & 0xFF;
    for (let s = 0; s < 3; s++) {
        if (s < entry.secondary.length) {
            data[3 + s] = entry.secondary[s] & 0xFF;
        } else {
            data[3 + s] = 0x13; // INVALID = 19
        }
    }
    // bytes 6-15 已初始化为 0x00

    await device.sendReport(0, data);
}

/**
 * 发送全部按键映射（每 10ms 发送一个，共 20 个 Report）
 */
async function sendAllKeymaps() {
    if (!device) {
        appendLog('⚠️ 请先连接设备', 'error');
        return;
    }

    appendLog('⏳ 开始发送按键映射 (20个 Report, 每10ms一个)...', 'info');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < 20; i++) {
        const entry = currentKeymap[i];
        try {
            await sendSingleKeymap(device, i, entry);
            successCount++;

            // 构建日志信息
            let keyStr = `键位 ${i} → ${getXinputName(entry.primary)}`;
            if (entry.secondary.length > 0 && entry.secondary[0] !== 19) {
                const secStr = entry.secondary
                    .filter(v => v !== 19)
                    .map(v => getXinputName(v))
                    .join(', ');
                if (secStr) keyStr += ` + ${secStr}`;
            }

            // 每 5 个输出一次进度
            if ((i + 1) % 5 === 0 || i === 19) {
                appendLog(`📤 按键映射进度: ${i + 1}/20 (${keyStr})`, 'sent');
            }
            // 等 10ms 再发下一个
            if (i < 19) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        } catch (err) {
            failCount++;
            appendLog(`❌ 键位 ${i} 发送失败: ${err.message}`, 'error');
        }
    }

    appendLog(
        `✅ 按键映射发送完成: 成功 ${successCount} 个, 失败 ${failCount} 个`,
        successCount > 0 ? 'info' : 'error'
    );
}

// ============ 开机图(WebHID 上传) ============
// 与固件 APP/include/boot_logo_store.h 对应:
//   0x21 开始 -> 0x20 数据块 x74 -> 0x22 提交, 然后用读回段 0x05 核对 CRC
// 转换规则与 tools/bootlogo_gen.cpp 保持一致:
//   默认"灰度 > 阈值 的像素点亮"(黑底白字的图直接就对), invert 时反过来(深色点亮)。

const LOGO_W = 128;
const LOGO_H = 64;
const LOGO_BYTES = LOGO_W * LOGO_H / 8;                      // 1024
const LOGO_PAYLOAD = 14;                                     // 每个 16 字节报表里的数据字节
const LOGO_PACKETS = Math.ceil(LOGO_BYTES / LOGO_PAYLOAD);   // 74
const SEC_LOGO = 0x05;
const LOGO_CMD = { CHUNK: 0x20, BEGIN: 0x21, COMMIT: 0x22, DEFAULT: 0x23 };

// 8x8 有序抖动矩阵(与 bootlogo_gen.cpp 里的 kBayer8 相同)
const BAYER8 = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
];

let logoSourceImage = null;      // 解码后的原图(ImageBitmap/HTMLImageElement)
let logoBytes = null;            // 转换结果(1024 字节)

function logoIsLit(lum, threshold, invert) {
    return invert ? (lum < threshold) : (lum > threshold);
}

/**
 * CRC16-CCITT (poly 0x1021, init 0xFFFF) —— 与固件 boot_logo_store.h 里的实现一致,
 * 用来核对设备存下来的图和我们发出去的是否一致
 */
function logoCrc16(bytes) {
    let crc = 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc ^= bytes[i] << 8;
        for (let b = 0; b < 8; b++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
    }
    return crc & 0xFFFF;
}

/**
 * ImageData(128x64) -> 1024 字节 1bpp(行优先, 每行 16 字节, MSB 在左)
 * @param {ImageData} data
 * @param {{threshold:number, invert:boolean, dither:string}} opts
 */
function imageDataToLogoBytes(data, opts) {
    const threshold = (opts && opts.threshold !== undefined) ? opts.threshold : 128;
    const invert = !!(opts && opts.invert);
    const dither = (opts && opts.dither) || 'none';
    const out = new Uint8Array(LOGO_BYTES);

    // 灰度: 透明像素按黑底合成(与命令行工具一致)
    // 用 Float64Array(而不是 Float32)存灰度: 阈值边界上必须和 C++ 工具的 double 完全一致,
    // 否则像"纯 128 灰"这种像素两边会判得不一样(0.299*128+0.587*128+0.114*128 在 double 里
    // 是 127.99999..., 存成 float32 会变成 128.0, 判定就反了)。
    const lum = new Float64Array(LOGO_W * LOGO_H);
    for (let i = 0; i < lum.length; i++) {
        const r = data.data[i * 4 + 0];
        const g = data.data[i * 4 + 1];
        const b = data.data[i * 4 + 2];
        const a = data.data[i * 4 + 3] / 255;
        lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) * a;
    }

    const setBit = (x, y, on) => {
        if (!on) return;
        out[y * 16 + (x >> 3)] |= (0x80 >> (x & 7));
    };

    if (dither === 'bayer8') {
        for (let y = 0; y < LOGO_H; y++) {
            for (let x = 0; x < LOGO_W; x++) {
                const t = (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 * 255;
                setBit(x, y, logoIsLit(lum[y * LOGO_W + x], t, invert));
            }
        }
    } else if (dither === 'fs') {
        const g = Float64Array.from(lum);      // 误差扩散也用 double, 与命令行工具一致
        for (let y = 0; y < LOGO_H; y++) {
            for (let x = 0; x < LOGO_W; x++) {
                const i = y * LOGO_W + x;
                const v = g[i];
                const on = logoIsLit(v, threshold, invert);
                setBit(x, y, on);
                const quantized = (on !== invert) ? 255 : 0;   // 与固件的量化目标一致
                const err = v - quantized;
                if (x + 1 < LOGO_W) g[i + 1] += err * 7 / 16;
                if (y + 1 < LOGO_H) {
                    if (x > 0) g[i + LOGO_W - 1] += err * 3 / 16;
                    g[i + LOGO_W] += err * 5 / 16;
                    if (x + 1 < LOGO_W) g[i + LOGO_W + 1] += err * 1 / 16;
                }
            }
        }
    } else {
        for (let y = 0; y < LOGO_H; y++) {
            for (let x = 0; x < LOGO_W; x++) {
                setBit(x, y, logoIsLit(lum[y * LOGO_W + x], threshold, invert));
            }
        }
    }
    return out;
}

/**
 * 把原图按 fit/fill/stretch 画到 128x64 的画布上(黑底, 浏览器负责缩放)
 */
function renderLogoSource(img, mode) {
    const cv = document.createElement('canvas');
    cv.width = LOGO_W;
    cv.height = LOGO_H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, LOGO_W, LOGO_H);

    let dw = LOGO_W, dh = LOGO_H, dx = 0, dy = 0;
    if (mode !== 'stretch') {
        const s = (mode === 'fill')
            ? Math.max(LOGO_W / img.width, LOGO_H / img.height)
            : Math.min(LOGO_W / img.width, LOGO_H / img.height);
        dw = Math.max(1, Math.round(img.width * s));
        dh = Math.max(1, Math.round(img.height * s));
        dx = Math.floor((LOGO_W - dw) / 2);
        dy = Math.floor((LOGO_H - dh) / 2);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
    return cv;
}

/**
 * 按当前选项重新生成 1bpp 数据并刷新预览
 */
function regenerateLogoBytes() {
    if (!logoSourceImage) return null;
    const cv = renderLogoSource(logoSourceImage, logoFitSelect.value);
    const data = cv.getContext('2d').getImageData(0, 0, LOGO_W, LOGO_H);
    logoBytes = imageDataToLogoBytes(data, {
        threshold: parseInt(logoThresholdInput.value, 10),
        invert: logoInvertCheckbox.checked,
        dither: logoDitherSelect.value,
    });
    drawLogoPreview(logoBytes);
    return logoBytes;
}

/**
 * 预览: 把 1bpp 数据画到预览画布上(黑色背景 + 白色发光点, 与面板观感一致)
 */
function drawLogoPreview(bytes) {
    if (!logoPreviewCanvas) return;
    const ctx = logoPreviewCanvas.getContext('2d');
    const scale = logoPreviewCanvas.width / LOGO_W;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, logoPreviewCanvas.width, logoPreviewCanvas.height);
    ctx.fillStyle = '#ffffff';
    let lit = 0;
    for (let y = 0; y < LOGO_H; y++) {
        for (let x = 0; x < LOGO_W; x++) {
            const on = (bytes[y * 16 + (x >> 3)] >> (7 - (x & 7))) & 1;
            if (on) {
                lit++;
                ctx.fillRect(x * scale, y * scale, scale, scale);
            }
        }
    }
    if (logoStatSpan) {
        logoStatSpan.textContent = `点亮 ${lit}/${LOGO_W * LOGO_H} 像素`;
    }
}

/**
 * 上传 1024 字节到设备: 0x21 开始 -> 0x20 x74 -> 0x22 提交 -> 读回段 0x05 核对
 * @returns {Promise<{ok:boolean, message:string, status?:object}>}
 */
async function uploadLogoToDevice(bytes, onProgress) {
    const makeReport = (type, b1, payload) => {
        const p = new Uint8Array(16);
        p[0] = type;
        p[1] = b1 || 0;
        if (payload && payload.length) p.set(payload.subarray(0, LOGO_PAYLOAD), 2);
        return p;
    };

    await device.sendReport(0, makeReport(LOGO_CMD.BEGIN));
    await new Promise(r => setTimeout(r, 150));      // 等设备擦除 4 个 256 字节页

    for (let seq = 0; seq < LOGO_PACKETS; seq++) {
        const start = seq * LOGO_PAYLOAD;
        await device.sendReport(0, makeReport(LOGO_CMD.CHUNK, seq, bytes.subarray(start, start + LOGO_PAYLOAD)));
        if ((seq & 7) === 7) await new Promise(r => setTimeout(r, 1));   // 让一让, 别把设备写 Flash 的时间挤掉
        if (onProgress) onProgress(seq + 1, LOGO_PACKETS);
    }

    await device.sendReport(0, makeReport(LOGO_CMD.COMMIT));
    await new Promise(r => setTimeout(r, 150));     // 等设备回读校验 + 写头

    const st = await readSection(SEC_LOGO);
    const status = {
        valid: st[1],
        crc: st[2] | (st[3] << 8),
        len: st[4] | (st[5] << 8),
        got: st[6] | (st[7] << 8),
        err: st[8],
    };
    const names = { 0: '无', 1: '数据块序号不连续(有丢包)', 2: 'Flash 写失败', 3: '数据不足 1024 字节', 4: '回读校验不通过', 5: '没有先发"开始"' };
    const errName = names[status.err] !== undefined ? names[status.err] : `未知道错误(${status.err})`;

    if (status.valid !== 1) {
        return { ok: false, status, message: `❌ 上传失败: 设备只收到 ${status.got}/${LOGO_BYTES} 字节, 错误: ${errName}` };
    }
    /* 设备算出来的 CRC 必须和我们发出去的内容一致, 否则说明传输过程中有字节出错 */
    const wantCrc = logoCrc16(bytes);
    if (status.crc !== wantCrc) {
        return {
            ok: false, status,
            message: `❌ 上传内容校验不一致(设备 0x${status.crc.toString(16).toUpperCase().padStart(4, '0')}`
                + ` vs 本地 0x${wantCrc.toString(16).toUpperCase().padStart(4, '0')}), 请重试`,
        };
    }
    return { ok: true, status, message: `✅ 已保存到设备(CRC 0x${status.crc.toString(16).toUpperCase().padStart(4, '0')}), 重启后显示` };
}

/**
 * 读取设备当前的开机图状态
 */
async function readLogoStatus(log = true) {
    const st = await readSection(SEC_LOGO);
    const status = {
        valid: st[1],
        crc: st[2] | (st[3] << 8),
        len: st[4] | (st[5] << 8),
        got: st[6] | (st[7] << 8),
        err: st[8],
    };
    if (logoDeviceStatSpan) {
        logoDeviceStatSpan.textContent = status.valid === 1
            ? `自定义图(CRC 0x${status.crc.toString(16).toUpperCase().padStart(4, '0')}, ${status.len} 字节)`
            : '默认图(固件里那张)';
    }
    if (log) {
        appendLog(status.valid === 1
            ? `🖼️ 设备开机图: 自定义图(CRC 0x${status.crc.toString(16).toUpperCase().padStart(4, '0')})`
            : '🖼️ 设备开机图: 默认图(未上传过)', 'info');
    }
    return status;
}

/**
 * 恢复默认开机图
 */
async function restoreDefaultLogo() {
    if (!device) { appendLog('⚠️ 请先连接设备', 'error'); return; }
    try {
        const p = new Uint8Array(16);
        p[0] = LOGO_CMD.DEFAULT;
        await device.sendReport(0, p);
        await new Promise(r => setTimeout(r, 150));
        await readLogoStatus(false);
        appendLog('↺ 已恢复默认开机图(重启后生效)', 'info');
    } catch (err) {
        appendLog(`❌ 恢复默认开机图失败: ${err.message}`, 'error');
    }
}

/**
 * 读取用户选择的图片文件
 */
function loadLogoFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            logoSourceImage = img;
            regenerateLogoBytes();
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('图片解码失败(浏览器支持的格式: PNG/JPEG/BMP/GIF/WebP)'));
        };
        img.src = url;
    });
}

/**
 * 上传按钮: 转换 + 上传 + 核对
 */
async function uploadLogo() {
    if (!device) { appendLog('⚠️ 请先连接设备', 'error'); return; }
    if (!logoSourceImage) { appendLog('⚠️ 请先选择一张图片', 'error'); return; }

    const bytes = regenerateLogoBytes();
    if (!bytes) return;

    try {
        appendLog(`⏳ 开始上传开机图(${LOGO_BYTES} 字节, ${LOGO_PACKETS} 个数据块)...`, 'info');
        const res = await uploadLogoToDevice(bytes, (done, total) => {
            if (logoProgressSpan) logoProgressSpan.textContent = `进度 ${done}/${total}`;
            if (done === total) appendLog(`📤 数据块发送完成(${total} 个)`, 'sent');
        });
        appendLog(res.message, res.ok ? 'info' : 'error');
        if (logoProgressSpan) logoProgressSpan.textContent = res.ok ? '已完成' : '失败';
        await readLogoStatus(false);
    } catch (err) {
        appendLog(`❌ 上传开机图失败: ${err.message}`, 'error');
        if (logoProgressSpan) logoProgressSpan.textContent = '失败';
    }
}

// ============ 配置标签切换 ============

/**
 * 切换到指定配置面板
 */
function switchConfigTab(tabIndex) {
    [configTab1, configTab2, configTab3, configTab4].forEach(t => t.classList.remove('config-tab-active'));
    [configPanel1, configPanel2, configPanel3, configPanel4].forEach(p => p.classList.add('hidden'));

    if (tabIndex === 1) {
        configTab1.classList.add('config-tab-active');
        configPanel1.classList.remove('hidden');
    } else if (tabIndex === 2) {
        configTab2.classList.add('config-tab-active');
        configPanel2.classList.remove('hidden');
    } else if (tabIndex === 3) {
        configTab3.classList.add('config-tab-active');
        configPanel3.classList.remove('hidden');
    } else if (tabIndex === 4) {
        configTab4.classList.add('config-tab-active');
        configPanel4.classList.remove('hidden');
    }
    updateConfigPreview();
}

// ============ 工具函数 ============

/**
 * 将字节数组 (Uint8Array / Array) 转为 16 进制字符串
 */
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
}

/**
 * 将 16 进制字符串转为字节数组
 */
function hexToBytes(hexStr) {
    // 移除空格、0x 前缀等无关字符
    const clean = hexStr.replace(/\s+/g, '').replace(/0x/gi, '');
    if (clean.length === 0) return new Uint8Array(0);
    if (clean.length % 2 !== 0) {
        throw new Error('16进制字符串长度必须为偶数（每个字节两位十六进制）');
    }
    const bytes = [];
    for (let i = 0; i < clean.length; i += 2) {
        bytes.push(parseInt(clean.substring(i, i + 2), 16));
    }
    return new Uint8Array(bytes);
}

/**
 * 获取当前时间戳字符串
 */
function getTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { hour12: false }) +
        '.' + String(now.getMilliseconds()).padStart(3, '0');
}

/**
 * 向隐藏日志输出添加一条记录
 */
function appendLog(message, type = 'default', rawBytes = null) {
    const hiddenLog = document.getElementById('hiddenLog');
    if (!hiddenLog) return;
    const timestamp = getTimestamp();
    const timeStr = `<span class="log-timestamp">[${timestamp}]</span>`;
    const msgStr = `<span class="log-${type}">${message}</span>`;

    // 如果有原始字节数据，附加显示
    let hexStr = '';
    if (rawBytes) {
        hexStr = ` <span class="log-timestamp">(${bytesToHex(rawBytes)})</span>`;
    }

    hiddenLog.innerHTML += `${timeStr} ${msgStr}${hexStr}\n`;
    // 保留最近 500 条
    const lines = hiddenLog.innerHTML.split('\n');
    if (lines.length > 500) {
        hiddenLog.innerHTML = lines.slice(-500).join('\n');
    }
}

/**
 * 清空日志（保留函数签名，但不再需要）
 */
function clearLog() {
    const hiddenLog = document.getElementById('hiddenLog');
    if (hiddenLog) hiddenLog.innerHTML = '';
}

/**
 * 更新连接状态 UI
 */
function updateConnectionUI() {
    const connected = device !== null;

    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    sendConfigBtn.disabled = !connected;
    sendNetworkNameBtn.disabled = !connected;
    readConfigBtn.disabled = !connected;
    readKeymapBtn.disabled = !connected;
    readNameBtn.disabled = !connected;
    uploadLogoBtn.disabled = !connected;
    restoreLogoBtn.disabled = !connected;
    saveAndRebootBtn.disabled = !connected;
    sendKeymapBtn.disabled = !connected;
    readMacBtn.disabled = !connected;
    sendRegCodeBtn.disabled = !connected;

    if (connected) {
        connectionStatus.textContent = '已连接';
        connectionStatus.className = 'status-badge status-connected';
    } else {
        connectionStatus.textContent = '未连接';
        connectionStatus.className = 'status-badge status-disconnected';
    }
}

// ============ 设备注册 ============

/**
 * 复制文本到剪贴板（优先 Clipboard API，失败时回退 execCommand）
 * @returns {Promise<boolean>} 是否复制成功
 */
async function copyText(text) {
    // 优先 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.warn('Clipboard API 复制失败, 尝试回退方案:', e);
        }
    }
    // 回退：临时 textarea + execCommand（不依赖用户手势与安全上下文）
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e) {
        console.error('复制到剪贴板失败:', e);
        return false;
    }
}

/**
 * 读取按钮的短暂反馈（1.2s 后恢复原文案与禁用状态）
 */
let macBtnTimer = null;
function flashMacButton(ok) {
    if (macBtnTimer === null) {
        readMacBtn.dataset.label = readMacBtn.textContent;   // 首次点击时记住原文案
    }
    clearTimeout(macBtnTimer);
    readMacBtn.textContent = ok ? '✅ 已复制 MAC' : '⚠️ 复制失败';
    readMacBtn.disabled = true;
    macBtnTimer = setTimeout(() => {
        readMacBtn.textContent = readMacBtn.dataset.label || '📩 读取并复制 MAC';
        readMacBtn.disabled = !device;
        macBtnTimer = null;
    }, 1200);
}

/**
 * 读取设备 MAC 地址和注册状态（通过 Feature Report）
 * @param {boolean} copyMac 是否顺便把 MAC 复制到剪贴板。
 *        仅按钮点击时传 true；连接后自动读取不传 —— 避免在没有用户手势时
 *        写剪贴板(部分浏览器会拒绝)，也避免覆盖用户剪贴板里已有的内容。
 */
async function readMacAddress(copyMac = false) {
    if (!device) {
        appendLog('⚠️ 请先连接设备', 'error');
        return;
    }

    const reportId = 0;
    try {
        // 先发"设备信息"读请求: 保证读到的是设备信息, 而不是上一次读请求留下的响应
        // (旧版固件不认识这个请求, 会忽略它并照旧返回设备信息, 所以两种固件都能用)
        try {
            await sendReadRequest(SEC_INFO);
        } catch (err) {
            console.warn('发送设备信息读请求失败(继续尝试读取):', err);
        }

        const reportData = await device.receiveFeatureReport(reportId);
        const data = new Uint8Array(reportData.buffer);

        if (data.length < 8) {
            appendLog(`⚠️ Feature Report 数据不足 8 字节 (收到 ${data.length}B)`, 'error');
            return;
        }

        // Bytes 0-5: MAC 地址
        const macHex = Array.from(data.slice(0, 6))
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':');
        deviceMacEl.textContent = macHex;

        // Byte 6: 注册状态
        const registered = data[6] !== 0;
        updateRegStatus(registered);

        // Byte 7: 32M 晶振负载电容档位 (0..7 = 10..24pF)
        const rfCap = data.length >= 8 ? (data[7] & 0x07) : 0;
        rfCapSelect.value = String(rfCap);

        appendLog(
            `📩 MAC 地址: ${macHex} | 注册状态: ${registered ? '✅ 已注册' : '❌ 未注册'}` +
            ` | 晶振电容: ${10 + 2 * rfCap} pF`,
            'info'
        );

        // 按钮点击时顺便复制 MAC（连接后的自动读取不复制）
        if (copyMac) {
            const copied = await copyText(macHex);
            appendLog(
                copied ? `📋 已复制 MAC 到剪贴板: ${macHex}` : '⚠️ 复制失败，请手动选中 MAC 复制',
                copied ? 'info' : 'error'
            );
            flashMacButton(copied);
        }
    } catch (err) {
        console.error('读取 MAC 失败:', err);
        appendLog(`❌ 读取 MAC 失败: ${err.message}`, 'error');
    }
}

/**
 * 更新注册状态标签
 */
function updateRegStatus(registered) {
    if (registered) {
        regStatusEl.textContent = '✅ 已注册';
        regStatusEl.className = 'status-badge status-connected';
    } else {
        regStatusEl.textContent = '❌ 未注册';
        regStatusEl.className = 'status-badge status-disconnected';
    }
}

/**
 * 发送注册码到设备
 */
async function sendRegCode() {
    if (!device) {
        appendLog('⚠️ 请先连接设备', 'error');
        return;
    }

    const hexStr = regCodeInput.value.trim().toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(hexStr)) {
        appendLog('⚠️ 注册码格式错误: 需要 16 位十六进制字符 (0-9, A-F)', 'error');
        return;
    }

    // 将 16 字符 hex 解析为 8 字节 (big-endian)
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        bytes[i] = parseInt(hexStr.substring(i * 2, i * 2 + 2), 16);
    }

    // 打包为 16 字节 Output Report: [0x04] [regHash 8B] [0x00 × 7]
    const report = new Uint8Array(16);
    report[0] = 0x04;
    report.set(bytes, 1);
    // bytes 9-15 are already 0

    try {
        await device.sendReport(0, report);
        appendLog(
            `📤 注册码已发送: ${hexStr} (${bytesToHex(report)})`,
            'sent',
            report
        );

        // 短暂延迟后读取注册状态确认
        setTimeout(async () => {
            if (device) {
                await readMacAddress();
            }
        }, 500);
    } catch (err) {
        console.error('发送注册码失败:', err);
        appendLog(`❌ 发送注册码失败: ${err.message}`, 'error');
    }
}

/**
 * 显示设备信息
 */
function showDeviceInfo(dev) {
    deviceInfo.classList.remove('hidden');

    const collections = dev.collections.map((col, i) => {
        return `  [集合 ${i}]
    Usage Page:  0x${col.usagePage.toString(16)}
    Usage:       0x${col.usage.toString(16)}
    Type:        ${col.type}
`.trim();
    }).join('\n');

    const infoText = `制造商:  ${dev.manufacturerName || '未知'}
产品名:  ${dev.productName || '未知'}
产品 ID: 0x${dev.productId.toString(16).padStart(4, '0')}
厂商 ID: 0x${dev.vendorId.toString(16).padStart(4, '0')}

集合:
${collections || '  (无集合信息)'}`;

    deviceInfoContent.textContent = infoText;

    // 在日志中显示连接信息
    appendLog(`✅ 已连接设备: ${dev.productName || '未知'} (VID: 0x${dev.vendorId.toString(16).padStart(4, '0')}, PID: 0x${dev.productId.toString(16).padStart(4, '0')})`, 'info');
}

/**
 * 隐藏设备信息
 */
function hideDeviceInfo() {
    deviceInfo.classList.add('hidden');
    deviceInfoContent.textContent = '';
}

// ============ 核心功能 ============

/**
 * 设备过滤: requestDevice() 只列出匹配这些 VID/PID 的设备(列表是并集)。
 *
 * 注意: BLE HID 的 VID/PID 由**主机**决定, 不一定等于固件 PnP ID 特征(0x2A50)里的值:
 *   固件 WebHID/Keyboard 模式: ble_interface.cpp 的 generalPnpId -> VID 0x07D7, PID 0x0000
 *   固件 XInput 模式:          ble_interface.cpp 的 xboxPnpId    -> VID 0x045E, PID 0x0B13
 *   实测(Windows + Chrome):    主机上报 VID 0x1209, PID 0xCF58  (0x1209 是 pid.codes 公共 VID)
 * 所以这里既列出固件里的值, 也列出实测值; 另外每次成功连接都会把主机上报的
 * VID/PID 记到 localStorage, 下次自动加入过滤(见 loadLearnedVidPid/rememberVidPid),
 * 这样换主机/换系统导致上报值变化时也不用改代码。
 * 若过滤后列表为空, 取消勾选"按 VID/PID 过滤"选一次设备即可让它自己学会。
 */
const HID_DEVICE_FILTERS = [
    { vendorId: 0x1209, productId: 0xCF58 },   // 实测: 主机上报值(pid.codes VID)
    { vendorId: 0x07D7, productId: 0x0000 },   // 固件 WebHID / Keyboard 模式 PnP ID
    { vendorId: 0x045E, productId: 0x0B13 },   // 固件 XInput 模式 PnP ID
];

const filterVidPidCheckbox = document.getElementById('filterVidPid');
const FILTER_PREF_KEY = 'ch5xx_filterVidPid';
const LEARNED_VIDPID_KEY = 'ch5xx_learnedVidPid';

const hex4 = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(4, '0');

/** 读取上次成功连接时主机上报的 VID/PID */
function loadLearnedVidPid() {
    try {
        const o = JSON.parse(localStorage.getItem(LEARNED_VIDPID_KEY) || 'null');
        if (o && typeof o.vendorId === 'number' && typeof o.productId === 'number') return o;
    } catch (e) { /* 忽略 */ }
    return null;
}

/** 记住本次连接的主机上报 VID/PID, 供下次过滤使用 */
function rememberVidPid(dev) {
    try {
        localStorage.setItem(LEARNED_VIDPID_KEY, JSON.stringify({
            vendorId: dev.vendorId, productId: dev.productId
        }));
    } catch (e) { /* 忽略 */ }
}

/** 组装过滤列表: 学到的值优先, 再跟上固件已知值(去重) */
function buildFilterList() {
    const list = [];
    const push = f => {
        if (!list.some(x => x.vendorId === f.vendorId && x.productId === f.productId)) list.push(f);
    };
    const learned = loadLearnedVidPid();
    if (learned) push(learned);
    HID_DEVICE_FILTERS.forEach(push);
    return list;
}

// 记住上次的过滤选择(默认开启过滤)
if (filterVidPidCheckbox) {
    try {
        const saved = localStorage.getItem(FILTER_PREF_KEY);
        if (saved !== null) filterVidPidCheckbox.checked = (saved === '1');
    } catch (e) { /* file:// 或隐私模式下 localStorage 不可用, 忽略 */ }

    filterVidPidCheckbox.addEventListener('change', () => {
        try {
            localStorage.setItem(FILTER_PREF_KEY, filterVidPidCheckbox.checked ? '1' : '0');
        } catch (e) { /* 忽略 */ }
    });
}

/**
 * 连接 HID 设备
 */
async function connectDevice() {
    // 默认只列出本方案的设备, 避免在一堆系统 HID 设备里找
    const useFilter = filterVidPidCheckbox ? filterVidPidCheckbox.checked : true;
    const filterList = buildFilterList();
    const filters = useFilter ? filterList : [];
    appendLog(
        useFilter
            ? '🔎 设备过滤已开启: ' + filterList
                  .map(f => `VID ${hex4(f.vendorId)}/PID ${hex4(f.productId)}`)
                  .join(' 或 ')
            : '🔎 设备过滤已关闭: 将列出所有 HID 设备',
        'info'
    );
    try {
        // 请求选择设备
        const devices = await navigator.hid.requestDevice({ filters });

        if (devices.length === 0) {
            appendLog('⚠️ 未选择任何设备', 'error');
            return;
        }

        const selectedDevice = devices[0];

        // 打开设备
        await selectedDevice.open();
        device = selectedDevice;

        // 记住主机上报的 VID/PID, 供下次过滤使用
        const isKnownVidPid = HID_DEVICE_FILTERS.some(
            f => f.vendorId === device.vendorId && f.productId === device.productId
        );
        rememberVidPid(device);
        if (!isKnownVidPid) {
            appendLog(
                `ℹ️ 主机上报 VID/PID 为 ${hex4(device.vendorId)}/${hex4(device.productId)}, `
                + '与固件 PnP ID 不同(该值由主机侧决定); 已记住它, 下次过滤即可命中',
                'info'
            );
        }

        updateConnectionUI();
        showDeviceInfo(device);

        appendLog('🔓 设备已打开，等待用户操作...', 'info');

        // 自动开始监听
        startListening();

        // 连上后自动把设备里的设置读回来填到页面上(设备信息/配置/网络名/按键映射)
        setTimeout(() => syncAllFromDevice(), 300);

    } catch (err) {
        console.error('连接失败:', err);
        appendLog(`❌ 连接失败: ${err.message}`, 'error');
        // 浏览器无法区分"用户主动取消"和"没有匹配设备", 两种情况都给出提示
        if (useFilter) {
            appendLog('💡 若设备列表里没有你的设备: 可能是主机上报的 VID/PID 与固件 PnP ID 不一致, 取消勾选「按 VID/PID 过滤」后重试', 'error');
        }
    }
}

/**
 * 断开 HID 设备
 */
async function disconnectDevice() {
    if (!device) return;

    try {
        // 先停止监听
        if (isListening) {
            stopListening();
        }

        // 断开后清空报告
        clearAllReports();

        await device.close();
        appendLog(`🔌 设备已断开: ${device.productName || '未知'}`, 'info');

    } catch (err) {
        console.error('断开失败:', err);
        appendLog(`❌ 断开失败: ${err.message}`, 'error');
    } finally {
        device = null;
        hideDeviceInfo();
        updateConnectionUI();
        deviceMacEl.textContent = '--:--:--:--:--:--';
        updateRegStatus(false);
    }
}

/**
 * 获取或创建某个 Report ID 的显示卡片
 */
function getOrCreateReportCard(reportId) {
    let card = document.getElementById(`report-card-${reportId}`);
    if (card) return card;

    // 移除 placeholder
    const placeholder = reportsContainer.querySelector('.reports-placeholder');
    if (placeholder) placeholder.remove();

    card = document.createElement('div');
    card.className = 'report-card';
    card.id = `report-card-${reportId}`;

    card.innerHTML = `
        <div class="report-card-header">
            <span class="report-card-title">Report ID = ${reportId}</span>
            <span class="report-card-stats" id="report-stats-${reportId}">计数: 0</span>
        </div>
        <div class="report-card-body" id="report-body-${reportId}">—</div>
    `;

    reportsContainer.appendChild(card);
    return card;
}

/**
 * 更新指定 Report ID 的显示数据
 */
function updateReportDisplay(reportId) {
    const entry = reportDataMap[reportId];
    if (!entry) return;

    const bodyEl = document.getElementById(`report-body-${reportId}`);
    const statsEl = document.getElementById(`report-stats-${reportId}`);

    if (bodyEl) {
        bodyEl.textContent = bytesToHex(entry.data);
        // 闪动效果
        bodyEl.classList.remove('flash');
        void bodyEl.offsetWidth; // 触发 reflow
        bodyEl.classList.add('flash');
    }
    if (statsEl) {
        statsEl.textContent = `计数: ${entry.count} | ${entry.data.length}B`;
    }
}

/**
 * 开始监听设备的 InputReport
 */
function startListening() {
    if (!device || isListening) return;

    isListening = true;
    updateConnectionUI();
    receiveStatus.textContent = '监听中';
    receiveStatus.className = 'status-badge status-connected';

    // 定义 input 事件处理函数
    inputReportHandler = (event) => {
        const data = new Uint8Array(event.data.buffer);
        const reportId = event.reportId;

        // 更新缓存
        if (!reportDataMap[reportId]) {
            reportDataMap[reportId] = { data: null, count: 0 };
            // 首次出现，创建卡片
            getOrCreateReportCard(reportId);
        }
        const entry = reportDataMap[reportId];
        entry.data = data;
        entry.count++;

        // 更新显示
        updateReportDisplay(reportId);

        // 如果是 3 字节的 report，解析前 20 位更新按键映射高亮
        if (data.length === 3) {
            updateKeymapHighlights(data);
        }
    };

    device.addEventListener('inputreport', inputReportHandler);
}

/**
 * 停止监听设备的 InputReport
 */
function stopListening() {
    if (!device || !isListening) return;

    isListening = false;
    updateConnectionUI();
    receiveStatus.textContent = '已停止';
    receiveStatus.className = 'status-badge status-disconnected';

    if (inputReportHandler && device) {
        device.removeEventListener('inputreport', inputReportHandler);
        inputReportHandler = null;
    }
}

/**
 * 清空所有报告数据
 */
function clearAllReports() {
    // 清空缓存
    for (const key of Object.keys(reportDataMap)) {
        delete reportDataMap[key];
    }
    // 清空 DOM
    reportsContainer.innerHTML = `<div class="reports-placeholder">等待设备连接并接收数据...</div>`;
    // 清除按键高亮
    clearKeymapHighlights();
}

/**
 * 清除所有按键高亮
 */
function clearKeymapHighlights() {
    const items = keymapContainer.querySelectorAll('.keymap-item');
    items.forEach(item => item.classList.remove('keymap-active'));
}

// ============ 配置导入导出 ============

const CONFIG_FILE_VERSION = 1;

function gatherCurrentConfig() {
    return {
        wirelessMode: parseInt(wirelessModeSelect.value, 10),
        socd: parseInt(socdSelect.value, 10),
        sleepEnable: parseInt(sleepEnableSelect.value, 10),
        sleepTime: parseInt(sleepTimeInput.value, 10),
        enableModifyKey: parseInt(enableModifyKeySelect.value, 10),
        swapDirDpad: parseInt(swapDirDpadSelect.value, 10),
        rfCap: parseInt(rfCapSelect.value, 10),
        networkName: networkNameInput.value.trim() || DEFAULT_CONFIG.networkName,
    };
}

function applyConfigObject(config) {
    wirelessModeSelect.value = String(config.wirelessMode ?? DEFAULT_CONFIG.wirelessMode);
    socdSelect.value = String(config.socd ?? DEFAULT_CONFIG.socd);
    sleepEnableSelect.value = String(config.sleepEnable ?? DEFAULT_CONFIG.sleepEnable);
    sleepTimeInput.value = String(config.sleepTime ?? DEFAULT_CONFIG.sleepTime);
    enableModifyKeySelect.value = String(config.enableModifyKey ?? DEFAULT_CONFIG.enableModifyKey);
    swapDirDpadSelect.value = String(config.swapDirDpad ?? DEFAULT_CONFIG.swapDirDpad);
    rfCapSelect.value = String(config.rfCap ?? DEFAULT_CONFIG.rfCap);
    networkNameInput.value = config.networkName || DEFAULT_CONFIG.networkName;
    updateConfigPreview();
    updateNetworkNamePreview();
}

function exportConfig() {
    const data = {
        version: CONFIG_FILE_VERSION,
        config: gatherCurrentConfig(),
        keymap: currentKeymap,
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const ts = now.getFullYear()
        + String(now.getMonth() + 1).padStart(2, '0')
        + String(now.getDate()).padStart(2, '0') + '_'
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
    a.href = url;
    a.download = `ch58x_config_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog(`📤 配置已导出 (版本=${data.version}, ${data.keymap.length} 个键位)`, 'info');
}

function importConfig() {
    const file = importFileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // 版本检查
            if (data.version !== CONFIG_FILE_VERSION) {
                appendLog(`⚠️ 配置文件版本不兼容: 期望 ${CONFIG_FILE_VERSION}, 实际 ${data.version}`, 'error');
                return;
            }

            // 应用设置
            if (data.config) {
                applyConfigObject(data.config);
            }

            // 应用按键映射
            if (data.keymap && Array.isArray(data.keymap) && data.keymap.length === 20) {
                currentKeymap = JSON.parse(JSON.stringify(data.keymap));
                renderKeymap();
            } else {
                appendLog('⚠️ 配置文件中没有有效的按键映射数据', 'error');
            }

            appendLog('📥 配置已导入，请检查各项设置后发送到设备', 'info');
        } catch (err) {
            console.error('导入配置失败:', err);
            appendLog(`❌ 导入配置失败: ${err.message}`, 'error');
        }
    };
    reader.readAsText(file);

    // 重置 input 以便可以重复选择同一个文件
    importFileInput.value = '';
}

// ============ 事件绑定 ============

// 连接 / 断开
connectBtn.addEventListener('click', connectDevice);
disconnectBtn.addEventListener('click', disconnectDevice);

// 设备注册
readMacBtn.addEventListener('click', () => readMacAddress(true));
sendRegCodeBtn.addEventListener('click', sendRegCode);
regCodeInput.addEventListener('input', () => {
    // 自动转大写，限制 hex 字符
    regCodeInput.value = regCodeInput.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase().slice(0, 16);
});

// 清空报告
clearReportsBtn.addEventListener('click', clearAllReports);

// ============ 配置事件绑定 ============

// 配置项变更时更新预览
wirelessModeSelect.addEventListener('change', updateConfigPreview);
socdSelect.addEventListener('change', updateConfigPreview);
sleepEnableSelect.addEventListener('change', updateConfigPreview);
sleepTimeInput.addEventListener('input', () => {
    // 限制范围 5~20
    let val = parseInt(sleepTimeInput.value, 10);
    if (isNaN(val)) val = 5;
    val = Math.max(5, Math.min(20, val));
    sleepTimeInput.value = val;
    updateConfigPreview();
});

enableModifyKeySelect.addEventListener('change', updateConfigPreview);
swapDirDpadSelect.addEventListener('change', updateConfigPreview);
rfCapSelect.addEventListener('change', updateConfigPreview);
networkNameInput.addEventListener('input', updateNetworkNamePreview);

// 发送配置按钮
sendConfigBtn.addEventListener('click', sendConfig);

// 发送网络名称按钮
sendNetworkNameBtn.addEventListener('click', sendNetworkName);

// 重置配置按钮
resetConfigBtn.addEventListener('click', resetConfig);

// 读取配置按钮
readConfigBtn.addEventListener('click', readConfig);

// 读取按键映射 / 读取网络名按钮(读请求不修改设备上的配置)
readKeymapBtn.addEventListener('click', async () => {
    if (!device) { appendLog('⚠️ 请先连接设备', 'error'); return; }
    try {
        const n = await readKeymapAll();
        appendLog(`📩 已读取按键映射: ${n}/20 个键位`, n > 0 ? 'info' : 'error');
    } catch (err) {
        appendLog(`❌ 读取按键映射失败: ${err.message}`, 'error');
    }
});

readNameBtn.addEventListener('click', async () => {
    if (!device) { appendLog('⚠️ 请先连接设备', 'error'); return; }
    try {
        const data = await readSection(SEC_NAME);
        appendLog(`📩 读取响应 [段=0x03] | ${data.length}B: ${bytesToHex(data)}`, 'received', data);
        unpackConfig(data);
    } catch (err) {
        appendLog(`❌ 读取网络名失败: ${err.message}`, 'error');
    }
});

// 保存配置并重启按钮
saveAndRebootBtn.addEventListener('click', saveAndReboot);

// 导入导出配置
exportConfigBtn.addEventListener('click', exportConfig);
importConfigBtn.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', importConfig);

// ============ 按键映射事件绑定 ============

// 配置标签切换
configTab1.addEventListener('click', () => switchConfigTab(1));
configTab2.addEventListener('click', () => switchConfigTab(2));
configTab3.addEventListener('click', () => switchConfigTab(3));
configTab4.addEventListener('click', () => switchConfigTab(4));

// ============ 开机图事件绑定 ============

logoFileInput.addEventListener('change', async () => {
    const file = logoFileInput.files && logoFileInput.files[0];
    if (!file) return;
    try {
        const img = await loadLogoFile(file);
        appendLog(`🖼️ 已载入图片 ${file.name} (${img.width}x${img.height})`, 'info');
    } catch (err) {
        appendLog(`❌ ${err.message}`, 'error');
    }
});

[logoThresholdInput, logoFitSelect, logoDitherSelect].forEach(el =>
    el.addEventListener('input', regenerateLogoBytes));
logoFitSelect.addEventListener('change', regenerateLogoBytes);
logoDitherSelect.addEventListener('change', regenerateLogoBytes);
logoInvertCheckbox.addEventListener('change', regenerateLogoBytes);

uploadLogoBtn.addEventListener('click', uploadLogo);
restoreLogoBtn.addEventListener('click', restoreDefaultLogo);

// 发送全部按键映射
sendKeymapBtn.addEventListener('click', sendAllKeymaps);

// 重置按键映射
resetKeymapBtn.addEventListener('click', resetKeymap);

// ============ 初始化 ============

// 初始化 UI
updateConnectionUI();

// 初始化配置预览
updateConfigPreview();
updateNetworkNamePreview();

// 初始化按键映射 UI
renderKeymap();

// 浏览器兼容性检查
if (!navigator.hid) {
    appendLog('❌ 您的浏览器不支持 WebHID API。请使用 Chrome 89+ 或 Edge 89+，并启用 HTTPS 或 localhost。', 'error');
    document.body.innerHTML = `
        <div style="text-align:center;margin-top:100px;color:#f87171;font-size:1.2rem;">
            <h2>❌ 浏览器不支持 WebHID</h2>
            <p style="margin-top:16px;color:#94a3b8;">
                请使用 Chrome 89+ 或 Edge 89+，并通过 HTTPS 或 localhost 访问。
            </p>
        </div>
    `;
}

// 如果在非 HTTPS / 非 localhost 环境下提醒
if (navigator.hid && location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    appendLog('⚠️ 当前非安全环境 (${location.protocol}//${location.host})。WebHID 需要 HTTPS 才能运行。', 'error');
}

console.log('三模HITBOX配置工具已启动！');
