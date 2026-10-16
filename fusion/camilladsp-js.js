"use strict";

const { execSync } = require("child_process");
const { spawn } = require("child_process");
const fs = require("fs");

let counter = 0;

/**
 * CamillaDsp class to handle the external process
 * spawned as child process
 */
let CamillaDsp = function (logger) {

    const cdPath = "/data/plugins/audio_interface/fusiondsp/camilladsp"
    const cdLog = "/tmp/camilladsp.log";
    const cdLogLevel = "warn";
    const cdPortWs = 9876;
    const cdPathConfig = "/data/configuration/audio_interface/fusiondsp/camilladsp.yml";

    // Respawn backoff settings
    const baseRespawnDelayMs = 1000;
    const maxRespawnDelayMs = 10000;
    const maxConsecutiveRespawns = 10;
    const respawnCountResetMs = 30000; // Reset count if up for this long

    // Stop settings
    const stopTimeoutMs = 3000;        // wait this long for SIGTERM before SIGKILL
    const stopPollIntervalMs = 50;
    const deviceReleaseDelayMs = 300;  // let ALSA finish releasing the output device

    let run = false;
    let camilla = null;
    let uniqueid = ++counter;

    // Respawn backoff state
    let consecutiveRespawns = 0;
    let lastSpawnTime = 0;
    let respawnStopped = false;

    /**
     * Listener for event sent on camilladsp process termination.
     * The process may terminate either because FIFO has been closed (hence
     * we need to respawn the process immediately) or because of an error.
     * In case of error, we wait with exponential backoff to avoid hogging CPU.
     * If too many consecutive quick respawns occur, stop respawning entirely.
     */
    let listenerClose = function(code, signal) {

        let timeout = 0;
        let uptime = Date.now() - lastSpawnTime;

        logger.debug("close event");

        // Nullify the camilla process since it has been fully terminated
        camilla = null;

        // .stop() has been called, hence the process is supposed to
        // not to be respawned. Just stop here in case.
        if (run === false)
            return;

        // If respawning was stopped due to too many failures, don't respawn
        if (respawnStopped) {
            logger.warn(`camilladsp respawn stopped due to repeated failures; not respawning`);
            return;
        }

        // Check uptime: if process was up long enough, reset respawn count
        if (uptime >= respawnCountResetMs) {
            consecutiveRespawns = 0;
        }

        // Increment consecutive respawn counter
        consecutiveRespawns++;

        // Check if we've exceeded max consecutive respawns
        if (consecutiveRespawns > maxConsecutiveRespawns) {
            logger.error(`camilladsp exceeded max consecutive respawns (${maxConsecutiveRespawns}); stopping respawn. Plugin restart required.`);
            respawnStopped = true;
            return;
        }

        // Calculate backoff delay: baseDelay * 2^(respawnCount-1), capped at maxDelay
        // For clean exit (code 0, e.g. FIFO closed), use shorter base delay
        if (code === 0) {
            timeout = Math.min(100 * Math.pow(2, consecutiveRespawns - 1), maxRespawnDelayMs);
        } else {
            timeout = Math.min(baseRespawnDelayMs * Math.pow(2, consecutiveRespawns - 1), maxRespawnDelayMs);
        }

        logger.debug(`camilladsp close event, exit code ${code}, signal ${signal}`);
        logger.info(`camilladsp respawn in ${timeout} ms (attempt ${consecutiveRespawns}/${maxConsecutiveRespawns})`);

        setTimeout(function() {

            if (run === false)
                return;

            // In case of error, cleanup the FIFO before starting, so it won't be
            // kept in wait state and stall the whole pipeline
            if (code > 0) {
                try {
                    execSync("/bin/dd if=/tmp/fusiondspfifo of=/dev/null bs=32k iflag=nonblock");
                } catch (e) {
                    // pass
                }
            }

            processSpawn();

        }, timeout);

    };

    /**
     * Listener for "exit" process: here process is terminated but
     * stdio is not yet closed (and we may still not have an exit code)
     */
    let listenerExit = function(code, signal) {

        logger.debug(`camilladsp exit event, exit code ${code}, signal ${signal}`);

    };

    /**
     * Private function to spawn the camilladsp process.
     * If the process is already started (ie: camilla !== null), does not
     * spawn another process. Returns true when a process was actually spawned.
     */
    let processSpawn = function() {

        let args;

        if (camilla !== null)
            return false;

        args = [
            "-p",
            cdPortWs,
            "-o",
            cdLog,
            "-l",
            cdLogLevel,
            cdPathConfig
        ];

        logger.debug(`camilladsp spawning process`);

        camilla = spawn(cdPath, args);
        lastSpawnTime = Date.now();

     //   logger.info(`camilladsp spawned new process with pid ${camilla.pid}, instance ${uniqueid}, run: ${run}`);

        //camilla.on("exit", listenerExit);
        camilla.on("close", listenerClose);

        return true;

    };

    /**
     * Blocking sleep. processStop() has to stay synchronous because index.js
     * calls stop(), then rebuilds the config, then calls start(), and relies on
     * the process being gone by the time stop() returns.
     */
    let sleepSync = function(ms) {

        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

    };

    /**
     * True once the process has terminated, whether or not it has been reaped.
     *
     * A zombie has to count as exited here. We block the event loop while
     * waiting, so node cannot reap the child in the meantime, and
     * process.kill(pid, 0) keeps succeeding for a zombie. Reading the state
     * field out of /proc/<pid>/stat avoids that trap. The field sits right
     * after the comm value, which is parenthesised and may itself contain
     * spaces, so index from the last ")" rather than splitting the whole line.
     */
    let hasExited = function(pid) {

        let stat;

        try {
            stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
        } catch (e) {
            return true; // no /proc entry, process is gone
        }

        return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] === "Z";

    };

    /**
     * Blocks until pid has terminated, or until timeoutMs has elapsed.
     * Returns true if the process exited, false on timeout.
     */
    let waitForExit = function(pid, timeoutMs) {

        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {

            if (hasExited(pid))
                return true;

            sleepSync(stopPollIntervalMs);

        }

        return false;

    };

    /**
     * Private function to stop camilladsp process. If there is no process running
     * (ie: camilla === null), does not do anything
     */
    let processStop = function() {

        let pid;

        try {

            if (camilla === null)
                return;

            pid = camilla.pid;

            logger.info(`camilladsp stopping service pid ${pid}...`);

            // A deliberate stop must not look like a crash. Without this, a
            // stop() immediately followed by start() lets the queued close event
            // see run === true again and schedule a spurious respawn on top of
            // the instance start() just created.
            camilla.removeListener("close", listenerClose);

            camilla.kill();

            if (waitForExit(pid, stopTimeoutMs) === false) {

                logger.warn(`camilladsp pid ${pid} still alive after ${stopTimeoutMs} ms, sending SIGKILL`);

                camilla.kill("SIGKILL");
                waitForExit(pid, stopTimeoutMs);

            }

            camilla = null;

            // The process is gone but ALSA has not necessarily finished tearing
            // the stream down, and on some DACs that teardown is slow. Reopening
            // the device too early makes the next instance exit with
            // "snd_pcm_open failed with error 'Device or resource busy (16)'",
            // which then burns the respawn budget until the plugin gives up and
            // leaves the fifo with no reader.
            sleepSync(deviceReleaseDelayMs);

            logger.debug(`camilladsp stopped pid ${pid}`);

        } catch (e) {

            logger.error(`camilladsp processStop exception. Reason: ${e}`);

        }

    };

    /**
     * Public function to spawn the camilladsp process and keep it
     * running in the background
     */
    this.start = function() {

        run = true;

        // Reset respawn state on explicit start
        consecutiveRespawns = 0;
        respawnStopped = false;

        if (processSpawn() === false) {

            logger.warn(`camilladsp start requested but instance ${uniqueid} is already running, ignoring`);
            return;

        }

        logger.info(`camilladsp service started and running in background, instance ${uniqueid}`);

    };

    /**
     * Public function to terminate the camilladsp process and stop
     * it from respawning
     */
    this.stop = function() {

        run = false;

        processStop();

        logger.info(`camilladsp service terminated, instance ${uniqueid}`);

    }

};

module.exports = { CamillaDsp };

