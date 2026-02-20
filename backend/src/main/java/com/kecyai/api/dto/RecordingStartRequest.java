package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record RecordingStartRequest(
        @JsonProperty("robot_type") String robotType,
        @JsonProperty("mode") String mode,
        @JsonProperty("episode_duration_sec") Integer episodeDurationSec,
        @JsonProperty("num_episodes") Integer numEpisodes
) {
}
