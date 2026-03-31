from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

GAMEPAD_LOOP_HZ = 30.0
GAMEPAD_LOOP_INTERVAL = 1.0 / GAMEPAD_LOOP_HZ
GAMEPAD_AXIS_STEP = 2.0
GAMEPAD_DPAD_STEP = 2.0
GAMEPAD_BUTTON_STEP = 2.0
GAMEPAD_GRIPPER_SPEED = 120.0  # deg/s for digital trigger fallback
GAMEPAD_AXIS_DEADZONE = 0.15
DEVICE_SCAN_INTERVAL = 0.5
IDLE_WAIT_INTERVAL = 0.1
PS3_VENDOR_ID = 0x054C
PS3_PRODUCT_ID = 0x0268

BUTTON_LABELS = {
    0: "Cross",
    1: "Circle",
    2: "Square",
    3: "Triangle",
    4: "L1",
    5: "R1",
    6: "L2",
    7: "R2",
    8: "Select",
    9: "Start",
    10: "L3",
    11: "R3",
    12: "PS",
    13: "DPad Up",
    14: "DPad Right",
    15: "DPad Down",
    16: "DPad Left",
    17: "Mic",
    18: "Touchpad",
}


def _normalize_axis(value: float, deadzone: float = GAMEPAD_AXIS_DEADZONE) -> float:
    if abs(value) < deadzone:
        return 0.0
    return float(value)


def _button_label(index: int) -> str:
    return BUTTON_LABELS.get(index, f"BTN {index}")


def _normalize_byte_axis(raw: int | None) -> float:
    if raw is None:
        return 0.0
    normalized = (float(raw) - 128.0) / 127.0
    return _normalize_axis(max(-1.0, min(1.0, normalized)))


def _normalize_pressure(raw: int | None) -> float:
    if raw is None:
        return 0.0
    return max(0.0, min(1.0, float(raw) / 255.0))


class KecyaiGamepadRuntime:
    def __init__(self, adapter: Any, log_callback: Callable[[str], None] | None = None) -> None:
        self.adapter = adapter
        self.log_callback = log_callback
        self._lock = threading.Lock()
        self._pygame = None
        self._pygame_import_error = ""
        self._joystick = None
        self._joystick_index: int | None = None
        self._hid = None
        self._hid_import_error = ""
        self._hid_device = None
        self._hid_path: bytes | None = None
        self._selected_backend = "pygame"
        self._thread: threading.Thread | None = None
        self._running = False
        self._selected_index: int | None = None
        self._speed = 0.8
        self._analog_values = self._empty_analog_values()
        self._active_buttons: list[str] = []
        self._available_gamepads: list[dict[str, Any]] = []
        self._last_buttons: list[bool] = []
        self._target_positions: dict[str, float] = {}
        self._error_message = ""
        self._backend = "pygame"
        self._shutdown = False
        self._refresh_requested = True
        self._wake_event = threading.Event()
        self._status_event = threading.Event()
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name="kecyai-gamepad-worker")
        self._worker_thread.start()

    @staticmethod
    def _empty_analog_values() -> dict[str, float]:
        return {
            "leftStickX": 0.0,
            "leftStickY": 0.0,
            "rightStickX": 0.0,
            "rightStickY": 0.0,
            "leftTrigger": 0.0,
            "rightTrigger": 0.0,
        }

    def _log(self, message: str) -> None:
        logger.info(message)
        if self.log_callback is not None:
            self.log_callback(message)

    def _ensure_pygame(self):
        if self._pygame is not None:
            return self._pygame

        try:
            import pygame
        except Exception as exc:
            self._pygame_import_error = str(exc)
            raise RuntimeError(f"pygame import failed: {exc}") from exc

        pygame.init()
        pygame.joystick.init()
        self._pygame = pygame
        self._pygame_import_error = ""
        return pygame

    def _ensure_hid(self):
        if self._hid is not None:
            return self._hid

        try:
            import hid
        except Exception as exc:
            self._hid_import_error = str(exc)
            raise RuntimeError(f"hid import failed: {exc}") from exc

        self._hid = hid
        self._hid_import_error = ""
        return hid

    def _request_refresh(self) -> None:
        with self._lock:
            self._refresh_requested = True
        self._status_event.clear()
        self._wake_event.set()

    def refresh_devices(self) -> list[dict[str, Any]]:
        self._request_refresh()
        self._status_event.wait(timeout=0.35)
        with self._lock:
            return list(self._available_gamepads)

    def _close_joystick_locked(self) -> None:
        if self._joystick is not None:
            try:
                self._joystick.quit()
            except Exception:
                pass
        self._joystick = None
        self._joystick_index = None

    def _close_hid_locked(self) -> None:
        if self._hid_device is not None:
            try:
                self._hid_device.close()
            except Exception:
                pass
        self._hid_device = None
        self._hid_path = None

    def _refresh_devices_on_worker(self) -> None:
        devices: list[dict[str, Any]] = []
        hid_devices: list[dict[str, Any]] = []
        try:
            hid = self._ensure_hid()
            for device in hid.enumerate():
                vendor_id = int(device.get("vendor_id", 0) or 0)
                product_id = int(device.get("product_id", 0) or 0)
                if vendor_id == PS3_VENDOR_ID and product_id == PS3_PRODUCT_ID:
                    hid_devices.append(
                        {
                            "index": len(hid_devices),
                            "id": f"hid-{vendor_id:04x}:{product_id:04x}:{len(hid_devices)}",
                            "name": device.get("product_string") or "PLAYSTATION(R)3 Controller",
                            "guid": "",
                            "axes": 4,
                            "buttons": 19,
                            "hats": 0,
                            "backend": "hidapi",
                            "path": device.get("path"),
                            "vendor_id": vendor_id,
                            "product_id": product_id,
                        }
                    )
        except Exception:
            hid_devices = []

        if hid_devices:
            devices = hid_devices
        else:
            try:
                pygame = self._ensure_pygame()
                pygame.event.pump()
                for index in range(pygame.joystick.get_count()):
                    joystick = pygame.joystick.Joystick(index)
                    joystick.init()
                    guid = ""
                    try:
                        guid = joystick.get_guid()
                    except Exception:
                        guid = ""
                    devices.append(
                        {
                            "index": index,
                            "id": guid or f"joystick-{index}",
                            "name": joystick.get_name() or f"Controller {index + 1}",
                            "guid": guid,
                            "axes": joystick.get_numaxes(),
                            "buttons": joystick.get_numbuttons(),
                            "hats": joystick.get_numhats(),
                            "backend": "pygame",
                        }
                    )
            except Exception as exc:
                self._pygame_import_error = str(exc)
                devices = []

        with self._lock:
            self._available_gamepads = devices
            self._refresh_requested = False
            if self._selected_backend == "hidapi":
                if self._hid_path is not None and not any(device.get("path") == self._hid_path for device in devices):
                    self._close_hid_locked()
            elif self._joystick_index is not None and not any(device["index"] == self._joystick_index for device in devices):
                self._close_joystick_locked()

        self._status_event.set()

    def _ensure_selected_joystick_on_worker(self, selected_index: int | None):
        if selected_index is None:
            self._close_joystick_locked()
            return None
        if self._joystick is not None and self._joystick_index == selected_index:
            return self._joystick
        self._close_joystick_locked()
        pygame = self._ensure_pygame()
        joystick = pygame.joystick.Joystick(selected_index)
        joystick.init()
        self._joystick = joystick
        self._joystick_index = selected_index
        return joystick

    def _ensure_selected_hid_device_on_worker(self, selected_path: bytes | None):
        if selected_path is None:
            self._close_hid_locked()
            return None
        if self._hid_device is not None and self._hid_path == selected_path:
            return self._hid_device
        self._close_hid_locked()
        hid = self._ensure_hid()
        device = hid.device()
        device.open_path(selected_path)
        self._hid_device = device
        self._hid_path = selected_path
        return device

    def get_status(self) -> dict[str, Any]:
        available = self.refresh_devices()
        with self._lock:
            message = self._error_message
            if not message and self._pygame_import_error:
                message = f"pygame unavailable: {self._pygame_import_error}"
            if not message and self._hid_import_error and not available:
                message = f"hid unavailable: {self._hid_import_error}"
            backend = self._selected_backend
            if not self._running and available:
                backend = str(available[0].get("backend") or backend)
            serializable_available = [
                {key: value for key, value in entry.items() if key != "path"}
                for entry in available
            ]
            return {
                "backend": backend,
                "pygame_available": self._pygame is not None,
                "connected": len(serializable_available) > 0,
                "active": self._running,
                "selected_index": self._selected_index,
                "speed": self._speed,
                "available_gamepads": serializable_available,
                "analog_values": dict(self._analog_values),
                "active_buttons": list(self._active_buttons),
                "message": message,
            }

    def start(self, controller_index: int | None = None, speed: float | None = None) -> dict[str, Any]:
        if not self.adapter.is_connected():
            raise RuntimeError("Teleop session must be connected before starting gamepad control.")

        available = self.refresh_devices()
        if not available:
            raise RuntimeError("No runtime gamepad detected by pygame.")

        selected_index = controller_index if controller_index is not None else available[0]["index"]
        selected = next((entry for entry in available if entry["index"] == selected_index), None)
        if selected is None:
            raise RuntimeError(f"Controller index {selected_index} is unavailable.")

        with self._lock:
            self._selected_index = selected_index
            self._selected_backend = str(selected.get("backend") or "pygame")
            self._speed = float(speed if speed is not None else self._speed)
            self._error_message = ""
            self._analog_values = self._empty_analog_values()
            self._active_buttons = []
            self._last_buttons = [False for _ in range(19)]
            self._target_positions = {
                entry["id"]: float(entry.get("position", 0.0))
                for entry in self.adapter.get_joint_state()
            }
            self._running = True
            self._refresh_requested = True

        self._wake_event.set()
        self._log(f"Runtime gamepad started on controller {selected_index + 1}: {selected['name']}")
        return self.get_status()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._running = False
            self._close_joystick_locked()
            self._close_hid_locked()
            self._active_buttons = []
            self._analog_values = self._empty_analog_values()
            self._last_buttons = []
            self._target_positions = {}
            if not self._error_message:
                self._error_message = ""

        self._wake_event.set()
        self._log("Runtime gamepad stopped.")
        return self.get_status()

    def configure(self, controller_index: int | None = None, speed: float | None = None) -> dict[str, Any]:
        with self._lock:
            if controller_index is not None:
                self._selected_index = int(controller_index)
                selected = next((entry for entry in self._available_gamepads if entry["index"] == self._selected_index), None)
                if selected is not None:
                    self._selected_backend = str(selected.get("backend") or self._selected_backend)
                self._refresh_requested = True
                self._target_positions = {
                    entry["id"]: float(entry.get("position", 0.0))
                    for entry in self.adapter.get_joint_state()
                } if self.adapter.is_connected() else {}
            if speed is not None:
                self._speed = float(speed)
        self._wake_event.set()
        return self.get_status()

    def _read_snapshot(self, joystick) -> tuple[dict[str, float], list[bool]]:
        analog_values = self._empty_analog_values()
        num_axes = joystick.get_numaxes()
        num_buttons = joystick.get_numbuttons()

        analog_values["leftStickX"] = _normalize_axis(joystick.get_axis(0) if num_axes > 0 else 0.0)
        analog_values["leftStickY"] = _normalize_axis(joystick.get_axis(1) if num_axes > 1 else 0.0)
        analog_values["rightStickX"] = _normalize_axis(joystick.get_axis(2) if num_axes > 2 else 0.0)
        analog_values["rightStickY"] = _normalize_axis(joystick.get_axis(3) if num_axes > 3 else 0.0)

        if num_axes > 5:
            analog_values["leftTrigger"] = max(0.0, min(1.0, (joystick.get_axis(4) + 1.0) / 2.0))
            analog_values["rightTrigger"] = max(0.0, min(1.0, (joystick.get_axis(5) + 1.0) / 2.0))

        buttons = [bool(joystick.get_button(index)) for index in range(num_buttons)]
        while len(buttons) < 19:
            buttons.append(False)

        if analog_values["leftTrigger"] == 0.0 and buttons[6]:
            analog_values["leftTrigger"] = 1.0
        if analog_values["rightTrigger"] == 0.0 and buttons[7]:
            analog_values["rightTrigger"] = 1.0

        return analog_values, buttons

    def _read_ps3_hid_snapshot(self, device) -> tuple[dict[str, float], list[bool]]:
        analog_values = self._empty_analog_values()
        buttons = [False for _ in range(19)]

        try:
            data = device.get_input_report(0x01, 64)
        except Exception as exc:
            raise RuntimeError(f"Failed to poll HID input report: {exc}") from exc

        if not data or len(data) < 20:
            return analog_values, buttons

        button_byte0 = int(data[2]) if len(data) > 2 else 0
        button_byte1 = int(data[3]) if len(data) > 3 else 0
        button_byte2 = int(data[4]) if len(data) > 4 else 0

        analog_values["leftStickX"] = _normalize_byte_axis(data[6] if len(data) > 6 else None)
        analog_values["leftStickY"] = _normalize_byte_axis(data[7] if len(data) > 7 else None)
        analog_values["rightStickX"] = _normalize_byte_axis(data[8] if len(data) > 8 else None)
        analog_values["rightStickY"] = _normalize_byte_axis(data[9] if len(data) > 9 else None)
        analog_values["leftTrigger"] = _normalize_pressure(data[18] if len(data) > 18 else (255 if (button_byte1 & 0x01) else 0))
        analog_values["rightTrigger"] = _normalize_pressure(data[19] if len(data) > 19 else (255 if (button_byte1 & 0x02) else 0))

        buttons[0] = bool(button_byte1 & 0x40)   # Cross
        buttons[1] = bool(button_byte1 & 0x20)   # Circle
        buttons[2] = bool(button_byte1 & 0x80)   # Square
        buttons[3] = bool(button_byte1 & 0x10)   # Triangle
        buttons[4] = bool(button_byte1 & 0x04)   # L1
        buttons[5] = bool(button_byte1 & 0x08)   # R1
        buttons[6] = analog_values["leftTrigger"] > 0.05 or bool(button_byte1 & 0x01)   # L2
        buttons[7] = analog_values["rightTrigger"] > 0.05 or bool(button_byte1 & 0x02)  # R2
        buttons[8] = bool(button_byte0 & 0x01)   # Select
        buttons[9] = bool(button_byte0 & 0x08)   # Start
        buttons[10] = bool(button_byte0 & 0x02)  # L3
        buttons[11] = bool(button_byte0 & 0x04)  # R3
        buttons[12] = bool(button_byte0 & 0x10)  # Up
        buttons[13] = bool(button_byte0 & 0x40)  # Down
        buttons[14] = bool(button_byte0 & 0x80)  # Left
        buttons[15] = bool(button_byte0 & 0x20)  # Right
        buttons[16] = bool(button_byte2 & 0x01)  # PS

        return analog_values, buttons

    def _button_pressed(self, buttons: list[bool], index: int) -> bool:
        return index < len(buttons) and buttons[index]

    def _just_pressed(self, buttons: list[bool], index: int) -> bool:
        previous = self._button_pressed(self._last_buttons, index)
        return self._button_pressed(buttons, index) and not previous

    def _worker_loop(self) -> None:
        last_tick = time.monotonic()
        last_scan = 0.0

        while not self._shutdown:
            with self._lock:
                running = self._running
                selected_index = self._selected_index
                selected_backend = self._selected_backend
                speed = self._speed
                targets = dict(self._target_positions)
                refresh_requested = self._refresh_requested

            current_time = time.monotonic()
            if refresh_requested or current_time - last_scan >= DEVICE_SCAN_INTERVAL:
                self._refresh_devices_on_worker()
                last_scan = current_time

            if not running:
                self._wake_event.wait(timeout=IDLE_WAIT_INTERVAL)
                self._wake_event.clear()
                continue

            if not self.adapter.is_connected():
                with self._lock:
                    self._error_message = "Teleop disconnected while gamepad was active."
                    self._running = False
                    self._active_buttons = []
                    self._analog_values = self._empty_analog_values()
                continue

            try:
                if selected_backend == "hidapi":
                    selected_device = next(
                        (device for device in self._available_gamepads if device["index"] == selected_index and device.get("backend") == "hidapi"),
                        None,
                    )
                    if selected_device is None:
                        raise RuntimeError("Selected HID controller is unavailable.")
                    hid_device = self._ensure_selected_hid_device_on_worker(selected_device.get("path"))
                    analog_values, buttons = self._read_ps3_hid_snapshot(hid_device)
                else:
                    joystick = self._ensure_selected_joystick_on_worker(selected_index)
                    pygame = self._ensure_pygame()
                    pygame.event.pump()
                    analog_values, buttons = self._read_snapshot(joystick)
            except Exception as exc:
                with self._lock:
                    self._error_message = f"Selected controller is unavailable: {exc}"
                    self._running = False
                    self._active_buttons = []
                    self._analog_values = self._empty_analog_values()
                continue

            active_labels = [_button_label(index) for index, pressed in enumerate(buttons) if pressed]
            delta_t = min(max(current_time - last_tick, GAMEPAD_LOOP_INTERVAL), 0.1)
            last_tick = current_time

            next_targets = dict(targets)

            def add_delta(joint_id: str, delta: float) -> None:
                if abs(delta) < 1e-6:
                    return
                next_targets[joint_id] = float(next_targets.get(joint_id, 0.0)) + delta

            add_delta("shoulder_pan", analog_values["leftStickX"] * GAMEPAD_AXIS_STEP * speed)
            add_delta("shoulder_lift", -analog_values["leftStickY"] * GAMEPAD_AXIS_STEP * speed)
            add_delta("wrist_flex", analog_values["rightStickX"] * GAMEPAD_AXIS_STEP * speed)
            add_delta("elbow_flex", -analog_values["rightStickY"] * GAMEPAD_AXIS_STEP * speed)

            if self._button_pressed(buttons, 12):
                add_delta("wrist_flex", GAMEPAD_DPAD_STEP * speed)
            if self._button_pressed(buttons, 13):
                add_delta("wrist_flex", -GAMEPAD_DPAD_STEP * speed)
            if self._button_pressed(buttons, 14):
                add_delta("wrist_roll", -GAMEPAD_DPAD_STEP * speed)
            if self._button_pressed(buttons, 15):
                add_delta("wrist_roll", GAMEPAD_DPAD_STEP * speed)

            if self._button_pressed(buttons, 0):
                add_delta("wrist_flex", -GAMEPAD_BUTTON_STEP * speed)
            if self._button_pressed(buttons, 3):
                add_delta("wrist_flex", GAMEPAD_BUTTON_STEP * speed)
            if self._button_pressed(buttons, 2):
                add_delta("wrist_roll", -GAMEPAD_BUTTON_STEP * speed)
            if self._button_pressed(buttons, 1):
                add_delta("wrist_roll", GAMEPAD_BUTTON_STEP * speed)

            if self._just_pressed(buttons, 9):
                self.adapter.home_pose()
                next_targets = {
                    entry["id"]: float(entry.get("position", 0.0))
                    for entry in self.adapter.get_joint_state()
                }

            if self._just_pressed(buttons, 4):
                next_targets["gripper"] = 100.0
            if self._just_pressed(buttons, 5):
                next_targets["gripper"] = 0.0

            gripper_delta = (analog_values["leftTrigger"] - analog_values["rightTrigger"]) * GAMEPAD_GRIPPER_SPEED * delta_t * speed
            if abs(gripper_delta) > 0.01:
                add_delta("gripper", gripper_delta)

            changed_targets: dict[str, float] = {}
            for joint_id, value in next_targets.items():
                if abs(value - targets.get(joint_id, 0.0)) > 0.001:
                    changed_targets[joint_id] = value

            if changed_targets and not self.adapter.is_estop_active():
                self.adapter.set_joint_targets(changed_targets)

            with self._lock:
                self._analog_values = analog_values
                self._active_buttons = active_labels
                self._last_buttons = buttons
                self._target_positions = next_targets
                self._error_message = ""

            self._wake_event.wait(timeout=GAMEPAD_LOOP_INTERVAL)
            self._wake_event.clear()
