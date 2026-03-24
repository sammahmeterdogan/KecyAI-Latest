package com.kecyai.api;

import com.kecyai.api.dto.TeleopCommandRequest;
import com.kecyai.api.dto.TeleopJointCommand;
import com.kecyai.api.dto.TeleopJointSetRequest;
import com.kecyai.api.dto.TeleopStartRequest;
import com.kecyai.domain.RuntimeClient;
import com.kecyai.domain.RuntimeNotReadyException;
import com.kecyai.domain.RuntimeOrchestrator;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.Disposable;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/lerobot/teleop")
@RequiredArgsConstructor
public class TeleopController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    // ----------------------------------------------------------------
    // Teleop Control
    // ----------------------------------------------------------------

    @GetMapping("/status")
    public ResponseEntity<?> getTeleopStatus() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getTeleopStatus());
        } catch (RuntimeNotReadyException e) {
            return ResponseEntity.ok(Map.of(
                    "state", "offline",
                    "message", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("state", "unknown", "error",
                    e.getMessage() != null ? e.getMessage() : "unknown"));
        }
    }

    @PostMapping("/start")
    public ResponseEntity<?> startTeleop(@RequestBody(required = false) TeleopStartRequest config) {
        if (config == null) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "Request body is required. Expected: {\"robot_type\":\"...\", \"teleop_type\":\"...\"}",
                    List.of()));
        }

        String robotType = config.robotType();
        String teleopType = config.teleopType();

        if (robotType == null || robotType.isBlank()) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "Missing required field: 'robot_type'",
                    List.of()));
        }
        if (teleopType == null || teleopType.isBlank()) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "Missing required field: 'teleop_type'",
                    List.of()));
        }

        orchestrator.ensureRuntimeReady();
        Map<String, Object> result = runtimeClient.startTeleop(Map.of(
                "robot_type", robotType,
                "teleop_type", teleopType));
        return ResponseEntity.ok(result);
    }

    @PostMapping("/stop")
    public ResponseEntity<?> stopTeleop() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.stopTeleop());
    }

    @GetMapping("/logs")
    public ResponseEntity<?> getTeleopLogs(@RequestParam(defaultValue = "150") int tail) {
        return ResponseEntity.ok(runtimeClient.getTeleopLogs(tail));
    }

    @GetMapping("/joints")
    public ResponseEntity<?> getJoints() {
        return ResponseEntity.ok(runtimeClient.getJoints());
    }

    @PostMapping("/joints/set")
    public ResponseEntity<?> setJoint(@RequestBody(required = false) TeleopJointSetRequest payload) {
        orchestrator.ensureRuntimeReady();
        if (payload == null || payload.jointId() == null || payload.value() == null) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "Missing required fields: 'jointId' and 'value'",
                    List.of()));
        }
        runtimeClient.setJoint(payload.jointId(), payload.value());
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    @PostMapping("/command")
    public ResponseEntity<?> sendCommand(@RequestBody(required = false) TeleopCommandRequest payload) {
        if (payload == null) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "Request body is required. Expected: {\"joints\":[{\"id\":\"...\",\"position\":0.0}, ...]}",
                    List.of()));
        }

        if (payload.joints() == null) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "Missing required field: 'joints'",
                    List.of("Expected: {\"mode\":\"manual\",\"joints\":[{\"id\":\"shoulder_pan\",\"position\":0.2}]}")));
        }
        if (payload.joints().isEmpty()) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "'joints' must be a non-empty JSON array",
                    List.of()));
        }

        orchestrator.ensureRuntimeReady();
        Map<String, Object> result = runtimeClient.sendCommand(Map.of(
                "mode", payload.mode(),
                "joints", payload.joints().stream()
                        .map(TeleopController::toJointMap)
                        .toList()));
        return ResponseEntity.ok(result);
    }

    private static Map<String, Object> toJointMap(TeleopJointCommand joint) {
        return Map.of(
                "id", joint.id(),
                "position", joint.position());
    }

    @PostMapping("/pose/home")
    public ResponseEntity<?> moveHome() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.moveHomePose());
    }

    @PostMapping("/pose/ready")
    public ResponseEntity<?> moveReady() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.moveReadyPose());
    }

    @PostMapping("/gripper/open")
    public ResponseEntity<?> openGripper() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.openGripper());
    }

    @PostMapping("/gripper/close")
    public ResponseEntity<?> closeGripper() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.closeGripper());
    }

    @PostMapping("/estop/on")
    public ResponseEntity<?> estopOn() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.estopOn());
    }

    @PostMapping("/estop/off")
    public ResponseEntity<?> estopOff() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.estopOff());
    }

    // ----------------------------------------------------------------
    // Torque
    // ----------------------------------------------------------------

    @PostMapping("/torque/read")
    public ResponseEntity<?> readTorque(@RequestParam(required = false) Integer robot_id) {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.readTorque(robot_id));
    }

    @PostMapping("/torque/toggle")
    public ResponseEntity<?> toggleTorque(@RequestBody Map<String, Object> payload) {
        boolean torqueStatus = payload != null && Boolean.TRUE.equals(payload.get("torque_status"));
        Integer robotId = payload != null && payload.get("robot_id") != null
                ? Integer.valueOf(payload.get("robot_id").toString()) : null;
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.toggleTorque(robotId, torqueStatus));
    }

    // ----------------------------------------------------------------
    // Telemetry Stream (SSE)
    // ----------------------------------------------------------------

    @GetMapping("/telemetry/stream")
    public SseEmitter streamTelemetry() {
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);

        Disposable subscription = runtimeClient.getTelemetryStream()
                .subscribe(
                        data -> {
                            try {
                                emitter.send(data);
                            } catch (IOException ignored) {
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
