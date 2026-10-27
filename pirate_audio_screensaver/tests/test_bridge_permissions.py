"""Exercise the permissions helper with isolated files and command doubles.

The helper itself runs under a POSIX shell. Only its fixed sudoers directory is
redirected into the fixture; no test can write to the host's sudo policy. The
visudo double tests validation/rollback sequencing, not real sudoers syntax.
Ownership and chmod calls are checked; the actual file mode is checked on POSIX.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
MARKER = "# Managed by Pirate Audio Screensaver (display bridge permissions)"


def find_shell() -> Path | None:
    candidates = [shutil.which("sh"), shutil.which("bash")]
    if os.name == "nt":
        dependencies = Path(sys.executable).resolve().parent.parent
        candidates.append(dependencies / "native/git/usr/bin/sh.exe")
        candidates.append(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/sh.exe")
    return next((Path(candidate) for candidate in candidates if candidate and Path(candidate).is_file()), None)


SHELL = find_shell()


@unittest.skipIf(SHELL is None, "A POSIX shell is needed for the permissions helper")
class BridgePermissionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="pirate-permissions-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.plugin = self.root / "pirate_audio_screensaver"
        self.policy_directory = self.root / "sudoers"
        self.bin_directory = self.root / "bin"
        for directory in (self.plugin, self.policy_directory, self.bin_directory):
            directory.mkdir()
        self.policy = self.policy_directory / "volumio-user-pirate-audio-screensaver"
        self.legacy_policy = self.policy_directory / "pirate-audio-screensaver"
        self.operations = self.root / "operations"
        self.validation = self.root / "validated-policy"
        source = (PLUGIN_ROOT / "bridge-permissions.sh").read_text(encoding="utf-8")
        original_target = 'SUDOERS_DIR="/etc/sudoers.d"'
        self.assertEqual(source.count(original_target), 1, "The fixture must redirect exactly the policy directory")
        source = source.replace(original_target, f'SUDOERS_DIR="{self.policy_directory.as_posix()}"')
        self.helper = self.plugin / "bridge-permissions.sh"
        self.helper.write_text(source, encoding="utf-8", newline="\n")
        (self.plugin / "display-bridge.sh").write_text("#!/bin/sh\n", encoding="utf-8", newline="\n")
        real_chmod = shutil.which("chmod")
        if real_chmod is None:
            executable = "chmod.exe" if os.name == "nt" else "chmod"
            candidate = SHELL.parent / executable
            real_chmod = str(candidate) if candidate.is_file() else ""
        self.env = os.environ.copy()
        self.env.update({
            "PATH": os.pathsep.join((str(self.bin_directory), str(SHELL.parent), self.env.get("PATH", ""))),
            "HARNESS_OPERATIONS": str(self.operations),
            "HARNESS_VALIDATED_POLICY": str(self.validation),
            "HARNESS_REAL_CHMOD": Path(real_chmod).as_posix() if real_chmod else "",
        })
        self.write_command("id", 'if [ "$1" = "-u" ]; then printf "0\\n"; else exit 2; fi\n')
        self.write_command("visudo", '''printf 'visudo %s\\n' "$*" >> "$HARNESS_OPERATIONS"
policy=
while [ "$#" -gt 0 ]; do
    if [ "$1" = "-f" ]; then shift; policy=$1; fi
    shift
done
[ -n "$policy" ] && [ -f "$policy" ] || exit 2
cat "$policy" > "$HARNESS_VALIDATED_POLICY"
[ "${HARNESS_VISUDO_FAIL:-0}" = "0" ]
''')
        self.write_command("chown", 'printf "chown %s\\n" "$*" >> "$HARNESS_OPERATIONS"\n')
        self.write_command("chmod", '''printf 'chmod %s\\n' "$*" >> "$HARNESS_OPERATIONS"
if [ -n "$HARNESS_REAL_CHMOD" ]; then exec "$HARNESS_REAL_CHMOD" "$@"; fi
''')
        self.plugin_posix = subprocess.run(
            [str(SHELL), "-c", 'CDPATH= cd -- "$1" && pwd', "test", str(self.plugin)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()

    def write_command(self, name: str, body: str) -> None:
        command = self.bin_directory / name
        command.write_text("#!/bin/sh\n" + body, encoding="utf-8", newline="\n")
        command.chmod(0o755)

    def run_helper(self, action: str, *, validation_fails: bool = False) -> subprocess.CompletedProcess[str]:
        env = self.env.copy()
        if validation_fails:
            env["HARNESS_VISUDO_FAIL"] = "1"
        return subprocess.run(
            [str(SHELL), str(self.helper), action],
            env=env, capture_output=True, text=True, timeout=15,
        )

    def assert_failed(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_install_validates_two_exact_commands_and_restricts_permissions(self) -> None:
        result = self.run_helper("install")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        content = self.policy.read_text(encoding="utf-8")
        self.assertEqual(content, self.validation.read_text(encoding="utf-8"))
        self.assertIn(MARKER, content.splitlines())
        rules = [line for line in content.splitlines() if line.strip() and not line.startswith("#")]
        self.assertEqual(rules, [
            f"volumio ALL=(root) NOPASSWD: /bin/sh {self.plugin_posix}/display-bridge.sh enable",
            f"volumio ALL=(root) NOPASSWD: /bin/sh {self.plugin_posix}/display-bridge.sh disable",
        ])
        operations = self.operations.read_text(encoding="utf-8").splitlines()
        self.assertTrue(operations[0].startswith("visudo "), operations)
        chmod = next(line for line in operations if line.startswith("chmod "))
        self.assertEqual(int(chmod.split()[1], 8), 0o440)
        self.assertTrue(any(line.startswith("chown root:root ") for line in operations), operations)
        if os.name != "nt":
            self.assertEqual(self.policy.stat().st_mode & 0o777, 0o440)

    def test_install_replaces_an_existing_owned_rule_after_validation(self) -> None:
        self.policy.write_text(MARKER + "\nold-owned-rule\n", encoding="utf-8")
        result = self.run_helper("install")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("old-owned-rule", self.policy.read_text(encoding="utf-8"))
        self.assertEqual(self.policy.read_bytes(), self.validation.read_bytes())
        self.assertEqual(list(self.policy_directory.iterdir()), [self.policy])

    def test_validation_failure_preserves_previous_owned_rule_and_cleans_temporary(self) -> None:
        original = (MARKER + "\nprevious-owned-rule\n").encode()
        legacy_original = (MARKER + "\nprevious-legacy-rule\n").encode()
        self.policy.write_bytes(original)
        self.legacy_policy.write_bytes(legacy_original)
        result = self.run_helper("install", validation_fails=True)
        self.assert_failed(result)
        self.assertTrue(self.validation.exists(), result.stdout + result.stderr)
        self.assertEqual(self.policy.read_bytes(), original)
        self.assertEqual(self.legacy_policy.read_bytes(), legacy_original)
        self.assertEqual(set(self.policy_directory.iterdir()), {self.policy, self.legacy_policy})

    def test_validation_failure_does_not_create_a_policy(self) -> None:
        result = self.run_helper("install", validation_fails=True)
        self.assert_failed(result)
        self.assertTrue(self.validation.exists(), result.stdout + result.stderr)
        self.assertEqual(list(self.policy_directory.iterdir()), [])

    def test_unrelated_policy_cannot_be_replaced_or_removed(self) -> None:
        original = b"# Another plugin owns this file\nvolumio ALL=(root) /bin/true\n"
        legacy_original = (MARKER + "\nowned-legacy-rule\n").encode()
        self.policy.write_bytes(original)
        self.legacy_policy.write_bytes(legacy_original)
        for action in ("install", "remove"):
            with self.subTest(action=action):
                result = self.run_helper(action)
                self.assert_failed(result)
                self.assertIn("unrelated permissions entry", result.stdout)
                self.assertEqual(self.policy.read_bytes(), original)
                self.assertEqual(self.legacy_policy.read_bytes(), legacy_original)
        self.assertFalse(self.validation.exists())

    def test_remove_is_limited_to_our_policy_and_is_repeatable(self) -> None:
        self.policy.write_text(MARKER + "\nowned-rule\n", encoding="utf-8")
        self.legacy_policy.write_text(MARKER + "\nowned-legacy-rule\n", encoding="utf-8")
        unrelated = self.policy_directory / "another-plugin"
        unrelated.write_bytes(b"unrelated-policy\n")
        for _ in range(2):
            result = self.run_helper("remove")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.policy.exists())
        self.assertFalse(self.legacy_policy.exists())
        self.assertEqual(unrelated.read_bytes(), b"unrelated-policy\n")

    def test_nonfile_policy_target_cannot_be_replaced_or_removed(self) -> None:
        for target, other in ((self.policy, self.legacy_policy), (self.legacy_policy, self.policy)):
            target.mkdir()
            unrelated = target / "unrelated"
            unrelated.write_bytes(b"preserve-this-file\n")
            other_original = (MARKER + "\nowned-other-rule\n").encode()
            other.write_bytes(other_original)
            for action in ("install", "remove"):
                with self.subTest(target=target.name, action=action):
                    result = self.run_helper(action)
                    self.assert_failed(result)
                    self.assertIn("Refusing an unrelated permissions entry", result.stdout)
                    self.assertEqual(unrelated.read_bytes(), b"preserve-this-file\n")
                    self.assertEqual(other.read_bytes(), other_original)
            unrelated.unlink()
            target.rmdir()
            other.unlink()
        self.assertFalse(self.validation.exists())

    def test_install_migrates_owned_legacy_policy_after_validation(self) -> None:
        self.legacy_policy.write_text(MARKER + "\nowned-legacy-rule\n", encoding="utf-8")
        result = self.run_helper("install")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.policy.read_bytes(), self.validation.read_bytes())
        self.assertFalse(self.legacy_policy.exists())
        self.assertEqual(list(self.policy_directory.iterdir()), [self.policy])

    def test_validation_failure_preserves_legacy_policy_before_migration(self) -> None:
        original = (MARKER + "\nowned-legacy-rule\n").encode()
        self.legacy_policy.write_bytes(original)
        result = self.run_helper("install", validation_fails=True)
        self.assert_failed(result)
        self.assertTrue(self.validation.exists(), result.stdout + result.stderr)
        self.assertFalse(self.policy.exists())
        self.assertEqual(self.legacy_policy.read_bytes(), original)
        self.assertEqual(list(self.policy_directory.iterdir()), [self.legacy_policy])

    def test_unrelated_legacy_policy_blocks_changes_to_both_entries(self) -> None:
        original = b"# Unrelated legacy file\nvolumio ALL=(root) /bin/true\n"
        current_original = (MARKER + "\nowned-current-rule\n").encode()
        self.legacy_policy.write_bytes(original)
        self.policy.write_bytes(current_original)
        for action in ("install", "remove"):
            with self.subTest(action=action):
                result = self.run_helper(action)
                self.assert_failed(result)
                self.assertIn("unrelated permissions entry", result.stdout)
                self.assertEqual(self.legacy_policy.read_bytes(), original)
                self.assertEqual(self.policy.read_bytes(), current_original)
        self.assertFalse(self.validation.exists())


if __name__ == "__main__":
    unittest.main()
