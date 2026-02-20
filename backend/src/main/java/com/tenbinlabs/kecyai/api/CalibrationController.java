package com.tenbinlabs.kecyai.api;

import com.tenbinlabs.kecyai.domain.RuntimeClient;
import com.tenbinlabs.kecyai.domain.RuntimeNotReadyException;
import com.tenbinlabs.kecyai.domain.RuntimeOrchestrator;
import com.tenbinlabs.kecyai.infrastructure.HttpRuntimeClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClientRequestException;

import java.util.List;
import java.util.Map;

/**
 * Calibration gateway endpoints.
 * Thin controller — delegates to runtime via RuntimeClient.
 * Uses same structured error contract as teleop endpoints.
 */
@RestController
@RequestMapping("/api/lerobot/calibration")
@RequiredArgsConstructor
@Slf4j
public class CalibrationController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    // ─── Error handling (same pattern as LeRobotControllerV2) ───

    private ResponseEntity<Map<String, Object>> handleRuntimeError(Exception e, String context) {
        if (e instanceof RuntimeNotReadyException rnr) {
            log.warn("{}: runtime not ready — {} [{}]", context, rnr.getMessage(), rnr.getCode());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "code", rnr.getCode(),
                    "message", rnr.getMessage(),
                    "details", rnr.getDetails()));
        }
        if (e instanceof HttpRuntimeClient.RuntimeClientException rce) {
            log.warn("{}: runtime returned {} -> {}", context, rce.getStatusCode(), rce.getBody());
            return ResponseEntity.status(rce.getStatusCode()).body(rce.getBody());
        }
        if (e instanceof WebClientRequestException) {
            log.error("{}: runtime unreachable", context, e);
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "code", "RUNTIME_UNREACHABLE",
                    "message", "Cannot connect to LeRobot runtime container",
                    "details", List.of()));
        }
        log.error("{}: unexpected error", context, e);
        String msg = (e.getMessage() != null) ? e.getMessage() : e.getClass().getSimpleName();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "code", "GATEWAY_ERROR",
                "message", msg,
                "details", List.of()));
    }

    // ─── Endpoints ───

    /**
     * GET /api/lerobot/calibration/status
     * Returns current calibration state machine status.
     */
    @GetMapping("/status")
    public ResponseEntity<?> getCalibrationStatus() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getCalibrationStatus());
        } catch (RuntimeNotReadyException e) {
            // Graceful fallback when runtime offline
            return ResponseEntity.ok(Map.of(
                    "state", "offline",
                    "message", e.getMessage()));
        } catch (Exception e) {
            return handleRuntimeError(e, "getCalibrationStatus");
        }
    }

    /**
     * POST /api/lerobot/calibration/start
     * Starts a calibration session. Dry-run if no serial_port provided.
     *
     * 200: session started
     * 409 CONFLICT: teleop running or calibration already running
     * 400 VALIDATION_ERROR: bad config
     * 502 RUNTIME_UNREACHABLE: runtime down
     */
    @PostMapping("/start")
    public ResponseEntity<?> startCalibration(@RequestBody(required = false) Map<String, Object> config) {
        if (config == null) {
            config = Map.of();
        }
        try {
            orchestrator.ensureRuntimeReady();
            Map<String, Object> result = runtimeClient.startCalibration(config);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return handleRuntimeError(e, "startCalibration");
        }
    }

    /**
     * POST /api/lerobot/calibration/step
     * Advances calibration to the next step.
     *
     * 200: step completed
     * 409 PRECONDITION_FAILED: E-STOP active or no session
     * 502 RUNTIME_UNREACHABLE: runtime down
     */
    @PostMapping("/step")
    public ResponseEntity<?> stepCalibration(@RequestBody(required = false) Map<String, Object> config) {
        try {
            orchestrator.ensureRuntimeReady();
            Map<String, Object> result = runtimeClient.stepCalibration(config);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return handleRuntimeError(e, "stepCalibration");
        }
    }

    /**
     * POST /api/lerobot/calibration/stop
     * Stops the current calibration session.
     *
     * 200: session stopped (or already idle)
     * 502 RUNTIME_UNREACHABLE: runtime down
     */
    @PostMapping("/stop")
    public ResponseEntity<?> stopCalibration() {
        try {
            orchestrator.ensureRuntimeReady();
            Map<String, Object> result = runtimeClient.stopCalibration();
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return handleRuntimeError(e, "stopCalibration");
        }
    }
}
