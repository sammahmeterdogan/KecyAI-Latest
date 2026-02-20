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
@RequestMapping("/api/lerobot/recording")
@RequiredArgsConstructor
@Slf4j
public class RecordingController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    @PostMapping("/start")
    public ResponseEntity<?> startRecording(@RequestBody(required = false) Map<String, Object> config) {
        try {
            orchestrator.ensureRuntimeReady();
            if (config == null) {
                config = Map.of();
            }
            return ResponseEntity.ok(runtimeClient.startRecording(config));
        } catch (Exception e) {
            return handleRuntimeError(e, "startRecording");
        }
    }

    @PostMapping("/stop")
    public ResponseEntity<?> stopRecording() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.stopRecording());
        } catch (Exception e) {
            return handleRuntimeError(e, "stopRecording");
        }
    }

    @GetMapping("/status")
    public ResponseEntity<?> getRecordingStatus() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getRecordingStatus());
        } catch (Exception e) {
            return handleRuntimeError(e, "getRecordingStatus");
        }
    }

    @GetMapping("/datasets")
    public ResponseEntity<?> getDatasets() {
        try {
            orchestrator.ensureRuntimeReady();
            return ResponseEntity.ok(runtimeClient.getDatasets());
        } catch (Exception e) {
            return handleRuntimeError(e, "getDatasets");
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
