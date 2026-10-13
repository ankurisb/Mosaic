"""
Mosaic Sandbox Sidecar — executes model-written code in isolation.

Security posture (defence in depth; this container is also on an INTERNAL
docker network with NO egress, so code cannot reach the internet or other
services):
  - runs as a non-root user
  - each run gets a fresh ephemeral working directory, wiped afterwards
  - a clean, minimal environment (no inherited secrets)
  - OS resource limits per run: CPU seconds, address space (memory), output
    file size, and process count — set via setrlimit in a preexec hook
  - a wall-clock timeout that kills the whole process group
Returns stdout/stderr (truncated) and any files the code produced (base64),
so the caller can store them and surface them as downloads.
"""
import os
import sys
import uuid
import shutil
import base64
import signal
import resource
import subprocess
import mimetypes
import tempfile
from typing import Any, Optional

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Mosaic Sandbox", version="1.0.0")

WORK_ROOT = "/work"
os.makedirs(WORK_ROOT, exist_ok=True)

# Hard ceilings (the request can ask for less, never more).
MAX_TIMEOUT_S = 60
DEFAULT_TIMEOUT_S = 30
MEM_LIMIT_BYTES = 1024 * 1024 * 1024        # 1 GB address space
FSIZE_LIMIT_BYTES = 64 * 1024 * 1024         # 64 MB per file written
NPROC_LIMIT = 128
MAX_OUTPUT_FILES = 20
MAX_TOTAL_OUTPUT_BYTES = 20 * 1024 * 1024     # 20 MB of files returned
STDOUT_CAP = 20000
MAX_INPUT_TOTAL_BYTES = 50 * 1024 * 1024


class ExecRequest(BaseModel):
    code: str
    language: str = "python"                 # 'python' | 'node'
    timeout_s: int = DEFAULT_TIMEOUT_S
    input_files: Optional[list[dict[str, Any]]] = None   # [{name, b64}]


@app.get("/health")
def health():
    return {"ok": True, "service": "mosaic-sandbox"}


def _preexec(timeout_s: int):
    # Runs in the child between fork and exec. New session => own process group
    # so a timeout can kill everything the code spawned.
    os.setsid()
    cpu = min(timeout_s + 2, MAX_TIMEOUT_S + 2)
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    resource.setrlimit(resource.RLIMIT_AS, (MEM_LIMIT_BYTES, MEM_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (FSIZE_LIMIT_BYTES, FSIZE_LIMIT_BYTES))
    try:
        resource.setrlimit(resource.RLIMIT_NPROC, (NPROC_LIMIT, NPROC_LIMIT))
    except (ValueError, OSError):
        pass


@app.post("/exec")
def execute(req: ExecRequest):
    timeout_s = max(1, min(int(req.timeout_s or DEFAULT_TIMEOUT_S), MAX_TIMEOUT_S))
    lang = (req.language or "python").lower()
    if lang not in ("python", "node"):
        return {"ok": False, "error": f"unsupported language: {lang}"}

    workdir = tempfile.mkdtemp(prefix="run-", dir=WORK_ROOT)
    try:
        # Write input files (names sanitised to basenames to prevent traversal).
        total_in = 0
        preexisting = set()
        for f in (req.input_files or []):
            name = os.path.basename(str(f.get("name") or "")).strip() or "input"
            try:
                raw = base64.b64decode(f.get("b64") or "")
            except Exception:
                raw = b""
            total_in += len(raw)
            if total_in > MAX_INPUT_TOTAL_BYTES:
                break
            p = os.path.join(workdir, name)
            with open(p, "wb") as fh:
                fh.write(raw)
            preexisting.add(name)

        code_name = "main.py" if lang == "python" else "main.js"
        preexisting.add(code_name)
        with open(os.path.join(workdir, code_name), "w") as fh:
            fh.write(req.code or "")

        # Clean, minimal environment — no inherited secrets.
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": workdir,
            "TMPDIR": workdir,
            "MPLBACKEND": "Agg",
            "PYTHONDONTWRITEBYTECODE": "1",
            "LANG": "C.UTF-8",
        }
        cmd = [sys.executable, "-I", code_name] if lang == "python" else ["node", code_name]

        timed_out = False
        exit_code = None
        stdout = stderr = ""
        try:
            proc = subprocess.Popen(
                cmd, cwd=workdir, env=env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                preexec_fn=lambda: _preexec(timeout_s),
            )
            try:
                out, err = proc.communicate(timeout=timeout_s)
                exit_code = proc.returncode
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except Exception:
                    proc.kill()
                out, err = proc.communicate()
            stdout = (out or b"").decode("utf-8", "replace")
            stderr = (err or b"").decode("utf-8", "replace")
        except Exception as e:
            return {"ok": False, "error": f"execution failed: {e}"}

        # Collect produced files (anything new in the workdir, shallow + one level).
        produced = []
        total_out = 0
        for root, _dirs, files in os.walk(workdir):
            depth = os.path.relpath(root, workdir).count(os.sep)
            if depth > 2:
                continue
            for fn in sorted(files):
                rel = os.path.relpath(os.path.join(root, fn), workdir)
                if rel in preexisting:
                    continue
                full = os.path.join(root, fn)
                try:
                    size = os.path.getsize(full)
                except OSError:
                    continue
                if size == 0 or total_out + size > MAX_TOTAL_OUTPUT_BYTES:
                    continue
                with open(full, "rb") as fh:
                    data = fh.read()
                total_out += len(data)
                mime = mimetypes.guess_type(fn)[0] or "application/octet-stream"
                produced.append({
                    "name": rel,
                    "mime": mime,
                    "size": size,
                    "b64": base64.b64encode(data).decode("ascii"),
                })
                if len(produced) >= MAX_OUTPUT_FILES:
                    break
            if len(produced) >= MAX_OUTPUT_FILES:
                break

        return {
            "ok": (exit_code == 0) and not timed_out,
            "exit_code": exit_code,
            "timed_out": timed_out,
            "stdout": stdout[:STDOUT_CAP],
            "stderr": stderr[:STDOUT_CAP],
            "stdout_truncated": len(stdout) > STDOUT_CAP,
            "files": produced,
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
