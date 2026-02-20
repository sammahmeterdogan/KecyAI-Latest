package com.kecyai.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TrainingStartRequest(
        @JsonProperty("dataset_id") String datasetId,
        @JsonProperty("policy_type") String policyType,
        @JsonProperty("num_steps") Integer numSteps,
        @JsonProperty("batch_size") Integer batchSize
) {
}
