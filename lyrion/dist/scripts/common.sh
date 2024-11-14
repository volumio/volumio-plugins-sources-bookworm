. install.conf

set -eE

echo_dt() {
  echo "[$(date +"%D %T")] $1"
}

on_error() {
    echo_dt "An error occurred in $(basename "$0"): line ${BASH_LINENO}: ${BASH_COMMAND}"
    if [ ! -z "${INSTALLING}" ]; then
      echo_dt "Installation failed"
      echo "plugininstallend"
    elif [ ! -z "${UNINSTALLING}" ]; then
      echo_dt "Uninstallation failed"
      exit 1
    fi
}

trap 'on_error' ERR
