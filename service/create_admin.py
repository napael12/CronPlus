#!/usr/bin/env python3
"""
Create the initial CronPlus administrator account.

Called by the Inno Setup installer after migrations have run.
Reads credentials from service/admin.cred (written by the installer wizard),
creates the admin user, then immediately deletes the credentials file.

Usage (called internally by setup.iss):
    python create_admin.py
"""

import os
import sys
from pathlib import Path

# Locate directories relative to this script
service_dir = Path(__file__).resolve().parent
install_dir = service_dir.parent
backend_dir = install_dir / "backend"
cred_file = service_dir / "admin.cred"

if not backend_dir.is_dir():
    print(f"ERROR: backend directory not found at {backend_dir}", file=sys.stderr)
    sys.exit(1)

if not cred_file.is_file():
    print(f"ERROR: credentials file not found at {cred_file}", file=sys.stderr)
    sys.exit(1)

# Read and immediately delete the credentials file
try:
    lines = cred_file.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2:
        print("ERROR: credentials file is malformed (expected 2 lines)", file=sys.stderr)
        sys.exit(1)
    admin_email = lines[0].strip()
    admin_password = lines[1].strip()
finally:
    try:
        cred_file.unlink()
    except OSError as e:
        print(f"WARNING: could not delete credentials file: {e}", file=sys.stderr)

if not admin_email or not admin_password:
    print("ERROR: email or password is empty in credentials file", file=sys.stderr)
    sys.exit(1)

# Bootstrap Django from the backend directory
os.chdir(backend_dir)
sys.path.insert(0, str(backend_dir))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cronplus.settings")

import django  # noqa: E402
django.setup()

from core.models import User  # noqa: E402

if User.objects.filter(email=admin_email).exists():
    print(f"User '{admin_email}' already exists — skipping creation.")
    sys.exit(0)

User.objects.create_superuser(email=admin_email, password=admin_password)
print(f"Admin user '{admin_email}' created successfully.")
