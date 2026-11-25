import dbus

from fakes import (
    DBUSMENU_BUS, DBUSMENU_PATH, FakeSession, FakeWindow, dm, install_dbusmenu_app,
)
from globalmenu.menu_model.menu_model import MenuModel


def native_window(path=DBUSMENU_PATH):
    return FakeWindow({
        '_DBUS_APPMENU_SERVICE_NAME': DBUSMENU_BUS,
        '_DBUS_APPMENU_OBJECT_PATH': path,
    }, xid=0)


def test_native_address_bypasses_registrar_and_activates_real_item():
    session, window = FakeSession(), native_window()
    install_dbusmenu_app(session, dm(0, {}, [dm(1, {'label': 'Ping'})]), window)
    model = MenuModel(session, window)
    model._update_menus()
    model.activate('Ping')
    assert session.calls_to('GetMenuForWindow') == []
    click = next(c for c in session.calls_to('Event') if c[4][1] == 'clicked')
    assert click[:2] == (DBUSMENU_BUS, DBUSMENU_PATH)
    assert int(click[4][0]) == 1


def test_same_process_windows_with_no_xid_keep_distinct_menus():
    session = FakeSession()
    for number in (1, 2):
        path = '/MenuBar/%d' % number
        layout = dm(0, {}, [dm(number, {'label': 'Window %d' % number})])
        session.on(DBUSMENU_BUS, path, 'com.canonical.dbusmenu', 'GetLayout',
                   lambda *args, tree=layout: (dbus.UInt32(1), tree))
        session.on(DBUSMENU_BUS, path, 'com.canonical.dbusmenu', 'Event', lambda *args: None)
        model = MenuModel(session, native_window(path))
        model._update_menus()
        assert list(model.actions) == ['Window %d' % number]
        model.activate('Window %d' % number)
    clicks = [c for c in session.calls_to('Event') if c[4][1] == 'clicked']
    assert [c[1] for c in clicks] == ['/MenuBar/1', '/MenuBar/2']
    assert session.calls_to('GetMenuForWindow') == []


def test_incomplete_native_address_preserves_x11_registration():
    session = FakeSession()
    window = FakeWindow({'_DBUS_APPMENU_SERVICE_NAME': DBUSMENU_BUS})
    install_dbusmenu_app(session, dm(0, {}, [dm(1, {'label': 'Legacy'})]), window)
    model = MenuModel(session, window)
    model._update_menus()
    assert list(model.actions) == ['Legacy']
    assert len(session.calls_to('GetMenuForWindow')) == 1


def test_dead_native_menu_does_not_fall_back_to_another_window():
    session, window = FakeSession(), native_window()
    install_dbusmenu_app(session, dm(0, {}, [dm(1, {'label': 'Wrong Window'})]), window)

    def gone(*args):
        raise dbus.exceptions.DBusException('gone', name='org.freedesktop.DBus.Error.ServiceUnknown')

    session.on(DBUSMENU_BUS, DBUSMENU_PATH, 'com.canonical.dbusmenu', 'GetLayout', gone)
    model = MenuModel(session, window)
    model._update_menus()
    assert list(model.actions) == []
    assert session.calls_to('GetMenuForWindow') == []
