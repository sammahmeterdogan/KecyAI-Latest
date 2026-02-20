package com.tenbinlabs.kecyai.api;

import com.tenbinlabs.kecyai.application.LeRobotQueryService;
import com.tenbinlabs.kecyai.domain.RuntimeClient;
import com.tenbinlabs.kecyai.domain.RuntimeNotReadyException;
import com.tenbinlabs.kecyai.domain.RuntimeOrchestrator;
import com.tenbinlabs.kecyai.infrastructure.HttpRuntimeClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.Disposable;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/lerobot")
@RequiredArgsConstructor
@Slf4j
public class LeRobotControllerV2 {

    private final LeRobotQueryService queryService;
    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    // ─────────────────────────────────────────────
    // Exception handlers (scoped to this controller)
    // ─────────────────────────────────────────────

    /**
     * Malformed JSON body -> clean 400 with structured error.
     * Without this, Spring returns its default Whitelabel error page / generic 400.
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> handleBadJson(HttpMessageNotReadableException ex) {
        log.warn("Malformed request body: {}", ex.getMessage());
        return ResponseEntity.badRequest().body(Map.of(
                "code", "VALIDATION_ERROR",
                "message", "Malformed or missing JSON request body",
                "details", List.of(ex.getMostSpecificCause().getMessage())));
    }

    // ─── Helper: handle RuntimeClientException uniformly ───

    /**
     * Forward runtime HTTP status + body to the client.
     * If the exception is RuntimeClientException -> preserve status.
     * If it is a connectivity error -> 502.
     * Otherwise -> 500 with GATEWAY_ERROR code.
     */
    private ResponseEntity<Map<String, Object>> handleRuntimeError(Exception e, String context) {
        // Orchestrator: runtime not ready (health fail / docker issue / timeout)
        if (e instanceof RuntimeNotReadyException rnr) {
            log.warn("{}: runtime not ready — {} [{}]", context, rnr.getMessage(), rnr.getCode());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "code", rnr.getCode(),
                    "message", rnr.getMessage(),
                    "details", rnr.getDetails()));
        }
        // Runtime returned a non-2xx → forward status + body transparently
        if (e instanceof HttpRuntimeClient.RuntimeClientException rce) {
            log.warn("{}: runtime returned {} -> {}", context, rce.getStatusCode(), rce.getBody());
            return ResponseEntity.status(rce.getStatusCode()).body(rce.getBody());
        }
        // Network-level failure (connection refused, timeout, etc.)
        if (e instanceof WebClientRequestException) {
            log.error("{}: runtime unreachable", context, e);
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "code", "RUNTIME_UNREACHABLE",
                    "message", "Cannot connect to LeRobot runtime container"));
        }
        // Anything else → 500
        log.error("{}: unexpected error", context, e);
        String msg = (e.getMessage() != null) ? e.getMessage() : e.getClass().getSimpleName();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "code", "GATEWAY_ERROR",
                "message", msg));
    }

    // ─── Base Metadata ───

    @GetMapping("/health")
    public ResponseEntity<?> getRuntimeHealth() {
        try {
            return ResponseEntity.ok(queryService.getSystemHealth());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "runtime_unreachable", "message",
                            e.getMessage() != null ? e.getMessage() : "unknown"));
        }
    }

    @GetMapping("/version")
    public ResponseEntity<?> getRuntimeVersion() {
        try {
            return ResponseEntity.ok(queryService.getSystemVersion());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "runtime_unreachable", "message",
                            e.getMessage() != null ? e.getMessage() : "unknown"));
        }
    }

    @GetMapping("/capabilities")
    public ResponseEntity<?> getCapabilities() {
        try {
            return ResponseEntity.ok(queryService.getCapabilities());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "runtime_unreachable", "message",
                            e.getMessage() != null ? e.getMessage() : "unknown"));
        }
    }

    // ─── Teleop Control ───

    @GetMapping("/teleop/status")
    public ResponseEntity<?> getTeleopStatus() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getTeleopStatus());
        } catch (RuntimeNotReadyException e) {
            // Status endpoint returns graceful fallback when offline (no 502)
            return ResponseEntity.ok(Map.of(
                    "state", "offline",
                    "message", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("state", "unknown", "error",
                    e.getMessage() != null ? e.getMessage() : "unknown"));
        }
    }

    /**
     * POST /api/lerobot/teleop/start
     *
     * Idempotent semantics:
     * idle -> start -> 200
     * running + same config -> 200 {idempotent:true}
     * running + different config -> 409 {code:CONFLICT}
     * missing/invalid body -> 400 {code:VALIDATION_ERROR}
     * runtime down -> 502 {code:RUNTIME_UNREACHABLE}
     */
    @PostMapping("/teleop/start")
    public ResponseEntity<?> startTeleop(@RequestBody(required = false) Map<String, Object> config) {
        // Guard: empty or null body
        if (config == null || config.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message", "Request body is required. Expected: {\"robot_type\":\"...\", \"teleop_type\":\"...\"}",
                    "details", List.of()));
        }

        // Validate required fields at gateway level (fail fast before network call)
        String robotType = config.get("robot_type") != null ? config.get("robot_type").toString() : null;
        String teleopType = config.get("teleop_type") != null ? config.get("teleop_type").toString() : null;

        if (robotType == null || robotType.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message", "Missing required field: 'robot_type'",
                    "details", List.of()));
        }
        if (teleopType == null || teleopType.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message", "Missing required field: 'teleop_type'",
                    "details", List.of()));
        }

        try {
            orchestrator.ensureRuntimeReady();
            Map<String, Object> result = runtimeClient.startTeleop(config);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return handleRuntimeError(e, "startTeleop");
        }
    }

    @PostMapping("/teleop/stop")
    public ResponseEntity<?> stopTeleop() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.stopTeleop());
        } catch (Exception e) {
            return handleRuntimeError(e, "stopTeleop");
        }
    }

    @GetMapping("/teleop/logs")
    public ResponseEntity<?> getTeleopLogs(@RequestParam(defaultValue = "150") int tail) {
        return ResponseEntity.ok(runtimeClient.getTeleopLogs(tail));
    }

    // ─── Joint Control ───

    @GetMapping("/teleop/joints")
    public ResponseEntity<?> getJoints() {
        return ResponseEntity.ok(runtimeClient.getJoints());
    }

    @PostMapping("/teleop/joints/set")
    public ResponseEntity<?> setJoint(@RequestBody Map<String, Object> payload) {
        try {
            orchestrator.ensureRuntimeReady();
            String jointId = (String) payload.get("jointId");
            Number value = (Number) payload.get("value");
            if (jointId == null || value == null) {
                return ResponseEntity.badRequest().body(Map.of(
                        "code", "VALIDATION_ERROR",
                        "message", "Missing required fields: 'jointId' and 'value'",
                        "details", List.of()));
            }
            runtimeClient.setJoint(jointId, value.doubleValue());
            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (Exception e) {
            return handleRuntimeError(e, "setJoint");
        }
    }

    /**
     * POST /api/lerobot/teleop/command
     *
     * Accepts: {"mode":"manual", "joints":[{"id":"shoulder_pan","position":0.2},
     * ...]}
     * 'mode' is optional. 'joints' is required (array of {id, position}).
     *
     * Returns 200: {accepted:[...], rejected:[...], simulated:true/false}
     * Returns 400: {code:"VALIDATION_ERROR", message:"...", details:[...]}
     */
    @PostMapping("/teleop/command")
    public ResponseEntity<?> sendCommand(@RequestBody(required = false) Map<String, Object> payload) {
        if (payload == null || payload.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message",
                    "Request body is required. Expected: {\"joints\":[{\"id\":\"...\",\"position\":0.0}, ...]}",
                    "details", List.of()));
        }

        Object jointsRaw = payload.get("joints");
        if (jointsRaw == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message", "Missing required field: 'joints'",
                    "details", List.of(
                            "Expected: {\"mode\":\"manual\",\"joints\":[{\"id\":\"shoulder_pan\",\"position\":0.2}]}")));
        }
        if (!(jointsRaw instanceof List)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message", "'joints' must be a JSON array",
                    "details", List.of("Got type: " + jointsRaw.getClass().getSimpleName())));
        }

        try {
            orchestrator.ensureRuntimeReady();
            Map<String, Object> result = runtimeClient.sendCommand(payload);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return handleRuntimeError(e, "sendCommand");
        }
    }

    @PostMapping("/teleop/pose/home")
    public ResponseEntity<?> moveHome() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.moveHomePose());
        } catch (Exception e) {
            return handleRuntimeError(e, "moveHome");
        }
    }

    @PostMapping("/teleop/pose/ready")
    public ResponseEntity<?> moveReady() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.moveReadyPose());
        } catch (Exception e) {
            return handleRuntimeError(e, "moveReady");
        }
    }

    @PostMapping("/teleop/gripper/open")
    public ResponseEntity<?> openGripper() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.openGripper());
        } catch (Exception e) {
            return handleRuntimeError(e, "openGripper");
        }
    }

    @PostMapping("/teleop/gripper/close")
    public ResponseEntity<?> closeGripper() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.closeGripper());
        } catch (Exception e) {
            return handleRuntimeError(e, "closeGripper");
        }
    }

    // ─── E-STOP ───

    @PostMapping("/teleop/estop/on")
    public ResponseEntity<?> estopOn() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.estopOn());
        } catch (Exception e) {
            return handleRuntimeError(e, "estopOn");
        }
    }

    @PostMapping("/teleop/estop/off")
    public ResponseEntity<?> estopOff() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.estopOff());
        } catch (Exception e) {
            return handleRuntimeError(e, "estopOff");
        }
    }

    // ─── Admin / Hardware ───

    @GetMapping("/admin/preflight")
    public ResponseEntity<?> getPreflightChecks(@RequestParam Map<String, Object> params) {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getPreflightChecks(params));
        } catch (Exception e) {
            return handleRuntimeError(e, "getPreflightChecks");
        }
    }

    @GetMapping("/admin/calibration/list")
    public ResponseEntity<?> getCalibrationArtifacts() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getCalibrationArtifacts());
        } catch (Exception e) {
            return handleRuntimeError(e, "getCalibrationArtifacts");
        }
    }

    @GetMapping("/admin/calibration/latest")
    public ResponseEntity<?> getLatestCalibrationArtifact(
            @RequestParam(defaultValue = "so101_follower") String robot_type) {
        try {
            orchestrator.ensureRuntimeReady();
            Map<String, Object> artifact = runtimeClient.getLatestCalibrationArtifact(robot_type);
            if (artifact == null || artifact.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                        "code", "NOT_FOUND",
                        "message", "No artifacts found for robot type: " + robot_type));
            }
            return ResponseEntity.ok(artifact);
        } catch (Exception e) {
            return handleRuntimeError(e, "getLatestCalibrationArtifact");
        }
    }

    @PostMapping("/admin/calibration/select")
    public ResponseEntity<?> selectCalibrationArtifact(@RequestBody Map<String, String> payload) {
        String artifactId = payload.get("artifactId");
        if (artifactId == null || artifactId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message", "Missing required field: 'artifactId'"));
        }
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.selectCalibrationArtifact(artifactId));
        } catch (Exception e) {
            return handleRuntimeError(e, "selectCalibrationArtifact");
        }
    }

    // ─── Hardware Config ───

    /**
     * GET /api/lerobot/admin/config
     * Returns current hardware configuration (serial_port, robot_type, driver,
     * mode).
     */
    @GetMapping("/admin/config")
    public ResponseEntity<?> getHardwareConfig() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getHardwareConfig());
        } catch (Exception e) {
            return handleRuntimeError(e, "getHardwareConfig");
        }
    }

    /**
     * POST /api/lerobot/admin/config
     * Update hardware configuration at runtime.
     *
     * Accepts: {"serial_port":"...", "robot_type":"...", "driver":"...",
     * "dry_run":bool}
     * Returns 200: updated config
     * Returns 400: VALIDATION_ERROR (invalid robot_type/driver)
     * Returns 502: RUNTIME_UNREACHABLE
     */
    @PostMapping("/admin/config")
    public ResponseEntity<?> setHardwareConfig(@RequestBody Map<String, Object> payload) {
        if (payload == null || payload.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "code", "VALIDATION_ERROR",
                    "message", "Request body is required"));
        }
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.setHardwareConfig(payload));
        } catch (Exception e) {
            return handleRuntimeError(e, "setHardwareConfig");
        }
    }

    // ─── Telemetry Stream (SSE) ───

    @GetMapping("/teleop/telemetry/stream")
    public SseEmitter streamTelemetry() {
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);

        Disposable subscription = runtimeClient.getTelemetryStream()
                .subscribe(
                        data -> {
                            try {
                                emitter.send(data);
                            } catch (IOException e) {
                                // Client disconnected
                            }
                        },
                        error -> {
                            try {
                                emitter.send(SseEmitter.event().name("error").data(
                                        error.getMessage() != null ? error.getMessage() : "unknown"));
                                emitter.completeWithError(error);
                            } catch (IOException ignored) {
                            }
                        },
                        () -> {
                            try {
                                emitter.complete();
                            } catch (Exception ignored) {
                            }
                        });

        emitter.onCompletion(subscription::dispose);
        emitter.onTimeout(subscription::dispose);
        emitter.onError(e -> subscription.dispose());

        return emitter;
    }
}
