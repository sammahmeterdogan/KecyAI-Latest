package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TeleopJointCommand(
        @JsonProperty("id") String id,
        @JsonProperty("position") Double position
) {
}
