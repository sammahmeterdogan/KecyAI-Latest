package com.kecyai.api;

import com.kecyai.api.dto.TrainingStartRequest;
import com.kecyai.domain.RuntimeClient;
import com.kecyai.domain.RuntimeOrchestrator;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/lerobot/train")
@RequiredArgsConstructor
public class TrainingController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    @PostMapping("/start")
    public ResponseEntity<?> startTraining(@RequestBody(required = false) TrainingStartRequest config) {
        orchestrator.ensureRuntimeReady();
        if (config == null || config.datasetId() == null || config.datasetId().isBlank()) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(
                    "VALIDATION_ERROR",
                    "Missing required field: 'dataset_id'",
                    java.util.List.of()));
        }
        return ResponseEntity.ok(runtimeClient.startTraining(toConfigMap(config)));
    }

    @PostMapping("/stop")
    public ResponseEntity<?> stopTraining() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.stopTraining());
    }

    @GetMapping("/status")
    public ResponseEntity<?> getTrainingStatus() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.getTrainingStatus());
    }

    @GetMapping("/artifacts")
    public ResponseEntity<?> getTrainingArtifacts() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.getTrainingArtifacts());
    }

    private static Map<String, Object> toConfigMap(TrainingStartRequest config) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("dataset_id", config.datasetId());
        if (config.policyType() != null) payload.put("policy_type", config.policyType());
        if (config.numSteps() != null) payload.put("num_steps", config.numSteps());
        if (config.batchSize() != null) payload.put("batch_size", config.batchSize());
        return payload;
    }
}
