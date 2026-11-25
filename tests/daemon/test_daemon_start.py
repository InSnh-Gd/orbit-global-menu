"""Exercise the installed wrapper without the build shell's Python paths."""
import os
import signal
import subprocess
import sys
import time

import dbus


bus = dbus.SessionBus()
names = ('space.unmade.GlobalMenu', 'com.canonical.AppMenu.Registrar')
env = {key: value for key, value in os.environ.items()
       if key not in ('PYTHONPATH', 'DISPLAY', 'WAYLAND_DISPLAY')}
env['PYTHONNOUSERSITE'] = '1'
proc = subprocess.Popen([sys.argv[1]], env=env, start_new_session=True)
try:
    deadline = time.monotonic() + 8
    while not all(bus.name_has_owner(name) for name in names):
        assert proc.poll() is None, 'installed daemon exited before claiming its names'
        assert time.monotonic() < deadline, 'installed daemon failed to claim its names'
        time.sleep(0.05)
    proc.terminate()
    proc.wait(timeout=8)
    assert not any(bus.name_has_owner(name) for name in names)
    print('PASS: installed daemon starts its children and releases both bus names')
finally:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.wait()
