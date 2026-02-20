package com.kecyai.api;

import com.kecyai.api.dto.RecordingStartRequest;
import com.kecyai.domain.RuntimeClient;
import com.kecyai.domain.RuntimeOrchestrator;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/lerobot/recording")
@RequiredArgsConstructor
public class RecordingController {

    private final RuntimeClient runtimeClient;
    private final RuntimeOrchestrator orchestrator;

    @PostMapping("/start")
    public ResponseEntity<?> startRecording(@RequestBody(required = false) RecordingStartRequest config) {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.startRecording(toConfigMap(config)));
    }

    @PostMapping("/stop")
    public ResponseEntity<?> stopRecording() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.stopRecording());
    }

    @GetMapping("/status")
    public ResponseEntity<?> getRecordingStatus() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.getRecordingStatus());
    }

    @GetMapping("/datasets")
    public ResponseEntity<?> getDatasets() {
        orchestrator.ensureRuntimeReady();
        return ResponseEntity.ok(runtimeClient.getDatasets());
    }

    private static Map<String, Object> toConfigMap(RecordingStartRequest config) {
        if (config == null) {
            return Map.of();
        }
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        if (config.robotType() != null) payload.put("robot_type", config.robotType());
        if (config.mode() != null) payload.put("mode", config.mode());
        if (config.episodeDurationSec() != null) payload.put("episode_duration_sec", config.episodeDurationSec());
        if (config.numEpisodes() != null) payload.put("num_episodes", config.numEpisodes());
        return payload;
    }
}
