package com.kecyai.application;

import com.kecyai.domain.RuntimeClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
@RequiredArgsConstructor
public class LeRobotQueryService {

    private final RuntimeClient runtimeClient;

    public Map<String, Object> getSystemHealth() {
        return runtimeClient.getHealth();
    }

    public Map<String, Object> getSystemVersion() {
        return runtimeClient.getVersion();
    }

    public Map<String, Object> getCapabilities() {
        return runtimeClient.getCapabilities();
    }
}
