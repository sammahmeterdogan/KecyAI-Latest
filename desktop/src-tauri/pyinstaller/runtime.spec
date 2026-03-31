# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_dynamic_libs, collect_submodules

repo_root = Path.cwd()
runtime_app = repo_root / "runtime" / "app"
lerobot_src = repo_root / "runtime" / "upstream" / "lerobot" / "src"

hiddenimports = [
    "kecyai_local",
    "server",
    "runtime_exec",
    "hardware_check",
    "hardware_diagnostics",
    "fastapi",
    "starlette",
    "uvicorn",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "lerobot",
    "lerobot.scripts",
    "lerobot.scripts.lerobot_find_port",
    "lerobot.scripts.lerobot_teleoperate",
    "lerobot.scripts.lerobot_setup_motors",
    "serial",
    "serial.tools",
    "serial.tools.list_ports",
]

datas = []
binaries = []

for package_name in ("lerobot", "scservo_sdk", "serial"):
    try:
        package_datas, package_binaries, package_hiddenimports = collect_all(package_name)
        datas += package_datas
        binaries += package_binaries
        hiddenimports += package_hiddenimports
    except Exception:
        pass

for package_name in ("calibration", "motors", "recording", "teleop", "training", "lerobot", "fastapi", "starlette", "uvicorn"):
    hiddenimports += collect_submodules(package_name)

datas += collect_data_files("lerobot")
for package_name in ("torch", "torchvision", "numpy", "av", "cv2"):
    try:
        binaries += collect_dynamic_libs(package_name)
    except Exception:
        pass

a = Analysis(
    [str(runtime_app / "runtime_entry.py")],
    pathex=[str(runtime_app), str(lerobot_src)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="kecyai-runtime",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
