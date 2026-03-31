# Upstream Reference Policy

## Purpose

KECYAI uses developer-oriented robotics projects such as `phosphobot` and `LeRobot` as implementation references, not as the final user-facing product. The goal is to study how useful robotics workflows are built, adapt the underlying logic into KECYAI's architecture, and expose the result directly through the KECY UI and desktop experience.

This policy exists so new feature work follows the same rule set every time.

## Primary Source Order

For robotics features such as teleoperation, calibration, gamepad control, data recording, hardware onboarding, and related operator flows, review sources in this order:

1. `C:\Users\ASUS\Desktop\phosphobot`
2. `C:\Users\ASUS\Desktop\lerobot-main`
3. `runtime/upstream/lerobot/` only when the vendored runtime snapshot is the relevant pinned in-repo reference

`phosphobot` is the first reference by default. `LeRobot` is the second reference when the behavior is missing, incomplete, or clearer there.

## Product Boundary

The final KECYAI product should not depend on users interacting with upstream robotics repositories directly.

That means shipped workflows should be available through KECYAI's own:

- `frontend/` UI
- `desktop/` desktop shell and launcher flow
- `runtime/` runtime services and hardware integration

Users should not need to clone upstream repositories, install their dependencies manually, edit raw configuration files, or run terminal commands just to access core robotic functions.

## Required Development Flow

When a new robotics task is assigned:

1. Check `phosphobot` first for an existing implementation of the requested capability.
2. If needed, check `LeRobot` next to compare behavior, device handling, state management, recording formats, or operator flow.
3. Identify the useful implementation ideas:
   - control loop behavior
   - calibration sequences
   - gamepad mapping and input handling
   - recording workflow and dataset structure
   - device discovery, connection, and error handling
   - operator feedback and UX flow
4. Reimplement the needed behavior inside KECYAI's own architecture and naming conventions.
5. Deliver the feature through KECYAI's own screens, APIs, runtime services, and desktop workflow.

The expected output is an independent KECYAI capability, not a thin wrapper around upstream tooling.

## Adaptation Rules

- Prefer reimplementation of the underlying behavior over transplanting CLI-heavy or repo-specific workflows.
- Preserve the KECYAI product model: guided UI, desktop-first operator flow, and low terminal exposure.
- If upstream behavior is useful but too technical, convert it into structured forms, guided steps, defaults, and in-product actions.
- If code is copied or vendored instead of reimplemented, document that choice explicitly and verify license obligations before shipping.

## Documentation Expectations

For each meaningful robotics feature task, record:

- which upstream repository was checked first
- which upstream files or modules were consulted
- what logic or workflow was adapted
- where the adapted implementation lives inside KECYAI

This keeps future work traceable and makes the `phosphobot`-first rule auditable.
