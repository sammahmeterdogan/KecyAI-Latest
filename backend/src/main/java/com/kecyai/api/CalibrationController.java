package com.kecyai.api;

import com.kecyai.domain.RuntimeClient;
import com.kecyai.domain.RuntimeNotReadyException;
import com.kecyai.domain.RuntimeOrchestrator;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Calibration gateway endpoints.
 * Thin controller - delegates to runtime via RuntimeClient.
 * Uses same structured error contract as teleop endpoints.
 */
@RestController
@RequestMapping("/api/lerobot/calibration")
@RequiredArgsConstructor
public class CalibrationController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    // ----------------------------------------------------------------
    // Endpoints
    // ----------------------------------------------------------------

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
        orchestrator.ensureRuntimeReady();
        Map<String, Object> result = runtimeClient.startCalibration(config);
        return ResponseEntity.ok(result);
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
        orchestrator.ensureRuntimeReady();
        Map<String, Object> result = runtimeClient.stepCalibration(config);
        return ResponseEntity.ok(result);
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
        orchestrator.ensureRuntimeReady();
        Map<String, Object> result = runtimeClient.stopCalibration();
        return ResponseEntity.ok(result);
    }
}
