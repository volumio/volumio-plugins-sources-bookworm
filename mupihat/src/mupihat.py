#!/usr/bin/python3

"""MuPiHAT Battery Management Service

This script provides battery monitoring and management functionality for the MuPiHAT
Raspberry Pi HAT, which uses the BQ25792 battery charger IC from Texas Instruments.

The service continuously monitors battery status, charging parameters, and system health,
providing real-time data through JSON output and optional logging capabilities.

Key Features:
- Real-time battery voltage, current, and temperature monitoring
- Charging status and fault detection
- Thermal regulation and protection monitoring
- JSON API for external applications (like Volumio plugins)
- Optional detailed logging for debugging and analysis
- Watchdog timer reset to maintain system stability
- I2C communication with BQ25792 charger IC

The script runs as a system service and provides data to web interfaces and monitoring
applications through standardized JSON output.

Parameters
----------
-l, --logfile <logfile> : str
    Enable detailed logging and specify log file path
    (default: /tmp/mupihat.log)
-j, --json <json_file> : str
    Enable JSON status file generation and specify output path
    (default: /tmp/mupihat.json)
-c, --config <config_file> : str
    Specify battery configuration file path
    (default: /etc/mupihat/mupihatconfig.json)
-h, --help
    Display help information

Usage Examples
--------------
Service mode (typical usage):
    python3 -B mupihat.py -j /tmp/mupihat.json

Debug mode with logging:
    python3 -B mupihat.py -l /tmp/mupihat.log

Service with custom config:
    python3 -B mupihat.py -j /tmp/mupihat.json -c /path/to/config.json

Returns
-------
The script runs continuously as a daemon, updating JSON status every 5 seconds.
Exit codes:
    0: Normal termination
    1: I2C device not found or initialization failed

Notes
-----
- Requires I2C to be enabled on the Raspberry Pi
- Must run with appropriate permissions to access I2C devices
- The BQ25792 IC communicates on I2C address 0x6B
- Optimal I2C bus speed is 50kHz for reliable communication
"""

__author__ = "Lars Stopfkuchen"
__license__ = "GPLv3"
__version__ = "0.2.0"
__email__ = "larsstopfkuchen@mupihat.de"
__status__ = "released"

import sys
import os
import time
import json
import logging
import argparse
from datetime import datetime
from mupihat_bq25792 import bq25792


class MuPiHATService:
    """MuPiHAT Battery Management Service Class

    Encapsulates all service functionality including battery monitoring,
    logging, and JSON status file generation.
    """

    def __init__(self, json_file=None, log_file=None, config_file=None):
        """Initialize the MuPiHAT service.

        Args:
            json_file (str): Path to JSON status output file
            log_file (str): Path to log file (enables logging if provided)
            config_file (str): Path to battery configuration file
        """
        self.hat = None
        self.json_file = json_file
        self.log_file = log_file
        self.config_file = config_file or "/etc/mupihat/mupihatconfig.json"
        self.log_enabled = bool(log_file)
        self.json_enabled = bool(json_file)

    def timestamp(self):
        """Returns the current timestamp."""
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def setup_logging(self):
        """Sets up logging to a file."""
        if self.log_enabled and self.log_file:
            logging.basicConfig(
                filename=self.log_file,
                level=logging.INFO,
                format="%(asctime)s - %(message)s",
            )
            logging.info("----- Logfile mupihat.py -----")

    def log_register_values(self):
        """Logs register values for debugging."""
        if not self.hat:
            return

        logging.info("*** Timestamp: %s", self.timestamp())
        logging.info(
            "Thermal Regulation Threshold: %s",
            self.hat.REG16_Temperature_Control.get_thermal_reg_threshold(),
        )
        logging.info(
            "Thermal Shutdown Threshold: %s",
            self.hat.REG16_Temperature_Control.get_thermal_shutdown_threshold(),
        )
        logging.info(
            "Temperature Charger IC: %s", self.hat.REG41_TDIE_ADC.get_IC_temperature()
        )
        logging.info(
            "Temperature Regulation Status: %s",
            self.hat.REG1D_Charger_Status_2.get_thermal_regulation_status(),
        )
        logging.info(
            "Charger Status: %s", self.hat.REG1C_Charger_Status_1.CHG_STAT_STRG
        )
        logging.info("IBUS [mA]: %s", self.hat.get_ibus())
        logging.info("IBAT [mA]: %s", self.hat.get_ibat())
        logging.info("VBUS [mV]: %s", self.hat.get_vbus())
        logging.info("VBAT [mV]: %s", self.hat.get_vbat())
        logging.info("VSYS [mV]: %s", self.hat.REG3D_VSYS_ADC.VSYS_ADC)
        logging.info(
            "Charge Voltage Limit: %s", self.hat.REG01_Charge_Voltage_Limit.VREG
        )
        logging.info(
            "Input Current Limit: %s", self.hat.REG06_Input_Current_Limit.get()
        )

    def detect_i2c_device(self):
        """Detect available I2C device."""
        if os.path.exists("/dev/i2c-1"):
            return 1
        else:
            logging.error(
                "No supported I2C device found (/dev/i2c-1). Check if the I2C bus is enabled."
            )
            return None

    def initialize_hardware(self):
        """Initialize the BQ25792 hardware interface."""
        i2c_device = self.detect_i2c_device()
        if i2c_device is None:
            return False

        try:
            self.hat = bq25792(
                i2c_device=i2c_device, battery_conf_file=self.config_file
            )
            self.hat.MuPiHAT_Default()
            return True
        except Exception as e:
            logging.error("MuPiHAT initialization failed: %s", str(e))
            return False

    def periodic_monitoring(self):
        """Periodically monitor battery status and update JSON file."""
        if not self.hat:
            logging.error("Hardware not initialized")
            return

        while True:
            try:
                # Reset watchdog and read registers
                self.hat.watchdog_reset()
                time.sleep(0.1)  # Allow time for the watchdog reset
                self.hat.read_all_register()
                time.sleep(1)  # Allow time for the registers to be updated

                # Write JSON status file
                if self.json_enabled and self.json_file:
                    try:
                        with open(self.json_file, "w") as outfile:
                            json.dump(self.hat.to_json(), outfile, indent=4)
                    except Exception as e:
                        logging.error("Failed to write JSON dump: %s", str(e))

                # Log register values if enabled
                if self.log_enabled:
                    self.log_register_values()

                time.sleep(3.9)  # Run every 4 seconds

            except KeyboardInterrupt:
                logging.info("Service stopped by user")
                break
            except Exception as e:
                logging.error("Error in monitoring loop: %s", str(e))
                time.sleep(5)  # Wait before retrying

    def run(self):
        """Main service execution method."""
        # Set up logging if enabled
        if self.log_enabled:
            self.setup_logging()

        # Initialize hardware
        if not self.initialize_hardware():
            sys.exit(1)

        # Start monitoring
        logging.info("Starting the monitoring process.")
        self.periodic_monitoring()


def parse_arguments():
    """Parses command-line arguments using argparse."""
    parser = argparse.ArgumentParser(description="MuPiHAT Charger IC (BQ25792) Service")
    parser.add_argument(
        "-l",
        "--logfile",
        type=str,
        help="Enable logging and specify the log file path",
        default=None,
    )
    parser.add_argument(
        "-j",
        "--json",
        type=str,
        help="Enable JSON file generation and specify the JSON file path",
        default=None,
    )
    parser.add_argument(
        "-c",
        "--config",
        type=str,
        help="Config (Json) File for MuPiHAT",
        default="/etc/mupihat/mupihatconfig.json",
    )
    return parser.parse_args()


def main():
    """Main entry point for the MuPiHAT service."""
    # Parse command-line arguments
    args = parse_arguments()

    # Create and run the service
    service = MuPiHATService(
        json_file=args.json, log_file=args.logfile, config_file=args.config
    )

    try:
        service.run()
    except KeyboardInterrupt:
        logging.info("Service interrupted by user")
        sys.exit(0)
    except Exception as e:
        logging.error("Service failed: %s", str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
