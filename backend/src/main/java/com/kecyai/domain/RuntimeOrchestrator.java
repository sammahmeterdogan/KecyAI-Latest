package com.kecyai.domain;

/**
 * Ensures the LeRobot runtime container is reachable before any
 * endpoint touches it.
 *
 * Default (autostart=false): fast health check; throws if unreachable.
 * Autostart enabled: starts the Docker container then polls health.
 */
public interface RuntimeOrchestrator {

    /**
     * Guarantees the runtime is healthy after this call returns.
     *
     * @throws RuntimeNotReadyException if runtime cannot be made ready
     *         (unreachable, docker unavailable, timeout, etc.)
     */
    void ensureRuntimeReady();
}
