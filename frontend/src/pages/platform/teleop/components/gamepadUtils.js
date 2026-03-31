export const GAMEPAD_LOOP_INTERVAL = 10;
export const GAMEPAD_COMMAND_HZ = 30;
export const GAMEPAD_DEBOUNCE_INTERVAL = 1000 / GAMEPAD_COMMAND_HZ;
export const GAMEPAD_AXIS_DEADZONE = 0.15;
export const HID_GAMEPAD_INDEX_OFFSET = 1000;

export const GAMEPAD_BUTTON_NAMES = {
    0: 'A',
    1: 'B',
    2: 'X',
    3: 'Y',
    4: 'LB',
    5: 'RB',
    6: 'LT',
    7: 'RT',
    8: 'BACK',
    9: 'START',
    10: 'L3',
    11: 'R3',
    12: 'DPAD UP',
    13: 'DPAD DOWN',
    14: 'DPAD LEFT',
    15: 'DPAD RIGHT',
    16: 'HOME',
};

const HID_VENDOR_FILTERS = [
    { vendorId: 0x054c }, // Sony
    { vendorId: 0x045e }, // Microsoft
    { vendorId: 0x057e }, // Nintendo
];

function normalizeControllerName(gamepad) {
    const rawId = String(gamepad?.id ?? '').trim();
    const shortName = rawId
        .split(' ')
        .slice(0, 4)
        .join(' ')
        .trim();
    const normalized = rawId.toLowerCase();

    if (normalized.includes('wireless controller') || normalized.includes('dualshock') || normalized.includes('dualsense') || normalized.includes('playstation')) {
        return shortName || 'PlayStation Controller';
    }

    if (normalized.includes('xbox')) {
        return shortName || 'Xbox Controller';
    }

    return shortName || `Controller ${(gamepad?.index ?? 0) + 1}`;
}

function normalizeAxis(value) {
    return Math.abs(value) > GAMEPAD_AXIS_DEADZONE ? value : 0;
}

function normalizeByteAxis(value) {
    if (typeof value !== 'number') return 0;
    return normalizeAxis((value - 127.5) / 127.5);
}

function normalizePressure(value) {
    if (typeof value !== 'number') return 0;
    return Math.max(0, Math.min(1, value / 255));
}

function readTrigger(gamepad, axisIndex, buttonIndex) {
    const axisValue = gamepad.axes.length > axisIndex ? gamepad.axes[axisIndex] : null;
    if (typeof axisValue === 'number') {
        if (axisIndex === 7) {
            return axisValue > -0.9 ? (axisValue + 1) / 2 : 0;
        }
        return axisValue > 0.1 ? axisValue : 0;
    }

    const button = gamepad.buttons?.[buttonIndex];
    if (!button) return 0;
    return typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0;
}

export function extractGamepadSnapshot(gamepad) {
    return {
        leftStickX: normalizeAxis(gamepad.axes?.[0] ?? 0),
        leftStickY: normalizeAxis(gamepad.axes?.[1] ?? 0),
        rightStickX: normalizeAxis(gamepad.axes?.[2] ?? 0),
        rightStickY: normalizeAxis(gamepad.axes?.[3] ?? 0),
        leftTrigger: readTrigger(gamepad, 6, 6),
        rightTrigger: readTrigger(gamepad, 7, 7),
        buttons: Array.from(gamepad.buttons ?? []).map((button) => Boolean(button?.pressed)),
        buttonValues: Array.from(gamepad.buttons ?? []).map((button) => Number(button?.value ?? 0)),
    };
}

export function readGamepads() {
    if (typeof navigator === 'undefined') return [];

    const getter = navigator.getGamepads || navigator.webkitGetGamepads;
    if (typeof getter !== 'function') return [];

    try {
        return Array.from(getter.call(navigator) ?? []);
    } catch {
        return [];
    }
}

export function isHidControllerIndex(index) {
    return typeof index === 'number' && index >= HID_GAMEPAD_INDEX_OFFSET;
}

export function createEmptyGamepadSnapshot() {
    return {
        leftStickX: 0,
        leftStickY: 0,
        rightStickX: 0,
        rightStickY: 0,
        leftTrigger: 0,
        rightTrigger: 0,
        buttons: Array(17).fill(false),
        buttonValues: Array(17).fill(0),
    };
}

function createHidControllerInfo(device, slotIndex) {
    return {
        index: HID_GAMEPAD_INDEX_OFFSET + slotIndex,
        id: `${device.vendorId}:${device.productId}`,
        name: `${device.productName || `HID Controller ${slotIndex + 1}`} (HID)`,
        vendorId: device.vendorId,
        productId: device.productId,
        opened: Boolean(device.opened),
        source: 'hid',
        device,
    };
}

function parsePs3HidReport(data) {
    if (!data || data.byteLength < 10) return null;

    const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const snapshot = createEmptyGamepadSnapshot();
    const buttonByte0 = bytes[2] ?? 0;
    const buttonByte1 = bytes[3] ?? 0;
    const buttonByte2 = bytes[4] ?? 0;

    snapshot.leftStickX = normalizeByteAxis(bytes[6]);
    snapshot.leftStickY = normalizeByteAxis(bytes[7]);
    snapshot.rightStickX = normalizeByteAxis(bytes[8]);
    snapshot.rightStickY = normalizeByteAxis(bytes[9]);
    snapshot.leftTrigger = normalizePressure(bytes[18] ?? ((buttonByte1 & 0x01) ? 255 : 0));
    snapshot.rightTrigger = normalizePressure(bytes[19] ?? ((buttonByte1 & 0x02) ? 255 : 0));

    snapshot.buttons[0] = Boolean(buttonByte1 & 0x40); // Cross
    snapshot.buttons[1] = Boolean(buttonByte1 & 0x20); // Circle
    snapshot.buttons[2] = Boolean(buttonByte1 & 0x80); // Square
    snapshot.buttons[3] = Boolean(buttonByte1 & 0x10); // Triangle
    snapshot.buttons[4] = Boolean(buttonByte1 & 0x04); // L1
    snapshot.buttons[5] = Boolean(buttonByte1 & 0x08); // R1
    snapshot.buttons[6] = snapshot.leftTrigger > 0.05 || Boolean(buttonByte1 & 0x01); // L2
    snapshot.buttons[7] = snapshot.rightTrigger > 0.05 || Boolean(buttonByte1 & 0x02); // R2
    snapshot.buttons[8] = Boolean(buttonByte0 & 0x01); // Select
    snapshot.buttons[9] = Boolean(buttonByte0 & 0x08); // Start
    snapshot.buttons[10] = Boolean(buttonByte0 & 0x02); // L3
    snapshot.buttons[11] = Boolean(buttonByte0 & 0x04); // R3
    snapshot.buttons[12] = Boolean(buttonByte0 & 0x10); // Up
    snapshot.buttons[13] = Boolean(buttonByte0 & 0x40); // Down
    snapshot.buttons[14] = Boolean(buttonByte0 & 0x80); // Left
    snapshot.buttons[15] = Boolean(buttonByte0 & 0x20); // Right
    snapshot.buttons[16] = Boolean(buttonByte2 & 0x01); // PS

    snapshot.buttonValues = snapshot.buttons.map((pressed, index) => {
        if (index === 6) return snapshot.leftTrigger;
        if (index === 7) return snapshot.rightTrigger;
        return pressed ? 1 : 0;
    });

    return snapshot;
}

export function parseHidControllerSnapshot(device, data) {
    const vendorId = Number(device?.vendorId ?? 0);
    const productId = Number(device?.productId ?? 0);

    if (vendorId === 0x054c && productId === 0x0268) {
        return parsePs3HidReport(data);
    }

    return null;
}

export function getGamepadDiagnostics() {
    const gamepads = readGamepads();
    const apiAvailable = typeof navigator !== 'undefined'
        && typeof (navigator.getGamepads || navigator.webkitGetGamepads) === 'function';

    return {
        apiAvailable,
        secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
        hasHidApi: typeof navigator !== 'undefined'
            && typeof navigator.hid?.getDevices === 'function'
            && typeof navigator.hid?.requestDevice === 'function',
        rawSlotCount: gamepads.length,
        connectedCount: gamepads.filter(Boolean).length,
        visibleControllers: gamepads
            .filter(Boolean)
            .map((gamepad) => ({
                index: gamepad.index,
                id: gamepad.id,
                mapping: gamepad.mapping || 'unknown',
                connected: Boolean(gamepad.connected),
                name: normalizeControllerName(gamepad),
            })),
    };
}

export function getAvailableGamepads() {
    const gamepads = readGamepads();
    const available = [];

    for (let index = 0; index < gamepads.length; index += 1) {
        const gamepad = gamepads[index];
        if (!gamepad) continue;

        available.push({
            index: gamepad.index,
            id: gamepad.id,
            name: normalizeControllerName(gamepad),
        });
    }

    return available;
}

export function getPressedButtonLabels(buttons = []) {
    return buttons
        .map((pressed, index) => (pressed ? GAMEPAD_BUTTON_NAMES[index] ?? `BTN ${index}` : null))
        .filter(Boolean);
}

export async function getGrantedHidControllers() {
    if (typeof navigator === 'undefined' || typeof navigator.hid?.getDevices !== 'function') {
        return [];
    }

    try {
        const devices = await navigator.hid.getDevices();
        return devices.map((device, index) => createHidControllerInfo(device, index));
    } catch {
        return [];
    }
}

export async function requestControllerHidAccess() {
    if (typeof navigator === 'undefined' || typeof navigator.hid?.requestDevice !== 'function') {
        return [];
    }

    try {
        const devices = await navigator.hid.requestDevice({
            filters: HID_VENDOR_FILTERS,
        });

        return devices.map((device, index) => createHidControllerInfo(device, index));
    } catch {
        return [];
    }
}
