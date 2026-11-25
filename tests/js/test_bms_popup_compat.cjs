const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(process.argv[2], 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');

const St = {
    Corner: {TOPLEFT: 0},
    Side: {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3},
    ThemeContext: {get_for_stage: () => ({scale_factor: 1})},
};

const Clutter = {
    OffscreenRedirect: {AUTOMATIC_FOR_OPACITY: 1, ALWAYS: 2},
    TextDirection: {RTL: 2},
    ModifierType: {MOD1_MASK: 8, CONTROL_MASK: 4, SHIFT_MASK: 1, MOD4_MASK: 64},
    KEY_Alt_L: 0xffe9,
    KEY_Alt_R: 0xffea,
    KEY_Control_L: 0xffe3,
    KEY_Control_R: 0xffe4,
    KEY_Shift_L: 0xffe1,
    KEY_Shift_R: 0xffe2,
    KEY_Super_L: 0xffeb,
    KEY_Super_R: 0xffec,
};

const global = {
    stage: {},
    display: {},
    get_pointer: () => [0, 0, 0],
    blur_my_shell: null,
};

const Main = {
    layoutManager: {
        primaryIndex: 0,
        findIndexForActor: () => 0,
        getWorkAreaForMonitor: () => ({height: 1000}),
    },
    panel: {statusArea: {}},
    sessionMode: {connect: () => 1, disconnect: () => {}},
    extensionManager: {connect: () => 1, disconnect: () => {}},
};

const {createManager, registerButton, onMenuOpened} = vm.runInNewContext(
    `${source}\n({createManager, registerButton, onMenuOpened})`,
    {St, Clutter, Main, global}
);

function makeNode({bg = {red: 0, green: 0, blue: 0}, radius = 20, padding = 4, border = 1} = {}) {
    return {
        get_background_color: () => bg,
        get_border_radius: () => radius,
        get_padding: () => padding,
        get_border_width: () => border,
        get_length: () => 8,
    };
}

function makeButton({bmsStyled = false, menuRadius = 20} = {}) {
    const subActor = {
        style: null,
        set_style(s) { this.style = s; },
    };
    const boxClasses = new Set(bmsStyled ? ['bms-popup-blurred'] : []);
    const box = {
        style: bmsStyled ? 'border-radius: 20px 20px 20px 20px;' : null,
        has_style_class_name: cls => boxClasses.has(cls),
        addClass: cls => boxClasses.add(cls),
        removeClass: cls => boxClasses.delete(cls),
        get_style() { return this.style; },
        set_style(s) { this.style = s; },
        get_stage: () => ({}),
        get_theme_node: () => makeNode({radius: bmsStyled ? menuRadius : 12}),
        get_children: () => [],
    };
    const actorClasses = new Set();
    const offscreenCalls = [];
    const actor = {
        margin_top: 0,
        margin_bottom: 0,
        offscreenCalls,
        has_style_class_name: cls => actorClasses.has(cls),
        add_style_class_name: cls => actorClasses.add(cls),
        remove_style_class_name: cls => actorClasses.delete(cls),
        set_style() {},
        set_offscreen_redirect(mode) { offscreenCalls.push(mode); },
        get_children: () => [],
        get_theme_node: () => makeNode({radius: 0}),
        connect: () => 1,
        disconnect: () => {},
    };
    const itemsBox = {
        style: null,
        set_style(s) { this.style = s; },
        get_children: () => [{menu: {actor: subActor, box: {get_children: () => []}}}],
    };
    const btn = {
        _globalMenuAppName: false,
        set_style() {},
        get_style() {},
        get_text_direction: () => 1,
        get_theme_node: () => makeNode({padding: 4, border: 0}),
        connect: () => 1,
        disconnect: () => {},
        container: {visible: true, connect: () => 1, disconnect: () => {}},
        itemsMenu: {
            box: itemsBox,
            firstMenuItem: null,
        },
        menu: {
            isOpen: true,
            actor,
            box,
            setSourceAlignment: () => {},
        },
        subActor,
    };
    return btn;
}

function makeSettings() {
    const vals = {
        'blur-popups': false,
        'popup-blur-sigma': 21,
        'popup-blur-brightness': 1.0,
        'popup-opacity': 65,
        'popup-corner-radius': 12,
        'hide-popup-arrow': true,
        'hide-app-name': false,
        'button-spacing': 8,
        'menu-font-size': 11,
        'bold-app-name': true,
        'hide-workspace-indicator': false,
        'shortcut-labels': 'always',
        'shortcut-hold-key': 'alt',
    };
    return {
        connect: () => 1,
        disconnect: () => {},
        get_int: k => vals[k],
        get_double: k => vals[k],
        get_boolean: k => vals[k],
        get_string: k => vals[k],
    };
}

// Case 1: BMS PopupBlur is active -> preserve BMS style/radius on menu.box, no black background,
// move font-size to itemsMenu.box, keep submenu well radius aligned with 20px, no offscreen_redirect(ALWAYS).
global.blur_my_shell = {
    _popup: {enabled: true},
    _settings: {popup: {BLUR_MENUS: true}},
    _effects_manager: {},
};
const mgr = createManager(makeSettings());
const bmsBtn = makeButton({bmsStyled: true, menuRadius: 20});
registerButton(bmsBtn);
onMenuOpened(bmsBtn);

assert.equal(bmsBtn.menu.box.style, 'border-radius: 20px 20px 20px 20px;');
assert.equal(bmsBtn.itemsMenu.box.style, 'font-size: 11pt;');
assert.equal(bmsBtn.subActor.style, 'border-radius: 0 0 15px 15px;');
assert.deepEqual(bmsBtn.menu.actor.offscreenCalls, []);

// Case 2: Startup race — global-menu styles menu.box first (when BMS wasn't enabled yet),
// then BMS appends its border-radius and becomes active -> applyAll strips only owned prefix.
global.blur_my_shell = null;
const raceBtn = makeButton({bmsStyled: false});
registerButton(raceBtn);
assert.match(raceBtn.menu.box.style, /background-color: rgba\(0, 0, 0, 0\.65\);/);
assert.match(raceBtn.menu.box.style, /^border-radius: 12px;/);
assert.equal(raceBtn.itemsMenu.box.style, null);

// Simulate BMS PopupBlurSurfaceStyle appending its border-radius and enabling BMS
raceBtn.menu.box.addClass('bms-popup-blurred');
raceBtn.menu.box.style = `${raceBtn.menu.box.style} border-radius: 20px 20px 20px 20px;`;
global.blur_my_shell = {
    _popup: {enabled: true},
    _settings: {popup: {BLUR_MENUS: true}},
    _effects_manager: {},
};
mgr.applyAll();
assert.equal(raceBtn.menu.box.style, 'border-radius: 20px 20px 20px 20px;');
assert.equal(raceBtn.itemsMenu.box.style, 'font-size: 11pt;');

// Case 3: BMS disabled -> global-menu restores its own popup background & clears itemsMenu.box style.
global.blur_my_shell = null;
bmsBtn.menu.box.removeClass('bms-popup-blurred');
mgr.applyPopupBackground(bmsBtn);
assert.equal(
    bmsBtn.menu.box.style,
    'border-radius: 12px; font-size: 11pt; background-color: rgba(0, 0, 0, 0.65);'
);
assert.equal(bmsBtn.itemsMenu.box.style, null);

mgr.destroy();
console.log('PASS: orbit-global-menu yields popup box styling, corner radius, and offscreen_redirect to Blur my Shell');
