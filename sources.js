import Gio from 'gi://Gio';
import NM from 'gi://NM';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';

// Where the widgets' data comes from. Each source starts with its first subscriber
// and stops with its last, so a widget nobody placed costs nothing.

class Source {
    constructor() {
        this._subs = new Set();
        this.value = undefined;
    }

    subscribe(fn) {
        this._subs.add(fn);
        if (this._subs.size === 1)
            this.start();
        if (this.value !== undefined)
            fn(this.value);
        return () => {
            if (!this._subs.delete(fn))
                return;
            if (this._subs.size === 0)
                this.stop();
        };
    }

    set(value) {
        this.value = value;
        for (const fn of [...this._subs]) {
            try {
                fn(value);
            } catch (e) {
                console.error('Glass Widgets:', e);
            }
        }
    }

    start() {}

    stop() {}

    destroy() {
        this._subs.clear();
        this.stop();
    }
}

// A metered connection (a phone's hotspot, mobile data), as NetworkManager tells GIO:
// the widgets then ask the internet less often.
export function metered() {
    try {
        return Gio.NetworkMonitor.get_default().network_metered;
    } catch {
        return false;
    }
}

function every(seconds, fn) {
    return GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
        fn();
        return GLib.SOURCE_CONTINUE;
    });
}

function clear(id) {
    if (id)
        GLib.source_remove(id);
    return 0;
}

// ---------- Time ----------

// Ticks on the second (aligned to the wall clock); the value is a Date.
class ClockSource extends Source {
    start() {
        const tick = () => {
            this.set(new Date());
            this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000 - (Date.now() % 1000) + 5, tick);
            return GLib.SOURCE_REMOVE;
        };
        tick();
    }

    stop() {
        this._id = clear(this._id);
    }
}

// ---------- Weather (wttr.in, no key) ----------

// wttr.in weather codes → the drawings (the same names as Dynamic Island's cards).
const CONDITIONS = {sun: [113], partly: [116], cloud: [119, 122], fog: [143, 248, 260],
    storm: [200, 386, 389, 392, 395],
    snow: [179, 182, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377]};

export function condition(code) {
    code = Number(code);
    return Object.keys(CONDITIONS).find(k => CONDITIONS[k].includes(code)) ?? 'rain';
}

function clockMinutes(text) {
    // "06:58 AM" → minutes after midnight
    const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(text ?? '');
    if (!m)
        return null;
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === 'PM')
        h += 12;
    return h * 60 + Number(m[2]);
}

class WeatherSource extends Source {
    constructor(settings) {
        super();
        this._settings = settings;
        this._session = new Soup.Session({timeout: 15, user_agent: 'curl/8.0 (Glass Widgets)'});
        this._changedId = settings.connect('changed::weather-location', () => {
            this.value = undefined;
            this._fetch();
        });
    }

    start() {
        this._fetch();
    }

    stop() {
        this._id = clear(this._id);
        this._cancellable?.cancel();
    }

    destroy() {
        this._settings.disconnect(this._changedId);
        super.destroy();
        this._session.abort();
    }

    refresh() {
        this._fetch();
    }

    _later(seconds) {
        this._id = clear(this._id);
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._id = 0;
            this._fetch();
            return GLib.SOURCE_REMOVE;
        });
    }

    _fetch() {
        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        const place = this._settings.get_string('weather-location').trim();
        const lang = (GLib.get_language_names()[0] ?? 'en').slice(0, 2);
        const url = `https://wttr.in/${encodeURIComponent(place)}?format=j1&lang=${lang}`;
        const message = Soup.Message.new('GET', url);
        if (!message)
            return;
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
            try {
                const bytes = session.send_and_read_finish(res);
                if (message.get_status() !== 200)
                    throw new Error(`HTTP ${message.get_status()}`);
                this.set(this._parse(JSON.parse(new TextDecoder().decode(bytes.get_data())), place, lang));
                this._later(metered() ? 60 * 60 : 30 * 60);
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                if (this.value === undefined)
                    this.set(null);
                this._later(5 * 60);
            }
        });
    }

    _parse(data, place, lang) {
        const now = data.current_condition[0];
        const area = data.nearest_area?.[0]?.areaName?.[0]?.value;
        const astro = data.weather[0]?.astronomy?.[0] ?? {};
        const sunrise = clockMinutes(astro.sunrise) ?? 6 * 60;
        const sunset = clockMinutes(astro.sunset) ?? 19 * 60;
        const nowDate = new Date();
        const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
        const night = m => m < sunrise || m >= sunset;
        const desc = c => (c[`lang_${lang}`] ?? c.weatherDesc ?? [{value: ''}])[0].value.trim();

        // The next few three-hour slots, today's and then tomorrow's.
        const hours = [];
        data.weather.slice(0, 2).forEach((day, d) => {
            for (const h of day.hourly) {
                const minutes = Number(h.time) / 100 * 60;
                if (d === 0 && minutes + 90 < nowMin)
                    continue;
                hours.push({hour: `${String(minutes / 60).padStart(2, '0')}`, temp: Number(h.tempC),
                    cond: condition(h.weatherCode), night: night(minutes), rain: Number(h.chanceofrain ?? 0)});
            }
        });
        const days = data.weather.slice(0, 3).map(day => {
            const noon = day.hourly[Math.min(4, day.hourly.length - 1)];
            const date = new Date(`${day.date}T12:00:00`);
            return {date, hi: Number(day.maxtempC), lo: Number(day.mintempC), cond: condition(noon.weatherCode),
                rain: Math.max(...day.hourly.map(h => Number(h.chanceofrain ?? 0)))};
        });
        return {
            place: place || area || '',
            temp: Number(now.temp_C),
            feels: Number(now.FeelsLikeC),
            cond: condition(now.weatherCode),
            text: desc(now),
            night: night(nowMin),
            hi: days[0]?.hi,
            lo: days[0]?.lo,
            hours: hours.slice(0, 6),
            days,
        };
    }
}

// ---------- Harvis (an optional command that prints JSON) ----------

// `harvis widgets` prints {reminders, morning, finance}. Without the command the Harvis
// widgets are simply not offered; value null means "not available".
class HarvisSource extends Source {
    constructor(settings) {
        super();
        this._settings = settings;
        this.available = null;
        this._probe();
    }

    _argv() {
        try {
            const [, argv] = GLib.shell_parse_argv(this._settings.get_string('harvis-command'));
            return argv;
        } catch {
            return null;
        }
    }

    // Known before any Harvis widget is placed, so the gallery can offer them.
    _probe() {
        const argv = this._argv();
        this.available = !!(argv?.length && GLib.find_program_in_path(argv[0]));
    }

    start() {
        this.refresh();
        this._id = every(120, () => this.refresh());
    }

    stop() {
        this._id = clear(this._id);
    }

    refresh() {
        const argv = this._argv();
        if (!this.available || !argv) {
            this.set(null);
            return;
        }
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
            launcher.setenv('GLASS_WIDGETS_METERED', metered() ? '1' : '0', true);
            const proc = launcher.spawnv(argv);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    this.set(JSON.parse(out));
                } catch {
                    if (this.value === undefined)
                        this.set(null);
                }
            });
        } catch {
            this.set(null);
        }
    }
}

// ---------- Notes (Markdown files in a folder) ----------

export function expandPath(path) {
    path = path.trim();
    if (!path)
        return '';
    return path.startsWith('~') ? GLib.build_filenamev([GLib.get_home_dir(), path.slice(1)]) : path;
}

class NotesSource extends Source {
    constructor(settings) {
        super();
        this._settings = settings;
        this._changedId = settings.connect('changed::notes-folder', () => {
            if (this._subs.size) {
                this.stop();
                this.start();
            }
        });
    }

    destroy() {
        this._settings.disconnect(this._changedId);
        super.destroy();
    }

    folder() {
        return expandPath(this._settings.get_string('notes-folder'));
    }

    start() {
        const folder = this.folder();
        if (!folder) {
            this.set({folder: null, notes: []});
            return;
        }
        try {
            this._monitor = Gio.File.new_for_path(folder).monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => this._queue());
        } catch {
            this._monitor = null;
        }
        this._read();
    }

    stop() {
        this._monitor?.cancel();
        this._monitor = null;
        this._idle = clear(this._idle);
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._idle = 0;
            this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    _read() {
        const folder = this.folder();
        const notes = [];
        try {
            const dir = Gio.File.new_for_path(folder);
            const children = dir.enumerate_children('standard::name,standard::type,time::modified',
                Gio.FileQueryInfoFlags.NONE, null);
            for (let info; (info = children.next_file(null));) {
                const name = info.get_name();
                if (info.get_file_type() !== Gio.FileType.REGULAR || !name.endsWith('.md') || /^readme\.md$/i.test(name))
                    continue;
                notes.push({name, modified: info.get_attribute_uint64('time::modified')});
            }
            children.close(null);
        } catch {
            this.set({folder, notes: [], missing: true});
            return;
        }
        notes.sort((a, b) => b.modified - a.modified);
        const decoder = new TextDecoder();
        this.set({folder, notes: notes.slice(0, 6).map(n => {
            let text = '';
            try {
                const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([folder, n.name]));
                // The body without the signature line Dynamic Island adds ("— 2026-10-08 14:00").
                text = decoder.decode(bytes).split('\n').filter(l => !/^—\s*\d{4}-/.test(l.trim()))
                    .join(' ').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
            } catch {
                // unreadable: left out
            }
            const title = n.name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2} \d{4} /, '');
            return {title, text: text || title, modified: new Date(n.modified * 1000), path: GLib.build_filenamev([folder, n.name])};
        })});
    }

    // A note's whole text, lines kept, without the signature line.
    read(path) {
        try {
            const [, bytes] = GLib.file_get_contents(path);
            return new TextDecoder().decode(bytes).split('\n').filter(l => !/^—\s*\d{4}-/.test(l.trim()))
                .join('\n').trim();
        } catch {
            return '';
        }
    }

    // To the trash, not gone: a note deleted by mistake can be brought back.
    remove(path) {
        try {
            Gio.File.new_for_path(path).trash(null);
            this._read();
            return true;
        } catch (e) {
            console.error('Glass Widgets: could not move the note to the trash', e);
            return false;
        }
    }

    // Saved the way Dynamic Island's quick notes are, so both land in the same inbox.
    add(text) {
        const folder = this.folder();
        if (!folder || !text.trim())
            return false;
        const now = GLib.DateTime.new_now_local();
        const words = text.replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ').trim().split(/\s+/).slice(0, 6).join(' ');
        const base = `${now.format('%Y-%m-%d %H%M')} ${words}`.slice(0, 80);
        try {
            GLib.mkdir_with_parents(folder, 0o755);
            let path = GLib.build_filenamev([folder, `${base}.md`]);
            for (let i = 2; GLib.file_test(path, GLib.FileTest.EXISTS); i++)
                path = GLib.build_filenamev([folder, `${base} ${i}.md`]);
            GLib.file_set_contents(path, `${text.trim()}\n\n— ${now.format('%Y-%m-%d %H:%M')}\n`);
            this._read();
            return true;
        } catch (e) {
            console.error('Glass Widgets: could not save the note', e);
            return false;
        }
    }
}

// ---------- System (CPU, memory, disk) ----------

class SystemSource extends Source {
    start() {
        this._last = null;
        this._read();
        this._id = every(2, () => this._read());
    }

    stop() {
        this._id = clear(this._id);
    }

    _read() {
        const decoder = new TextDecoder();
        const read = path => decoder.decode(GLib.file_get_contents(path)[1]);
        let cpu = 0;
        try {
            const fields = read('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
            const idle = fields[3] + fields[4];
            const total = fields.reduce((a, b) => a + b, 0);
            if (this._last && total > this._last.total)
                cpu = 1 - (idle - this._last.idle) / (total - this._last.total);
            this._last = {idle, total};
        } catch {
            // unreadable: left out
        }
        const mem = {};
        try {
            for (const line of read('/proc/meminfo').split('\n')) {
                const m = /^(\w+):\s+(\d+)/.exec(line);
                if (m)
                    mem[m[1]] = Number(m[2]) * 1024;
            }
        } catch {
            // unreadable: left out
        }
        let disk = {size: 0, free: 0};
        try {
            const info = Gio.File.new_for_path(GLib.get_home_dir())
                .query_filesystem_info('filesystem::size,filesystem::free', null);
            disk = {size: info.get_attribute_uint64('filesystem::size'), free: info.get_attribute_uint64('filesystem::free')};
        } catch {
            // unreadable: left out
        }
        let uptime = 0;
        try {
            uptime = Number(read('/proc/uptime').split(' ')[0]);
        } catch {
            // unreadable: left out
        }
        const memTotal = mem.MemTotal ?? 0;
        const memUsed = memTotal - (mem.MemAvailable ?? 0);
        this.set({
            cpu: Math.max(0, Math.min(1, cpu)),
            memory: memTotal ? memUsed / memTotal : 0,
            memUsed,
            memTotal,
            disk: disk.size ? 1 - disk.free / disk.size : 0,
            diskFree: disk.free,
            diskSize: disk.size,
            uptime,
        });
    }
}

// ---------- Batteries (UPower: the laptop and Bluetooth devices) ----------

const UPOWER = 'org.freedesktop.UPower';
// UPower device types → icons; types left out (line power, UPS) are not shown.
const DEVICE_ICONS = {
    2: 'computer-symbolic', 5: 'input-mouse-symbolic', 6: 'input-keyboard-symbolic', 8: 'phone-symbolic',
    9: 'multimedia-player-symbolic', 10: 'input-tablet-symbolic', 12: 'input-gaming-symbolic',
    13: 'input-mouse-symbolic', 17: 'audio-headset-symbolic', 18: 'audio-speakers-symbolic',
    19: 'audio-headphones-symbolic', 22: 'input-mouse-symbolic', 24: 'input-gaming-symbolic',
    25: 'input-tablet-symbolic',
};

class BatteriesSource extends Source {
    start() {
        const bus = Gio.DBus.system;
        const refresh = () => this._queue();
        this._signals = [
            bus.signal_subscribe(UPOWER, 'org.freedesktop.UPower', null, '/org/freedesktop/UPower', null,
                Gio.DBusSignalFlags.NONE, refresh),
            bus.signal_subscribe(UPOWER, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', null,
                'org.freedesktop.UPower.Device', Gio.DBusSignalFlags.NONE, refresh),
        ];
        this._read();
        this._id = every(60, () => this._read());
    }

    stop() {
        this._signals?.forEach(id => Gio.DBus.system.signal_unsubscribe(id));
        this._signals = null;
        this._id = clear(this._id);
        this._idle = clear(this._idle);
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._idle = 0;
            this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _call(path, iface, method, params, type) {
        const reply = await Gio.DBus.system.call(UPOWER, path, iface, method, params,
            new GLib.VariantType(type), Gio.DBusCallFlags.NONE, 2000, null);
        return reply.recursiveUnpack()[0];
    }

    async _read() {
        try {
            const paths = await this._call('/org/freedesktop/UPower', 'org.freedesktop.UPower',
                'EnumerateDevices', null, '(ao)');
            const devices = [];
            for (const path of paths) {
                const p = await this._call(path, 'org.freedesktop.DBus.Properties', 'GetAll',
                    new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']), '(a{sv})');
                const icon = DEVICE_ICONS[p.Type];
                if (!icon || !p.IsPresent || (p.Type === 2 && !p.PowerSupply))
                    continue;
                devices.push({
                    path,
                    name: p.Type === 2 ? '' : (p.Model || p.Vendor || ''),
                    laptop: p.Type === 2,
                    icon,
                    level: p.Percentage / 100,
                    charging: p.State === 1 || p.State === 4,
                });
            }
            devices.sort((a, b) => Number(b.laptop) - Number(a.laptop));
            this.set(devices);
        } catch {
            if (this.value === undefined)
                this.set([]);
        }
    }
}

// ---------- Music (MPRIS) ----------

const MPRIS = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.DBus'));
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.mpris.MediaPlayer2'));
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.mpris.MediaPlayer2.Player'));

// Follows every player on the session bus and shows one: the most recently playing,
// otherwise the most recently active paused one.
class MediaSource extends Source {
    start() {
        this._players = new Map();
        this._stopped = false;
        this._dbus = new DBusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', (proxy, error) => {
            if (error || this._stopped)
                return;
            proxy.ListNamesRemote(([names], err) => {
                if (!err && !this._stopped)
                    names.filter(n => n.startsWith(MPRIS)).forEach(n => this._add(n));
                this._emit();
            });
            this._ownerId = proxy.connectSignal('NameOwnerChanged', (_p, _s, [name, oldOwner, newOwner]) => {
                if (!name.startsWith(MPRIS))
                    return;
                if (oldOwner)
                    this._remove(name);
                if (newOwner)
                    this._add(name);
            });
        });
    }

    stop() {
        this._stopped = true;
        if (this._ownerId)
            this._dbus?.disconnectSignal(this._ownerId);
        this._ownerId = 0;
        for (const name of [...(this._players?.keys() ?? [])])
            this._remove(name, false);
        this._dbus = null;
    }

    _add(name) {
        if (this._players.has(name))
            return;
        const entry = {name, stamp: 0, ready: false};
        this._players.set(name, entry);
        entry.player = new PlayerProxy(Gio.DBus.session, name, MPRIS_PATH, (proxy, error) => {
            if (error || this._stopped || !this._players.has(name))
                return;
            entry.ready = true;
            if (proxy.PlaybackStatus === 'Playing')
                entry.stamp = Date.now();
            entry.changedId = proxy.connect('g-properties-changed', () => {
                if (proxy.PlaybackStatus === 'Playing')
                    entry.stamp = Date.now();
                this._emit();
            });
            this._emit();
        });
        entry.mpris = new MprisProxy(Gio.DBus.session, name, MPRIS_PATH, (_p, error) => {
            if (!error && !this._stopped)
                this._emit();
        });
    }

    _remove(name, notify = true) {
        const entry = this._players.get(name);
        if (!entry)
            return;
        if (entry.changedId)
            entry.player.disconnect(entry.changedId);
        this._players.delete(name);
        if (notify)
            this._emit();
    }

    _current() {
        const ready = [...this._players.values()].filter(e => e.ready && e.player.g_name_owner);
        ready.sort((a, b) => b.stamp - a.stamp);
        return ready.find(e => e.player.PlaybackStatus === 'Playing') ?? ready[0] ?? null;
    }

    _emit() {
        const entry = this._current();
        if (!entry) {
            this.set(null);
            return;
        }
        const metadata = entry.player.Metadata ?? {};
        const get = key => metadata[key]?.deepUnpack?.();
        const artists = get('xesam:artist');
        const desktop = entry.mpris?.DesktopEntry;
        const app = desktop ? Shell.AppSystem.get_default().lookup_app(`${desktop}.desktop`) : null;
        this._entry = entry;
        this.set({
            title: get('xesam:title') ?? '',
            artist: Array.isArray(artists) ? artists.join(', ') : (artists ?? ''),
            album: get('xesam:album') ?? '',
            artUrl: get('mpris:artUrl') ?? '',
            playing: entry.player.PlaybackStatus === 'Playing',
            canNext: !!entry.player.CanGoNext,
            canPrevious: !!entry.player.CanGoPrevious,
            app,
            appName: app?.get_name() ?? entry.mpris?.Identity ?? '',
        });
    }

    playPause() {
        this._entry?.player.PlayPauseRemote();
    }

    next() {
        this._entry?.player.NextRemote();
    }

    previous() {
        this._entry?.player.PreviousRemote();
    }

    raise() {
        if (this._entry?.mpris?.CanRaise)
            this._entry.mpris.RaiseRemote();
        else
            this.value?.app?.activate();
    }
}

// ---------- Calendar (GNOME's calendar server: Online Accounts, Evolution) ----------

class CalendarSource extends Source {
    start() {
        this._events = new Calendar.DBusEventSource();
        this._changedId = this._events.connect('changed', () => this._emit());
        this._dayId = every(60, () => {
            if (new Date().getDate() !== this._day)
                this._request();
        });
        this._request();
    }

    stop() {
        this._dayId = clear(this._dayId);
        if (this._events) {
            this._events.disconnect(this._changedId);
            this._events.destroy();
        }
        this._events = null;
    }

    _request() {
        const now = new Date();
        this._day = now.getDate();
        // This month (the month grid's dots) and the next two weeks (upcoming events).
        this._begin = new Date(now.getFullYear(), now.getMonth(), 1);
        const twoWeeks = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 15);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        this._end = twoWeeks > monthEnd ? twoWeeks : monthEnd;
        this._events.requestRange(this._begin, this._end);
        this._emit();
    }

    _emit() {
        if (!this._events)
            return;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const all = this._events.getEvents(this._begin, this._end).map(e => ({
            summary: e.summary,
            date: e.date,
            end: e.end,
            allDay: e.date.getHours() === 0 && e.date.getMinutes() === 0 && e.end - e.date >= 86400000 - 60000,
        }));
        const days = new Set(all.map(e => `${e.date.getMonth()}-${e.date.getDate()}`));
        this.set({
            hasCalendars: this._events.hasCalendars,
            upcoming: all.filter(e => e.end > now && e.date >= today).slice(0, 8),
            hasEvents: d => days.has(`${d.getMonth()}-${d.getDate()}`),
        });
    }
}

// ---------- Network (NetworkManager, the interface counters, a ping, Tailscale) ----------

// Live throughput from the interface's byte counters, the connection's name and kind
// from NetworkManager, the round trip to 1.1.1.1, and Tailscale when it is installed.
class NetworkSource extends Source {
    start() {
        this._history = [];
        this._last = null;
        this._latency = null;
        this._tailscale = null;
        NM.Client.new_async(null, (_o, res) => {
            try {
                this._client = NM.Client.new_finish(res);
                this._nmId = this._client.connect('notify::primary-connection', () => this._read());
            } catch {
                this._client = null;
            }
            this._read();
        });
        this._id = every(2, () => this._read());
        this._ping();
        this._pingId = every(30, () => {
            // Every 30 s, or every 2 minutes on a metered connection.
            this._pings = (this._pings ?? 0) + 1;
            if (!metered() || this._pings % 4 === 0)
                this._ping();
        });
        this._tail();
        this._tailId = every(60, () => this._tail());
    }

    stop() {
        this._id = clear(this._id);
        this._pingId = clear(this._pingId);
        this._tailId = clear(this._tailId);
        if (this._client && this._nmId)
            this._client.disconnect(this._nmId);
        this._client = null;
        this._nmId = 0;
    }

    _run(argv, done) {
        try {
            const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (pr, res) => {
                try {
                    const [, out] = pr.communicate_utf8_finish(res);
                    done(pr.get_successful() ? out : null);
                } catch {
                    done(null);
                }
            });
        } catch {
            done(null);
        }
    }

    _ping() {
        this._run(['ping', '-c', '1', '-W', '2', '1.1.1.1'], out => {
            const m = /time=([\d.]+)/.exec(out ?? '');
            this._latency = m ? Number(m[1]) : null;
        });
    }

    _tail() {
        if (!GLib.find_program_in_path('tailscale')) {
            this._tailscale = {installed: false};
            return;
        }
        this._run(['tailscale', 'status', '--json'], out => {
            try {
                const s = JSON.parse(out);
                const peers = Object.values(s.Peer ?? {});
                this._tailscale = {installed: true, up: s.BackendState === 'Running', ip: s.Self?.TailscaleIPs?.[0] ?? '',
                    online: peers.filter(p => p.Online).length, peers: peers.length};
            } catch {
                this._tailscale = {installed: true, up: false};
            }
        });
    }

    _read() {
        const primary = this._client?.get_primary_connection() ?? null;
        const device = primary?.get_devices()?.[0] ?? null;
        const iface = device?.get_ip_iface?.() || device?.get_iface?.() || null;
        let wifi = false;
        let strength = null;
        if (device instanceof NM.DeviceWifi) {
            wifi = true;
            strength = device.get_active_access_point()?.get_strength() ?? null;
        }
        let down = 0;
        let up = 0;
        if (iface) {
            const read = name => {
                try {
                    return Number(new TextDecoder().decode(
                        GLib.file_get_contents(`/sys/class/net/${iface}/statistics/${name}`)[1]));
                } catch {
                    return 0;
                }
            };
            const now = GLib.get_monotonic_time() / 1e6;
            const rx = read('rx_bytes');
            const tx = read('tx_bytes');
            if (this._last && this._last.iface === iface && now > this._last.t) {
                down = Math.max(0, (rx - this._last.rx) / (now - this._last.t));
                up = Math.max(0, (tx - this._last.tx) / (now - this._last.t));
            }
            this._last = {iface, rx, tx, t: now};
        }
        this._history.push(down);
        if (this._history.length > 40)
            this._history.shift();
        this.set({
            online: !!primary,
            name: primary?.get_id() ?? '',
            wifi,
            vpn: primary?.get_vpn?.() ?? false,
            strength,
            down,
            up,
            history: [...this._history],
            latency: this._latency,
            tailscale: this._tailscale,
            metered: metered(),
        });
    }
}

// ---------- All of them ----------

export class Sources {
    constructor(settings) {
        this._settings = settings;
        this._made = new Map();
    }

    _get(name, make) {
        if (!this._made.has(name))
            this._made.set(name, make());
        return this._made.get(name);
    }

    get clock() {
        return this._get('clock', () => new ClockSource());
    }

    get weather() {
        return this._get('weather', () => new WeatherSource(this._settings));
    }

    get harvis() {
        return this._get('harvis', () => new HarvisSource(this._settings));
    }

    get notes() {
        return this._get('notes', () => new NotesSource(this._settings));
    }

    get system() {
        return this._get('system', () => new SystemSource());
    }

    get batteries() {
        return this._get('batteries', () => new BatteriesSource());
    }

    get media() {
        return this._get('media', () => new MediaSource());
    }

    get calendar() {
        return this._get('calendar', () => new CalendarSource());
    }

    get network() {
        return this._get('network', () => new NetworkSource());
    }

    destroy() {
        for (const source of this._made.values())
            source.destroy();
        this._made.clear();
    }
}
