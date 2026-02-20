import os
import re
import json
import time
import shutil
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any

import requests
from fastmcp import FastMCP

# -----------------------------------------------------------------------------
# Config / Guards
# -----------------------------------------------------------------------------
REPO_ROOT = Path(os.environ.get("REPO_ROOT", os.getcwd())).resolve()

WRITE_ENABLED = os.environ.get("MCP_WRITE_ENABLED", "false").lower() == "true"
RUN_ENABLED = os.environ.get("MCP_RUN_ENABLED", "false").lower() == "true"

# conservative allowlist: extend as needed
ALLOWED_CMD_PREFIXES = [
    "git",
    "docker",
    "docker-compose",
    "mvn",
    "npm",
    "pnpm",
    "node",
]

DISALLOWED_SUBSTRINGS = [
    " rm ", " del ", " rmdir ", " format ", " mkfs", " shutdown", " reboot",
]

def _safe_resolve(rel_path: str) -> Path:
    p = (REPO_ROOT / rel_path).resolve()
    if REPO_ROOT not in p.parents and p != REPO_ROOT:
        raise ValueError(f"path_outside_repo: {rel_path}")
    return p

def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

def _check_write() -> None:
    if not WRITE_ENABLED:
        raise PermissionError("write_disabled: set MCP_WRITE_ENABLED=true in mcp_config.json env")

def _check_run() -> None:
    if not RUN_ENABLED:
        raise PermissionError("run_disabled: set MCP_RUN_ENABLED=true in mcp_config.json env")

def _validate_command(cmd: List[str]) -> None:
    if not cmd:
        raise ValueError("empty_command")
    joined = " ".join(cmd).lower()
    for bad in DISALLOWED_SUBSTRINGS:
        if bad.strip() in joined:
            raise PermissionError(f"command_blocked: contains '{bad.strip()}'")
    if cmd[0] not in ALLOWED_CMD_PREFIXES:
        raise PermissionError(f"command_not_allowlisted: {cmd[0]}")

# -----------------------------------------------------------------------------
# MCP Server
# -----------------------------------------------------------------------------
mcp = FastMCP("kecy-dev")

@mcp.tool
def repo_info() -> Dict[str, Any]:
    """Return repo root and feature flags."""
    return {
        "repo_root": str(REPO_ROOT),
        "write_enabled": WRITE_ENABLED,
        "run_enabled": RUN_ENABLED,
    }

@mcp.tool
def repo_tree(max_depth: int = 4, include_hidden: bool = False) -> str:
    """Return a simple directory tree."""
    max_depth = max(1, min(max_depth, 12))
    lines: List[str] = [str(REPO_ROOT)]
    root_depth = len(REPO_ROOT.parts)

    for path in sorted(REPO_ROOT.rglob("*")):
        if not include_hidden and any(part.startswith(".") for part in path.relative_to(REPO_ROOT).parts):
            continue
        depth = len(path.parts) - root_depth
        if depth > max_depth:
            continue
        prefix = "  " * depth
        name = path.name + ("/" if path.is_dir() else "")
        lines.append(f"{prefix}{name}")
    return "\n".join(lines)

@mcp.tool
def read_text(path: str, max_bytes: int = 200_000) -> str:
    """Read a UTF-8 text file from repo (bounded)."""
    p = _safe_resolve(path)
    data = p.read_bytes()
    if len(data) > max_bytes:
        data = data[:max_bytes]
    return data.decode("utf-8", errors="replace")

@mcp.tool
def grep(pattern: str, glob: str = "**/*", max_matches: int = 100) -> List[Dict[str, Any]]:
    """Search text files for a regex pattern."""
    rx = re.compile(pattern)
    results: List[Dict[str, Any]] = []
    for p in REPO_ROOT.glob(glob):
        if p.is_dir():
            continue
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".jar"}:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if rx.search(line):
                results.append({"path": str(p.relative_to(REPO_ROOT)), "line": i, "text": line[:400]})
                if len(results) >= max_matches:
                    return results
    return results

@mcp.tool
def replace_in_file(path: str, old: str, new: str, occurrences: int = 1) -> Dict[str, Any]:
    """Safe-ish patch primitive (write-gated)."""
    _check_write()
    p = _safe_resolve(path)
    text = p.read_text(encoding="utf-8", errors="strict")
    if old not in text:
        return {"changed": False, "reason": "old_not_found"}
    if occurrences == 0:
        updated = text.replace(old, new)
    else:
        updated = text.replace(old, new, occurrences)
    _ensure_parent(p)
    p.write_text(updated, encoding="utf-8")
    return {"changed": True, "path": str(p.relative_to(REPO_ROOT))}

@mcp.tool
def move_path(src: str, dst: str, overwrite: bool = False) -> Dict[str, Any]:
    """Move/rename within repo (write-gated)."""
    _check_write()
    s = _safe_resolve(src)
    d = _safe_resolve(dst)
    if d.exists() and not overwrite:
        raise FileExistsError(f"dst_exists: {dst}")
    _ensure_parent(d)
    if d.exists() and overwrite:
        if d.is_dir():
            shutil.rmtree(d)
        else:
            d.unlink()
    shutil.move(str(s), str(d))
    return {"moved": True, "from": src, "to": dst}

@mcp.tool
def list_dir(path: str = ".", max_entries: int = 200, include_hidden: bool = False) -> Dict[str, Any]:
    """List directory entries (safe, bounded)."""
    p = _safe_resolve(path)
    if not p.exists():
        raise FileNotFoundError(f"not_found: {path}")
    if not p.is_dir():
        raise NotADirectoryError(f"not_a_dir: {path}")

    max_entries = max(1, min(max_entries, 2000))
    entries: List[Dict[str, Any]] = []
    children = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))

    for c in children:
        if not include_hidden and c.name.startswith("."):
            continue
        try:
            st = c.stat()
        except Exception:
            continue
        entries.append({
            "name": c.name,
            "path": str(c.relative_to(REPO_ROOT)),
            "type": "dir" if c.is_dir() else "file",
            "size": int(getattr(st, "st_size", 0)),
            "mtime": float(getattr(st, "st_mtime", 0.0)),
        })
        if len(entries) >= max_entries:
            break

    return {
        "dir": str(p.relative_to(REPO_ROOT)),
        "count": len(entries),
        "truncated": len(entries) >= max_entries,
        "entries": entries,
    }

@mcp.tool
def mkdir(path: str, parents: bool = True, exist_ok: bool = True) -> Dict[str, Any]:
    """Create a directory within the repo (write-gated)."""
    _check_write()
    p = _safe_resolve(path)
    p.mkdir(parents=parents, exist_ok=exist_ok)
    return {"created": True, "path": str(p.relative_to(REPO_ROOT))}

@mcp.tool
def write_text(path: str, content: str, overwrite: bool = True, create_parents: bool = True, encoding: str = "utf-8") -> Dict[str, Any]:
    """Write a text file within the repo (write-gated). Creates file if missing."""
    _check_write()
    p = _safe_resolve(path)
    if p.exists() and not overwrite:
        raise FileExistsError(f"exists: {path}")
    if create_parents:
        _ensure_parent(p)
    p.write_text(content, encoding=encoding)
    return {"written": True, "path": str(p.relative_to(REPO_ROOT)), "bytes": len(content.encode(encoding, errors="replace"))}

def _git_repo_ok() -> bool:
    return (REPO_ROOT / ".git").exists()

def _run_git(args: List[str], timeout_sec: int = 120) -> Dict[str, Any]:
    _check_run()
    if not _git_repo_ok():
        return {"ok": False, "error": "not_a_git_repo", "detail": "No .git directory found under REPO_ROOT."}

    cmd = ["git"] + args
    _validate_command(cmd)  # keep safety (blocks git rm etc.)

    timeout_sec = max(1, min(timeout_sec, 600))
    t0 = time.time()
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=timeout_sec,
    )
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": (proc.stdout or "")[-20000:],
        "stderr": (proc.stderr or "")[-20000:],
        "elapsed_sec": round(time.time() - t0, 3),
        "cmd": cmd,
    }

@mcp.tool
def git_status(porcelain: bool = True) -> Dict[str, Any]:
    """Git status (run-gated)."""
    args = ["status", "--porcelain=v1"] if porcelain else ["status"]
    return _run_git(args, timeout_sec=60)

@mcp.tool
def git_diff(staged: bool = False, pathspec: Optional[str] = None) -> Dict[str, Any]:
    """Git diff (run-gated)."""
    args = ["diff", "--staged"] if staged else ["diff"]
    if pathspec:
        args.append("--")
        args.append(pathspec)
    return _run_git(args, timeout_sec=120)

@mcp.tool
def git_commit(message: str, add_all: bool = True) -> Dict[str, Any]:
    """Git commit (run+write gated). Safe default: add_all=True."""
    _check_write()
    if not message or not message.strip():
        raise ValueError("empty_commit_message")

    # Stage changes
    if add_all:
        r1 = _run_git(["add", "-A"], timeout_sec=120)
        if not r1.get("ok", False):
            return {"ok": False, "step": "git_add", "result": r1}

    # Commit
    r2 = _run_git(["commit", "-m", message.strip()], timeout_sec=120)
    return {"ok": r2.get("ok", False), "step": "git_commit", "result": r2}

@mcp.tool
def run_cmd(cmd: List[str], timeout_sec: int = 900) -> Dict[str, Any]:
    """Run a command in REPO_ROOT (run-gated + allowlist)."""
    _check_run()
    _validate_command(cmd)
    timeout_sec = max(1, min(timeout_sec, 3600))
    t0 = time.time()
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=timeout_sec,
    )
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": (proc.stdout or "")[-20000:],
        "stderr": (proc.stderr or "")[-20000:],
        "elapsed_sec": round(time.time() - t0, 3),
    }

@mcp.tool
def http_smoke(base_backend: str = "http://localhost:8080", base_runtime: str = "http://localhost:8100") -> Dict[str, Any]:
    """Basic health checks + structured error contract sanity."""
    out: Dict[str, Any] = {"backend": {}, "runtime": {}}

    # runtime
    r = requests.get(f"{base_runtime}/health", timeout=5)
    out["runtime"]["health_status"] = r.status_code
    out["runtime"]["health_body"] = r.text[:500]

    # backend
    b = requests.get(f"{base_backend}/api/lerobot/health", timeout=5)
    out["backend"]["health_status"] = b.status_code
    out["backend"]["health_body"] = b.text[:500]

    # error contract probe (expect structured json on a known failing call)
    # example: teleop start with missing body -> should return structured error, not {"error":"..."}
    probe = requests.post(f"{base_backend}/api/lerobot/teleop/start", timeout=5)
    out["backend"]["probe_status"] = probe.status_code
    try:
        j = probe.json()
        out["backend"]["probe_json_keys"] = sorted(list(j.keys()))
        out["backend"]["probe_is_structured"] = all(k in j for k in ["code", "message", "details", "currentStatus"])
    except Exception:
        out["backend"]["probe_is_structured"] = False
        out["backend"]["probe_body"] = probe.text[:500]

    return out

if __name__ == "__main__":
    # STDIO transport by default (FastMCP run() without args)
    mcp.run()
