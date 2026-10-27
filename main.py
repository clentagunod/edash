"""Edash Provision: GUI entry point and portable command-line interface."""

from pathlib import Path
import sys


def main() -> int:
    source = Path(__file__).resolve().parent / "src"
    sys.path.insert(0, str(source))
    if sys.argv[1:]:
        from edash_provision.cli import main as command_main
        return command_main()
    from edash_provision.gui import launch
    launch()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
