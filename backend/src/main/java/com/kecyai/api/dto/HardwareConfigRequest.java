package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record HardwareConfigRequest(
        @JsonProperty("serial_port") String serialPort,
        @JsonProperty("robot_type") String robotType,
        @JsonProperty("driver") String driver,
        @JsonProperty("dry_run") Boolean dryRun
) {
}
