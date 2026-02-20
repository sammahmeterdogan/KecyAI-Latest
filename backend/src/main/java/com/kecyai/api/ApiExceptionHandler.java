package com.kecyai.api;

import com.kecyai.domain.RuntimeNotReadyException;
import com.kecyai.infrastructure.HttpRuntimeClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.reactive.function.client.WebClientRequestException;

@RestControllerAdvice
@Slf4j
public class ApiExceptionHandler {

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleBadJson(HttpMessageNotReadableException ex) {
        log.warn("Malformed request body: {}", ex.getMessage());
        String detail = ex.getMostSpecificCause() != null ? ex.getMostSpecificCause().getMessage() : ex.getMessage();
        return ResponseEntity.badRequest().body(new ApiErrorResponse(
                "VALIDATION_ERROR",
                "Malformed or missing JSON request body",
                detail != null ? java.util.List.of(detail) : java.util.List.of()
        ));
    }

    @ExceptionHandler(RuntimeNotReadyException.class)
    public ResponseEntity<ApiErrorResponse> handleRuntimeNotReady(RuntimeNotReadyException ex) {
        log.warn("runtime not ready - {} [{}]", ex.getMessage(), ex.getCode());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ApiErrorResponse(ex.getCode(), ex.getMessage(), ex.getDetails()));
    }

    @ExceptionHandler(HttpRuntimeClient.RuntimeClientException.class)
    public ResponseEntity<?> handleRuntimeClientException(HttpRuntimeClient.RuntimeClientException ex) {
        log.warn("runtime returned {} -> {}", ex.getStatusCode(), ex.getBody());
        return ResponseEntity.status(ex.getStatusCode()).body(ex.getBody());
    }

    @ExceptionHandler(WebClientRequestException.class)
    public ResponseEntity<ApiErrorResponse> handleRuntimeUnreachable(WebClientRequestException ex) {
        log.error("runtime unreachable", ex);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(ApiErrorResponse.of("RUNTIME_UNREACHABLE", "Cannot connect to LeRobot runtime container"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception ex) {
        log.error("unexpected error", ex);
        String msg = (ex.getMessage() != null) ? ex.getMessage() : ex.getClass().getSimpleName();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiErrorResponse.of("GATEWAY_ERROR", msg));
    }
}
