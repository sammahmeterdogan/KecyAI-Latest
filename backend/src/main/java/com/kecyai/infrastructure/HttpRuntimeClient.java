package com.kecyai.infrastructure;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kecyai.domain.RuntimeClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * HTTP adapter implementing RuntimeClient.
 * Talks to the LeRobot Python runtime container via REST.
 *
 * Uses exchangeToMono (NOT retrieve) for all mutating endpoints.
 * This bypasses Spring's default 4xx/5xx -> exception conversion,
 * giving us explicit control over status code + body propagation.
 * The controller layer catches RuntimeClientException and forwards
 * the original runtime HTTP status + body to the frontend.
 */
@Component
@Slf4j
public class HttpRuntimeClient implements RuntimeClient {

        private final WebClient webClient;
        private final ObjectMapper objectMapper = new ObjectMapper();

        public HttpRuntimeClient(@Value("${lerobot.runtime.base-url}") String runtimeBaseUrl,
                        WebClient.Builder webClientBuilder) {
                this.webClient = webClientBuilder.baseUrl(runtimeBaseUrl).build();
        }

// ----------------------------------------------------------------
        // Helpers: safe body parsing + exchangeToMono
// ----------------------------------------------------------------

        /**
         * Safely parse a response body string into a Map.
         * Never throws. Returns a fallback map if parsing fails.
         */
        private Map<String, Object> parseJsonSafe(String body) {
                if (body == null || body.isBlank()) {
                        Map<String, Object> fallback = new LinkedHashMap<>();
                        fallback.put("code", "RUNTIME_ERROR");
                        fallback.put("message", "Empty response body from runtime");
                        return fallback;
                }
                try {
                        return objectMapper.readValue(body, new TypeReference<Map<String, Object>>() {
                        });
                } catch (Exception e) {
                        // Body is not JSON -- wrap the raw text as the message
                        Map<String, Object> fallback = new LinkedHashMap<>();
                        fallback.put("code", "RUNTIME_ERROR");
                        fallback.put("message", body);
                        return fallback;
                }
        }

        /**
         * Core handler for non-2xx runtime responses.
         * Reads body as raw String (never fails), parses it safely,
         * and wraps into a RuntimeClientException preserving HTTP status.
         */
        private Mono<Map<String, Object>> handleNon2xx(ClientResponse response) {
                return response.bodyToMono(String.class)
                                .defaultIfEmpty("")
                                .flatMap(body -> {
                                        log.warn("Runtime returned {} for request. Body: {}",
                                                        response.statusCode().value(), body);
                                        return Mono.error(new RuntimeClientException(
                                                        response.statusCode(),
                                                        parseJsonSafe(body)));
                                });
        }

        /** Reusable type reference to avoid raw Map.class in bodyToMono. */
        private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE = new ParameterizedTypeReference<>() {
        };

        /**
         * POST with body. Uses exchangeToMono to explicitly handle
         * every status code without relying on retrieve()'s default
         * status handler (which can silently convert 409 -> exception
         * in a way that onErrorMap misses during block()).
         */
        private Map<String, Object> postForMap(String uri, Object body) {
                return webClient.post()
                                .uri(uri)
                                .bodyValue(body != null ? body : Map.of())
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

        /**
         * POST without body.
         */
        private Map<String, Object> postForMapNoBody(String uri) {
                return webClient.post()
                                .uri(uri)
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

// ----------------------------------------------------------------
        // Base Metadata (GET -- safe to use retrieve)
// ----------------------------------------------------------------

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getHealth() {
                return webClient.get()
                                .uri("/health")
                                .retrieve()
                                .bodyToMono(Map.class)
                                .onErrorReturn(Map.of("status", "unreachable", "error", "Runtime not responding"))
                                .block();
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getVersion() {
                return webClient.get()
                                .uri("/version")
                                .retrieve()
                                .bodyToMono(Map.class)
                                .block();
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getCapabilities() {
                return webClient.get()
                                .uri("/capabilities")
                                .retrieve()
                                .bodyToMono(Map.class)
                                .block();
        }

// ----------------------------------------------------------------
        // Teleop Control (POST -- must use exchangeToMono)
// ----------------------------------------------------------------

        @Override
        public Map<String, Object> startTeleop(Map<String, Object> config) {
                return postForMap("/teleop/start", config);
        }

        @Override
        public Map<String, Object> stopTeleop() {
                return postForMapNoBody("/teleop/stop");
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getTeleopStatus() {
                return webClient.get()
                                .uri("/teleop/status")
                                .retrieve()
                                .bodyToMono(Map.class)
                                .onErrorReturn(Map.of("state", "unknown", "error", "Runtime unreachable"))
                                .block();
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getTeleopLogs(int tail) {
                return webClient.get()
                                .uri(uriBuilder -> uriBuilder.path("/teleop/logs")
                                                .queryParam("tail", tail).build())
                                .retrieve()
                                .bodyToMono(Map.class)
                                .onErrorReturn(Map.of("logs", java.util.List.of("Failed to fetch logs")))
                                .block();
        }

// ----------------------------------------------------------------
        // Joint Control (POST -- must use exchangeToMono)
// ----------------------------------------------------------------

        @Override
        public void setJoint(String jointId, double value) {
                // setJoint uses the same exchangeToMono pattern;
                // discard the response body on success.
                postForMap("/teleop/joints/set", Map.of("jointId", jointId, "value", value));
        }

        @Override
        public Map<String, Object> sendCommand(Map<String, Object> command) {
                return postForMap("/teleop/command", command);
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getJoints() {
                return webClient.get()
                                .uri("/teleop/joints")
                                .retrieve()
                                .bodyToMono(Map.class)
                                .onErrorReturn(Map.of("joints", java.util.List.of()))
                                .block();
        }

        @Override
        public Map<String, Object> moveHomePose() {
                return postForMapNoBody("/teleop/pose/home");
        }

        @Override
        public Map<String, Object> moveReadyPose() {
                return postForMapNoBody("/teleop/pose/ready");
        }

        @Override
        public Map<String, Object> openGripper() {
                return postForMapNoBody("/teleop/gripper/open");
        }

        @Override
        public Map<String, Object> closeGripper() {
                return postForMapNoBody("/teleop/gripper/close");
        }

        @Override
        public Map<String, Object> estopOn() {
                return postForMapNoBody("/teleop/estop/on");
        }

        @Override
        public Map<String, Object> estopOff() {
                return postForMapNoBody("/teleop/estop/off");
        }

        @Override
        public Map<String, Object> readTorque(Integer robotId) {
                return postForMap("/teleop/torque/read", Map.of());
        }

        @Override
        public Map<String, Object> toggleTorque(Integer robotId, boolean torqueStatus) {
                return postForMap("/teleop/torque/toggle", Map.of("torque_status", torqueStatus));
        }

// ----------------------------------------------------------------
        // Calibration
// ----------------------------------------------------------------

        @Override
        public Map<String, Object> getCalibrationStatus() {
                return webClient.get()
                                .uri("/calibration/status")
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

        @Override
        public Map<String, Object> startCalibration(Map<String, Object> config) {
                return postForMap("/calibration/start", config);
        }

        @Override
        public Map<String, Object> stepCalibration(Map<String, Object> config) {
                return postForMap("/calibration/step", config != null ? config : Map.of());
        }

        @Override
        public Map<String, Object> stopCalibration() {
                return postForMapNoBody("/calibration/stop");
        }

// ----------------------------------------------------------------
        // Admin / Hardware
// ----------------------------------------------------------------

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getCalibrationArtifacts() {
                return webClient.get()
                                .uri("/admin/calibration/list")
                                .retrieve()
                                .bodyToMono(Map.class)
                                .block();
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getLatestCalibrationArtifact(String robotType) {
                return webClient.get()
                                .uri(uriBuilder -> uriBuilder.path("/admin/calibration/latest")
                                                .queryParam("robot_type", robotType).build())
                                .retrieve()
                                .bodyToMono(Map.class)
                                .onErrorResume(e -> Mono.empty()) // Return empty/null if 404
                                .block();
        }

        @Override
        public Map<String, Object> selectCalibrationArtifact(String artifactId) {
                return postForMap("/admin/calibration/select", Map.of("artifactId", artifactId));
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getPreflightChecks(Map<String, Object> config) {
                String robotType = (config != null && config.get("robot_type") != null)
                                ? config.get("robot_type").toString()
                                : "so101_follower";

                return webClient.get()
                                .uri(uriBuilder -> uriBuilder.path("/admin/preflight")
                                                .queryParam("robot_type", robotType).build())
                                .retrieve()
                                .bodyToMono(Map.class)
                                .block();
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> getHardwareConfig() {
                return webClient.get()
                                .uri("/admin/config")
                                .retrieve()
                                .bodyToMono(Map.class)
                                .block();
        }

        @Override
        public Map<String, Object> setHardwareConfig(Map<String, Object> config) {
                return postForMap("/admin/config", config);
        }

        @Override
        public Map<String, Object> scanMotorPorts() {
                return webClient.get()
                                .uri("/admin/ports/scan")
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

        @Override
        public Map<String, Object> startMotorSetupSession(Map<String, Object> config) {
                return postForMap("/admin/motors/setup/start", config != null ? config : Map.of());
        }

        @Override
        public Map<String, Object> getMotorSetupSessionStatus() {
                return webClient.get()
                                .uri("/admin/motors/setup/status")
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

        @Override
        public Map<String, Object> sendMotorSetupEnter(Map<String, Object> payload) {
                return postForMap("/admin/motors/setup/enter", payload != null ? payload : Map.of());
        }

        @Override
        public Map<String, Object> stopMotorSetupSession() {
                return postForMapNoBody("/admin/motors/setup/stop");
        }

        @Override
        public Map<String, Object> getMotorSetupLogs(Integer since, Integer tail) {
                return webClient.get()
                                .uri(uriBuilder -> {
                                        var builder = uriBuilder.path("/admin/motors/setup/logs");
                                        if (since != null) {
                                                builder = builder.queryParam("since", since);
                                        }
                                        if (tail != null) {
                                                builder = builder.queryParam("tail", tail);
                                        }
                                        return builder.build();
                                })
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

// ----------------------------------------------------------------
        // Recording (POST + GET)
// ----------------------------------------------------------------

        @Override
        public Map<String, Object> startRecording(Map<String, Object> config) {
                return postForMap("/recording/start", config);
        }

        @Override
        public Map<String, Object> stopRecording(Map<String, Object> config) {
                return postForMap("/recording/stop", config != null ? config : Map.of());
        }

        @Override
        public Map<String, Object> replayRecording(Map<String, Object> config) {
                return postForMap("/recording/replay", config != null ? config : Map.of());
        }

        @Override
        public Map<String, Object> getRecordingStatus() {
                return webClient.get()
                                .uri("/recording/status")
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

        @Override
        public Map<String, Object> getDatasets() {
                return webClient.get()
                                .uri("/recording/datasets")
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

// ----------------------------------------------------------------
        // Training (POST + GET)
// ----------------------------------------------------------------

        @Override
        public Map<String, Object> startTraining(Map<String, Object> config) {
                return postForMap("/train/start", config);
        }

        @Override
        public Map<String, Object> stopTraining() {
                return postForMapNoBody("/train/stop");
        }

        @Override
        public Map<String, Object> getTrainingStatus() {
                return webClient.get()
                                .uri("/train/status")
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

        @Override
        public Map<String, Object> getTrainingArtifacts() {
                return webClient.get()
                                .uri("/train/artifacts")
                                .exchangeToMono(response -> {
                                        if (response.statusCode().is2xxSuccessful()) {
                                                return response.bodyToMono(MAP_TYPE)
                                                                .defaultIfEmpty(Map.of());
                                        }
                                        return handleNon2xx(response);
                                })
                                .block();
        }

// ----------------------------------------------------------------
        // Telemetry Stream (SSE -- uses retrieve, OK)
// ----------------------------------------------------------------

        public WebClient getWebClient() {
                return webClient;
        }

        @Override
        public reactor.core.publisher.Flux<Map<String, Object>> getTelemetryStream() {
                return webClient.get()
                                .uri("/teleop/telemetry/stream")
                                .accept(org.springframework.http.MediaType.TEXT_EVENT_STREAM)
                                .retrieve()
                                .bodyToFlux(
                                                new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {
                                                });
        }

// ----------------------------------------------------------------
        // Inner Exception (preserves runtime HTTP status + body)
// ----------------------------------------------------------------

        /**
         * Carries the exact HTTP status code and parsed JSON body from the
         * runtime container. The controller catches this and returns
         * ResponseEntity.status(statusCode).body(body) -- no 500 wrapping.
         */
        public static class RuntimeClientException extends RuntimeException {
                private final HttpStatusCode statusCode;
                private final Map<String, Object> body;

                public RuntimeClientException(HttpStatusCode statusCode, Map<String, Object> body) {
                        super(buildMessage(statusCode, body));
                        this.statusCode = statusCode;
                        this.body = body;
                }

                public HttpStatusCode getStatusCode() {
                        return statusCode;
                }

                public Map<String, Object> getBody() {
                        return body;
                }

                private static String buildMessage(HttpStatusCode code, Map<String, Object> body) {
                        Object msg = (body != null) ? body.getOrDefault("message", "Runtime error") : "Runtime error";
                        return "Runtime " + code.value() + ": " + msg;
                }
        }
}
