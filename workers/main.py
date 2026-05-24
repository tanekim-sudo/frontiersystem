from __future__ import annotations

import argparse
import logging
import threading

from dotenv import load_dotenv

from .config import load_settings
from .scheduler import run_scheduler
from .worker import run_worker_loop


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Live platform worker runtime")
    parser.add_argument("--mode", choices=["scheduler", "worker", "both"], default="both")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = load_settings()

    if args.mode == "scheduler":
        run_scheduler(settings)
        return
    if args.mode == "worker":
        run_worker_loop(settings)
        return

    t = threading.Thread(target=run_scheduler, args=(settings,), daemon=True)
    t.start()
    run_worker_loop(settings)


if __name__ == "__main__":
    main()
