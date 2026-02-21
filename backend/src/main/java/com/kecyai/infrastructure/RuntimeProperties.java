package com.kecyai.infrastructure;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration properties for runtime autostart.
 *
 * Mapped via Spring Boot relaxed binding:
 *   RUNTIME_AUTOSTART_ENABLED          â†’ runtime.autostart.enabled
 *   RUNTIME_AUTOSTART_TIMEOUT_SECONDS  â†’ runtime.autostart.timeout-seconds
 *   RUNTIME_AUTOSTART_CONTAINER_NAME   â†’ runtime.autostart.container-name
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "runtime.autostart")
public class RuntimeProperties {

    /** Master switch — false by default (safe). */
    private boolean enabled = false;

    /** Max seconds to wait for runtime health after docker start. */
    private int timeoutSeconds = 30;

    /** Docker container name to start (must exist from prior compose up). */
    private String containerName = "kecyai-runtime";
}


