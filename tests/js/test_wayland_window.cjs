const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(process.argv[2], 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default class', 'class');
const app = {get_id: () => 'probe.desktop', get_name: () => 'Probe'};
const global = {display: {focus_window: null}};
const {MenuBar, MenuTreeCache} = vm.runInNewContext(source + '\n({MenuBar, MenuTreeCache})', {
    Extension: class {},
    Gio: {
        DBusProxy: {makeProxyWrapper: () => class {}},
        DBusError: {SERVICE_UNKNOWN: 1, NAME_HAS_NO_OWNER: 2, NO_REPLY: 3},
    },
    Meta: {WindowClientType: {X11: 1}},
    global,
});

function window(id) {
    let serial = 0;
    return {
        service: ':1.5', path: `/MenuBar/${id}`, handlers: new Map(),
        get_id: () => id, get_client_type: () => 0,
        get_wm_class: () => 'Probe', get_wm_class_instance: () => 'Probe',
        get_transient_for: () => null,
        get_dbus_appmenu_service_name() { return this.service; },
        get_dbus_appmenu_object_path() { return this.path; },
        connect(signal, callback) { this.handlers.set(++serial, {signal, callback}); return serial; },
        disconnect(id) { assert(this.handlers.delete(id)); },
        emit(signal) {
            for (const handler of [...this.handlers.values()])
                if (handler.signal === signal) handler.callback();
        },
    };
}

const requests = [];
const bar = Object.assign(Object.create(MenuBar.prototype), {
    _window: null, _windowSignalIds: [], _request: 0,
    _cache: new MenuTreeCache(), _fallback: null,
    _store: {resolveMapping: () => null},
    _settings: {get_boolean: () => false},
    _winTracker: {focus_app: app, get_window_app: () => app},
    _proxy: {WindowSwitched: data => requests.push(data)},
    _native: {clear: () => {}, setItems: () => {}},
    _shortcuts: {setMapping: () => {}},
});

const first = window(1), second = window(2);
global.display.focus_window = first;
bar.refresh();
assert.equal(requests.at(-1).xid, '0');
assert.equal(requests.at(-1).dbus_appmenu_object_path, '/MenuBar/1');
const firstCacheKey = bar._requestApp;

first.service = ':1.6';
first.emit('notify::dbus-appmenu-service-name');
assert.equal(requests.at(-1).dbus_appmenu_service_name, ':1.6');
assert.equal(requests.at(-1).dbus_appmenu_object_path, '/MenuBar/1');
first.path = '/MenuBar/replaced';
first.emit('notify::dbus-appmenu-object-path');
assert.equal(requests.at(-1).dbus_appmenu_object_path, '/MenuBar/replaced');

global.display.focus_window = second;
bar.refresh();
assert.equal(first.handlers.size, 0);
assert.notEqual(bar._requestApp, firstCacheKey);
assert.equal(requests.at(-1).dbus_appmenu_object_path, '/MenuBar/2');
const requestCount = requests.length;
first.emit('notify::dbus-appmenu-object-path');
assert.equal(requests.length, requestCount);

second.emit('unmanaged');
assert.equal(second.handlers.size, 0);
assert.equal(bar._window, null);

const legacy = window(3);
delete legacy.get_dbus_appmenu_service_name;
delete legacy.get_dbus_appmenu_object_path;
bar._trackWindow(legacy);
assert.equal(legacy.handlers.size, 1);
assert.equal(bar._windowData(legacy).dbus_appmenu_service_name, undefined);
bar._trackWindow(null);
assert.equal(legacy.handlers.size, 0);
console.log('PASS: Wayland addresses, late updates, window isolation and listener cleanup');
