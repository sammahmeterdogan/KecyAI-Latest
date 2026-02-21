"""
KECY AI — LeRobot Runtime API Server
HTTP server exposing verified LeRobot capabilities + telemetry SSE.

Uses ThreadingHTTPServer to support concurrent requests (SSE + regular).
"""
import json
import subprocess
import sys
import time
import urllib.parse
import glob
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path
# ConflictError is imported lazily along with TeleopManager

PORT = 8100

# ThreadingHTTPServer: handles each request in a new thread
# Required for SSE (long-lived connections) alongside regular requests
class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True



# Global Manager Instances (Lazy)
_teleop_manager = None
_calibration_manager = None
_preflight_manager = None
_calibration_admin = None
_hardware_config = None
_recording_manager = None
_training_manager = None
_motor_setup_manager = None

def get_manager():
    global _teleop_manager
    if _teleop_manager is None:
        try:
            print("INFO: Initializing TeleopManager...")
            from teleop.TeleopManager import TeleopManager
            _teleop_manager = TeleopManager()
            print("INFO: TeleopManager initialized successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize TeleopManager: {e}")
            import traceback
            traceback.print_exc()
            raise e
    return _teleop_manager


def get_calibration_manager():
    global _calibration_manager
    if _calibration_manager is None:
        try:
            print("INFO: Initializing CalibrationManager...")
            from calibration.CalibrationManager import CalibrationManager
            _calibration_manager = CalibrationManager()
            print("INFO: CalibrationManager initialized successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize CalibrationManager: {e}")
            import traceback
            traceback.print_exc()
            raise e
    return _calibration_manager


def get_hardware_config():
    global _hardware_config
    if _hardware_config is None:
        try:
            print("INFO: Initializing HardwareConfig...")
            from hardware_check import HardwareConfig
            _hardware_config = HardwareConfig()
            print(f"INFO: HardwareConfig initialized: {_hardware_config.get()}")
        except Exception as e:
            print(f"ERROR: Failed to initialize HardwareConfig: {e}")
            raise e
    return _hardware_config


def get_preflight_manager():
    global _preflight_manager
    if _preflight_manager is None:
        try:
            print("INFO: Initializing PreflightManager...")
            from hardware_check import PreflightManager
            _preflight_manager = PreflightManager(hardware_config=get_hardware_config())
            print("INFO: PreflightManager initialized successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize PreflightManager: {e}")
            raise e
    return _preflight_manager


def get_calibration_admin():
    global _calibration_admin
    if _calibration_admin is None:
        try:
            print("INFO: Initializing CalibrationAdmin...")
            from calibration.CalibrationAdmin import CalibrationAdmin
            _calibration_admin = CalibrationAdmin()
            print("INFO: CalibrationAdmin initialized successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize CalibrationAdmin: {e}")
            raise e
    return _calibration_admin


def get_recording_manager():
    global _recording_manager
    if _recording_manager is None:
        try:
            print("INFO: Initializing RecordingManager...")
            from recording.RecordingManager import RecordingManager
            _recording_manager = RecordingManager()
            print("INFO: RecordingManager initialized successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize RecordingManager: {e}")
            import traceback
            traceback.print_exc()
            raise e
    return _recording_manager


def get_training_manager():
    global _training_manager
    if _training_manager is None:
        try:
            print("INFO: Initializing TrainingManager...")
            from training.TrainingManager import TrainingManager
            _training_manager = TrainingManager()
            print("INFO: TrainingManager initialized successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize TrainingManager: {e}")
            import traceback
            traceback.print_exc()
            raise e
    return _training_manager


def get_motor_setup_manager():
    global _motor_setup_manager
    if _motor_setup_manager is None:
        try:
            print("INFO: Initializing MotorSetupManager...")
            from motors.MotorSetupManager import MotorSetupManager
            _motor_setup_manager = MotorSetupManager()
            print("INFO: MotorSetupManager initialized successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize MotorSetupManager: {e}")
            import traceback
            traceback.print_exc()
            raise e
    return _motor_setup_manager


class RuntimeHandler(BaseHTTPRequestHandler):
    """Handles runtime API requests."""

    def _respond(self, status: int, body: dict) -> None:
        try:
            response_body = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(response_body)
        except Exception as e:
            print(f"ERROR: Failed to send response: {e}")

    def _read_body(self) -> dict:
        """
        Read and parse JSON request body.
        Robust to missing Content-Length, empty bodies, and non-JSON content types.
        Raises ValueError with clear message on parse failures.
        """
        try:
            content_len = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            content_len = 0

        if content_len == 0:
            return {}

        raw = self.rfile.read(content_len)
        if not raw or not raw.strip():
            return {}

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON body: {e}")

        if not isinstance(parsed, dict):
            raise ValueError(f"Request body must be a JSON object, got {type(parsed).__name__}")

        return parsed

    @staticmethod
    def _enumerate_serial_ports() -> list[str]:
        patterns = (
            "/dev/ttyUSB*",
            "/dev/ttyACM*",
            "/dev/tty.usbmodem*",
            "/dev/tty.usbserial*",
        )
        ports = []
        for pattern in patterns:
            ports.extend(glob.glob(pattern))
        return sorted(set(ports))

    @staticmethod
    def _extract_ports_from_text(text: str) -> list[str]:
        if not text:
            return []
        matches = re.findall(r"/dev/[A-Za-z0-9._-]+", text)
        return sorted(set(matches))

    def _scan_motorbus_ports(self) -> dict:
        """
        Try the official `lerobot-find-port` helper first and capture console output.
        Fallback to direct serial enumeration when the helper is unavailable or returns no ports.
        """
        stdout = ""
        stderr = ""
        exit_code = None

        try:
            proc = subprocess.Popen(
                ["lerobot-find-port"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                stdout, stderr = proc.communicate(input="\n", timeout=12)
                exit_code = proc.returncode
            except subprocess.TimeoutExpired:
                proc.kill()
                timeout_out, timeout_err = proc.communicate()
                stdout = timeout_out or ""
                stderr = timeout_err or ""
                exit_code = -1
        except FileNotFoundError:
            fallback_ports = self._enumerate_serial_ports()
            return {
                "status": "warning" if fallback_ports else "empty",
                "ports": fallback_ports,
                "source": "fallback_enumeration",
                "message": "lerobot-find-port is not available in runtime. Used /dev serial enumeration fallback.",
                "stdout": [],
                "stderr": [],
                "exit_code": None,
            }
        except Exception as e:
            fallback_ports = self._enumerate_serial_ports()
            return {
                "status": "warning" if fallback_ports else "error",
                "ports": fallback_ports,
                "source": "fallback_enumeration",
                "message": f"Failed to run lerobot-find-port: {e}",
                "stdout": [],
                "stderr": [],
                "exit_code": None,
            }

        parsed_ports = self._extract_ports_from_text(stdout)
        fallback_ports = self._enumerate_serial_ports()
        ports = parsed_ports if parsed_ports else fallback_ports

        if ports:
            if parsed_ports:
                message = "Ports detected via lerobot-find-port output."
                source = "lerobot_find_port"
            else:
                message = "No parsable ports in lerobot-find-port output. Used /dev serial enumeration fallback."
                source = "fallback_enumeration"
            status = "ok"
        else:
            message = "No serial ports detected. Connect MotorBus and press refresh."
            source = "lerobot_find_port"
            status = "empty"

        return {
            "status": status,
            "ports": ports,
            "source": source,
            "message": message,
            "stdout": [line for line in (stdout or "").splitlines() if line.strip()][-120:],
            "stderr": [line for line in (stderr or "").splitlines() if line.strip()][-60:],
            "exit_code": exit_code,
        }

    def do_GET(self) -> None:
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        query = urllib.parse.parse_qs(parsed_path.query)

        if path == "/health":
            # Health check must pass even if LeRobot is broken
            self._respond(200, {"status": "ok", "service": "kecyai-lerobot-runtime"})

        elif path == "/capabilities":
            base = Path("/lerobot")
            caps = []
            if (Path("/app/upstream/lerobot/src/lerobot/scripts/lerobot_teleoperate.py")).exists() or \
               (Path("/lerobot/lerobot/scripts/lerobot_teleoperate.py")).exists() or \
               (Path("/lerobot/src/lerobot/scripts/lerobot_teleoperate.py")).exists():
                caps.append({
                    "id": "teleop",
                    "title": "Teleoperation",
                    "route": "/kecy/platform/teleop",
                    "runnable": True,
                    "source_links": ["src/lerobot/scripts/lerobot_teleoperate.py"],
                })
            self._respond(200, {"capabilities": caps})

        elif path == "/version":
            try:
                import lerobot
                version = getattr(lerobot, "__version__", "unknown")
            except ImportError:
                version = "not installed"

            git_sha = "unknown"
            try:
                git_sha = subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd="/lerobot", text=True
                ).strip()
            except Exception:
                pass

            self._respond(200, {
                "lerobot_version": version,
                "git_sha": git_sha,
                "backend": "kecyai-runtime",
                "python": sys.version.split()[0],
            })

        elif path == "/teleop/status":
            try:
                self._respond(200, get_manager().get_status())
            except Exception as e:
                self._respond(503, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Manager unavailable: {str(e)}",
                })

        elif path == "/teleop/logs":
            try:
                try:
                    tail = int(query.get("tail", [200])[0])
                except ValueError:
                    tail = 200
                logs = get_manager().get_logs(tail)
                self._respond(200, {"logs": logs})
            except Exception as e:
                self._respond(503, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Manager unavailable: {str(e)}",
                })

        elif path == "/teleop/joints":
            try:
                joints = get_manager().get_joint_state()
                self._respond(200, {"joints": joints})
            except Exception as e:
                self._respond(503, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Manager unavailable: {str(e)}",
                })

        elif path == "/teleop/telemetry/stream":
            self._handle_telemetry_stream()

        # ─── Admin / Config (GET) ───

        elif path == "/admin/ports/scan":
            try:
                self._respond(200, self._scan_motorbus_ports())
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to scan ports: {str(e)}",
                })

        elif path == "/admin/config":
            try:
                self._respond(200, get_hardware_config().get())
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to read config: {str(e)}",
                })

        # ─── Calibration (GET) ───

        elif path == "/admin/motors/setup/status":
            try:
                self._respond(200, get_motor_setup_manager().get_status())
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to read motor setup status: {str(e)}",
                })

        elif path == "/admin/motors/setup/logs":
            try:
                since = query.get("since", [None])[0]
                tail = query.get("tail", [200])[0]

                since_val = None
                if since is not None and str(since).strip() != "":
                    since_val = int(since)
                tail_val = int(tail) if tail is not None else 200

                self._respond(200, get_motor_setup_manager().get_logs(since=since_val, tail=tail_val))
            except ValueError:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": "Query params 'since' and 'tail' must be integers.",
                })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to read motor setup logs: {str(e)}",
                })

        elif path == "/calibration/status":
            try:
                self._respond(200, get_calibration_manager().get_status())
            except Exception as e:
                self._respond(503, {
                    "code": "RUNTIME_ERROR",
                    "message": f"CalibrationManager unavailable: {str(e)}",
                    "details": [],
                })

        # ─── Admin / Preflight (GET) ───

        elif path == "/admin/preflight":
            try:
                config = {}
                try:
                    config["robot_type"] = query.get("robot_type", ["so101_follower"])[0]
                except:
                    pass
                result = get_preflight_manager().run_checks(config if config else None)
                self._respond(200, result)
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        # ─── Admin / Calibration (GET) ───

        elif path == "/admin/calibration/list":
            try:
                artifacts = get_calibration_admin().list_artifacts()
                self._respond(200, {"artifacts": artifacts})
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/admin/calibration/latest":
            try:
                rtype = query.get("robot_type", ["so101_follower"])[0]
                artifact = get_calibration_admin().get_latest_artifact(rtype)
                if artifact:
                    self._respond(200, artifact)
                else:
                    self._respond(404, {
                        "code": "NOT_FOUND",
                        "message": "No artifacts found for this robot type",
                    })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/admin/calibration/selected":
            try:
                selected = get_calibration_admin().get_selected_artifact()
                if selected:
                    self._respond(200, selected)
                else:
                    self._respond(404, {
                        "code": "NOT_FOUND",
                        "message": "No calibration artifact selected",
                    })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        # ─── Recording (GET) ───

        elif path == "/recording/status":
            try:
                self._respond(200, get_recording_manager().get_status())
            except Exception as e:
                self._respond(503, {
                    "code": "RUNTIME_ERROR",
                    "message": f"RecordingManager unavailable: {str(e)}",
                })

        elif path == "/recording/datasets":
            try:
                datasets = get_recording_manager().list_datasets()
                self._respond(200, {"datasets": datasets})
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        # ─── Training (GET) ───

        elif path == "/train/status":
            try:
                self._respond(200, get_training_manager().get_status())
            except Exception as e:
                self._respond(503, {
                    "code": "RUNTIME_ERROR",
                    "message": f"TrainingManager unavailable: {str(e)}",
                })

        elif path == "/train/artifacts":
            try:
                artifacts = get_training_manager().list_artifacts()
                self._respond(200, {"artifacts": artifacts})
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/train/logs/stream":
            self._handle_training_log_stream()

        else:
            self._respond(404, {
                "code": "NOT_FOUND",
                "message": f"Unknown endpoint: {path}",
            })

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path

        if path == "/teleop/start":
            try:
                # Conflict guard: calibration must not be running
                try:
                    if get_calibration_manager().is_running():
                        self._respond(409, {
                            "code": "CONFLICT",
                            "message": "Calibration session is active. Stop calibration before starting teleop.",
                            "details": [],
                        })
                        return
                except Exception:
                    pass  # CalibrationManager not init'd yet → no conflict

                # Live-mode guard: require calibration artifact when NOT in dry-run
                try:
                    hw = get_hardware_config().get()
                    if not hw.get("dry_run", True):
                        selected = get_calibration_admin().get_selected_artifact()
                        if not selected:
                            self._respond(412, {
                                "code": "PRECONDITION_FAILED",
                                "message": "No calibration artifact selected. Run calibration and select an artifact before starting teleop in hardware mode.",
                                "details": ["POST /admin/calibration/select with {\"artifactId\":\"...\"}"],
                            })
                            return
                except Exception:
                    pass  # HardwareConfig/CalibrationAdmin not init'd → skip guard (dry-run)

                data = self._read_body()
                result = get_manager().start(data)
                self._respond(200, result)
            except ValueError as e:
                # Validation errors: missing fields, invalid types, bad JSON
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except Exception as e:
                # Identify ConflictError by class name to avoid import-order
                # issues. ConflictError lives in teleop.TeleopManager and is
                # guaranteed to be loaded because get_manager() was already called.
                exc_name = type(e).__name__
                if exc_name == "ConflictError":
                    self._respond(409, {
                        "code": "CONFLICT",
                        "message": str(e),
                        "currentStatus": getattr(e, "current_status", {}),
                    })
                elif isinstance(e, RuntimeError):
                    self._respond(500, {
                        "code": "RUNTIME_ERROR",
                        "message": str(e),
                    })
                else:
                    self._respond(500, {
                        "code": "INTERNAL_ERROR",
                        "message": f"Internal error: {str(e)}",
                    })

        elif path == "/teleop/stop":
            try:
                result = get_manager().stop()
                self._respond(200, result)
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to stop: {str(e)}",
                })

        elif path == "/teleop/joints/set":
            try:
                data = self._read_body()
                joint_id = data.get("jointId")
                value = data.get("value")
                if joint_id is None or value is None:
                    self._respond(400, {
                        "code": "VALIDATION_ERROR",
                        "message": "Missing required fields: 'jointId' and 'value'",
                    })
                    return
                get_manager().set_joint(joint_id, float(value))
                self._respond(200, {"status": "ok"})
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                })
            except RuntimeError as e:
                self._respond(409, {
                    "code": "PRECONDITION_FAILED",
                    "message": str(e),
                })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to set joint: {str(e)}",
                })

        elif path == "/teleop/command":
            try:
                data = self._read_body()

                # Validate required 'joints' field
                if "joints" not in data:
                    self._respond(400, {
                        "code": "VALIDATION_ERROR",
                        "message": "Missing required field: 'joints'",
                        "details": [
                            "Expected: {\"mode\":\"manual\",\"joints\":[{\"id\":\"shoulder_pan\",\"position\":0.2}, ...]}"
                        ],
                    })
                    return

                joints_list = data.get("joints")
                if not isinstance(joints_list, list):
                    self._respond(400, {
                        "code": "VALIDATION_ERROR",
                        "message": "'joints' must be a JSON array",
                        "details": [f"Got type: {type(joints_list).__name__}"],
                    })
                    return

                result = get_manager().send_command(joints_list)
                self._respond(200, result)

            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except RuntimeError as e:
                self._respond(409, {
                    "code": "PRECONDITION_FAILED",
                    "message": str(e),
                })
            except Exception as e:
                self._respond(500, {
                    "code": "INTERNAL_ERROR",
                    "message": f"Failed to send command: {str(e)}",
                })

        elif path == "/teleop/pose/home":
            try:
                self._respond(200, get_manager().home_pose())
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/teleop/pose/ready":
            try:
                self._respond(200, get_manager().ready_pose())
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/teleop/gripper/open":
            try:
                self._respond(200, get_manager().gripper_open())
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/teleop/gripper/close":
            try:
                self._respond(200, get_manager().gripper_close())
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/teleop/estop/on":
            try:
                result = get_manager().estop_on()
                self._respond(200, result)
            except RuntimeError as e:
                self._respond(409, {
                    "code": "PRECONDITION_FAILED",
                    "message": str(e),
                })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        elif path == "/teleop/estop/off":
            try:
                result = get_manager().estop_off()
                self._respond(200, result)
            except RuntimeError as e:
                self._respond(409, {
                    "code": "PRECONDITION_FAILED",
                    "message": str(e),
                })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        # ─── Admin / Preflight (POST) ───

        elif path == "/admin/calibration/select":
            try:
                data = self._read_body()
                if "artifactId" not in data:
                    self._respond(400, {
                        "code": "VALIDATION_ERROR",
                        "message": "Missing 'artifactId'",
                    })
                    return
                
                result = get_calibration_admin().select_artifact(data["artifactId"])
                self._respond(200, result)
            except FileNotFoundError:
                self._respond(404, {
                    "code": "NOT_FOUND",
                    "message": "Artifact not found",
                })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": str(e),
                })

        # ─── Admin / Config (POST) ───

        elif path == "/admin/config":
            try:
                data = self._read_body()
                if not data:
                    self._respond(400, {
                        "code": "VALIDATION_ERROR",
                        "message": "Request body is required. Expected: {\"serial_port\":\"...\", \"robot_type\":\"...\", \"driver\":\"...\", \"dry_run\":true/false}",
                    })
                    return
                result = get_hardware_config().update(data)
                self._respond(200, result)
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to update config: {str(e)}",
                })

        # ─── Admin / Preflight (POST kept for legacy, but GET is primary) ───

        elif path == "/admin/motors/setup/start":
            try:
                data = self._read_body()

                try:
                    if get_calibration_manager().is_running():
                        self._respond(409, {
                            "code": "CONFLICT",
                            "message": "Calibration session is active. Stop calibration before motor setup.",
                            "details": [],
                        })
                        return
                except Exception:
                    pass

                try:
                    teleop_status = get_manager().get_status()
                    if teleop_status.get("state") in ("running", "starting"):
                        self._respond(409, {
                            "code": "CONFLICT",
                            "message": "Teleop session is active. Stop teleop before motor setup.",
                            "details": [],
                            "currentStatus": teleop_status,
                        })
                        return
                except Exception:
                    pass

                result = get_motor_setup_manager().start(data)
                self._respond(200, result)
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except Exception as e:
                if type(e).__name__ == "ConflictError":
                    self._respond(409, {
                        "code": "CONFLICT",
                        "message": str(e),
                        "currentStatus": getattr(e, "current_status", {}),
                    })
                else:
                    self._respond(500, {
                        "code": "RUNTIME_ERROR",
                        "message": str(e),
                    })

        elif path == "/admin/motors/setup/enter":
            try:
                data = self._read_body()
                times = int(data.get("times", 1))
                result = get_motor_setup_manager().send_enter(times=times)
                self._respond(200, result)
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except RuntimeError as e:
                self._respond(409, {
                    "code": "PRECONDITION_FAILED",
                    "message": str(e),
                    "details": [],
                })
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to send Enter: {str(e)}",
                    "details": [],
                })

        elif path == "/admin/motors/setup/stop":
            try:
                result = get_motor_setup_manager().stop()
                self._respond(200, result)
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to stop motor setup: {str(e)}",
                    "details": [],
                })

        elif path == "/admin/preflight":
            try:
                # POST to preflight allows passing explicit config overrides
                data = self._read_body()
                result = get_preflight_manager().run_checks(data if data else None)
                self._respond(200, result)
            except Exception as e:
                self._respond(500, {
                     "code": "RUNTIME_ERROR",
                     "message": str(e),
                })



        # ─── Calibration (POST) ───

        elif path == "/calibration/start":
            try:
                data = self._read_body()
                # Check teleop conflict
                teleop_running = False
                try:
                    teleop_running = get_manager().adapter.is_connected()
                except Exception:
                    pass

                result = get_calibration_manager().start(data, teleop_running=teleop_running)
                self._respond(200, result)
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except Exception as e:
                exc_name = type(e).__name__
                if exc_name == "CalibrationConflictError":
                    self._respond(409, {
                        "code": "CONFLICT",
                        "message": str(e),
                        "details": [],
                    })
                elif isinstance(e, RuntimeError):
                    self._respond(500, {
                        "code": "RUNTIME_ERROR",
                        "message": str(e),
                        "details": [],
                    })
                else:
                    self._respond(500, {
                        "code": "INTERNAL_ERROR",
                        "message": f"Internal error: {str(e)}",
                        "details": [],
                    })

        elif path == "/calibration/step":
            try:
                data = self._read_body()
                # Check E-STOP
                estop_active = False
                try:
                    estop_active = get_manager().adapter.is_estop_active()
                except Exception:
                    pass

                result = get_calibration_manager().step(data, estop_active=estop_active)
                self._respond(200, result)
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except RuntimeError as e:
                msg = str(e)
                if "E-STOP" in msg:
                    self._respond(409, {
                        "code": "PRECONDITION_FAILED",
                        "message": msg,
                        "details": [],
                    })
                else:
                    self._respond(409, {
                        "code": "PRECONDITION_FAILED",
                        "message": msg,
                        "details": [],
                    })
            except Exception as e:
                self._respond(500, {
                    "code": "INTERNAL_ERROR",
                    "message": f"Calibration step failed: {str(e)}",
                    "details": [],
                })

        elif path == "/calibration/stop":
            try:
                result = get_calibration_manager().stop()
                self._respond(200, result)
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to stop calibration: {str(e)}",
                    "details": [],
                })

        # ─── Recording (POST) ───

        elif path == "/recording/start":
            try:
                # Conflict: calibration must not be active
                try:
                    cs = get_calibration_manager().get_status()
                    if cs.get("state") not in (None, "idle", "completed"):
                        self._respond(409, {
                            "code": "CONFLICT",
                            "message": "Calibration session is active. Stop calibration before starting recording.",
                            "details": [],
                            "currentStatus": cs,
                        })
                        return
                except Exception:
                    pass

                # Conflict: teleop blocks recording unless allow_teleop flag
                data_peek = self._read_body()
                allow_teleop = data_peek.get("allow_teleop", False)
                if not allow_teleop:
                    try:
                        ts = get_manager().get_status()
                        if ts.get("status") == "running":
                            self._respond(409, {
                                "code": "CONFLICT",
                                "message": "Teleop is active. Stop teleop or set allow_teleop=true to record during teleop.",
                                "details": [],
                                "currentStatus": ts,
                            })
                            return
                    except Exception:
                        pass

                # Conflict: training must not be active
                try:
                    ts = get_training_manager().get_status()
                    if ts.get("state") == "training":
                        self._respond(409, {
                            "code": "CONFLICT",
                            "message": "Training job is active. Stop training before starting recording.",
                            "details": [],
                            "currentStatus": ts,
                        })
                        return
                except Exception:
                    pass

                result = get_recording_manager().start(data_peek)
                self._respond(200, result)
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except Exception as e:
                exc_name = type(e).__name__
                if exc_name == "ConflictError":
                    self._respond(409, {
                        "code": "CONFLICT",
                        "message": str(e),
                        "currentStatus": getattr(e, "current_status", {}),
                    })
                else:
                    self._respond(500, {
                        "code": "RUNTIME_ERROR",
                        "message": str(e),
                        "details": [],
                    })

        elif path == "/recording/stop":
            try:
                result = get_recording_manager().stop()
                self._respond(200, result)
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to stop recording: {str(e)}",
                    "details": [],
                })

        # ─── Training (POST) ───

        elif path == "/train/start":
            try:
                # Conflict: calibration must not be active
                try:
                    cs = get_calibration_manager().get_status()
                    if cs.get("state") not in (None, "idle", "completed"):
                        self._respond(409, {
                            "code": "CONFLICT",
                            "message": "Calibration session is active. Stop calibration before starting training.",
                            "details": [],
                            "currentStatus": cs,
                        })
                        return
                except Exception:
                    pass

                # Conflict: recording must not be active
                try:
                    rs = get_recording_manager().get_status()
                    if rs.get("state") == "recording":
                        self._respond(409, {
                            "code": "CONFLICT",
                            "message": "Recording session is active. Stop recording before starting training.",
                            "details": [],
                            "currentStatus": rs,
                        })
                        return
                except Exception:
                    pass

                data = self._read_body()
                result = get_training_manager().start(data)
                self._respond(200, result)
            except ValueError as e:
                self._respond(400, {
                    "code": "VALIDATION_ERROR",
                    "message": str(e),
                    "details": [],
                })
            except Exception as e:
                exc_name = type(e).__name__
                if exc_name == "ConflictError":
                    self._respond(409, {
                        "code": "CONFLICT",
                        "message": str(e),
                        "currentStatus": getattr(e, "current_status", {}),
                    })
                else:
                    self._respond(500, {
                        "code": "RUNTIME_ERROR",
                        "message": str(e),
                        "details": [],
                    })

        elif path == "/train/stop":
            try:
                result = get_training_manager().stop()
                self._respond(200, result)
            except Exception as e:
                self._respond(500, {
                    "code": "RUNTIME_ERROR",
                    "message": f"Failed to stop training: {str(e)}",
                    "details": [],
                })

        else:
            self._respond(404, {
                "code": "NOT_FOUND",
                "message": f"Unknown endpoint: {path}",
            })

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ───────── SSE Telemetry Stream ─────────

    def _handle_telemetry_stream(self):
        """
        Server-Sent Events endpoint.
        Streams JSON telemetry at ~10Hz while the connection is alive.
        """
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        except Exception:
            return

        try:
            while True:
                try:
                    telemetry = get_manager().get_telemetry()
                except Exception:
                    telemetry = {"status": "error", "error": "Manager unavailable"}
                
                data_line = json.dumps(telemetry)
                self.wfile.write(f"data: {data_line}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.1)  # ~10Hz
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    # ───────── SSE Training Log Stream ─────────

    def _handle_training_log_stream(self):
        """
        Server-Sent Events endpoint for training log lines.
        Streams new log lines at ~2Hz while training is active.
        """
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        except Exception:
            return

        cursor = 0
        try:
            while True:
                try:
                    log_data = get_training_manager().get_logs(since_cursor=cursor)
                    cursor = log_data.get("cursor", cursor)
                    state = log_data.get("state", "idle")
                except Exception:
                    log_data = {"logs": [], "cursor": cursor, "state": "error"}
                    state = "error"

                data_line = json.dumps(log_data)
                self.wfile.write(f"data: {data_line}\n\n".encode())
                self.wfile.flush()

                # Stop streaming if training is done
                if state in ("completed", "stopped", "failed", "idle"):
                    # Send one final event, then close
                    time.sleep(0.5)
                    final = json.dumps({"logs": [], "cursor": cursor, "state": state, "done": True})
                    self.wfile.write(f"data: {final}\n\n".encode())
                    self.wfile.flush()
                    break

                time.sleep(0.5)  # ~2Hz
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def log_message(self, format, *args):
        pass


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), RuntimeHandler)
    print(f"KECY LeRobot Runtime listening on :{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


def bootstrap_check() -> None:
    """
    Deterministic startup check.
    Ensures LeRobot is importable and prints environmental info.
    Exit 1 if critical dependencies are missing.
    """
    print("-" * 60)
    print("KECY RUNTIME BOOTSTRAP")
    print("-" * 60)
    print(f"Python: {sys.version}")
    print(f"Platform: {sys.platform}")
    print("-" * 60)
    
    # 1. Print sys.path to debug import resolution
    print("sys.path:")
    for p in sys.path:
        print(f"  - {p}")
    print("-" * 60)

    # 2. Try importing lerobot
    try:
        import lerobot
        print(f"SUCCESS: 'lerobot' module found.")
        print(f"File: {lerobot.__file__}")
        print(f"Version: {getattr(lerobot, '__version__', 'unknown')}")
        
    except ImportError as e:
        print("CRITICAL ERROR: Could not import 'lerobot'.")
        print(f"Reason: {e}")
        # Don't exit here, allows server to start and report error via API
        print("WARNING: Server will start but Teleop features may fail.")

    print("-" * 60)
    print("Bootstrap: OK")
    print("-" * 60)


if __name__ == "__main__":
    bootstrap_check()
    main()
