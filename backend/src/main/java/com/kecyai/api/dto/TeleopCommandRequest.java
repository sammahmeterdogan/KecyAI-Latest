package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record TeleopCommandRequest(
        @JsonProperty("mode") String mode,
        @JsonProperty("joints") List<TeleopJointCommand> joints
) {
}
