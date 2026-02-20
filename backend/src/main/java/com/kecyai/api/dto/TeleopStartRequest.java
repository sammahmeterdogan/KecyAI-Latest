package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TeleopStartRequest(
        @JsonProperty("robot_type") String robotType,
        @JsonProperty("teleop_type") String teleopType
) {
}
