package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SelectCalibrationArtifactRequest(
        @JsonProperty("artifactId") String artifactId
) {
}
