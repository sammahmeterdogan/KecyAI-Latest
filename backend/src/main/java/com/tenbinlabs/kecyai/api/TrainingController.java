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

import java.util.Map;

@RestController
@RequestMapping("/api/lerobot/train")
@RequiredArgsConstructor
@Slf4j
public class TrainingController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    @PostMapping("/start")
    public ResponseEntity<?> startTraining(@RequestBody(required = false) Map<String, Object> config) {
        try {
            orchestrator.ensureRuntimeReady();
            if (config == null) {
                return ResponseEntity.badRequest().body(Map.of(
                        "code", "VALIDATION_ERROR",
                        "message", "Request body is required",
                        "details", java.util.List.of()));
            }
            return ResponseEntity.ok(runtimeClient.startTraining(config));
        } catch (Exception e) {
            return handleRuntimeError(e, "startTraining");
        }
    }

    @PostMapping("/stop")
    public ResponseEntity<?> stopTraining() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.stopTraining());
        } catch (Exception e) {
            return handleRuntimeError(e, "stopTraining");
        }
    }

    @GetMapping("/status")
    public ResponseEntity<?> getTrainingStatus() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getTrainingStatus());
        } catch (Exception e) {
            return handleRuntimeError(e, "getTrainingStatus");
        }
    }

    @GetMapping("/artifacts")
    public ResponseEntity<?> getTrainingArtifacts() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getTrainingArtifacts());
        } catch (Exception e) {
            return handleRuntimeError(e, "getTrainingArtifacts");
        }
    }

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
                    "message", "Cannot connect to LeRobot runtime container"));
        }
        log.error("{}: unexpected error", context, e);
        String msg = (e.getMessage() != null) ? e.getMessage() : e.getClass().getSimpleName();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "code", "GATEWAY_ERROR",
                "message", msg));
    }
}
