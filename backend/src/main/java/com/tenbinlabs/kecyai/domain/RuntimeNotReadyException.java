package com.tenbinlabs.kecyai.domain;

import java.util.List;

/**
 * Thrown when the runtime cannot be made reachable.
 * Carries a machine-readable {@code code} and optional details
 * so the controller can return a structured error body.
 *
 * Codes:
 *   RUNTIME_UNREACHABLE   — health check failed, autostart disabled
 *   DOCKER_UNAVAILABLE    — cannot reach Docker daemon (socket missing)
 *   RUNTIME_START_FAILED  — container not found or start command failed
 *   RUNTIME_START_TIMEOUT — container started but health didn't pass in time
 */
public class RuntimeNotReadyException extends RuntimeException {

    private final String code;
    private final List<String> details;

    public RuntimeNotReadyException(String code, String message) {
        this(code, message, List.of());
    }

    public RuntimeNotReadyException(String code, String message, List<String> details) {
        super(message);
        this.code = code;
        this.details = details != null ? details : List.of();
    }

    public String getCode() {
        return code;
    }

    public List<String> getDetails() {
        return details;
    }
}
