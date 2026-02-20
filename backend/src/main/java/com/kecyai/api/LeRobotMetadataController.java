package com.kecyai.api;

import com.kecyai.application.LeRobotQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/lerobot")
@RequiredArgsConstructor
public class LeRobotMetadataController {

    private final LeRobotQueryService queryService;

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
}
