package com.tenbinlabs.kecyai.domain;

import java.util.Map;

/**
 * Contract for all communication with the LeRobot Python runtime container.
 */
public interface RuntimeClient {
    Map<String, Object> getHealth();

    Map<String, Object> getVersion();

    Map<String, Object> getCapabilities();

    Map<String, Object> startTeleop(Map<String, Object> config);

    Map<String, Object> stopTeleop();

    Map<String, Object> getTeleopStatus();

    Map<String, Object> getTeleopLogs(int tail);

    void setJoint(String jointId, double value);

    /** Batch joint command: {joints: [{id, position}, ...]} */
    Map<String, Object> sendCommand(Map<String, Object> command);

    /** Get current joint positions from runtime adapter. */
    Map<String, Object> getJoints();

    Map<String, Object> moveHomePose();

    Map<String, Object> moveReadyPose();

    Map<String, Object> openGripper();

    Map<String, Object> closeGripper();

    /** Engage emergency stop. */
    Map<String, Object> estopOn();

    /** Release emergency stop. */
    Map<String, Object> estopOff();

    /**
     * Subscribe to realtime telemetry stream.
     */
    reactor.core.publisher.Flux<Map<String, Object>> getTelemetryStream();

    // ─── Calibration ───

    /** Get calibration session status. */
    Map<String, Object> getCalibrationStatus();

    /** Start a calibration session. */
    Map<String, Object> startCalibration(Map<String, Object> config);

    /** Advance calibration to next step. */
    Map<String, Object> stepCalibration(Map<String, Object> config);

    /** Stop the current calibration session. */
    Map<String, Object> stopCalibration();

    // ─── Admin / Hardware ───

    Map<String, Object> getPreflightChecks(Map<String, Object> config);

    Map<String, Object> getCalibrationArtifacts();

    Map<String, Object> getLatestCalibrationArtifact(String robotType);

    Map<String, Object> selectCalibrationArtifact(String artifactId);

    /** Get current hardware configuration from runtime. */
    Map<String, Object> getHardwareConfig();

    /** Update hardware configuration on runtime. */
    Map<String, Object> setHardwareConfig(Map<String, Object> config);

    // ─── Recording ───

    Map<String, Object> startRecording(Map<String, Object> config);

    Map<String, Object> stopRecording();

    Map<String, Object> getRecordingStatus();

    Map<String, Object> getDatasets();

    // ─── Training ───

    Map<String, Object> startTraining(Map<String, Object> config);

    Map<String, Object> stopTraining();

    Map<String, Object> getTrainingStatus();

    Map<String, Object> getTrainingArtifacts();
}
