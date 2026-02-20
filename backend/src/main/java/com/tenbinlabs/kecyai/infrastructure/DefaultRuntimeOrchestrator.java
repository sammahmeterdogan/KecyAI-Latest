package com.tenbinlabs.kecyai.infrastructure;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.exception.DockerException;
import com.github.dockerjava.api.exception.NotFoundException;
import com.github.dockerjava.core.DefaultDockerClientConfig;
import com.github.dockerjava.core.DockerClientConfig;
import com.github.dockerjava.core.DockerClientImpl;
import com.github.dockerjava.httpclient5.ApacheDockerHttpClient;
import com.github.dockerjava.transport.DockerHttpClient;
import com.tenbinlabs.kecyai.domain.RuntimeClient;
import com.tenbinlabs.kecyai.domain.RuntimeNotReadyException;
import com.tenbinlabs.kecyai.domain.RuntimeOrchestrator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Default orchestrator: health check → optional Docker autostart → poll.
 *
 * Thread-safety: a ReentrantLock prevents concurrent autostart attempts.
 * After a failed start, a 60-second cooldown avoids rapid Docker spam.
 */
@Component
@Slf4j
public class DefaultRuntimeOrchestrator implements RuntimeOrchestrator {

    private final RuntimeClient runtimeClient;
    private final RuntimeProperties props;

    // Concurrency guard for autostart
    private final ReentrantLock startLock = new ReentrantLock();
    private volatile long lastFailedAttemptMs = 0;
    private static final long COOLDOWN_MS = 60_000; // 1 min cooldown after failure

    public DefaultRuntimeOrchestrator(RuntimeClient runtimeClient,
            RuntimeProperties props) {
        this.runtimeClient = runtimeClient;
        this.props = props;
        log.info("RuntimeOrchestrator initialised. autostart={}, timeout={}s, container={}",
                props.isEnabled(), props.getTimeoutSeconds(), props.getContainerName());
    }

    // ─────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────

    @Override
    public void ensureRuntimeReady() {
        // Fast path: runtime already healthy → done
        if (isRuntimeHealthy()) {
            return;
        }

        // Autostart disabled → fail immediately with structured error
        if (!props.isEnabled()) {
            throw new RuntimeNotReadyException(
                    "RUNTIME_UNREACHABLE",
                    "Runtime is offline and autostart is disabled. "
                            + "Start manually: docker compose -f infra/compose/docker-compose.yml up -d runtime");
        }

        // Autostart enabled → try Docker start (with lock + cooldown)
        attemptAutostart();
    }

    // ─────────────────────────────────────────────
    // Health probe
    // ─────────────────────────────────────────────

    private boolean isRuntimeHealthy() {
        try {
            Map<String, Object> health = runtimeClient.getHealth();
            return "ok".equals(health.get("status"));
        } catch (Exception e) {
            return false;
        }
    }

    // ─────────────────────────────────────────────
    // Docker autostart (locked, with cooldown)
    // ─────────────────────────────────────────────

    private void attemptAutostart() {
        // Cooldown: don't retry too frequently after a failed attempt
        long now = System.currentTimeMillis();
        if (now - lastFailedAttemptMs < COOLDOWN_MS) {
            throw new RuntimeNotReadyException(
                    "RUNTIME_UNREACHABLE",
                    "Runtime is offline. Last autostart attempt failed; "
                            + "retry after cooldown (" + (COOLDOWN_MS / 1000) + "s).");
        }

        if (!startLock.tryLock()) {
            // Another thread is already auto-starting; wait for it
            startLock.lock();
            startLock.unlock();
            // Re-check health after the other thread finishes
            if (isRuntimeHealthy())
                return;
            throw new RuntimeNotReadyException(
                    "RUNTIME_UNREACHABLE",
                    "Runtime is still offline after concurrent autostart attempt.");
        }

        try {
            log.info("Autostart: attempting Docker start for container '{}'",
                    props.getContainerName());
            startContainerViaDocker();
            pollUntilHealthy();
            log.info("Autostart: runtime is now healthy");
        } catch (RuntimeNotReadyException e) {
            lastFailedAttemptMs = System.currentTimeMillis();
            throw e;
        } catch (Exception e) {
            lastFailedAttemptMs = System.currentTimeMillis();
            throw new RuntimeNotReadyException("DOCKER_UNAVAILABLE",
                    "Cannot access Docker daemon: " + e.getMessage(),
                    List.of("Ensure /var/run/docker.sock is mounted into the backend container",
                            "Or start runtime manually: docker compose -f infra/compose/docker-compose.yml up -d runtime"));
        } finally {
            startLock.unlock();
        }
    }

    // ─────────────────────────────────────────────
    // Docker client operations
    // ─────────────────────────────────────────────

    /**
     * Creates a short-lived Docker client, inspects the container,
     * and starts it if not running. Closes the client when done.
     */
    private void startContainerViaDocker() {
        DockerClientConfig config = DefaultDockerClientConfig
                .createDefaultConfigBuilder()
                .build();

        DockerHttpClient httpClient = new ApacheDockerHttpClient.Builder()
                .dockerHost(config.getDockerHost())
                .maxConnections(4)
                .connectionTimeout(Duration.ofSeconds(5))
                .responseTimeout(Duration.ofSeconds(10))
                .build();

        try (DockerClient docker = DockerClientImpl.getInstance(config, httpClient)) {
            String name = props.getContainerName();

            // Inspect container state
            try {
                var info = docker.inspectContainerCmd(name).exec();
                Boolean running = info.getState().getRunning();

                if (Boolean.TRUE.equals(running)) {
                    log.info("Container '{}' is already running; waiting for health...", name);
                    return;
                }

                log.info("Container '{}' state={}; issuing start...", name,
                        info.getState().getStatus());
                docker.startContainerCmd(info.getId()).exec();

            } catch (NotFoundException e) {
                throw new RuntimeNotReadyException("RUNTIME_START_FAILED",
                        "Container '" + name + "' not found. "
                                + "Create it first with: docker compose -f infra/compose/docker-compose.yml up -d runtime",
                        List.of("Container name: " + name));
            } catch (DockerException e) {
                throw new RuntimeNotReadyException("RUNTIME_START_FAILED",
                        "Docker start failed: " + e.getMessage());
            }
        } catch (RuntimeNotReadyException e) {
            throw e; // re-throw our structured exceptions
        } catch (Exception e) {
            throw new RuntimeNotReadyException("DOCKER_UNAVAILABLE",
                    "Docker daemon not reachable: " + e.getMessage(),
                    List.of("Check docker.sock mount or Docker Desktop status"));
        }
    }

    /**
     * Polls runtime /health every 1 s until OK or timeout.
     */
    private void pollUntilHealthy() {
        long deadlineMs = System.currentTimeMillis()
                + (props.getTimeoutSeconds() * 1000L);

        while (System.currentTimeMillis() < deadlineMs) {
            if (isRuntimeHealthy()) {
                return;
            }
            try {
                // noinspection BusyWait
                Thread.sleep(1_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }

        throw new RuntimeNotReadyException("RUNTIME_START_TIMEOUT",
                "Runtime did not become healthy within "
                        + props.getTimeoutSeconds() + " seconds.",
                List.of("Container may still be booting; check docker logs "
                        + props.getContainerName()));
    }
}
