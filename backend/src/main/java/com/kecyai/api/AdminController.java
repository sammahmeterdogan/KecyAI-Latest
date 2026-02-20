package com.kecyai.api;

import com.kecyai.api.dto.HardwareConfigRequest;
import com.kecyai.api.dto.SelectCalibrationArtifactRequest;
import com.kecyai.domain.RuntimeClient;
import com.kecyai.domain.RuntimeOrchestrator;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/lerobot/admin")
@RequiredArgsConstructor
public class AdminController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    // ----------------------------------------------------------------
    // Admin / Hardware
    // ----------------------------------------------------------------

    @GetMapping("/preflight")
    public ResponseEntity<?> getPreflightChecks(@RequestParam Map<String, Object> params) {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.getPreflightChecks(params));
    }

    @GetMapping("/calibration/list")
    public ResponseEntity<?> getCalibrationArtifacts() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.getCalibrationArtifacts());
    }

    @GetMapping("/calibration/latest")
    public ResponseEntity<?> getLatestCalibrationArtifact(
            @RequestParam(defaultValue = "so101_follower") String robot_type) {
        orchestrator.ensureRuntimeReady();
        Map<String, Object> artifact = runtimeClient.getLatestCalibrationArtifact(robot_type);
        if (artifact == null || artifact.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "code", "NOT_FOUND",
                    "message", "No artifacts found for robot type: " + robot_type));
        }
        return ResponseEntity.ok(artifact);
    }

    @PostMapping("/calibration/select")
    public ResponseEntity<?> selectCalibrationArtifact(@RequestBody(required = false) SelectCalibrationArtifactRequest payload) {
        String artifactId = payload != null ? payload.artifactId() : null;
        if (artifactId == null || artifactId.isBlank()) {
            return ResponseEntity.badRequest().body(ApiErrorResponse.of(
                    "VALIDATION_ERROR",
                    "Missing required field: 'artifactId'"));
        }
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.selectCalibrationArtifact(artifactId));
    }

    @GetMapping("/config")
    public ResponseEntity<?> getHardwareConfig() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.getHardwareConfig());
    }

    @PostMapping("/config")
    public ResponseEntity<?> setHardwareConfig(@RequestBody(required = false) HardwareConfigRequest payload) {
        if (payload == null) {
            return ResponseEntity.badRequest().body(ApiErrorResponse.of(
                    "VALIDATION_ERROR",
                    "Request body is required"));
        }
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.setHardwareConfig(toConfigMap(payload)));
    }

    private static Map<String, Object> toConfigMap(HardwareConfigRequest payload) {
        Map<String, Object> config = new java.util.LinkedHashMap<>();
        if (payload.serialPort() != null) config.put("serial_port", payload.serialPort());
        if (payload.robotType() != null) config.put("robot_type", payload.robotType());
        if (payload.driver() != null) config.put("driver", payload.driver());
        if (payload.dryRun() != null) config.put("dry_run", payload.dryRun());
        return config;
    }
}
