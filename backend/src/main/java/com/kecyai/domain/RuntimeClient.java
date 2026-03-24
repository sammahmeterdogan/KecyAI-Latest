package com.kecyai.domain;

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

    /** Read current motor torque values. */
    Map<String, Object> readTorque(Integer robotId);

    /** Enable or disable motor torque. */
    Map<String, Object> toggleTorque(Integer robotId, boolean torqueStatus);

    /**
     * Subscribe to realtime telemetry stream.
     */
    reactor.core.publisher.Flux<Map<String, Object>> getTelemetryStream();

// ----------------------------------------------------------------

    /** Get calibration session status. */
    Map<String, Object> getCalibrationStatus();

    /** Start a calibration session. */
    Map<String, Object> startCalibration(Map<String, Object> config);

    /** Advance calibration to next step. */
    Map<String, Object> stepCalibration(Map<String, Object> config);

    /** Stop the current calibration session. */
    Map<String, Object> stopCalibration();

// ----------------------------------------------------------------

    Map<String, Object> getPreflightChecks(Map<String, Object> config);

    Map<String, Object> getCalibrationArtifacts();

    Map<String, Object> getLatestCalibrationArtifact(String robotType);

    Map<String, Object> selectCalibrationArtifact(String artifactId);

    /** Get current hardware configuration from runtime. */
    Map<String, Object> getHardwareConfig();

    /** Update hardware configuration on runtime. */
    Map<String, Object> setHardwareConfig(Map<String, Object> config);

    /** Scan available MotorBus serial ports and include runtime console output. */
    Map<String, Object> scanMotorPorts();

    /** Start interactive motor setup session (lerobot-setup-motors). */
    Map<String, Object> startMotorSetupSession(Map<String, Object> config);

    /** Get current motor setup session status. */
    Map<String, Object> getMotorSetupSessionStatus();

    /** Send Enter key press to running motor setup process. */
    Map<String, Object> sendMotorSetupEnter(Map<String, Object> payload);

    /** Stop the current motor setup session. */
    Map<String, Object> stopMotorSetupSession();

    /** Read motor setup logs (tail or incremental via cursor). */
    Map<String, Object> getMotorSetupLogs(Integer since, Integer tail);

// ----------------------------------------------------------------

    Map<String, Object> startRecording(Map<String, Object> config);

    Map<String, Object> stopRecording(Map<String, Object> config);

    Map<String, Object> replayRecording(Map<String, Object> config);

    Map<String, Object> getRecordingStatus();

    Map<String, Object> getDatasets();

// ----------------------------------------------------------------

    Map<String, Object> startTraining(Map<String, Object> config);

    Map<String, Object> stopTraining();

    Map<String, Object> getTrainingStatus();

    Map<String, Object> getTrainingArtifacts();
}
