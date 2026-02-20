package com.kecyai.api;

import java.util.List;

public record ApiErrorResponse(
        String code,
        String message,
        List<String> details
) {
    public static ApiErrorResponse of(String code, String message) {
        return new ApiErrorResponse(code, message, List.of());
    }
}
