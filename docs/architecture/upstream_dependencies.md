# Upstream Dependencies

## LeRobot

| Field | Value |
|---|---|
| **Repository** | https://github.com/huggingface/lerobot |
| **Pinned Commit** | `2ce33810d4d5e76f6c996800491119a6951ec9fd` |
| **Branch** | `main` |
| **Sync Date** | 2026-02-14 |
| **License** | Apache-2.0 |
| **Vendored At** | `runtime/upstream/lerobot/` |

### Files / Docs Referenced

| Topic | Upstream Path |
|---|---|
| SO-101 Assembly | `docs/source/so101.mdx` |
| Imitation Learning | `docs/source/il_robots.mdx` |
| Cameras | `docs/source/cameras.mdx` |
| ACT Policy | `docs/source/policy_act_README.md` |
| SmolVLA | `docs/source/policy_smolvla_README.md` |
| Pi0 | `docs/source/pi0.mdx` |
| Installation | `docs/source/installation.mdx` |
| Robot Interface | `src/lerobot/robots/` |
| Teleop Interface | `src/lerobot/teleoperators/` |
| Docker Setup | `docker/` |

### Sync Instructions

**Windows:**
```powershell
.\scripts\sync-upstream-lerobot.ps1
```

**macOS/Linux:**
```bash
./scripts/sync-upstream-lerobot.sh
```

Both scripts copy from a local LeRobot clone into the vendored folder and update this document's pinned commit.

## Teleoperation
**Entrypoint:** `src/lerobot/scripts/lerobot_teleoperate.py`
**Command:** `lerobot-teleoperate` (via `pyproject.toml` scripts)
**Key Arguments:**
- `--robot.type`: The follower robot (e.g., `so101_follower`, `bi_so_follower`)
- `--teleop.type`: The leader device (e.g., `so_leader`, `bi_so_leader`)
- `--robot.port` / `--teleop.port`: Serial device paths
- `--display_data`: Boolean to show Rerun visualization (requires Rerun server)

**Supported Robot/Teleop Pairs (Inferred from imports):**
- `so101_follower` <-> `so_leader`
- `bi_so_follower` <-> `bi_so_leader`
- `so_follower` <-> `so_leader`
- `aloha` (various)
- `reachy2`
