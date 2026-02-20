package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TeleopJointSetRequest(
        @JsonProperty("jointId") String jointId,
        @JsonProperty("value") Double value
) {
}
