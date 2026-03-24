import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lerobotClient } from "../../lib/api/lerobotClient";

type TeleopStatus = {
    state: "idle" | "starting" | "running" | "stopping" | "error";
    message?: string;
    started_at?: string;
};

type TeleopConfig = {
    leader?: string;
    follower?: string;
    port?: string;
};

export function useTeleopSession() {
    const [runtimeOnline, setRuntimeOnline] = useState<boolean>(true);
    const [status, setStatus] = useState<TeleopStatus>({ state: "idle" });
    const [logs, setLogs] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);
    const [error, setError] = useState<string>("");

    const logTimerRef = useRef<number | null>(null);
    const statusTimerRef = useRef<number | null>(null);

    const refreshRuntime = useCallback(async () => {
        try {
            await lerobotClient.getHealth();
            setRuntimeOnline(true);
            setError("");
        } catch (e: any) {
            setRuntimeOnline(false);
            setError("Runtime offline");
        }
    }, []);

    const refreshStatus = useCallback(async () => {
        try {
            const s = await lerobotClient.teleopStatus();
            setStatus(s);
            setError("");
        } catch (e: any) {
            setError("Failed to fetch teleop status");
        }
    }, []);

    const refreshLogs = useCallback(async () => {
        try {
            const l = await lerobotClient.teleopLogs();
            const logArr = l?.logs ?? [];
            setLogs(Array.isArray(logArr) ? logArr.join('\n') : String(logArr));
        } catch (e: any) {
            // keep last logs; do not spam errors
        }
    }, []);

    const start = useCallback(async (cfg: TeleopConfig) => {
        setBusy(true);
        setError("");
        try {
            await lerobotClient.teleopStart({
                robot_type: cfg.follower ?? 'so101_follower',
                teleop_type: cfg.leader ?? 'web',
            });
            await refreshStatus();
            await refreshLogs();
        } catch (e: any) {
            setError("Failed to start teleop");
        } finally {
            setBusy(false);
        }
    }, [refreshLogs, refreshStatus]);

    const stop = useCallback(async () => {
        setBusy(true);
        setError("");
        try {
            await lerobotClient.teleopStop();
            await refreshStatus();
            await refreshLogs();
        } catch (e: any) {
            setError("Failed to stop teleop");
        } finally {
            setBusy(false);
        }
    }, [refreshLogs, refreshStatus]);

    useEffect(() => {
        refreshRuntime();
        refreshStatus();
        refreshLogs();

        // Poll status + logs
        statusTimerRef.current = window.setInterval(() => {
            refreshRuntime();
            refreshStatus();
        }, 1000);

        logTimerRef.current = window.setInterval(() => {
            refreshLogs();
        }, 1000);

        return () => {
            if (statusTimerRef.current) window.clearInterval(statusTimerRef.current);
            if (logTimerRef.current) window.clearInterval(logTimerRef.current);
        };
    }, [refreshLogs, refreshRuntime, refreshStatus]);

    const canStart = runtimeOnline && !busy && (status.state === "idle" || status.state === "error");
    const canStop = runtimeOnline && !busy && (status.state === "running" || status.state === "starting");

    return {
        runtimeOnline,
        status,
        logs,
        busy,
        error,
        canStart,
        canStop,
        start,
        stop,
    };
}
