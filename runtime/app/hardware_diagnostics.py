"""
Host-safe hardware diagnostics for Feetech SO-10x robots.

This module is intentionally read-mostly:
- it auto-detects likely robot serial ports
- pings expected servo IDs
- reads live telemetry registers
- can optionally run a tiny bounded twitch test when explicitly requested
"""

from __future__ import annotations

import gc
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

EXPECTED_SERVO_IDS = [1, 2, 3, 4, 5, 6]
EXPECTED_MODEL_NUMBERS = {777, 2825}
DIAGNOSTIC_BAUDRATE = 1_000_000

CH_USB_VID_PIDS = {
    ("1A86", "55D3"),
    ("1A86", "7523"),
}

READ_ONLY_REGISTER_MAP = {
    "present_position": (56, 2, "u16"),
    "present_load": (60, 2, "s10"),
    "present_voltage": (62, 1, "u8"),
    "present_temperature": (63, 1, "u8"),
    "present_current": (69, 2, "s15"),
    "torque_enable": (40, 1, "u8"),
}

SAFETY_POLICY = {
    "movement_allowed": False,
    "position_write_allowed": False,
    "max_goal_velocity_raw": 1,
    "max_acceleration_raw": 1,
    "max_torque_limit_raw": 100,
}

TWITCH_POLICY = {
    "movement_allowed": True,
    "position_write_allowed": True,
    "max_delta_raw": 30,
    "default_delta_raw": 20,
    "default_goal_velocity_raw": 10,
    "default_acceleration_raw": 1,
}

_home_dir = Path(os.environ.get("HOME") or Path.home())
CONFIG_DIR = _home_dir / ".kecyai"
CONFIG_FILE = CONFIG_DIR / "hardware_config.json"


def _decode_sign_magnitude(value: int, sign_bit: int) -> int:
    sign_mask = 1 << sign_bit
    magnitude = value & (sign_mask - 1)
    return -magnitude if value & sign_mask else magnitude


class HardwareDiagnostics:
    def __init__(self) -> None:
        self._last_result: Optional[Dict[str, Any]] = None

    def get_last_result(self) -> Optional[Dict[str, Any]]:
        if self._last_result is None:
            return None
        return json.loads(json.dumps(self._last_result))

    def auto_configure(
        self,
        preferred_port: str = "",
        robot_type: str = "so101_follower",
        driver: str = "feetech",
    ) -> Dict[str, Any]:
        result = self.run_safe_servo_scan(preferred_port=preferred_port)
        if result.get("status") != "ok":
            return result

        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        config = {
            "serial_port": result["selected_port"],
            "robot_type": robot_type,
            "driver": driver,
            "dry_run": False,
        }
        with open(CONFIG_FILE, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2)

        result["config_path"] = str(CONFIG_FILE)
        result["config"] = {
            **config,
            "mode": "hardware",
        }
        self._last_result = result
        return result

    def run_safe_servo_scan(self, preferred_port: str = "") -> Dict[str, Any]:
        candidates = self._scan_ports()
        ordered = self._order_candidates(candidates, preferred_port)
        if not ordered:
            result = {
                "status": "error",
                "message": "No serial ports detected on the host.",
                "dry_run": False,
                "selected_port": "",
                "candidates": [],
                "safety_policy": SAFETY_POLICY,
                "movement_commands_sent": False,
                "servos": [],
            }
            self._last_result = result
            return result

        last_error = ""
        for candidate in ordered:
            port = candidate["port"]
            try:
                diagnosis = self._diagnose_port(port)
            except Exception as exc:
                last_error = f"{port}: {exc}"
                logger.warning("Hardware diagnosis failed for %s: %s", port, exc)
                continue

            if diagnosis["servos"]:
                result = {
                    "status": "ok",
                    "message": f"Detected {len(diagnosis['servos'])} responding servo(s) on {port}.",
                    "dry_run": False,
                    "selected_port": port,
                    "selected_port_source": "preferred" if preferred_port and preferred_port.upper() == port.upper() else "auto_detected",
                    "candidates": ordered,
                    "safety_policy": SAFETY_POLICY,
                    "movement_commands_sent": False,
                    "servos": diagnosis["servos"],
                    "unreachable_ids": diagnosis["unreachable_ids"],
                }
                self._last_result = result
                return result

            last_error = diagnosis.get("message", f"No servos responded on {port}")

        result = {
            "status": "error",
            "message": last_error or "No servos responded on any detected serial port.",
            "dry_run": False,
            "selected_port": "",
            "candidates": ordered,
            "safety_policy": SAFETY_POLICY,
            "movement_commands_sent": False,
            "servos": [],
        }
        self._last_result = result
        return result

    def run_safe_servo_twitch(
        self,
        preferred_port: str = "",
        delta_raw: int = TWITCH_POLICY["default_delta_raw"],
        settle_ms: int = 250,
    ) -> Dict[str, Any]:
        bounded_delta = max(1, min(int(delta_raw), int(TWITCH_POLICY["max_delta_raw"])))
        bounded_settle_ms = max(100, min(int(settle_ms), 1000))
        candidates = self._scan_ports()
        ordered = self._order_candidates(candidates, preferred_port)
        if not ordered:
            result = {
                "status": "error",
                "message": "No serial ports detected on the host.",
                "selected_port": "",
                "candidates": [],
                "movement_commands_sent": False,
                "movements": [],
            }
            self._last_result = result
            return result

        last_error = ""
        for candidate in ordered:
            port = candidate["port"]
            try:
                result = self._twitch_port(port, bounded_delta, bounded_settle_ms)
            except Exception as exc:
                last_error = f"{port}: {exc}"
                logger.warning("Servo twitch failed for %s: %s", port, exc)
                continue

            if result.get("movements"):
                result.update(
                    {
                        "status": "ok",
                        "selected_port": port,
                        "selected_port_source": "preferred" if preferred_port and preferred_port.upper() == port.upper() else "auto_detected",
                        "candidates": ordered,
                        "movement_commands_sent": True,
                        "twitch_policy": TWITCH_POLICY,
                    }
                )
                self._last_result = result
                return result

            last_error = result.get("message", f"No twitch movement completed on {port}")

        result = {
            "status": "error",
            "message": last_error or "Servo twitch test failed on all detected ports.",
            "selected_port": "",
            "candidates": ordered,
            "movement_commands_sent": False,
            "movements": [],
        }
        self._last_result = result
        return result

    def _scan_ports(self) -> List[Dict[str, Any]]:
        try:
            from serial.tools.list_ports import comports
        except ImportError as exc:
            raise RuntimeError("pyserial is not installed in the active Python environment.") from exc

        candidates: List[Dict[str, Any]] = []
        for port in comports():
            description = port.description or port.name or port.device
            vid = f"{port.vid:04X}" if port.vid is not None else ""
            pid = f"{port.pid:04X}" if port.pid is not None else ""
            score = self._score_port(port.device, description, vid, pid)
            candidates.append(
                {
                    "port": port.device,
                    "description": description,
                    "vid": vid,
                    "pid": pid,
                    "vid_pid": f"{vid}:{pid}" if vid and pid else "",
                    "score": score,
                }
            )
        return candidates

    def _score_port(self, port: str, description: str, vid: str, pid: str) -> int:
        score = 0
        desc_upper = description.upper()
        if (vid, pid) in CH_USB_VID_PIDS:
            score += 100
        if "USB-ENHANCED-SERIAL" in desc_upper:
            score += 50
        if "CH34" in desc_upper:
            score += 25
        if port.upper().startswith("COM"):
            score += 5
        return score

    def _order_candidates(
        self,
        candidates: List[Dict[str, Any]],
        preferred_port: str,
    ) -> List[Dict[str, Any]]:
        preferred_port = preferred_port.upper().strip()
        ordered = sorted(
            candidates,
            key=lambda item: (
                0 if preferred_port and item["port"].upper() == preferred_port else 1,
                -int(item.get("score", 0)),
                item["port"],
            ),
        )
        return ordered

    def _diagnose_port(self, port: str) -> Dict[str, Any]:
        import scservo_sdk as scs

        port_handler = scs.PortHandler(port)
        packet_handler = scs.PacketHandler(0)

        if not port_handler.openPort():
            raise RuntimeError(f"Failed to open {port}")

        try:
            if not port_handler.setBaudRate(DIAGNOSTIC_BAUDRATE):
                raise RuntimeError(f"Failed to set baudrate {DIAGNOSTIC_BAUDRATE} on {port}")

            servos: List[Dict[str, Any]] = []
            unreachable_ids: List[int] = []
            for servo_id in EXPECTED_SERVO_IDS:
                model_number, comm, error = packet_handler.ping(port_handler, servo_id)
                if comm != scs.COMM_SUCCESS or error != 0:
                    unreachable_ids.append(servo_id)
                    continue

                if model_number not in EXPECTED_MODEL_NUMBERS:
                    logger.warning("Unexpected model number on %s id=%s: %s", port, servo_id, model_number)

                servo_info = {
                    "id": servo_id,
                    "model_number": model_number,
                    "reachable": True,
                }
                for key, (address, length, decode) in READ_ONLY_REGISTER_MAP.items():
                    servo_info[key] = self._read_register(
                        packet_handler,
                        port_handler,
                        servo_id,
                        address,
                        length,
                        decode,
                    )

                if isinstance(servo_info.get("present_voltage"), int):
                    servo_info["present_voltage_v"] = round(servo_info["present_voltage"] / 10.0, 2)

                servos.append(servo_info)

            return {
                "message": f"Read-only diagnostic completed on {port}",
                "servos": servos,
                "unreachable_ids": unreachable_ids,
            }
        finally:
            try:
                port_handler.closePort()
            except Exception:
                logger.debug("Failed to close %s cleanly", port, exc_info=True)
            packet_handler = None
            port_handler = None
            gc.collect()
            time.sleep(0.15)

    def _twitch_port(self, port: str, delta_raw: int, settle_ms: int) -> Dict[str, Any]:
        import scservo_sdk as scs

        port_handler = scs.PortHandler(port)
        packet_handler = scs.PacketHandler(0)

        if not port_handler.openPort():
            raise RuntimeError(f"Failed to open {port}")

        try:
            if not port_handler.setBaudRate(DIAGNOSTIC_BAUDRATE):
                raise RuntimeError(f"Failed to set baudrate {DIAGNOSTIC_BAUDRATE} on {port}")

            movements: List[Dict[str, Any]] = []
            logs: List[str] = []
            for servo_id in EXPECTED_SERVO_IDS:
                model_number, comm, error = packet_handler.ping(port_handler, servo_id)
                if comm != scs.COMM_SUCCESS or error != 0:
                    continue

                original_position = self._read_register(packet_handler, port_handler, servo_id, 56, 2, "u16")
                if original_position is None:
                    raise RuntimeError(f"Failed to read present position for servo {servo_id}")

                original_torque = self._read_register(packet_handler, port_handler, servo_id, 40, 1, "u8")
                direction = delta_raw if original_position <= (4095 - delta_raw - 32) else -delta_raw
                target_position = max(0, min(4095, int(original_position) + direction))

                self._write_register(packet_handler, port_handler, servo_id, 41, 1, TWITCH_POLICY["default_acceleration_raw"])
                self._write_register(packet_handler, port_handler, servo_id, 46, 2, TWITCH_POLICY["default_goal_velocity_raw"])
                if int(original_torque or 0) == 0:
                    self._write_register(packet_handler, port_handler, servo_id, 40, 1, 1)
                    time.sleep(0.05)

                self._write_register(packet_handler, port_handler, servo_id, 42, 2, target_position)
                time.sleep(settle_ms / 1000.0)
                moved_position = self._read_register(packet_handler, port_handler, servo_id, 56, 2, "u16")

                self._write_register(packet_handler, port_handler, servo_id, 42, 2, int(original_position))
                time.sleep(settle_ms / 1000.0)
                returned_position = self._read_register(packet_handler, port_handler, servo_id, 56, 2, "u16")

                if int(original_torque or 0) == 0:
                    self._write_register(packet_handler, port_handler, servo_id, 40, 1, 0)

                log_line = (
                    f"Servo {servo_id} moved to {target_position} "
                    f"(observed {moved_position}) and returned to {int(original_position)} "
                    f"(observed {returned_position})"
                )
                print(log_line)
                logs.append(log_line)
                movements.append(
                    {
                        "id": servo_id,
                        "model_number": model_number,
                        "original_position": int(original_position),
                        "target_position": int(target_position),
                        "moved_position": moved_position,
                        "returned_position": returned_position,
                        "delta_raw": int(target_position) - int(original_position),
                        "restored_torque_enable": int(original_torque or 0),
                    }
                )

            if not movements:
                return {
                    "message": f"No reachable servos were available for twitch on {port}",
                    "movements": [],
                    "logs": [],
                }

            return {
                "message": f"Completed bounded twitch test on {port}",
                "movements": movements,
                "logs": logs,
            }
        finally:
            try:
                port_handler.closePort()
            except Exception:
                logger.debug("Failed to close %s cleanly after twitch", port, exc_info=True)
            packet_handler = None
            port_handler = None
            gc.collect()
            time.sleep(0.15)

    def _read_register(
        self,
        packet_handler: Any,
        port_handler: Any,
        servo_id: int,
        address: int,
        length: int,
        decode: str,
    ) -> Optional[int]:
        if length == 1:
            value, comm, error = packet_handler.read1ByteTxRx(port_handler, servo_id, address)
        elif length == 2:
            value, comm, error = packet_handler.read2ByteTxRx(port_handler, servo_id, address)
        else:
            raise ValueError(f"Unsupported register length: {length}")

        import scservo_sdk as scs

        if comm != scs.COMM_SUCCESS or error != 0:
            return None
        if decode == "u8" or decode == "u16":
            return int(value)
        if decode == "s10":
            return int(_decode_sign_magnitude(int(value), 10))
        if decode == "s15":
            return int(_decode_sign_magnitude(int(value), 15))
        raise ValueError(f"Unsupported decode mode: {decode}")

    def _write_register(
        self,
        packet_handler: Any,
        port_handler: Any,
        servo_id: int,
        address: int,
        length: int,
        value: int,
    ) -> None:
        import scservo_sdk as scs

        if length == 1:
            comm, error = packet_handler.write1ByteTxRx(port_handler, servo_id, address, int(value))
        elif length == 2:
            comm, error = packet_handler.write2ByteTxRx(port_handler, servo_id, address, int(value))
        else:
            raise ValueError(f"Unsupported register length for write: {length}")

        if comm != scs.COMM_SUCCESS or error != 0:
            raise RuntimeError(
                f"Failed to write register {address} (len={length}) on servo {servo_id}: comm={comm} error={error}"
            )


def _print_json(data: Dict[str, Any]) -> None:
    print(json.dumps(data, indent=2, sort_keys=False))


def _main(argv: Optional[Iterable[str]] = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Host-side safe hardware diagnostics for KECY AI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    diagnose = subparsers.add_parser("diagnose", help="Run a read-only servo diagnostic.")
    diagnose.add_argument("--preferred-port", default="", help="Optional serial port to try first, e.g. COM4.")

    auto_config = subparsers.add_parser("auto-configure", help="Detect robot and persist host hardware config.")
    auto_config.add_argument("--preferred-port", default="", help="Optional serial port to try first, e.g. COM4.")
    auto_config.add_argument("--robot-type", default="so101_follower")
    auto_config.add_argument("--driver", default="feetech")

    scan = subparsers.add_parser("scan", help="List serial candidates without pinging servos.")
    scan.add_argument("--preferred-port", default="", help="Optional serial port to sort first.")

    twitch = subparsers.add_parser("twitch", help="Perform a tiny bounded servo motion test.")
    twitch.add_argument("--preferred-port", default="", help="Optional serial port to try first, e.g. COM4.")
    twitch.add_argument("--delta-raw", type=int, default=TWITCH_POLICY["default_delta_raw"])
    twitch.add_argument("--settle-ms", type=int, default=250)

    args = parser.parse_args(list(argv) if argv is not None else None)
    diagnostics = HardwareDiagnostics()

    if args.command == "scan":
        result = {
            "status": "ok",
            "dry_run": False,
            "candidates": diagnostics._order_candidates(diagnostics._scan_ports(), args.preferred_port),
            "movement_commands_sent": False,
            "safety_policy": SAFETY_POLICY,
        }
        _print_json(result)
        return 0

    if args.command == "auto-configure":
        result = diagnostics.auto_configure(
            preferred_port=args.preferred_port,
            robot_type=args.robot_type,
            driver=args.driver,
        )
        _print_json(result)
        return 0 if result.get("status") == "ok" else 1

    if args.command == "twitch":
        result = diagnostics.run_safe_servo_twitch(
            preferred_port=args.preferred_port,
            delta_raw=args.delta_raw,
            settle_ms=args.settle_ms,
        )
        _print_json(result)
        return 0 if result.get("status") == "ok" else 1

    result = diagnostics.run_safe_servo_scan(preferred_port=args.preferred_port)
    _print_json(result)
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(_main())
